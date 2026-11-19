// Deterministic Zobrist hashing.
//
// Keys are generated once, at module load, from a fixed seed via a
// splitmix64-style generator (zero-dep, no crypto). Determinism matters
// here: the same board arrangement must hash identically across runs and
// across processes so hashes can be asserted against in tests and, later,
// compared across a client and server.
//
// These are 64-bit XOR fingerprints, not injective identifiers and not
// cryptographic content hashes. Distinct boards can have equal Zobrist
// hashes (a constructive test lives in test/ko-hash-collision.test.mjs).
// Game's ko/superko verifier MUST compare the actual board cells after a
// matching hash, and the side to move for situational superko.

import { BLACK, WHITE } from "./board.mjs";

const MASK64 = (1n << 64n) - 1n;

function splitmix64(seed) {
  let state = seed & MASK64;
  return () => {
    state = (state + 0x9e3779b97f4a7c15n) & MASK64;
    let z = state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64;
    z = z ^ (z >> 31n);
    return z & MASK64;
  };
}

// Largest board this kernel supports is 19x19.
const MAX_POINTS = 19 * 19;

const rng = splitmix64(0x5eed_5eed_5eed_5eedn);
const BLACK_KEYS = new Array(MAX_POINTS);
const WHITE_KEYS = new Array(MAX_POINTS);
for (let i = 0; i < MAX_POINTS; i++) {
  BLACK_KEYS[i] = rng();
  WHITE_KEYS[i] = rng();
}
const WHITE_TO_MOVE_KEY = rng();

/** 64-bit fingerprint of the stones (ignores turn); never proof of board identity. */
export function boardHash(board) {
  let h = 0n;
  for (let i = 0; i < board.length; i++) {
    const c = board[i];
    if (c === BLACK) h ^= BLACK_KEYS[i];
    else if (c === WHITE) h ^= WHITE_KEYS[i];
  }
  return h;
}

/** 64-bit fingerprint of stones plus player to move; confirm both on a hash match. */
export function situationalHash(board, toMove) {
  let h = boardHash(board);
  if (toMove === WHITE) h ^= WHITE_TO_MOVE_KEY;
  return h;
}
