
import assert from "node:assert/strict";
import { test } from "node:test";
import * as engine from "../src/index.mjs";
import { BOT_TIERS, chooseMonteCarloMove, candidateMoveCoords } from "../src/policies.mjs";

test("native Game engine supplies the entire house opponent policy ladder", () => {
  assert.deepEqual(BOT_TIERS.map(x => x.id),
    ["random", "greedy", "liberty", "influence", "montecarlo"]);
  const opening = new engine.Game(9, "chinese");
  const originalHash = opening.current.boardHash;
  for (const tier of BOT_TIERS) {
    const move = tier.id === "montecarlo"
      ? chooseMonteCarloMove(opening, engine, () => 0.37, {playouts: 5, maxPlayoutMoves: 0})
      : tier.chooser(opening, engine, () => 0.37);
    assert.ok(opening.isLegal(move), tier.id + " must produce an engine-legal response");
    assert.equal(opening.current.boardHash, originalHash, "an opponent must not change the real board while reading");
  }
});
test("every move policy uses the actual rules engine on any supported board size", () => {
  for (const size of [9, 13, 19]) {
    const game = new engine.Game(size, "chinese");
    const legal = candidateMoveCoords(game, engine);
    assert.ok(legal.length > 0);
    assert.ok(legal.every(move => game.isLegal(move)));
  }
});

test("handicap post-pass candidates agree with the actual game's area-count improvement", () => {
  for (const ruleset of ["chinese", "aga", "newzealand", "ing"]) {
    for (const handicap of [0, 2, 5]) {
      for (const moves of [["D4", "E4", "pass"], ["D4", "E4", "F4", "pass"]]) {
        const session = engine.createWeiqiGameSession({ size: 9, ruleset, handicap },
          moves.map((move) => move === "pass" ? { kind: "pass" } : { kind: "play", move }));
        const game = engine.materializeWeiqiGame(session);
        const before = engine.countPosition(game);
        const advantage = (count) => game.current.toMove === engine.BLACK
          ? count.score.blackScore - count.score.whiteScore
          : count.score.whiteScore - count.score.blackScore;
        // In these open positions every safe, unowned move improves area.
        // Read that through the actual Game transition and counting owner,
        // not another implementation of the policy's placement preview.
        const expected = game.legalPlacementFrontier().filter((move) => {
          const point = engine.coordToPoint(9, 9, move);
          if (before.ownership[point] === game.current.toMove) return false;
          const branch = game.fork();
          assert.equal(branch.play(move).ok, true);
          const group = engine.findGroup(branch.current.board, 9, 9, point);
          return group.liberties.size > 1 && advantage(engine.countPosition(branch)) > advantage(before);
        });
        assert.ok(expected.length > 50, "this is an unsettled opening, not an endgame pass");
        assert.deepEqual(candidateMoveCoords(game, engine), expected,
          `${ruleset}, handicap ${handicap}, toMove ${game.current.toMove}`);
        assert.deepEqual(game.current.board, engine.materializeWeiqiGame(session).current.board,
          "reading candidates must not mutate the played game");
      }
    }
  }
});

test("every bot contests an early pass in a handicap game instead of opening counting", () => {
  const session = engine.createWeiqiGameSession({ size: 9, ruleset: "chinese", handicap: 2 }, [
    { kind: "play", move: "D4" }, { kind: "play", move: "E4" }, { kind: "pass" },
  ]);
  const game = engine.materializeWeiqiGame(session);
  for (const tier of BOT_TIERS) {
    const move = tier.id === "montecarlo"
      ? chooseMonteCarloMove(game, engine, () => 0.37, { playouts: 5, maxPlayoutMoves: 0 })
      : tier.chooser(game, engine, () => 0.37);
    assert.notEqual(move, "pass", `${tier.id} must contest the unsettled board`);
    const next = engine.admitWeiqiGameCommand(session, session.version, { kind: "play", move });
    assert.equal(next.ok, true, `${tier.id} continuation must be engine-legal`);
    assert.equal(next.session.state.mainPhaseEnded, false);
    assert.equal(next.session.state.passStreak, 0);
    assert.equal(session.state.passStreak, 1, "the original session stays immutable");
  }
});
