import { test } from "node:test";
import assert from "node:assert/strict";
import { coordToPoint, pointToCoord, neighbors, findGroup, BLACK, WHITE, createEmptyBoard } from "../src/board.mjs";

test("coordToPoint / pointToCoord round-trip, and skip the letter I", () => {
  assert.equal(coordToPoint(9, 9, "A1"), 0);
  assert.equal(pointToCoord(9, 0), "A1");
  // 9th column letter is J, not I.
  assert.equal(coordToPoint(9, 9, "J1"), 8);
  assert.throws(() => coordToPoint(9, 9, "I1"));
});

test("coordToPoint matches regression-positions.md's row-1-at-top convention", () => {
  // R13's 9x9 diagram: row 3 has stones at C and G -> C3 should be row index 2.
  assert.equal(coordToPoint(9, 9, "C3"), 2 * 9 + 2);
  assert.equal(coordToPoint(9, 9, "G3"), 2 * 9 + 6);
});

test("out-of-range coordinates throw", () => {
  assert.throws(() => coordToPoint(9, 9, "J10"));
  assert.throws(() => coordToPoint(9, 9, "K1"));
});

test("coordToPoint validates column against width and row against height independently (non-square boards)", () => {
  // 7 wide, 5 tall (R9's shape): G is in range (7th letter), row 5 is in range, row 6 is not.
  assert.equal(coordToPoint(7, 5, "G5"), 4 * 7 + 6);
  assert.throws(() => coordToPoint(7, 5, "G6"));
  assert.throws(() => coordToPoint(7, 5, "H1"));
});

test("neighbors respects board edges", () => {
  assert.deepEqual(new Set(neighbors(9, 9, 0)), new Set([1, 9])); // corner A1: 2 neighbors
  assert.equal(neighbors(9, 9, 40).length, 4); // interior point: 4 neighbors
});

test("neighbors respects independent width/height bounds on a non-square board", () => {
  // 7 wide x 5 tall: bottom-right corner is point (7*5-1)=34.
  const bottomRight = 7 * 5 - 1;
  assert.deepEqual(new Set(neighbors(7, 5, bottomRight)), new Set([bottomRight - 1, bottomRight - 7]));
});

test("findGroup flood-fills connected same-color stones and their liberties", () => {
  const width = 5;
  const height = 5;
  const board = createEmptyBoard(width, height);
  // Two black stones connected horizontally at B2-C2 (points 6,7 in a 5-wide board).
  board[6] = BLACK;
  board[7] = BLACK;
  board[11] = WHITE; // B3, a neighbor liberty-blocker
  const g = findGroup(board, width, height, 6);
  assert.equal(g.color, BLACK);
  assert.deepEqual(new Set(g.stones), new Set([6, 7]));
  // Liberties: A2(5), B1(1), C1(2), D2(8), C3(12) -- B3(11) is White, not a liberty.
  assert.deepEqual(new Set(g.liberties), new Set([5, 1, 2, 8, 12]));
});

test("findGroup throws on an empty starting point", () => {
  const board = createEmptyBoard(5, 5);
  assert.throws(() => findGroup(board, 5, 5, 0));
});
