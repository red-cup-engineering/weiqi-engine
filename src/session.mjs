// Portable, deterministic match-session admission.
//
// This is deliberately not a server: principals, durable storage, clocks,
// channels, and Cartridge state hashes belong at explicit effect boundaries.
// It gives every such boundary (and the browser client) one versioned command
// record and one replayable rules decision.
import { BLACK, WHITE, coordToPoint } from "./board.mjs";

import { Game, countPosition } from "./game.mjs";
import { marksWholeDeadGroups } from "./scoring.mjs";
import { createPositionFromCells } from "./position.mjs";
import { getRuleset, handicapPoints } from "./rulesets.mjs";

// Only sessions constructed by this engine get an in-process validated rules machine.
// Imported/deserialized records must replay their accepted commands. This WeakMap
// adds no serialized checkpoint, second rules authority, or persistent state.
const validatedGames = new WeakMap();

function handicapOf(config) {
  return config.handicap ?? 0;
}

function sameConfig(left, right) {
  return left.size === right.size && left.ruleset === right.ruleset && handicapOf(left) === handicapOf(right);
}

function frozenConfig(config) {
  const handicap = handicapOf(config);
  return Object.freeze(handicap > 0 ? { size: config.size, ruleset: config.ruleset, handicap } : { size: config.size, ruleset: config.ruleset });
}

/** Whether `command` has one of the four accepted shapes. */
export function isWeiqiGameCommand(command) {
  if (command === null || typeof command !== "object") return false;
  const { kind } = command;
  if (kind === "pass") return true;
  if (kind === "play") return typeof (command).move === "string";
  if (kind === "resign") {
    const color = (command).color;
    return color === BLACK || color === WHITE;
  }
  if (kind === "settle") {
    const dead = (command).dead;
    return Array.isArray(dead) && dead.every((coord) => typeof coord === "string");
  }
  return false;
}

/** The play or pass a command records, or null for resign and settle. */
function commandMove(command) {
  if (command.kind === "pass") return "pass";
  if (command.kind === "play") return command.move;
  return null;
}

function freezeCommand(command) {
  switch (command.kind) {
    case "pass": return Object.freeze({ kind: "pass" });
    case "play": return Object.freeze({ kind: "play", move: command.move });
    case "resign": return Object.freeze({ kind: "resign", color: command.color });
    case "settle": return Object.freeze({ kind: "settle", dead: Object.freeze([...command.dead]) });
  }
}

/** Apply one accepted-shape command to a game, returning the game's own verdict. */
function applyCommand(game, command) {
  switch (command.kind) {
    case "pass": return game.play("pass");
    case "play": return game.play(command.move);
    case "resign": return game.resign(command.color);
    case "settle": return game.settle(command.dead);
  }
}

/** The handicap stones a config places, as Go coordinates (empty for an even game). */
export function handicapStones(config) {
  const handicap = handicapOf(config);
  if (handicap === 0) return Object.freeze([]);
  if (!Number.isInteger(handicap) || handicap < 2) throw new TypeError(`Handicap must be an integer of at least 2, got ${handicap}`);
  if (config.size !== 9 && config.size !== 13 && config.size !== 19) throw new TypeError(`Fixed-star handicap placement is defined for 9x9, 13x13, and 19x19 boards, not ${config.size}x${config.size}`);
  return Object.freeze(handicapPoints(config.size, handicap));
}

function initialPosition(config) {
  const stones = handicapStones(config);
  if (stones.length === 0) return undefined;
  const cells = new Array(config.size * config.size).fill(0);
  for (const coord of stones) cells[coordToPoint(config.size, config.size, coord)] = BLACK;
  return createPositionFromCells(config.size, config.size, cells, WHITE);
}

function snapshot(config, commands, game) {
  const moves = commands.map(commandMove).filter((move) => move !== null);
  return Object.freeze({
    version: 2,
    config: frozenConfig(config),
    commands: Object.freeze(commands.map(freezeCommand)),
    moves: Object.freeze(moves),
    handicap: handicapStones(config),
    result: game.result,
    board: Object.freeze([...game.current.board]),
    toMove: game.current.toMove,
    capturedBlackStones: game.current.capturedBlackStones,
    capturedWhiteStones: game.current.capturedWhiteStones,
    passStreak: game.passStreak,
    mainPhaseEnded: game.mainPhaseEnded,
    activeKoPoint: game.activeKoPoint,
  });
}

function gameFor(config, commands) {
  getRuleset(config.ruleset);
  const game = new Game(config.size, config.ruleset, initialPosition(config));
  for (const command of commands) {
    if (!isWeiqiGameCommand(command)) throw new TypeError("Weiqi command must be { kind: 'play', move }, { kind: 'pass' }, { kind: 'resign', color }, or { kind: 'settle', dead }");
    const outcome = applyCommand(game, command);
    if (!outcome.ok) throw new TypeError(`Cannot reconstruct Weiqi session: ${commandMove(command) ?? command.kind} is ${outcome.reason}`);
  }
  return game;
}

/**
 * Construct a frozen record from the authoritative Game. An in-process
 * successor forks the already-validated rules history before accepting one
 * new command; imported/unrecognized sessions replay the full log. The
 * ephemeral WeakMap is not a second persisted game state or proof of identity.
 */
function sessionFromCommands(config, commands, game = gameFor(config, commands)) {
  const session = Object.freeze({
    config: frozenConfig(config),
    version: commands.length,
    commands: Object.freeze(commands.map(freezeCommand)),
    state: snapshot(config, commands, game),
  });
  // A completed game is only reread, never advanced: leave it to full replay
  // rather than share a potentially mutable nested score with an external view.
  if (game.result === null) validatedGames.set(session, game);
  return session;
}

/** Creates a replayable session. Invalid historical commands are rejected at the boundary. */
export function createWeiqiGameSession(config, commands = []) {
  return sessionFromCommands(config, commands);
}

/** Reconstructs the mutable rules machine only from the immutable accepted record. */
export function materializeWeiqiGame(session) {
  if (!Number.isSafeInteger(session.version) || session.version < 0 || session.version !== session.commands.length) {
    throw new TypeError("Weiqi session version must equal its accepted command count");
  }
  if (!sameConfig(session.config, session.state.config)) throw new TypeError("Weiqi session state belongs to another configuration");
  const validated = validatedGames.get(session);
  if (validated === undefined) return gameFor(session.config, session.commands);
  // Game.fork preserves immutable positions and full ko/superko history.
  // Clone event payloads too: callers may inspect or modify the returned
  // mutable Game, but cannot affect the private already-admitted record.
  const game = validated.fork();
  game.moveEvents = structuredClone(game.moveEvents);
  return game;
}

/**
 * Admits exactly one command at the version the caller observed. The result
 * contains no I/O; a server may persist the accepted command before exposing
 * this new session, while a browser can render it directly.
 */
export function admitWeiqiGameCommand(
  session,
  expectedVersion,
  command,
) {
  if (expectedVersion !== session.version) {
    return Object.freeze({ ok: false, reason: "version-mismatch", expectedVersion, actualVersion: session.version });
  }
  if (!isWeiqiGameCommand(command)) return Object.freeze({ ok: false, reason: "invalid-command" });
  let game;
  try {
    game = materializeWeiqiGame(session);
  } catch {
    return Object.freeze({ ok: false, reason: "invalid-command" });
  }
  const outcome = applyCommand(game, command);
  if (!outcome.ok) return Object.freeze({ ok: false, reason: outcome.reason });
  // game now represents precisely the accepted command prefix plus this
  // admissible new command. Snapshot that state; do not reconstruct it again.
  const next = sessionFromCommands(session.config, [...session.commands, command], game);
  return Object.freeze({ ok: true, session: next, events: Object.freeze([...outcome.events]) });
}

/**
 * Counts a session's current position under its own ruleset's scoring mode.
 *
 * Dead-stone settlement is an agreement between the players, never a rules
 * fact (dead-stones.md), so it arrives here as `deadPoints`: Go coordinates
 * or point indices of stones both sides agree are dead, removed as
 * prisoners before counting. With none given, every stone on the board is
 * counted as alive. Works at any moment of a game, not only after two
 * passes; the caller decides when a count is final.
 */
export function scoreWeiqiSession(session, deadPoints = []) {
  const game = materializeWeiqiGame(session);
  const size = session.config.size;
  // A dead-stone agreement names occupied board points, not arbitrary
  // intersections. Use the canonical board coordinate parser for strings,
  // collapse aliases and repeated point indices, and refuse empty points
  // before the scoring kernel's non-mutating removal.
  const points = new Set([...deadPoints].map((dead) =>
    typeof dead === "string" ? coordToPoint(size, size, dead) : dead));
  for (const point of points) {
    if (!Number.isInteger(point) || point < 0 || point >= game.current.board.length) {
      throw new TypeError(`Dead point ${String(point)} is not on a ${size}x${size} board`);
    }
    if (game.current.board[point] !== BLACK && game.current.board[point] !== WHITE) {
      throw new TypeError(`Dead point ${point} is not an occupied stone on a ${size}x${size} board`);
    }
  }
  if (!marksWholeDeadGroups(game.current, points)) {
    throw new TypeError("Marked dead stones must include each complete connected group");
  }
  const counted = countPosition(game, points);
  return Object.freeze({ mode: counted.mode, ruleset: game.ruleset, position: counted.position, score: counted.score, ownership: counted.ownership });
}

/** The SGF RE[] value for a result, per the SGF FF[4] game-info property: "B+R", "W+7.5", "0" for a draw. */
export function sgfResultOf(result) {
  if (result === null) return undefined;
  if (result.by === "resignation") return `${result.winner === BLACK ? "B" : "W"}+R`;
  if (result.winner === null) return "0";
  const margin = Math.abs(result.score.blackScore - result.score.whiteScore);
  return `${result.winner === BLACK ? "B" : "W"}+${margin}`;
}

/** The SGF interchange view of the accepted main line; it is never session truth. */
export function weiqiSessionToSgfRecord(session) {
  const game = materializeWeiqiGame(session);
  const size = session.config.size;
  const handicap = handicapStones(session.config);
  let color = handicap.length > 0 ? WHITE : BLACK;
  const moves = [];
  for (const command of session.commands) {
    const move = commandMove(command);
    if (move === null) continue;
    moves.push(Object.freeze({ color, point: move === "pass" ? ("pass") : coordToPoint(size, size, move) }));
    color = color === BLACK ? WHITE : BLACK;
  }
  const record = {
    size,
    ruleset: session.config.ruleset,
    komi: game.ruleset.komi,
    moves,
  };
  if (handicap.length > 0) record.handicap = [...handicap];
  const result = sgfResultOf(game.result);
  if (result !== undefined) record.result = result;
  return Object.freeze(record);
}
