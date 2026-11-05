import assert from "node:assert/strict";
import { test } from "node:test";
import { createRulePlayer, hashPosition, replayPlay } from "@red-cup-engineering/gaming/running/rules";
import { Game } from "../../src/game.mjs";
import { createWeiqiGameEngine, configIdentifier } from "../../src/replay.mjs";
import { createWeiqiGameSession } from "../../src/session.mjs";

const config = { size: 9, ruleset: "chinese" };
const commands = ["C3", "G7", "D3", "F7", "E3", "F6"]
  .map(move => ({ kind: "play", move }));

test("the actual Gaming streaming consumer executes each Weiqi move once", () => {
  const entries = [];
  const player = createRulePlayer(createWeiqiGameEngine(config), {
    seed: "consumer-regression", configId: configIdentifier(config),
    onEntry: entry => entries.push(entry),
  });
  const originalPlay = Game.prototype.play;
  let applications = 0;
  Game.prototype.play = function (...args) {
    applications += 1;
    return originalPlay.apply(this, args);
  };
  try {
    for (const [index, command] of commands.entries()) player.play(command, 1000 + index);
    assert.equal(applications, commands.length);
  } finally {
    Game.prototype.play = originalPlay;
  }
  const expected = createWeiqiGameSession(config, commands).state;
  assert.deepEqual(player.position, expected);
  assert.equal(player.stateHash(), hashPosition(expected));
  const reader = createRulePlayer(createWeiqiGameEngine(config), { seed: "consumer-regression" });
  for (const entry of entries) reader.replayEntry(entry);
  assert.deepEqual(reader.position, expected);
  assert.equal(reader.stateHash(), player.stateHash());
  assert.throws(() => reader.replayEntry(entries[0]), /sequence/);
  assert.equal(reader.moves, entries.length);
});

test("the shared batch consumer keeps legacy replay state hashes and refuses terminal suffixes", () => {
  const seed = "consumer-regression";
  const engine = createWeiqiGameEngine(config);
  // Original adapter behavior, rebuilt through the original session owner.
  const reference = {
    initialPosition: () => createWeiqiGameSession(config).state,
    extend(state, command) {
      return { state: createWeiqiGameSession(config, [...state.commands, command]).state, events: [] };
    },
  };
  for (const terminal of [{ kind: "resign", color: 1 }, { kind: "settle", dead: [] }]) {
    const log = [...commands, { kind: "pass" }, { kind: "pass" }, terminal];
    const accepted = replayPlay(engine, seed, log);
    const prior = replayPlay(reference, seed, log);
    assert.equal(accepted.valid, true);
    assert.deepEqual(accepted.finalState, prior.finalState);
    assert.equal(accepted.stateHash, prior.stateHash);
    const invalid = replayPlay(engine, seed, [...log, { kind: "pass" }]);
    assert.equal(invalid.valid, false);
    assert.deepEqual(invalid.finalState, accepted.finalState);
    assert.equal(invalid.stateHash, accepted.stateHash);
  }
});
