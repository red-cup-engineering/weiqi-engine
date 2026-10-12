// Property-based tests: instead of hand-picked positions, these drive many
// random self-play games (a seeded LCG, so any failure reproduces exactly
// from the printed seed) across board sizes 5x5..9x9 and several rulesets,
// then check invariants that must hold of ANY legal game, not just the
// regression corpus's specific diagrams.
//
// Every random game is generated once, up front, and its full move/history
// record is then checked against all five properties below -- one
// simulation pass, five independent checks, rather than five separate
// simulations.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BLACK,
  WHITE,
  EMPTY,

  pointToCoord,
  neighbors,
  findGroup,
  boardHash,
  situationalHash,
  Game,
  getRuleset,
  scoreArea,
  gameRecordToSgf,
  sgfToGameRecord,

} from "../src/index.mjs";

// --- Seeded PRNG ---------------------------------------------------------
//
// A plain linear congruential generator (Numerical Recipes' constants).
// Deterministic and tiny: the point is reproducibility, not statistical
// quality -- given the same seed this produces the exact same sequence of
// games every run, so a failure always names a seed that reproduces it.

function makeLcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Fisher-Yates shuffle of [0, n) using `rng`, itself deterministic given `rng`'s seed. */
function shuffledIndices(rng, n) {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// --- Random self-play ------------------------------------------------------

const PASS_PROBABILITY = 0.15;

/**
 * Play one random game to completion (or to `maxPlies`, whichever comes
 * first). At each ply: sometimes pass outright, otherwise try board points
 * in random order and play the first one Game.isLegal accepts; if none is
 * legal, pass. This naturally drives games toward two consecutive passes
 * (mainPhaseEnded) as the board fills and legal moves run out, without ever
 * needing to know Go strategy.
 */
function playRandomGame(size, rulesetName, seed, maxPlies) {
  const rng = makeLcg(seed);
  const game = new Game(size, rulesetName);
  const moves = [];

  for (let ply = 0; ply < maxPlies && !game.mainPhaseEnded; ply++) {
    const color = game.current.toMove;
    if (rng() < PASS_PROBABILITY) {
      game.play("pass");
      moves.push({ color, point: "pass" });
      continue;
    }
    let played = false;
    for (const point of shuffledIndices(rng, size * size)) {
      const coord = pointToCoord(size, point);
      if (game.isLegal(coord)) {
        const outcome = game.play(coord);
        assert.ok(outcome.ok, `seed ${seed}: isLegal said "${coord}" was legal but play() rejected it`);
        moves.push({ color, point });
        played = true;
        break;
      }
    }
    if (!played) {
      game.play("pass");
      moves.push({ color, point: "pass" });
    }
  }

  return { size, rulesetName, seed, game, moves };
}

const SIZES = [5, 6, 7, 8, 9];
const RULESET_NAMES = ["chinese", "japanese", "aga", "newzealand"]; // covers all three ko regimes, and both suicide rules.
const SEEDS_PER_COMBO = 2;

function buildGames() {
  const games = [];
  let seed = 1;
  for (const size of SIZES) {
    for (const rulesetName of RULESET_NAMES) {
      for (let i = 0; i < SEEDS_PER_COMBO; i++) {
        games.push(playRandomGame(size, rulesetName, seed, size * size * 3));
        seed += 1;
      }
    }
  }
  return games;
}

const GAMES = buildGames();

function describeGame(g) {
  return `${g.size}x${g.size} ${g.rulesetName} seed=${g.seed}`;
}

// --- Property 1: no illegal state ----------------------------------------

test("property: no group on the board ever has zero liberties, after any legal move in any self-play game", () => {
  for (const g of GAMES) {
    for (let i = 0; i < g.game.history.length; i++) {
      const position = g.game.history[i];
      const { width, height, board } = position;
      const visited = new Uint8Array(board.length);
      for (let p = 0; p < board.length; p++) {
        if (board[p] === EMPTY || visited[p]) continue;
        const group = findGroup(board, width, height, p);
        assert.ok(
          group.liberties.size > 0,
          `${describeGame(g)}: a ${group.color === BLACK ? "Black" : "White"} group at ply ${i} has zero liberties`,
        );
        for (const s of group.stones) visited[s] = 1;
      }
    }
  }
});

// --- Property 2: Zobrist consistency --------------------------------------

test("property: recomputing the Zobrist hash from scratch matches the incrementally-maintained hash, at every ply", () => {
  for (const g of GAMES) {
    for (let i = 0; i < g.game.history.length; i++) {
      const position = g.game.history[i];
      assert.equal(
        boardHash(position.board),
        position.boardHash,
        `${describeGame(g)}: boardHash mismatch at ply ${i}`,
      );
      assert.equal(
        situationalHash(position.board, position.toMove),
        position.situationalHash,
        `${describeGame(g)}: situationalHash mismatch at ply ${i}`,
      );
    }
  }
});

// --- Property 3: ko safety (replay reproduces the identical position) ----

test("property: replaying a game's recorded move list from the initial position reproduces the identical final position and hash", () => {
  for (const g of GAMES) {
    const replay = new Game(g.size, g.rulesetName);
    for (const mv of g.moves) {
      const coord = mv.point === "pass" ? "pass" : pointToCoord(g.size, mv.point);
      const outcome = replay.play(coord);
      assert.ok(outcome.ok, `${describeGame(g)}: replay move "${coord}" was rejected the second time through`);
    }
    assert.equal(replay.current.boardHash, g.game.current.boardHash, `${describeGame(g)}: replayed boardHash differs`);
    assert.equal(
      replay.current.situationalHash,
      g.game.current.situationalHash,
      `${describeGame(g)}: replayed situationalHash differs`,
    );
    assert.deepEqual(
      Array.from(replay.current.board),
      Array.from(g.game.current.board),
      `${describeGame(g)}: replayed board differs cell-for-cell`,
    );
  }
});

// --- Property 4: SGF round-trip -------------------------------------------

test("property: serializing a finished game to SGF, re-parsing, and replaying reproduces the identical final position", () => {
  for (const g of GAMES) {
    const ruleset = getRuleset(g.rulesetName);
    const sgfMoves = g.moves.map((mv) => ({ color: mv.color, point: mv.point }));
    const text = gameRecordToSgf({ size: g.size, ruleset: g.rulesetName, komi: ruleset.komi, moves: sgfMoves });
    const record = sgfToGameRecord(text);
    assert.equal(record.size, g.size, `${describeGame(g)}: SGF size did not round-trip`);
    assert.equal(record.moves.length, g.moves.length, `${describeGame(g)}: SGF move count did not round-trip`);

    const replay = new Game(g.size, g.rulesetName);
    for (const mv of record.moves) {
      const coord = mv.point === "pass" ? "pass" : pointToCoord(g.size, mv.point);
      const outcome = replay.play(coord);
      assert.ok(outcome.ok, `${describeGame(g)}: SGF-replayed move "${coord}" was rejected`);
    }
    assert.equal(replay.current.boardHash, g.game.current.boardHash, `${describeGame(g)}: SGF-round-tripped boardHash differs`);
    assert.deepEqual(
      Array.from(replay.current.board),
      Array.from(g.game.current.board),
      `${describeGame(g)}: SGF-round-tripped board differs cell-for-cell`,
    );
  }
});

// --- Property 5: scoring sanity (area-counting identity) -------------------
//
// Independently classify every point (own reimplementation, not calling
// computeTerritory) as a Black stone, White stone, Black territory, White
// territory, or neutral -- a single-color-bordered empty region is that
// color's territory (area-scoring.md), everything else (no stones on the
// board yet, or an empty region touching both colors -- dame/seki, per
// scoring.mts's own seki note) is neutral. Cross-checking this against
// scoreArea's production numbers, then confirming the whole partition sums
// to width*height, is what actually verifies rulesets.md's area-counting
// identity rather than just restating it algebraically.

function classifyPoints(position)

 {
  const { width, height, board } = position;
  let blackStones = 0;
  let whiteStones = 0;
  let blackTerritory = 0;
  let whiteTerritory = 0;
  let neutral = 0;
  const visited = new Uint8Array(board.length);

  for (let i = 0; i < board.length; i++) {
    if (board[i] === BLACK) {
      blackStones += 1;
      continue;
    }
    if (board[i] === WHITE) {
      whiteStones += 1;
      continue;
    }
    if (visited[i]) continue;

    const region = [i];
    visited[i] = 1;
    const borders = new Set();
    const stack = [i];
    while (stack.length) {
      const p = stack.pop();
      for (const n of neighbors(width, height, p)) {
        const c = board[n];
        if (c === EMPTY) {
          if (!visited[n]) {
            visited[n] = 1;
            stack.push(n);
            region.push(n);
          }
        } else {
          borders.add(c);
        }
      }
    }
    if (borders.size === 1) {
      if (borders.has(BLACK)) blackTerritory += region.length;
      else whiteTerritory += region.length;
    } else {
      neutral += region.length;
    }
  }

  return { blackStones, whiteStones, blackTerritory, whiteTerritory, neutral };
}

test("property: area score's black + white points plus neutral points equals total intersections", () => {
  for (const g of GAMES) {
    const position = g.game.current;
    const ruleset = getRuleset(g.rulesetName);
    const area = scoreArea(position, ruleset);
    const classified = classifyPoints(position);

    assert.equal(area.blackStones, classified.blackStones, `${describeGame(g)}: black stone count disagrees with an independent recount`);
    assert.equal(area.whiteStones, classified.whiteStones, `${describeGame(g)}: white stone count disagrees with an independent recount`);
    assert.equal(area.blackTerritory, classified.blackTerritory, `${describeGame(g)}: black territory disagrees with an independent recount`);
    assert.equal(area.whiteTerritory, classified.whiteTerritory, `${describeGame(g)}: white territory disagrees with an independent recount`);

    const blackPoints = area.blackStones + area.blackTerritory;
    const whitePoints = area.whiteStones + area.whiteTerritory;
    const total = g.size * g.size;
    assert.equal(
      blackPoints + whitePoints + classified.neutral,
      total,
      `${describeGame(g)}: Black + White + neutral points do not add up to ${total} intersections`,
    );
  }
});
