// Game: the stateful orchestrator that owns move history (needed for
// ko/superko, which Position alone cannot check) and drives the semantic
// event annotator.

import { BLACK, WHITE, coordToPoint, isBoardSize, opponent, pointToCoord } from "./board.mjs";
import { applyPass, applyStonePlacement, createEmptyPosition } from "./position.mjs";
import { getRuleset, handicapPoints } from "./rulesets.mjs";
import { annotateMove, annotatePass } from "./events.mjs";
import { computeTerritory, marksWholeDeadGroups, removeDeadStones, scoreArea, scoreTerritory } from "./scoring.mjs";

/** How a game ended: by one side resigning, or by an agreed count after two passes. */

/**
 * Check a candidate resulting position against game history under the
 * given ko regime. `history` holds every position that has occurred so
 * far (index 0 = empty board before any moves), NOT including `candidate`.
 *
 * - simple_ko forbids only recreating the single position that existed
 *   immediately before the opponent's last move — i.e. history[length-2].
 * - positional_superko forbids recreating ANY prior board arrangement
 *   (stones only, turn ignored).
 * - situational_superko forbids recreating any prior (arrangement, player
 *   to move) pair.
 *
 * Positional/situational superko subsume the simple-ko case (it is just
 * the most recent entry in the same history), so no special-casing is
 * needed once the regime is superko.
 *
 * Zobrist hashes are only 64-bit fingerprints, NOT proofs of equal boards:
 * XOR gives distinct arrangements with the same hash. Match the fast hash
 * first, then verify all board cells, and (for situational superko) the turn.
 * A collision may cost one small board comparison but may never refuse a
 * legal move. Prisoner counts are not part of position identity.
 */
function sameBoardCells(left, right) {
  if (left.length !== right.length) return false;
  for (let point = 0; point < left.length; point++) {
    if (left[point] !== right[point]) return false;
  }
  return true;
}

function checkKoViolation(history, candidate, regime) {
  if (regime === "simple_ko") {
    if (history.length >= 2) {
      const previous = history[history.length - 2];
      if (candidate.boardHash === previous.boardHash
        && sameBoardCells(candidate.board, previous.board)) return "simple-ko";
    }
    return null;
  }
  if (regime === "positional_superko") {
    for (const previous of history) {
      if (previous.boardHash === candidate.boardHash
        && sameBoardCells(candidate.board, previous.board)) return "positional-superko";
    }
    return null;
  }
  // situational_superko additionally requires the same player to move.
  for (const previous of history) {
    if (previous.situationalHash === candidate.situationalHash
      && previous.toMove === candidate.toMove
      && sameBoardCells(candidate.board, previous.board)) return "situational-superko";
  }
  return null;
}

export class Game {
  /** Square board side length (see isBoardSize in board.mts for the accepted range). */
 size;
 ruleset;
 handicap = 0;
 history;
 moveEvents = [];
  activeKoPoint = null;
  passStreak = 0;
  mainPhaseEnded = false;
  /** Set once the game has ended by resignation or an agreed count; play() refuses afterwards. */
  result = null;

  constructor(size, rulesetName, initial, handicap = 0) {
    if (!isBoardSize(size)) throw new Error(`Unsupported board size: ${size}`);
    if (!Number.isSafeInteger(handicap) || handicap < 0 || handicap === 1)
      throw new TypeError("A Go handicap must be zero or a supported fixed-star count");
    if (handicap > 0) handicapPoints(size, handicap);
    this.size = size;
    this.ruleset = getRuleset(rulesetName);
    this.handicap = handicap;
    this.history = [initial ?? createEmptyPosition(size)];
  }

  get current() {
    return this.history[this.history.length - 1];
  }

  /**
   * Fork the full rules state for a hypothetical continuation. A current
   * Position alone is insufficient: simple ko, positional/situational
   * superko, pass streaks, and terminal state depend on the prior game.
   *
   * Positions are immutable in the engine, so the fork shares historical
   * Position values while owning independent history/event arrays. A move
   * appended to either branch cannot change the other's continuation.
   * No historical commands are replayed or separate rules implemented.
   */
  fork() {
    const branch = new Game(this.size, this.ruleset.name, this.history[0], this.handicap);
    branch.history = this.history.slice();
    branch.moveEvents = this.moveEvents.slice();
    branch.activeKoPoint = this.activeKoPoint;
    branch.passStreak = this.passStreak;
    branch.mainPhaseEnded = this.mainPhaseEnded;
    branch.result = this.result;
    return branch;
  }

  /** Play a move. `move` is either the literal string "pass" or a Go-notation coordinate like "C3". */
  play(move) {
    if (this.result !== null) return { ok: false, reason: "game-ended" };
    const prev = this.current;

    if (move === "pass") {
      const next = applyPass(prev);
      this.history.push(next);
      this.passStreak += 1;
      // "endsMainPhase" is the transition, not the level: only the pass
      // that takes the streak to exactly 2 fires game-ended, mirroring
      // mainPhaseEnded's own one-way flip below (see pass.md/R12).
      const endsMainPhase = this.passStreak === 2;
      if (this.passStreak >= 2) this.mainPhaseEnded = true;
      const events = annotatePass(prev.toMove, endsMainPhase);
      this.moveEvents.push(events);
      return { ok: true, events, passStreak: this.passStreak };
    }

    // Resuming play after a settlement disagreement (see pass.md/R12) is
    // modeled as simply continuing to call play(); mainPhaseEnded does not
    // block further moves, it only records that two passes have happened
    // in a row at some point.
    let point;
    try {
      point = coordToPoint(this.size, this.size, move);
    } catch {
      return { ok: false, reason: "off-board" };
    }

    const placement = applyStonePlacement(prev, point, this.ruleset);
    if (!placement.ok) {
      return { ok: false, reason: placement.reason };
    }

    const koViolation = checkKoViolation(this.history, placement.position, this.ruleset.ko_regime);
    if (koViolation) {
      return { ok: false, reason: koViolation };
    }

    const { events, nextActiveKoPoint } = annotateMove({
      width: this.size,
      height: this.size,
      prevPosition: prev,
      nextPosition: placement.position,
      point,
      color: prev.toMove,
      captured: placement.captured,
      selfCaptured: placement.selfCaptured,
      activeKoPoint: this.activeKoPoint,
    });

    this.activeKoPoint = nextActiveKoPoint;
    this.history.push(placement.position);
    this.moveEvents.push(events);
    this.passStreak = 0;

    return { ok: true, events, passStreak: 0 };
  }

  /** `color` resigns: the opponent wins and no further move is admitted. Refused once the game has ended. */
  resign(color) {
    if (this.result !== null) return { ok: false, reason: "game-ended" };
    if (color !== BLACK && color !== WHITE) return { ok: false, reason: "game-ended" };
    this.result = Object.freeze({ by: "resignation", winner: opponent(color), loser: color });
    return { ok: true, events: [], passStreak: this.passStreak };
  }

  /**
   * Count the game with the stones at `dead` (Go coordinates) removed as
   * prisoners, under this ruleset's own scoring mode, and end it. Only
   * admitted after two consecutive passes (pass.md / R12); dead-stone
   * settlement is an agreement between the players, never a rules fact
   * (dead-stones.md), so the caller supplies it. A coordinate that is not
   * a stone is refused rather than ignored. The active pass streak must be
   * at least two: mainPhaseEnded records that this happened historically
   * and remains true after players resume a new phase of actual play.
   */
  settle(dead) {
    if (this.result !== null) return { ok: false, reason: "game-ended" };
    if (!this.mainPhaseEnded || this.passStreak < 2) return { ok: false, reason: "main-phase-open" };
    // Marked dead stones form a SET, not a multiset or a sequence.
    // Normalize via the existing board parser/formatter: " a03 ", "a3",
    // and "A3" identify the very same intersection. The authoritative
    // result records one canonical coordinate per actual stone.
    const uniquePoints = new Set();
    for (const coord of dead) {
      let point;
      try {
        point = coordToPoint(this.size, this.size, coord);
      } catch {
        return { ok: false, reason: "not-a-stone" };
      }
      if (this.current.board[point] === 0) return { ok: false, reason: "not-a-stone" };
      uniquePoints.add(point);
    }
    const points = [...uniquePoints].sort((a, b) => a - b);
    if (!marksWholeDeadGroups(this.current, points)) {
      return { ok: false, reason: "incomplete-dead-group" };
    }
    const counted = countPosition(this, points);
    this.result = Object.freeze({
      by: "count",
      winner: counted.score.blackScore > counted.score.whiteScore ? BLACK : counted.score.whiteScore > counted.score.blackScore ? WHITE : null,
      mode: counted.mode,
      dead: Object.freeze(points.map((point) => pointToCoord(this.size, point))),
      score: counted.score,
    });
    return { ok: true, events: [], passStreak: this.passStreak };
  }

  /** Whether `move` would currently be legal, without mutating game state. */
  isLegal(move) {
    if (this.result !== null) return false;
    if (move === "pass") return true;
    let point;
    try {
      point = coordToPoint(this.size, this.size, move);
    } catch {
      return false;
    }
    const placement = applyStonePlacement(this.current, point, this.ruleset);
    if (!placement.ok) return false;
    return checkKoViolation(this.history, placement.position, this.ruleset.ko_regime) === null;
  }
}

export { checkKoViolation as _checkKoViolationForTests };

/**
 * Count `game`'s current position under its own ruleset's scoring mode
 * (territory for territory rulesets, area otherwise -- `area_or_territory`
 * rulesets count area, their primary komi), with `deadPoints` removed as
 * prisoners first. Pure: the game is not changed.
 */
export function countPosition(game, deadPoints = []) {
  const position = removeDeadStones(game.current, deadPoints);
  const mode = game.ruleset.scoring === "territory" ? "territory" : "area";
  // Score and ownership must describe exactly the same settled position.
  // The old path flood-filled territory twice: once within scoreArea/
  // scoreTerritory, then again for the ownership projection.
  const territory = computeTerritory(position);
  // This is the single rules-owned score boundary for both provisional
  // counts and accepted game results. Session snapshots expose this object;
  // its values must not be writable after a command has been admitted.
  const score = Object.freeze(mode === "territory"
    ? scoreTerritory(position, game.ruleset, territory, game.handicap)
    : scoreArea(position, game.ruleset, territory, game.handicap));
  return Object.freeze({ mode, position, score, ownership: territory.ownership });
}
