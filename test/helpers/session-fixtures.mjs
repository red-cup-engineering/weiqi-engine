// Test-only, deterministic fixtures for sessions shared across scoring,
// command admission and durable-match tests. A fixture's commands always
// pass through the REAL upstream engine; no hand-written session checkpoints.
import { admitWeiqiGameCommand, createWeiqiGameSession } from "../../src/session.mjs";

export const WALL_MOVES = Object.freeze([
  "B1", "D1", "B2", "D2", "B3", "D3", "B4", "D4", "B5", "D5",
]);

export const WALL_WITH_INVADER = Object.freeze([
  ...WALL_MOVES, "pass", "A3", "pass", "pass",
]);

export function commandOfMove(move) {
  return move === "pass" ? { kind: "pass" } : { kind: "play", move };
}

// Downstream browser tests may inject the generated browser engine namespace.
// Production stays authoritative: no independent fixture rule implementation.
const UPSTREAM_ENGINE = { createWeiqiGameSession, admitWeiqiGameCommand };

export function sessionAfterMoves(config, moves, engine = UPSTREAM_ENGINE) {
  let session = engine.createWeiqiGameSession(config);
  for (const [index, move] of moves.entries()) {
    const command = typeof move === "string" ? commandOfMove(move) : move;
    const admitted = engine.admitWeiqiGameCommand(session, session.version, command);
    if (!admitted.ok) {
      throw new Error(`Invalid Weiqi test fixture at command ${index + 1} (${JSON.stringify(command)}): ${admitted.reason}`);
    }
    session = admitted.session;
  }
  return session;
}

export function walledSession(ruleset, extraMoves = [], engine = UPSTREAM_ENGINE) {
  return sessionAfterMoves({ size: 5, ruleset }, [...WALL_MOVES, ...extraMoves], engine);
}
