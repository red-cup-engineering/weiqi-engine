import assert from "node:assert/strict";
import { test } from "node:test";
import { checkedOperation0 as run } from "../src/engineering-code-contracts.mjs";
import { createWeiqiGameSession } from "../src/session.mjs";
import { coordToPoint } from "../src/board.mjs";

// Exercise the generated binding as a consumer. Keep assertions about rules,
// branching and errors here instead of freezing entire serialized boards/events.
const config = { size: 9, ruleset: "chinese" };
const initial = () => ({ method: "initialPosition", arguments: [] });
const play = (move, result, path = result ? ["state"] : [], captureError = false) => ({
  method: "extend", arguments: [null, { kind: "play", move }], captureError,
  references: [{ argument: 0, result, path }],
});
const execute = (calls, options = config) => run({ arguments: [options], calls });
const point = (state, coord) => state.board[coordToPoint(state.config.size, state.config.size, coord)];

function returned(observation) {
  assert.equal(observation.status, "returned");
  return observation.value;
}

function refused(observation, reason) {
  assert.equal(observation.status, "threw");
  assert.equal(observation.name, "TypeError");
  assert.match(observation.message, reason);
}

test("factory branches stay independent and recover after an occupied move", async () => {
  const output = await execute([initial(), play("C3", 0), play("G7", 1),
    play("F7", 1), play("C3", 1, ["state"], true), play("G7", 1)]);
  const opening = returned(output[0]);
  const first = returned(output[1]).state;
  const left = returned(output[2]).state;
  const right = returned(output[3]).state;
  assert.ok(opening.board.every(cell => cell === 0));
  assert.deepEqual(first.moves, ["C3"]);
  assert.equal(point(first, "C3"), 1);
  assert.equal(point(first, "G7"), 0);
  assert.equal(point(left, "G7"), 2);
  assert.equal(point(left, "F7"), 0);
  assert.equal(point(right, "F7"), 2);
  assert.equal(point(right, "G7"), 0);
  refused(output[4], /occupied/);
  assert.deepEqual(returned(output[5]), returned(output[2]));
});

test("a captured configuration error does not prevent a fresh initial position", async () => {
  const output = await execute([
    { method: "initialPosition", arguments: ["ignored", "weiqi/5/chinese"], captureError: true },
    initial(), play("C3", 1, []),
  ]);
  refused(output[0], /configuration mismatch/);
  assert.equal(returned(output[1]).board.length, 81);
  assert.deepEqual(returned(output[2]).state.moves, ["C3"]);
});

test("a failed result cannot be used as state even when source errors are captured", async () => {
  await assert.rejects(() => execute([
    { method: "initialPosition", arguments: ["ignored", "weiqi/5/chinese"], captureError: true },
    play("C3", 0, [], true),
  ]), { name: "TypeError", message: /target unavailable/ });
});

test("a foreign configuration is refused without poisoning a fresh position", async () => {
  const foreign = createWeiqiGameSession({ size: 5, ruleset: "chinese" }).state;
  const output = await execute([
    { method: "extend", arguments: [foreign, { kind: "play", move: "C3" }], captureError: true },
    initial(),
  ]);
  refused(output[0], /different engine configuration/);
  const fresh = returned(output[1]);
  assert.equal(fresh.board.length, 81);
  assert.equal(fresh.toMove, 1);
  assert.deepEqual(fresh.commands, []);
});

test("forward references are rejected outside source error capture", async () => {
  await assert.rejects(() => execute([play("C3", 0, [], true)]),
    { name: "TypeError", message: /result-reference input/ });
});

test("referenced history prevents immediate ko recapture and permits another move", async () => {
  const moves = ["C2", "C3", "B3", "B4", "D3", "D4", "A1", "C5", "C4"];
  const output = await execute([initial(), ...moves.map((move, index) => play(move, index)),
    play("C3", 9, ["state"], true), play("E5", 9)], { size: 5, ruleset: "chinese" });
  const capture = returned(output[9]);
  assert.equal(point(capture.state, "C3"), 0);
  assert.equal(point(capture.state, "C4"), 1);
  assert.equal(capture.state.capturedWhiteStones, 1);
  assert.ok(capture.events.some(event => event.kind === "ko-started"));
  refused(output[10], /positional-superko/);
  assert.equal(point(returned(output[11]).state, "E5"), 2);
  assert.deepEqual(returned(output[11]).state.moves, [...moves, "E5"]);
});

test("a missing state property is rejected outside source error capture", async () => {
  await assert.rejects(() => execute([initial(), play("C3", 0, ["missing"], true)]),
    { name: "TypeError", message: /path disagreement/ });
});

test("sequential referenced moves preserve every accepted prefix", async () => {
  const moves = ["C3", "G7", "D3", "F7", "E3", "F6"];
  const output = await execute([initial(), ...moves.map((move, index) => play(move, index))]);
  for (let index = 1; index < output.length; index++) {
    const state = returned(output[index]).state;
    assert.deepEqual(state.moves, moves.slice(0, index));
    assert.equal(state.toMove, index % 2 ? 2 : 1);
    assert.equal(state.board.filter(Boolean).length, index);
    for (let prior = 0; prior < index; prior++) assert.equal(point(state, moves[prior]), prior % 2 ? 2 : 1);
  }
});
