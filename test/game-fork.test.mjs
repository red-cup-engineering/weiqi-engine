import { test } from "node:test";
import assert from "node:assert/strict";
import { Game } from "../src/game.mjs";
import { BLACK, WHITE } from "../src/board.mjs";
import { parseDiagram } from "./helpers/diagram.mjs";

test("fork preserves a real simple-ko prohibition and separates mutable histories", () => {
  const { position } = parseDiagram([
    ". . . . .", ". . X . .", ". X O X .", ". O . O .", ". . O . .",
  ], 5, BLACK);
  const game = new Game(5, "japanese", position);
  assert.equal(game.play("C4").ok, true);
  assert.equal(new Game(5, "japanese", game.current).isLegal("C3"), true,
    "a current-position-only simulation incorrectly permits the ko recapture");

  const branch = game.fork();
  assert.notEqual(branch, game);
  assert.notEqual(branch.history, game.history);
  assert.notEqual(branch.moveEvents, game.moveEvents);
  assert.equal(branch.current, game.current, "immutable position values can be shared");
  assert.equal(branch.activeKoPoint, game.activeKoPoint);
  assert.deepEqual(branch.play("C3"), { ok: false, reason: "simple-ko" });
  assert.equal(branch.play("A1").ok, true);
  assert.equal(game.history.length, 2, "the parent has not advanced");
  assert.equal(game.isLegal("C3"), false);
});

test("fork preserves historical superko across the real triple-ko cycle", () => {
  const { position } = parseDiagram([
    ". . . . . . . . . . . . . . . . .",
    ". . X . . . . . O . . . . . X . .",
    ". X O X . . . O X O . . . X O X .",
    ". O . O . . . X . X . . . O . O .",
    ". . O . . . . . X . . . . . O . .",
  ], 17, BLACK);
  for (const [ruleset, reason] of [
    ["chinese", "positional-superko"],
    ["aga", "situational-superko"],
  ]) {
    const game = new Game(17, ruleset, position);
    for (const move of ["C4", "J4", "P4", "C3", "J3"]) {
      assert.equal(game.play(move).ok, true, ruleset + " " + move);
    }
    const branch = game.fork();
    assert.equal(branch.history.length, game.history.length);
    assert.deepEqual(branch.play("P3"), { ok: false, reason });
    assert.equal(new Game(17, ruleset, game.current).play("P3").ok, true,
      "the old MCTS trial can play a move forbidden by real game history");
    assert.equal(game.history.length, 6);
  }
});

test("fork preserves pass streaks and terminal state without changing its parent", () => {
  const game = new Game(9, "chinese");
  assert.equal(game.play("E5").ok, true);
  assert.equal(game.play("pass").ok, true);
  const branch = game.fork();
  assert.equal(branch.passStreak, 1);
  const pass = branch.play("pass");
  assert.equal(pass.ok, true);
  assert.ok(pass.events.some(event => event.type === "game-ended"));
  assert.equal(branch.mainPhaseEnded, true);
  assert.equal(game.mainPhaseEnded, false);
  assert.equal(game.passStreak, 1);

  assert.equal(branch.play("C3").ok, true);
  const resumed = branch.fork();
  assert.equal(resumed.passStreak, 0);
  assert.equal(resumed.mainPhaseEnded, true);
  assert.equal(resumed.result, null);
  assert.deepEqual(resumed.settle([]), { ok: false, reason: "main-phase-open" },
    "an earlier two-pass phase is not permission to settle after resuming");
  assert.equal(resumed.play("pass").ok, true);
  assert.equal(resumed.play("pass").ok, true);
  assert.equal(resumed.settle([]).ok, true, "a fresh pass pair permits settlement");
  const settled = resumed.fork();
  assert.deepEqual(settled.result, resumed.result);
  assert.deepEqual(settled.play("A1"), { ok: false, reason: "game-ended" });
  assert.equal(branch.result, null);

  const resigned = new Game(9, "japanese");
  assert.equal(resigned.resign(WHITE).ok, true);
  const terminal = resigned.fork();
  assert.deepEqual(terminal.result, resigned.result);
  assert.deepEqual(terminal.play("A1"), { ok: false, reason: "game-ended" });
});
