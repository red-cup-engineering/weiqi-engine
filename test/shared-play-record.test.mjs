import assert from "node:assert/strict";
import { test } from "node:test";
import { createWeiqiMatch, admitWeiqiMatchCommand, verifyWeiqiMatch } from "@red-cup-engineering/weiqi-engine/match";
import { replayWeiqi, verifyWeiqiIntentLog } from "@red-cup-engineering/weiqi-engine/replay";

test("the shared game engine preserves the 0.3.5 logged move and checkpoint", () => {
  const config = { size: 9, ruleset: "chinese" };
  const command = { kind: "play", move: "E5" };
  const match = createWeiqiMatch(config, { black: "black", white: "white" });
  const request = { principal: "black", idempotencyKey: "one", expectedRevision: 0, command };
  const accepted = admitWeiqiMatchCommand(match, request, 100);
  assert.ok(accepted.ok);
  assert.deepEqual(accepted.match.log, [{ seq: 0, intent: {
    kind: "weiqi-command", principal: "black", idempotencyKey: "one",
    expectedRevision: 0, configId: "weiqi/9/chinese", command,
  }, ts: 100 }]);
  assert.equal(accepted.match.stateHash, "68b22901454f12265af4cd2f1cbede654cfd925c994d1695ab62ee6d08eed332");
  assert.ok(verifyWeiqiMatch(accepted.match).valid);
  assert.ok(admitWeiqiMatchCommand(accepted.match, request, 101).duplicate);
  const replay = replayWeiqi(config, [command]);
  const checked = verifyWeiqiIntentLog(config, [{ seq: 0, intent: command, ts: 100 }]);
  assert.ok(replay.valid && checked.valid);
  assert.deepEqual(replay.finalState.moves, ["E5"]);
  assert.equal(replay.stateHash, checked.stateHash);
});
