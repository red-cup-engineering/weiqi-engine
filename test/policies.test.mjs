
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
