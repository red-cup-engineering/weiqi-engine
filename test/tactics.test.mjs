import { test } from "node:test";
import assert from "node:assert/strict";
import { planTacticalTryouts } from "../src/tactics.mjs";
import { BLACK, WHITE, createWeiqiGameSession, materializeWeiqiGame,
  admitWeiqiGameCommand } from "../src/index.mjs";

// Build accepted frame evidence from the real engine command admission,
// without borrowing a downstream Study renderer or a fictitious test helper.
function admissionFrames(commands) {
  let session = createWeiqiGameSession({ size: 9, ruleset: "chinese" });
  const frames = [{ version: 0, mover: null, command: null, events: [] }];
  for (const command of commands) {
    const mover = session.state.toMove;
    const outcome = admitWeiqiGameCommand(session, session.version, command);
    assert.equal(outcome.ok, true);
    if (!outcome.ok) throw new Error(outcome.reason);
    session = outcome.session;
    frames.push({ version: session.version, command, mover, events: outcome.events });
  }
  return { session, frames };
}

test("a player is invited to recreate only their own engine-accepted events", () => {
  const commands = [
    { kind: "play", move: "C3" }, { kind: "play", move: "C4" },
    { kind: "play", move: "B4" }, { kind: "play", move: "A1" },
    { kind: "play", move: "D4" }, { kind: "play", move: "A2" },
    { kind: "play", move: "C5" },
  ];
  const { session, frames } = admissionFrames(commands);
  const black = planTacticalTryouts(frames, { color: BLACK });
  const white = planTacticalTryouts(frames, { color: WHITE });
  const capture = black.invitations.find(invitation => invitation.kind === "capture");
  assert.ok(capture, "the recorded capture is a real playable puzzle");
  assert.equal(capture.color, BLACK);
  assert.ok(white.invitations.every(i => i.color === WHITE));
  assert.equal(capture.branchVersion, capture.sourceVersion - 1);
  assert.equal(capture.sourceMove, session.commands[capture.branchVersion].move);
  const fork = createWeiqiGameSession(session.config,
    session.commands.slice(0, capture.branchVersion));
  const result = admitWeiqiGameCommand(fork, fork.version,
    { kind: "play", move: capture.sourceMove });
  assert.equal(result.ok, true);
  assert.ok(result.events.some(e => e.type === capture.kind));
  assert.deepEqual(materializeWeiqiGame(session).current.board,
    materializeWeiqiGame(createWeiqiGameSession(session.config, session.commands)).current.board);
});

test("a quiet or unrelated side receives no imaginary tactical affiliation", () => {
  const input = [
    { version: 0, events: [] },
    { version: 1, mover: BLACK, command: { kind: "play", move: "C3" }, events: [] },
    { version: 2, mover: WHITE, command: { kind: "pass" }, events: [{ type: "pass" }] },
  ];
  assert.equal(planTacticalTryouts(input).invitations.length, 0);
  assert.equal(planTacticalTryouts(input, { color: WHITE }).observedMoves, 0);
});

test("capturing one's own stones is not a recruiting feat", () => {
  const frames = [
    { version: 0, events: [] },
    { version: 1, mover: BLACK, command: { kind: "play", move: "A1" },
      events: [{ type: "capture", detail: { selfCapture: true } }] },
  ];
  assert.equal(planTacticalTryouts(frames).invitations.length, 0);
});

test("engagement order is stable, source-addressed and input is immutable", () => {
  const frames = [
    { version: 0, events: [] },
    { version: 1, mover: BLACK, command: { kind: "play", move: "A1" },
      events: [{ type: "atari-given", termRef: "science://atari" }] },
    { version: 2, mover: WHITE, command: { kind: "play", move: "B1" },
      events: [{ type: "atari-escaped", termRef: "science://atari" }] },
    { version: 3, mover: BLACK, command: { kind: "play", move: "C1" },
      events: [{ type: "capture", detail: { stonesCaptured: 3 }, termRef: "science://capture" }] },
  ];
  const received = planTacticalTryouts(frames, { color: BLACK });
  assert.deepEqual(received.invitations.map(i => i.kind), ["atari-given", "capture"]);
  assert.equal(received.invitations.at(-1).termRef, "science://capture");
  assert.equal(received.invitations.at(-1).sourceMove, "C1");
  assert.ok(Object.isFrozen(received) && Object.isFrozen(received.invitations));
  assert.deepEqual(received, planTacticalTryouts(frames, { color: BLACK }));
  assert.equal(frames[3].events[0].detail.stonesCaptured, 3);
});

test("contradictory or invalid frame boundaries refuse rather than invent lineages", () => {
  assert.throws(() => planTacticalTryouts([]), /opening/);
  assert.throws(() => planTacticalTryouts([{ version: 2, events: [] }]), /contiguous/);
  assert.throws(() => planTacticalTryouts([{ version: 0, events: [] }], { color: 3 }), /Black/);
  assert.throws(() => planTacticalTryouts([{ version: 0, events: [] }], { limit: 0 }), /limit/);
});
