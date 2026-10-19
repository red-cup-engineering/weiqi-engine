import assert from "node:assert/strict";
import { test } from "node:test";
import { planReplayMoments } from "../src/reel.mjs";

const recorded = [
  { version: 0, events: [] },
  { version: 1, command: { kind: "play", move: "C3" }, events: [] },
  { version: 2, command: { kind: "play", move: "D4" }, events: [{ type: "atari-given", detail: { groupSize: 2 } }] },
  { version: 3, command: { kind: "play", move: "E5" }, events: [
    { type: "capture", detail: { stonesCaptured: 2 } },
    { type: "group-killed", detail: { groupSize: 2 } },
  ] },
  { version: 4, command: { kind: "pass" }, events: [{ type: "pass" }] },
  { version: 5, command: { kind: "pass" }, events: [{ type: "counting-opened", detail: { trigger: "two-consecutive-passes" } }] },
];

test("director preserves chronology while selecting real semantic match moments", () => {
  const reel = planReplayMoments(recorded);
  assert.deepEqual(reel.map(beat => beat.version), [0, 2, 3, 5]);
  assert.deepEqual(reel.map(beat => beat.kind), ["opening", "atari-given", "capture", "counting-opened"]);
  assert.equal(reel[2].title, "2 stones captured");
  assert.equal(reel[2].cue, "impact");
  assert.equal(recorded[3].events[0].detail.stonesCaptured, 2);
  assert.ok(Object.isFrozen(reel) && reel.every(Object.isFrozen));
});

test("limited reel reserves opening/last move and chooses strongest real event", () => {
  assert.deepEqual(planReplayMoments(recorded, { limit: 3 }).map(beat => beat.version), [0, 3, 5]);
  assert.deepEqual(planReplayMoments(recorded, { limit: 2 }).map(beat => beat.version), [0, 5]);
});

test("unremarkable and empty recordings never invent heroics", () => {
  assert.deepEqual(planReplayMoments([recorded[0]]).map(beat => beat.version), [0]);
  const plain = planReplayMoments([recorded[0], { version: 1, command: { kind: "play", move: "A1" }, events: [] }]);
  assert.equal(plain.length, 2);
  assert.equal(plain[1].kind, "continuation");
});

test("terminal resignation and settlement remain visible without a fabricated rules event", () => {
  for (const [kind, outcome] of [["resign", "resignation"], ["settle", "settlement"]]) {
    const reel = planReplayMoments([recorded[0], { version: 1, command: { kind }, events: [] }]);
    assert.equal(reel.at(-1).kind, outcome);
  }
});

test("corrupt versions and nonsensical limits refuse before presenting a replay", () => {
  assert.throws(() => planReplayMoments([]), /opening/);
  assert.throws(() => planReplayMoments([{ version: 1, events: [] }]), /contiguous/);
  assert.throws(() => planReplayMoments([{ version: 0, events: null }]), /contiguous/);
  for (const limit of [0, 1, 31, 2.1, NaN]) {
    assert.throws(() => planReplayMoments(recorded, { limit }), /limit/);
  }
});


test("counting only opens score negotiation, while admitted settlement is the finale", () => {
  const complete = [...recorded, {
    version: 6, command: { kind: "settle", dead: [] }, events: [],
  }];
  const scenes = planReplayMoments(complete, { limit: 6 });
  const count = scenes.find((moment) => moment.kind === "counting-opened");
  assert.ok(count, "two passes should remain visible as a transition");
  assert.equal(count.cue, "tick");
  assert.ok(count.impact < scenes.at(-1).impact);
  assert.equal(scenes.at(-1).kind, "settlement");
  assert.equal(scenes.at(-1).title, "Count agreed");
  assert.equal(scenes.at(-1).cue, "chime", "only the actual admitted settlement receives a terminal cue");
});
