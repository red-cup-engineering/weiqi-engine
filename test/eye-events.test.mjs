import assert from "node:assert/strict";
import test from "node:test";
import { Game } from "../src/game.mjs";

function eyeTurns(moves, point) {
  const game = new Game(9, "chinese");
  const turns = [];
  for (const [index, move] of moves.entries()) {
    const result = game.play(move);
    assert.equal(result.ok, true, move);
    if (result.events.some(event => event.type === "eye-formed" && event.detail.point === point)) {
      turns.push(index + 1);
    }
  }
  return turns;
}

test("corner eye is announced on the move connecting its diagonals", () => {
  assert.deepEqual(eyeTurns(["A2", "J9", "B1", "J8", "B2"], "A1"), [5]);
  assert.deepEqual(eyeTurns(["A2", "B2", "B1"], "A1"), []);
});

test("edge needs both supporting diagonals and the centre needs three", () => {
  const withPasses = moves => moves.flatMap(move => [move, "pass"]);
  assert.deepEqual(eyeTurns(withPasses(["A3","A5","B4","B3","B5"]), "A4"), [9]);
  assert.deepEqual(eyeTurns(withPasses(["D3","D5","C4","E4","C3","E3","C5","E5"]), "D4"), [13]);
});
