import assert from "node:assert/strict";
import { test } from "node:test";
import { admitWeiqiMatchCommand, createWeiqiMatch, verifyWeiqiMatch } from "../src/match.mjs";

const config = Object.freeze({ size: 9, ruleset: "chinese" });
const players = Object.freeze({ black: "principal:black", white: "principal:white" });

test("a match serializes two principals into one replayable Cartridge record", () => {
  const empty = createWeiqiMatch(config, players);
  const black = admitWeiqiMatchCommand(empty, {
    principal: players.black, idempotencyKey: "black-1", expectedVersion: 0, command: { kind: "play", move: "C3" },
  }, 1000);
  assert.ok(black.ok && !black.duplicate);
  if (!black.ok || black.duplicate) return;
  const white = admitWeiqiMatchCommand(black.match, {
    principal: players.white, idempotencyKey: "white-1", expectedVersion: 1, command: { kind: "play", move: "G7" },
  }, 1001);
  assert.ok(white.ok && !white.duplicate);
  if (!white.ok || white.duplicate) return;
  assert.deepEqual(white.match.log.map((entry) => entry.seq), [0, 1]);
  assert.deepEqual(white.match.session.state.moves, ["C3", "G7"]);
  assert.equal(verifyWeiqiMatch(white.match).valid, true);
});

test("a duplicate command never advances the accepted match record", () => {
  const empty = createWeiqiMatch(config, players);
  const accepted = admitWeiqiMatchCommand(empty, {
    principal: players.black, idempotencyKey: "black-1", expectedVersion: 0, command: { kind: "play", move: "C3" },
  }, 1000);
  assert.ok(accepted.ok && !accepted.duplicate);
  if (!accepted.ok || accepted.duplicate) return;
  const duplicate = admitWeiqiMatchCommand(accepted.match, {
    principal: players.black, idempotencyKey: "black-1", expectedVersion: 0, command: { kind: "play", move: "C3" },
  }, 2000);
  assert.ok(duplicate.ok && duplicate.duplicate);
  if (!duplicate.ok || !duplicate.duplicate) return;
  assert.equal(duplicate.match.log.length, 1);
  assert.equal(duplicate.match.stateHash, accepted.match.stateHash);
});

test("a match refuses stale, foreign, and out-of-turn commands without changing its log", () => {
  const empty = createWeiqiMatch(config, players);
  const stale = admitWeiqiMatchCommand(empty, {
    principal: players.black, idempotencyKey: "stale", expectedVersion: 1, command: { kind: "play", move: "C3" },
  }, 1000);
  assert.deepEqual(stale, { ok: false, reason: "version-mismatch", expectedVersion: 1, actualVersion: 0 });
  const foreign = admitWeiqiMatchCommand(empty, {
    principal: "principal:other", idempotencyKey: "foreign", expectedVersion: 0, command: { kind: "play", move: "C3" },
  }, 1000);
  assert.deepEqual(foreign, { ok: false, reason: "unknown-principal" });
  const white = admitWeiqiMatchCommand(empty, {
    principal: players.white, idempotencyKey: "white-first", expectedVersion: 0, command: { kind: "play", move: "C3" },
  }, 1000);
  assert.deepEqual(white, { ok: false, reason: "not-your-turn" });
  assert.equal(empty.log.length, 0);
});

test("the accepted log detects a forged derived checkpoint", () => {
  const empty = createWeiqiMatch(config, players);
  const accepted = admitWeiqiMatchCommand(empty, {
    principal: players.black, idempotencyKey: "black-1", expectedVersion: 0, command: { kind: "play", move: "C3" },
  }, 1000);
  assert.ok(accepted.ok && !accepted.duplicate);
  if (!accepted.ok || accepted.duplicate) return;
  const forged = Object.freeze({ ...accepted.match, stateHash: "not-the-log-hash" });
  assert.deepEqual(verifyWeiqiMatch(forged).valid, false);
});
