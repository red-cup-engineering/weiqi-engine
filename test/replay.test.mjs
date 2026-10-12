import assert from "node:assert/strict";
import { test } from "node:test";
import { replayWeiqi, verifyWeiqiIntentLog } from "../src/replay.mjs";

const config = Object.freeze({ size: 9, ruleset: "chinese" });

test("Cartridge replay reproduces a legal Weiqi move record and stable state hash", () => {
  const intents = Object.freeze([
    Object.freeze({ kind: "play", move: "C3" }),
    Object.freeze({ kind: "play", move: "G7" }),
    Object.freeze({ kind: "pass" }),
    Object.freeze({ kind: "pass" }),
  ]);
  const first = replayWeiqi(config, intents);
  const second = replayWeiqi(config, intents);
  assert.equal(first.valid, true);
  assert.equal(first.finalState.mainPhaseEnded, true);
  assert.deepEqual(first.finalState.moves, ["C3", "G7", "pass", "pass"]);
  assert.equal(first.stateHash, second.stateHash);
});

test("Cartridge verifier rejects a tampered Weiqi intent without advancing state", () => {
  const result = verifyWeiqiIntentLog(config, [
    Object.freeze({ seq: 0, intent: Object.freeze({ kind: "play", move: "C3" }) }),
    Object.freeze({ seq: 1, intent: Object.freeze({ kind: "play", move: "C3" }) }),
  ]);
  assert.equal(result.valid, false);
  assert.deepEqual(result.finalState.moves, ["C3"]);
});
