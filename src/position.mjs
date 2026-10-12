// Immutable position: a board arrangement plus whose turn it is and the
// running prisoner counts, with its two Zobrist hashes precomputed.
//
// A Position never mutates in place. Every function here that "changes" a
// position returns a brand-new one; the old one remains valid and usable
// (this is what lets Game keep a full, cheap-to-compare history for
// superko).

import {
  BLACK,
  EMPTY,
  WHITE,
  createEmptyBoard,
  findGroup,
  neighbors,
  opponent,

} from "./board.mjs";
import { boardHash, situationalHash } from "./zobrist.mjs";

function finalize(
  width,
  height,
  board,
  toMove,
  capturedBlackStones,
  capturedWhiteStones,
) {
  return {
    width,
    height,
    board,
    toMove,
    capturedBlackStones,
    capturedWhiteStones,
    boardHash: boardHash(board),
    situationalHash: situationalHash(board, toMove),
  };
}

export function createEmptyPosition(width, height = width, toMove = BLACK) {
  return finalize(width, height, createEmptyBoard(width, height), toMove, 0, 0);
}

/**
 * Build a position directly from a full cell array — used to load the
 * regression corpus's hand-drawn diagrams (which are already-resolved
 * board states, not move sequences) and for scoring/territory tests.
 */
export function createPositionFromCells(
  width,
  height,
  cells,
  toMove = BLACK,
  capturedBlackStones = 0,
  capturedWhiteStones = 0,
) {
  if (cells.length !== width * height) {
    throw new Error(`Expected ${width * height} cells, got ${cells.length}`);
  }
  const board = Uint8Array.from(cells);
  return finalize(width, height, board, toMove, capturedBlackStones, capturedWhiteStones);
}

/**
 * Apply a single stone placement, resolving captures and suicide, but
 * WITHOUT any ko/superko check — that requires game history and is the
 * caller's (Game's) job. This function is the pure "physics" of one move:
 * place the stone, remove any opponent groups left with zero liberties,
 * then check the mover's own group.
 */
export function applyStonePlacement(position, point, ruleset) {
  if (!Number.isInteger(point) || point < 0 || point >= position.board.length) {
    return { ok: false, reason: "off-board" };
  }
  if (position.board[point] !== EMPTY) {
    return { ok: false, reason: "occupied" };
  }

  const { width, height } = position;
  const color = position.toMove;
  const opp = opponent(color);
  const board = position.board.slice();
  board[point] = color;

  // Resolve opponent captures first — this is what makes a capturing move
  // never suicide even when the placed stone looks surrounded before the
  // capture is applied (see suicide.md and regression position R8).
  const captured = [];
  const consideredOpp = new Set();
  for (const n of neighbors(width, height, point)) {
    if (board[n] === opp && !consideredOpp.has(n)) {
      const g = findGroup(board, width, height, n);
      for (const s of g.stones) consideredOpp.add(s);
      if (g.liberties.size === 0) captured.push(g);
    }
  }
  for (const g of captured) {
    for (const s of g.stones) board[s] = EMPTY;
  }

  // Now check the mover's own group.
  const ownGroup = findGroup(board, width, height, point);
  let selfCaptured = null;
  if (ownGroup.liberties.size === 0) {
    if (ruleset.suicide === "legal") {
      selfCaptured = ownGroup;
      for (const s of ownGroup.stones) board[s] = EMPTY;
    } else {
      return { ok: false, reason: "suicide" };
    }
  }

  let capturedBlackStones = position.capturedBlackStones;
  let capturedWhiteStones = position.capturedWhiteStones;
  for (const g of captured) {
    if (g.color === BLACK) capturedBlackStones += g.stones.length;
    else capturedWhiteStones += g.stones.length;
  }
  if (selfCaptured) {
    if (selfCaptured.color === BLACK) capturedBlackStones += selfCaptured.stones.length;
    else capturedWhiteStones += selfCaptured.stones.length;
  }

  const nextToMove = opponent(color);
  return {
    ok: true,
    position: finalize(width, height, board, nextToMove, capturedBlackStones, capturedWhiteStones),
    captured,
    selfCaptured,
  };
}

/** A pass changes whose turn it is and nothing else. Always legal — see pass.md. */
export function applyPass(position) {
  return finalize(
    position.width,
    position.height,
    position.board,
    opponent(position.toMove),
    position.capturedBlackStones,
    position.capturedWhiteStones,
  );
}
