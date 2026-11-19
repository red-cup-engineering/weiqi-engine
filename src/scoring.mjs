// Scoring: area and territory, dead-stone marking, and seki-aware
// territory counting.
//
// Seki-awareness is not a special case bolted onto the territory walk: the
// standard flood-fill algorithm (an empty region counts for a color only
// if EVERY stone bordering it is that one color) already treats a seki's
// shared liberties correctly, because by definition those liberties border
// both colors — see seki.md and regression position R6. The same is true
// of ordinary neutral points (dame) between two living groups, and of the
// empty board before any territory exists.

import { BLACK, WHITE, findGroup, neighbors } from "./board.mjs";
import { boardHash, situationalHash } from "./zobrist.mjs";
import { handicapScorePolicy } from "./rulesets.mjs";

export function computeTerritory(position) {
  const { width, height, board } = position;
  const visited = new Uint8Array(board.length);
  const ownership = new Uint8Array(board.length);
  let blackTerritory = 0;
  let whiteTerritory = 0;

  for (let i = 0; i < board.length; i++) {
    if (board[i] !== 0 || visited[i]) continue;
    const region = [i];
    visited[i] = 1;
    const stack = [i];
    const borders = new Set();
    while (stack.length) {
      const p = stack.pop();
      for (const n of neighbors(width, height, p)) {
        const c = board[n];
        if (c === 0) {
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
      const owner = borders.has(BLACK) ? BLACK : WHITE;
      if (owner === BLACK) blackTerritory += region.length;
      else whiteTerritory += region.length;
      for (const p of region) ownership[p] = owner;
    }
    // borders.size === 0 (no stones at all) or 2 (neutral/dame/seki): counts for neither.
  }

  return { blackTerritory, whiteTerritory, ownership };
}

/**
 * An agreed dead-stone set must cover whole connected groups. A group has
 * shared liberties and lives or dies together; removing only part of one
 * invents a board that cannot arise from an agreed Go count.
 *
 * `deadPoints` contains already-validated occupied point indices (the Game
 * and session boundaries validate/normalize them). Walk each marked group
 * only once and consume the EXISTING board-level findGroup operation. The
 * lower-level removeDeadStones primitive remains intentionally unrestricted.
 */
export function marksWholeDeadGroups(position, deadPoints) {
  const marked = new Set(deadPoints);
  const visited = new Set();
  for (const point of marked) {
    if (visited.has(point)) continue;
    const group = findGroup(position.board, position.width, position.height, point);
    for (const stone of group.stones) {
      if (!marked.has(stone)) return false;
      visited.add(stone);
    }
  }
  return true;
}

/**
 * Dead-stone settlement: remove the marked points from the board, crediting
 * their color's opponent with a prisoner, exactly as though they had been
 * captured in play (dead-stones.md). Returns a new Position; does not
 * mutate the input.
 */
export function removeDeadStones(position, deadPoints) {
  const board = position.board.slice();
  let capturedBlackStones = position.capturedBlackStones;
  let capturedWhiteStones = position.capturedWhiteStones;
  for (const p of deadPoints) {
    const c = board[p];
    if (c === BLACK) {
      capturedBlackStones += 1;
      board[p] = 0;
    } else if (c === WHITE) {
      capturedWhiteStones += 1;
      board[p] = 0;
    }
  }
  return {
    width: position.width,
    height: position.height,
    board,
    toMove: position.toMove,
    capturedBlackStones,
    capturedWhiteStones,
    boardHash: boardHash(board),
    situationalHash: situationalHash(board, position.toMove),
  };
}

function countStones(position) {
  let blackStones = 0;
  let whiteStones = 0;
  for (const c of position.board) {
    if (c === BLACK) blackStones += 1;
    else if (c === WHITE) whiteStones += 1;
  }
  return { blackStones, whiteStones };
}

function marginString(blackScore, whiteScore) {
  if (blackScore === whiteScore) return "Draw";
  return blackScore > whiteScore ? `Black by ${blackScore - whiteScore}` : `White by ${whiteScore - blackScore}`;
}

/**
 * Area scoring: stones on the board plus territory, komi added to White.
 * `territory` may be the engine's already-computed `computeTerritory(position)`
 * result when the caller also needs ownership; otherwise compute it here.
 * `position` should already have dead stones removed (see
 * removeDeadStones) — area scoring does not otherwise consult prisoners.
 */
export function scoreArea(position, ruleset, territory = computeTerritory(position), handicap = 0) {
  const { blackStones, whiteStones } = countStones(position);
  const { blackTerritory, whiteTerritory } = territory;
  const { komi, blackAdjustment, whiteAdjustment } = handicapScorePolicy(ruleset, handicap, "area");
  const blackScore = blackStones + blackTerritory + blackAdjustment;
  const whiteScore = whiteStones + whiteTerritory + komi + whiteAdjustment;
  return {
    blackStones,
    whiteStones,
    blackTerritory,
    whiteTerritory,
    blackPrisoners: position.capturedWhiteStones,
    whitePrisoners: position.capturedBlackStones,
    ...(handicap > 0 ? { handicap, komi, blackHandicapAdjustment: blackAdjustment,
      whiteHandicapAdjustment: whiteAdjustment } : {}),
    blackScore,
    whiteScore,
    margin: marginString(blackScore, whiteScore),
  };
}

/**
 * Territory scoring: territory plus prisoners only, komi added to White.
 * Accepts the same optional previously-computed territory result as scoreArea.
 * `position` should already have dead stones removed.
 *
 * Uses `ruleset.komi_territory` when the ruleset declares one (AGA's
 * `area_or_territory` scoring keeps a separate territory-count komi,
 * reconciled against the area count via the pass-stone convention — see
 * rulesets.md's "Notes per parameter/Scoring" and pass.md) and falls back
 * to `.komi` for every other ruleset, which has no such split.
 */
export function scoreTerritory(position, ruleset, territory = computeTerritory(position), handicap = 0) {
  const { blackStones, whiteStones } = countStones(position);
  const { blackTerritory, whiteTerritory } = territory;
  const blackPrisoners = position.capturedWhiteStones;
  const whitePrisoners = position.capturedBlackStones;
  const { komi, blackAdjustment, whiteAdjustment } = handicapScorePolicy(ruleset, handicap, "territory");
  const blackScore = blackTerritory + blackPrisoners + blackAdjustment;
  const whiteScore = whiteTerritory + whitePrisoners + komi + whiteAdjustment;
  return {
    blackStones,
    whiteStones,
    blackTerritory,
    whiteTerritory,
    blackPrisoners,
    whitePrisoners,
    ...(handicap > 0 ? { handicap, komi, blackHandicapAdjustment: blackAdjustment,
      whiteHandicapAdjustment: whiteAdjustment } : {}),
    blackScore,
    whiteScore,
    margin: marginString(blackScore, whiteScore),
  };
}
