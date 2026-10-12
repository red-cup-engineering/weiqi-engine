/**
 * The durable-match semantic core.
 *
 * A match is not a socket, database row, or presence channel. Its only
 * authority is to turn an ordered, principal-attributed request into one
 * Cartridge entry that the Weiqi rules engine accepts. The `session` and
 * `stateHash` carried in a match are derived checkpoints: the Cartridge log
 * remains the record from which they are rebuilt.
 */
import { appendMove } from "@red-cup-engineering/gaming/running/play-record";
import { hashPosition } from "@red-cup-engineering/gaming/running/rules";
import { BLACK, WHITE } from "./board.mjs";
import { configIdentifier } from "./replay.mjs";
import {
  admitWeiqiGameCommand,
  createWeiqiGameSession,
  isWeiqiGameCommand,

} from "./session.mjs";

/** The only durable game-domain payload inside a Cartridge entry. */

/** A settlement one principal has proposed that the other has not yet matched. */

function normalizedDead(dead) {
  return [...new Set(dead.map((coord) => coord.trim().toUpperCase()))].sort();
}

function sameDead(left, right) {
  const a = normalizedDead(left);
  const b = normalizedDead(right);
  return a.length === b.length && a.every((coord, index) => coord === b[index]);
}

function commandEqual(left, right) {
  if (left.kind !== right.kind) return false;
  if (left.kind === "play" && right.kind === "play") return left.move === right.move;
  if (left.kind === "resign" && right.kind === "resign") return left.color === right.color;
  if (left.kind === "settle" && right.kind === "settle") return sameDead(left.dead, right.dead);
  return true;
}

function isPrincipal(value) {
  return typeof value === "string" && value.length > 0;
}

function isExpectedVersion(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

const isCommand = isWeiqiGameCommand;

function freezeCommand(command) {
  switch (command.kind) {
    case "pass": return Object.freeze({ kind: "pass" });
    case "play": return Object.freeze({ kind: "play", move: command.move });
    case "resign": return Object.freeze({ kind: "resign", color: command.color });
    case "settle": return Object.freeze({ kind: "settle", dead: Object.freeze(normalizedDead(command.dead)) });
  }
}

function principalColor(players, principal) {
  return principal === players.black ? BLACK : principal === players.white ? WHITE : null;
}

/**
 * Whether `principal` may submit `command` against `session` now. A play or
 * pass belongs to the side to move; a resignation belongs to its own color at
 * any time while the game is open; a settlement may come from either player
 * once the main phase has ended. Returns the refusal reason or null.
 */
function admissionRefusal(players, session, principal, command) {
  if (command.kind === "resign") {
    if (session.state.result !== null) return "illegal-command";
    return principalColor(players, principal) === command.color ? null : "not-your-color";
  }
  if (command.kind === "settle") {
    // mainPhaseEnded is sticky across resumed play. A settlement proposal
    // belongs only to the currently active two-pass counting window.
    if (!session.state.mainPhaseEnded || session.state.passStreak < 2 || session.state.result !== null) return "illegal-command";
    return null;
  }
  return principal === playerToMove(players, session) ? null : "not-your-turn";
}

function validatePlayers(players) {
  if (!isPrincipal(players.black) || !isPrincipal(players.white) || players.black === players.white) {
    throw new TypeError("Weiqi match players must be two distinct non-empty principal references");
  }
}

function playerToMove(players, session) {
  return session.state.toMove === BLACK ? players.black : players.white;
}

function rebuild(config, players, log) {
  validatePlayers(players);
  const frozenConfig = Object.freeze(config.handicap ? { size: config.size, ruleset: config.ruleset, handicap: config.handicap } : { size: config.size, ruleset: config.ruleset });
  const frozenPlayers = Object.freeze({ black: players.black, white: players.white });
  const expectedConfigId = configIdentifier(frozenConfig);
  let session = createWeiqiGameSession(frozenConfig);
  let pendingSettlement = null;
  const idempotencyKeys = new Set();
  const entries = [];

  for (const [index, entry] of log.entries()) {
    if (!entry || entry.seq !== index || !Number.isFinite(entry.ts)) throw new TypeError("Weiqi match log must have contiguous sequence numbers and injected timestamps");
    const intent = entry.intent;
    if (
      intent.kind !== "weiqi-command" ||
      !isPrincipal(intent.principal) ||
      !isPrincipal(intent.idempotencyKey) ||
      !isExpectedVersion(intent.expectedVersion) ||
      intent.configId !== expectedConfigId ||
      !isCommand(intent.command) ||
      idempotencyKeys.has(intent.idempotencyKey)
    ) throw new TypeError("Weiqi match log contains an invalid or duplicate command envelope");
    if (intent.expectedVersion !== session.version) throw new TypeError("Weiqi match log command does not name its pre-state version");
    const refusal = admissionRefusal(frozenPlayers, session, intent.principal, intent.command);
    if (refusal !== null) throw new TypeError(`Weiqi match log command is not admissible: ${refusal}`);
    if (intent.command.kind === "settle" && !(pendingSettlement !== null && pendingSettlement.principal !== intent.principal && sameDead(pendingSettlement.dead, intent.command.dead))) {
      // A settlement needs both players' identical agreement: the first
      // (or a differing counter-proposal) is recorded and waits.
      pendingSettlement = Object.freeze({ principal: intent.principal, dead: Object.freeze(normalizedDead(intent.command.dead)) });
    } else {
      const admitted = admitWeiqiGameCommand(session, intent.expectedVersion, intent.command);
      if (!admitted.ok) throw new TypeError(`Weiqi match log command is not legal: ${admitted.reason}`);
      session = admitted.session;
      pendingSettlement = null;
    }
    idempotencyKeys.add(intent.idempotencyKey);
    entries.push(Object.freeze({
      kind: "weiqi-command",
      principal: intent.principal,
      idempotencyKey: intent.idempotencyKey,
      expectedVersion: intent.expectedVersion,
      configId: intent.configId,
      command: freezeCommand(intent.command),
    }));
  }

  const frozenLog = Object.freeze(entries.map((intent, index) => Object.freeze({ seq: index, intent, ts: log[index].ts })));
  return Object.freeze({
    version: 2,
    config: frozenConfig,
    players: frozenPlayers,
    log: frozenLog,
    session,
    pendingSettlement,
    stateHash: hashPosition({ state: session.state, pendingSettlement }),
  });
}

/** Creates an empty match with two already-admitted principals. */
export function createWeiqiMatch(config, players) {
  return rebuild(config, players, []);
}

/** Replays the actual accepted record and proves any carried checkpoint is still derivable. */
export function verifyWeiqiMatch(match) {
  try {
    const rebuilt = rebuild(match.config, match.players, match.log);
    if (rebuilt.session.version !== match.session.version || rebuilt.stateHash !== match.stateHash) {
      return Object.freeze({ valid: false, reason: "match checkpoint does not match its accepted log" });
    }
    return Object.freeze({ valid: true, session: rebuilt.session, stateHash: rebuilt.stateHash });
  } catch (error) {
    return Object.freeze({ valid: false, reason: error instanceof Error ? error.message : "cannot replay match" });
  }
}

/**
 * Accepts one authenticated-principal request using an injected received-at
 * timestamp. A duplicate idempotency key returns the already-derived match;
 * it never appends a second Cartridge command.
 */
export function admitWeiqiMatchCommand(
  match,
  request,
  receivedAt,
) {
  const checked = verifyWeiqiMatch(match);
  if (!checked.valid) return Object.freeze({ ok: false, reason: "invalid-match" });
  if (!Number.isFinite(receivedAt) || !isPrincipal(request?.principal) || !isPrincipal(request?.idempotencyKey) || !isExpectedVersion(request?.expectedVersion) || !isCommand(request?.command)) {
    return Object.freeze({ ok: false, reason: "invalid-request" });
  }
  const existing = match.log.find((entry) => entry.intent.idempotencyKey === request.idempotencyKey);
  if (existing) {
    const intent = existing.intent;
    if (intent.principal === request.principal && intent.expectedVersion === request.expectedVersion && commandEqual(intent.command, request.command)) {
      return Object.freeze({ ok: true, duplicate: true, match, events: Object.freeze([]) });
    }
    return Object.freeze({ ok: false, reason: "idempotency-conflict" });
  }
  if (request.expectedVersion !== match.session.version) {
    return Object.freeze({ ok: false, reason: "version-mismatch", expectedVersion: request.expectedVersion, actualVersion: match.session.version });
  }
  if (request.principal !== match.players.black && request.principal !== match.players.white) {
    return Object.freeze({ ok: false, reason: "unknown-principal" });
  }
  const refusal = admissionRefusal(match.players, match.session, request.principal, request.command);
  if (refusal !== null) return Object.freeze({ ok: false, reason: refusal });
  const proposes = request.command.kind === "settle" && !(match.pendingSettlement !== null && match.pendingSettlement.principal !== request.principal && sameDead(match.pendingSettlement.dead, request.command.dead));
  if (proposes) {
    // The engine will count once the other player matches; the proposal itself
    // must still name real stones, so check it against the engine now.
    const trial = admitWeiqiGameCommand(match.session, request.expectedVersion, request.command);
    if (!trial.ok) return Object.freeze({ ok: false, reason: "illegal-command" });
  }
  const admitted = proposes ? null : admitWeiqiGameCommand(match.session, request.expectedVersion, request.command);
  if (admitted !== null && !admitted.ok) return Object.freeze({ ok: false, reason: "illegal-command" });
  const intent = Object.freeze({
    kind: "weiqi-command",
    principal: request.principal,
    idempotencyKey: request.idempotencyKey,
    expectedVersion: request.expectedVersion,
    configId: configIdentifier(match.config),
    command: freezeCommand(request.command),
  });
  const nextLog = appendMove(match.log, intent, { ts: receivedAt });
  const next = rebuild(match.config, match.players, nextLog);
  if (proposes) return Object.freeze({ ok: true, duplicate: false, proposed: true, match: next, events: Object.freeze([]) });
  return Object.freeze({ ok: true, duplicate: false, match: next, events: admitted.events });
}
