import assert from "node:assert/strict";
import { test } from "node:test";
import { admitWeiqiMatchCommand, createWeiqiMatch, verifyWeiqiMatch } from "../src/match.mjs";

const config = Object.freeze({ size: 9, ruleset: "chinese" });
const players = Object.freeze({ black: "principal:black", white: "principal:white" });

test("a match serializes two principals into one replayable Cartridge record", () => {
  const empty = createWeiqiMatch(config, players);
  const black = admitWeiqiMatchCommand(empty, {
    principal: players.black, idempotencyKey: "black-1", expectedRevision: 0, command: { kind: "play", move: "C3" },
  }, 1000);
  assert.ok(black.ok && !black.duplicate);
  if (!black.ok || black.duplicate) return;
  const white = admitWeiqiMatchCommand(black.match, {
    principal: players.white, idempotencyKey: "white-1", expectedRevision: 1, command: { kind: "play", move: "G7" },
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
    principal: players.black, idempotencyKey: "black-1", expectedRevision: 0, command: { kind: "play", move: "C3" },
  }, 1000);
  assert.ok(accepted.ok && !accepted.duplicate);
  if (!accepted.ok || accepted.duplicate) return;
  const duplicate = admitWeiqiMatchCommand(accepted.match, {
    principal: players.black, idempotencyKey: "black-1", expectedRevision: 0, command: { kind: "play", move: "C3" },
  }, 2000);
  assert.ok(duplicate.ok && duplicate.duplicate);
  if (!duplicate.ok || !duplicate.duplicate) return;
  assert.equal(duplicate.match.log.length, 1);
  assert.equal(duplicate.match.stateHash, accepted.match.stateHash);
});

test("a match refuses stale, foreign, and out-of-turn commands without changing its log", () => {
  const empty = createWeiqiMatch(config, players);
  const stale = admitWeiqiMatchCommand(empty, {
    principal: players.black, idempotencyKey: "stale", expectedRevision: 1, command: { kind: "play", move: "C3" },
  }, 1000);
  assert.deepEqual(stale, { ok: false, reason: "revision-mismatch", expectedRevision: 1, actualRevision: 0 });
  const foreign = admitWeiqiMatchCommand(empty, {
    principal: "principal:other", idempotencyKey: "foreign", expectedRevision: 0, command: { kind: "play", move: "C3" },
  }, 1000);
  assert.deepEqual(foreign, { ok: false, reason: "unknown-principal" });
  const white = admitWeiqiMatchCommand(empty, {
    principal: players.white, idempotencyKey: "white-first", expectedRevision: 0, command: { kind: "play", move: "C3" },
  }, 1000);
  assert.deepEqual(white, { ok: false, reason: "not-your-turn" });
  assert.equal(empty.log.length, 0);
});

test("the accepted log detects a forged derived checkpoint", () => {
  const empty = createWeiqiMatch(config, players);
  const accepted = admitWeiqiMatchCommand(empty, {
    principal: players.black, idempotencyKey: "black-1", expectedRevision: 0, command: { kind: "play", move: "C3" },
  }, 1000);
  assert.ok(accepted.ok && !accepted.duplicate);
  if (!accepted.ok || accepted.duplicate) return;
  const forged = Object.freeze({ ...accepted.match, stateHash: "not-the-log-hash" });
  assert.deepEqual(verifyWeiqiMatch(forged).valid, false);
});

test("every settlement proposal, counterproposal and agreement advances the actual match revision", () => {
  let m = createWeiqiMatch(config, players);
  for (const [principal, move, id] of [
    [players.black, "C3", "b1"], [players.white, "G7", "w1"],
    [players.black, "pass", "b2"], [players.white, "pass", "w2"],
  ]) {
    const r = admitWeiqiMatchCommand(m, { principal, idempotencyKey: id,
      expectedRevision: m.revision, command: move === "pass" ? {kind:"pass"} : {kind:"play",move} }, 10 + m.revision);
    assert.equal(r.ok, true); m = r.match;
  }
  const offer = { principal: players.black, idempotencyKey: "offer",
    expectedRevision: 4, command: {kind:"settle",dead:[]} };
  const p = admitWeiqiMatchCommand(m, offer, 20);
  assert.equal(p.ok, true);
  assert.equal(p.proposed, true);
  assert.equal(p.match.revision, 5);
  assert.equal(p.match.session.version, 4);
  assert.equal(verifyWeiqiMatch(p.match).valid,true);
  const stale = admitWeiqiMatchCommand(p.match, {principal:players.white,
    idempotencyKey:"stale",expectedRevision:4,command:{kind:"settle",dead:[]}},21);
  assert.deepEqual(stale,{ok:false,reason:"revision-mismatch",expectedRevision:4,actualRevision:5});
  const again = admitWeiqiMatchCommand(p.match,offer,22);
  assert.equal(again.duplicate,true);
  assert.equal(again.match,p.match);
  const conflict = admitWeiqiMatchCommand(p.match,
    {...offer,command:{kind:"settle",dead:["C3"]}},23);
  assert.deepEqual(conflict,{ok:false,reason:"idempotency-conflict"});
  const counter = admitWeiqiMatchCommand(p.match,{principal:players.white,
    idempotencyKey:"counter",expectedRevision:5,command:{kind:"settle",dead:["C3"]}},24);
  assert.equal(counter.ok,true);
  assert.equal(counter.match.revision,6);
  assert.equal(counter.match.session.version,4);
  assert.deepEqual(counter.match.pendingSettlement.dead,["C3"]);
  const staleAgain=admitWeiqiMatchCommand(counter.match,{principal:players.black,
    idempotencyKey:"stale-confirm",expectedRevision:5,command:{kind:"settle",dead:["C3"]}},25);
  assert.equal(staleAgain.reason,"revision-mismatch");
  const agreed = admitWeiqiMatchCommand(counter.match,{principal:players.black,
    idempotencyKey:"accept",expectedRevision:6,command:{kind:"settle",dead:["C3"]}},26);
  assert.equal(agreed.ok,true);
  assert.equal(agreed.match.revision,7);
  assert.equal(agreed.match.session.version,5);
  assert.equal(agreed.match.session.state.result.by,"count");
  assert.equal(agreed.match.pendingSettlement,null);
  assert.equal(verifyWeiqiMatch(agreed.match).valid,true);
});

test("the reconstructed log rejects a forged revision even with a matching Go position", () => {
  const m = createWeiqiMatch(config,players);
  const first = admitWeiqiMatchCommand(m,{principal:players.black,
    idempotencyKey:"first",expectedRevision:0,command:{kind:"play",move:"C3"}},11);
  assert.equal(first.ok,true);
  assert.equal(verifyWeiqiMatch({...first.match,revision:0}).valid,false);
});
