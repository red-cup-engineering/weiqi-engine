import { test } from "node:test";
import assert from "node:assert/strict";
import { BLACK, EMPTY, WHITE, coordToPoint } from "../src/board.mjs";
import { Game } from "../src/game.mjs";
import { createEmptyPosition, createPositionFromCells } from "../src/position.mjs";
import { boardHash, situationalHash } from "../src/zobrist.mjs";

test("independent initial board ownership prevents foreign changes from manufacturing moves", () => {
  const original = createEmptyPosition(9);
  const game = new Game(9, "chinese", original);
  assert.notStrictEqual(game.current.board, original.board);
  original.board[coordToPoint(9, 9, "A1")] = BLACK;
  assert.equal(game.current.board[0], EMPTY,
    "the external Position's writable cells cannot mutate the admitted game");
  assert.equal(game.play("A1").ok, true, "A1 remains legal after unrelated source mutation");
  assert.equal(game.current.board[0], BLACK);

  const second = new Game(9, "chinese", original);
  assert.equal(second.current.board[0], BLACK, "a later game sees what was explicitly provided");
  assert.equal(game.history[0].board[0], EMPTY, "earlier game's accepted opening is unchanged");
});

test("external geometry, player and prisoner fields are validated at Game admission", () => {
  for (const width of [5, 7, 19]) {
    assert.throws(() => new Game(9, "chinese", createEmptyPosition(width)),
      /Initial Weiqi position must match/, "wrong-sized board cannot masquerade as a 9x9 Game");
  }
  const valid = createEmptyPosition(9);
  for (const bad of [undefined, 0, 3, null]) {
    assert.throws(() => new Game(9, "chinese", { ...valid, toMove: bad }),
      /must declare its player/, "the turn may not default to an invented Black");
  }
  assert.throws(() => new Game(9, "chinese", { ...valid, capturedBlackStones: undefined }),
    /prisoner counts/);
  assert.throws(() => new Game(9, "chinese", { ...valid, capturedWhiteStones: -1 }),
    /nonnegative/);
  const invalid = { ...valid, board: new Uint8Array(81) };
  invalid.board[0] = 3;
  assert.throws(() => new Game(9, "chinese", invalid), /Invalid stone/);
  assert.equal(new Game(9, "chinese", null).current.board.length, 81,
    "null retains the original empty-position default");
});

test("a forged input hash is recomputed from admitted original cells and turn", () => {
  const initial = createPositionFromCells(9, 9, Array(81).fill(EMPTY), WHITE, 2, 3);
  const forged = { ...initial, boardHash: "not-a-board-hash",
    situationalHash: "not-a-situational-hash" };
  const game = new Game(9, "japanese", forged);
  assert.equal(game.current.toMove, WHITE);
  assert.equal(game.current.capturedBlackStones, 2);
  assert.equal(game.current.capturedWhiteStones, 3);
  assert.equal(game.current.boardHash, boardHash(game.current.board));
  assert.equal(game.current.situationalHash, situationalHash(game.current.board, WHITE));
  assert.notEqual(game.current.boardHash, forged.boardHash);
});

test("trusted search forks preserve history sharing without re-admitting source cells", () => {
  const game = new Game(9, "chinese", createEmptyPosition(9));
  assert.equal(game.play("E5").ok, true);
  const branch = game.fork();
  assert.strictEqual(branch.history[0], game.history[0],
    "trusted internal forks retain the source's cheap immutable-position sharing");
  assert.strictEqual(branch.history[1], game.history[1]);
  assert.equal(branch.play("F5").ok, true);
  assert.equal(game.current.toMove, WHITE, "a speculative branch never advances the parent");
  assert.equal(game.history.length, 2);
  assert.equal(branch.history.length, 3);
});
