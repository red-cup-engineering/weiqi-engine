import assert from "node:assert/strict";
import { test } from "node:test";
import { BLACK, EMPTY, WHITE, pointToCoord } from "../src/board.mjs";
import { Game, _checkKoViolationForTests } from "../src/game.mjs";
import { createPositionFromCells } from "../src/position.mjs";
import { boardHash } from "../src/zobrist.mjs";

// Zobrist board hashes are 64-bit XORs of per-cell stone keys. At least
// one nonempty subset of 65 distinct Black-stone keys must XOR to zero:
// 65 vectors in the 64-dimensional vector space GF(2)^64 are dependent.
// Find an explicit, deterministic witness from the *actual* engine keys,
// not from fabricated collision fields or a birthday-probability argument.
// Before the first dependency the basis is independent, so intermediate
// prefixes of the witness cannot already duplicate a prior hash.
function actualCollisionPoints() {
  const basis = new Array(64).fill(null);
  for (let point = 0; point < 65; point++) {
    const cells = new Uint8Array(81);
    cells[point] = BLACK;
    let hash = boardHash(cells);
    let mask = 1n << BigInt(point);
    for (let bit = 63; bit >= 0; bit--) {
      if ((hash & (1n << BigInt(bit))) === 0n) continue;
      if (!basis[bit]) {
        basis[bit] = { hash, mask };
        break;
      }
      hash ^= basis[bit].hash;
      mask ^= basis[bit].mask;
    }
    if (hash === 0n) {
      const points = [];
      for (let i = 0; i <= point; i++) {
        if ((mask & (1n << BigInt(i))) !== 0n) points.push(i);
      }
      return points;
    }
  }
  throw new Error("65 Zobrist vectors in GF(2)^64 cannot all be independent");
}

const collisionPoints = actualCollisionPoints();
const collisionCells = new Uint8Array(81);
for (const point of collisionPoints) collisionCells[point] = BLACK;

test("a real, nonempty board collides with the empty 9x9 board's Zobrist hash", () => {
  assert.ok(collisionPoints.length > 0 && collisionPoints.length <= 65);
  assert.equal(boardHash(collisionCells), boardHash(new Uint8Array(81)));
  assert.notDeepEqual(collisionCells, new Uint8Array(81),
    "equal hashes must not imply identical stone arrangements");
});

test("Chinese positional superko compares board cells after a genuine hash collision", () => {
  const game = new Game(9, "chinese");
  for (let i = 0; i < collisionPoints.length; i++) {
    const coord = pointToCoord(9, collisionPoints[i]);
    assert.equal(game.isLegal(coord), true,
      `${coord} has never appeared on the board; its hash is only a filter`);
    assert.equal(game.play(coord).ok, true, `legal Black placement ${coord}`);
    if (i + 1 < collisionPoints.length) {
      assert.equal(game.play("pass").ok, true, "White passes between Black placements");
    }
  }
  assert.deepEqual(game.current.board, collisionCells);
  assert.equal(game.current.boardHash, game.history[0].boardHash);
  assert.notDeepEqual(game.current.board, game.history[0].board);
});

test("AGA situational superko also distinguishes same-turn hash collisions", () => {
  const game = new Game(9, "aga");
  // J9 is outside the 65 cells used by the collision witness. Its
  // post-placement position (White to move) is the comparison baseline.
  assert.equal(game.play("J9").ok, true);
  const initial = game.current;
  assert.equal(game.play("pass").ok, true);
  for (let i = 0; i < collisionPoints.length; i++) {
    const coord = pointToCoord(9, collisionPoints[i]);
    assert.equal(game.isLegal(coord), true, `same-turn collision must not forbid ${coord}`);
    assert.equal(game.play(coord).ok, true);
    if (i + 1 < collisionPoints.length) assert.equal(game.play("pass").ok, true);
  }
  assert.equal(game.current.situationalHash, initial.situationalHash);
  assert.equal(game.current.toMove, initial.toMove);
  assert.notDeepEqual(game.current.board, initial.board);
});

test("simple ko confirms actual board equality when a hash happens to match", () => {
  const empty = createPositionFromCells(9, 9, new Uint8Array(81), BLACK);
  const middle = createPositionFromCells(9, 9,
    Uint8Array.from({ length: 81 }, (_, i) => i === 80 ? WHITE : EMPTY), WHITE);
  const colliding = createPositionFromCells(9, 9, collisionCells, BLACK);
  assert.equal(colliding.boardHash, empty.boardHash);
  assert.equal(_checkKoViolationForTests([empty, middle], colliding, "simple_ko"), null);
  const repeated = createPositionFromCells(9, 9, new Uint8Array(81), WHITE);
  assert.equal(_checkKoViolationForTests([empty, middle], repeated, "simple_ko"), "simple-ko");
});
