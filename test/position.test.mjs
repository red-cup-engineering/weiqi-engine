import { test } from "node:test";
import assert from "node:assert/strict";
import { createEmptyPosition, applyStonePlacement, applyPass, createPositionFromCells } from "../src/position.mjs";
import { coordToPoint, BLACK, WHITE, EMPTY } from "../src/board.mjs";
import { boardHash } from "../src/zobrist.mjs";

const ILLEGAL = { suicide: "illegal" };
const LEGAL = { suicide: "legal" };

test("placing a stone on an empty point succeeds and flips toMove", () => {
  const pos = createEmptyPosition(9);
  const r = applyStonePlacement(pos, coordToPoint(9, 9, "C3"), ILLEGAL);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.position.board[coordToPoint(9, 9, "C3")], BLACK);
  assert.equal(r.position.toMove, WHITE);
  assert.equal(r.captured.length, 0);
});

test("placing on an occupied point fails", () => {
  const pos = createEmptyPosition(9);
  const r1 = applyStonePlacement(pos, coordToPoint(9, 9, "C3"), ILLEGAL);
  assert.ok(r1.ok);
  if (!r1.ok) return;
  const r2 = applyStonePlacement(r1.position, coordToPoint(9, 9, "C3"), ILLEGAL);
  assert.equal(r2.ok, false);
  if (r2.ok) return;
  assert.equal(r2.reason, "occupied");
});

test("off-board point is rejected", () => {
  const pos = createEmptyPosition(9);
  const r = applyStonePlacement(pos, 999, ILLEGAL);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.reason, "off-board");
});

// regression-positions.md R4's board, verbatim: a Black ring (B2:D4,
// hollow at C3) on a 5x5 board, with real liberties outside the ring so
// it is unconditionally alive. (A 3x3 board holding only the ring would
// give it no outside liberties: the center would be its only liberty, and
// filling it would capture the whole ring outright, R8-style, not suicide
// -- which is why the corpus draws the 5x5 board.) The R5-shaped test
// below checks the suicide rule alone at the Position level; R5 itself is
// a two-stone self-capture, because on a real Game New Zealand's
// positional superko also forbids this one-stone shape (see game.test.mts):
//     . . . . .
//     . X X X .
//     . X . X .
//     . X X X .
//     . . . . .

function ringFragmentCells() {
  const cells = new Array(25).fill(EMPTY);
  for (const c of ["B2", "C2", "D2", "B3", "D3", "B4", "C4", "D4"]) {
    cells[coordToPoint(5, 5, c)] = BLACK;
  }
  return cells;
}

test("R4-shaped suicide is illegal under a suicide:illegal ruleset", () => {
  const pos = createPositionFromCells(5, 5, ringFragmentCells(), WHITE);
  const r = applyStonePlacement(pos, coordToPoint(5, 5, "C3"), ILLEGAL);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.reason, "suicide");
});

test("R5-shaped suicide is legal and self-removes under a suicide:legal ruleset (New Zealand)", () => {
  const pos = createPositionFromCells(5, 5, ringFragmentCells(), WHITE);
  const r = applyStonePlacement(pos, coordToPoint(5, 5, "C3"), LEGAL);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.position.board[coordToPoint(5, 5, "C3")], EMPTY);
  assert.ok(r.selfCaptured);
  assert.equal(r.selfCaptured.color, WHITE);
  assert.equal(r.position.capturedWhiteStones, 1);
});

test("R8-shaped move is a legal capture, not suicide (captures resolve before self-liberty check)", () => {
  // 2x2: O . / X .   Black to play B1, capturing White's lone stone at A1.
  const cells = [WHITE, EMPTY, BLACK, EMPTY];
  const pos = createPositionFromCells(2, 2, cells, BLACK);
  const r = applyStonePlacement(pos, coordToPoint(2, 2, "B1"), ILLEGAL);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.captured.length, 1);
  assert.equal(r.captured[0].color, WHITE);
  assert.equal(r.position.board[coordToPoint(2, 2, "A1")], EMPTY);
  assert.equal(r.position.board[coordToPoint(2, 2, "B1")], BLACK);
  assert.equal(r.position.capturedWhiteStones, 1);
  assert.equal(r.selfCaptured, null);
});

test("capturing a multi-stone group removes every stone and credits every prisoner", () => {
  // 3x3: White pair at B1,C1 (top row) has a single liberty at A1;
  // Black plays A1 and captures both.
  const size = 3;
  const cells = new Array(9).fill(EMPTY);
  cells[1] = WHITE; // B1
  cells[2] = WHITE; // C1
  cells[4] = BLACK; // B2 (below B1)
  cells[5] = BLACK; // C2 (below C1)
  const pos = createPositionFromCells(size, size, cells, BLACK);
  const r = applyStonePlacement(pos, coordToPoint(size, size, "A1"), ILLEGAL);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.captured.length, 1);
  assert.equal(r.captured[0].stones.length, 2);
  assert.equal(r.position.capturedWhiteStones, 2);
  assert.equal(r.position.board[1], EMPTY);
  assert.equal(r.position.board[2], EMPTY);
});

test("pass flips toMove, leaves the board and hashes' board-component unchanged", () => {
  const pos = createEmptyPosition(9, 9, BLACK);
  const next = applyPass(pos);
  assert.equal(next.toMove, WHITE);
  assert.deepEqual(next.board, pos.board);
  assert.equal(next.boardHash, boardHash(pos.board));
  assert.notEqual(next.situationalHash, pos.situationalHash);
});

test("createPositionFromCells rejects a mismatched cell count", () => {
  assert.throws(() => createPositionFromCells(9, 9, [BLACK, WHITE], BLACK));
});
