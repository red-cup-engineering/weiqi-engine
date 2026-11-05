import assert from "node:assert/strict";
import { test } from "node:test";
import * as engine from "../src/index.mjs";
import { chooseMonteCarloMove, randomPlayout } from "../src/policies.mjs";

function resumedGame(ruleset = "chinese", handicap = 0) {
  const session = engine.createWeiqiGameSession({ size: 9, ruleset, handicap }, [
    { kind: "play", move: "D4" }, { kind: "play", move: "E4" },
    { kind: "pass" }, { kind: "pass" }, { kind: "play", move: "F4" },
  ]);
  const game = engine.materializeWeiqiGame(session);
  assert.equal(game.mainPhaseEnded, true, "the historical counting phase remains recorded");
  assert.equal(game.passStreak, 0, "a real placement reopened play");
  return game;
}

test("random playouts continue after counting was opened and play resumed", () => {
  for (const ruleset of ["chinese", "japanese", "aga", "newzealand", "ing"]) {
    for (const handicap of [0, 2]) {
      const game = resumedGame(ruleset, handicap);
      const original = game.history.length;
      const winner = randomPlayout(game, engine, () => 0.37, 4);
      assert.equal(game.history.length, original + 4,
        `${ruleset}, handicap ${handicap}: actually execute the bounded continuation`);
      assert.ok([engine.BLACK, engine.WHITE, engine.EMPTY].includes(winner));
      assert.equal(game.mainPhaseEnded, true, "search must not erase historical facts");
      assert.equal(game.result, null, "a capped search is not settlement");
    }
  }
});

test("resumed playouts stop at a NEW pass pair, but not at a single pass", () => {
  const game = resumedGame();
  assert.equal(game.play("pass").ok, true);
  const before = game.history.length;
  randomPlayout(game, engine, () => 0.37, 1);
  assert.equal(game.history.length, before + 1);
  assert.equal(game.passStreak, 0, "the open board still admits placements");
  assert.equal(game.play("pass").ok, true);
  assert.equal(game.play("pass").ok, true);
  const counting = game.history.length;
  randomPlayout(game, engine, () => { throw new Error("counting is not a playout"); }, 4);
  assert.equal(game.history.length, counting);
  // A second disagreement must reopen the same policy again.
  assert.equal(game.play("G4").ok, true);
  randomPlayout(game, engine, () => 0.37, 2);
  assert.equal(game.history.length, counting + 3);
});

test("Monte Carlo expands opponent replies after resumed play without mutating the real game", () => {
  for (const ruleset of ["chinese", "japanese"]) {
    const game = resumedGame(ruleset);
    const before = structuredClone({ history: game.history, events: game.moveEvents,
      passStreak: game.passStreak, mainPhaseEnded: game.mainPhaseEnded, result: game.result });
    const trials = [];
    const fork = game.fork.bind(game);
    game.fork = () => {
      const trial = fork();
      trials.push(trial);
      return trial;
    };
    // Zero random moves isolates actual tree expansion from playout depth.
    const updates = [];
    const move = chooseMonteCarloMove(game, engine, () => 0.37, {
      playouts: 12, maxPlayoutMoves: 0, onProgress: (progress) => updates.push(progress),
    });
    assert.equal(trials.length, 12);
    assert.ok(trials.some((trial) => trial.history.length > before.history.length + 1),
      `${ruleset}: search must read an opponent reply, not repeatedly score only root moves`);
    assert.equal(game.isLegal(move), true);
    assert.equal(updates.at(-1).completed, 12);
    assert.deepEqual({ history: game.history, events: game.moveEvents,
      passStreak: game.passStreak, mainPhaseEnded: game.mainPhaseEnded, result: game.result }, before);
  }
});

test("playouts make no move attempts after a final result", () => {
  for (const start of [() => new engine.Game(9, "chinese"), resumedGame]) {
    for (const end of ["resign", "settle"]) {
      const game = start();
      if (end === "resign") assert.equal(game.resign(engine.BLACK).ok, true);
      else {
        game.play("pass"); game.play("pass");
        assert.equal(game.settle([]).ok, true);
      }
      game.play = () => { throw new Error("a final game cannot continue"); };
      randomPlayout(game, engine, () => { throw new Error("a final game needs no randomness"); }, 4);
    }
  }
});
