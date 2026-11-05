import assert from "node:assert/strict";
import { test } from "node:test";
import { Game } from "../src/game.mjs";
import { createWeiqiGameSession } from "../src/session.mjs";
import { createWeiqiCartridge, createWeiqiGameEngine, replayWeiqi, verifyWeiqiIntentLog } from "../src/replay.mjs";

const config = Object.freeze({ size: 9, ruleset: "chinese" });

test("the standard game-engine name preserves the existing factory identity", () => {
  assert.equal(createWeiqiCartridge, createWeiqiGameEngine);
});

test("game-engine replay applies each accepted command once without replaying its prefixes", () => {
  const originalPlay = Game.prototype.play;
  let applications = 0;
  Game.prototype.play = function (...args) {
    applications += 1;
    return originalPlay.apply(this, args);
  };
  try {
    const commands = ["C3", "G7", "D3", "F7", "E3", "F6"]
      .map(move => ({ kind: "play", move }));
    const result = replayWeiqi(config, commands);
    assert.equal(result.valid, true);
    assert.equal(applications, commands.length,
      "the replay adapter must reuse admitted sessions, not replay every accepted prefix");
    assert.deepEqual(result.finalState, createWeiqiGameSession(config, commands).state);
  } finally {
    Game.prototype.play = originalPlay;
  }
});

test("imported and cross-engine states replay their command history before continuing", () => {
  const engine = createWeiqiGameEngine(config);
  let state = engine.initialPosition();
  state = engine.extend(state, { kind: "play", move: "C3" }).state;
  state = engine.extend(state, { kind: "play", move: "G7" }).state;
  const originalPlay = Game.prototype.play;
  let applications = 0;
  Game.prototype.play = function (...args) {
    applications += 1;
    return originalPlay.apply(this, args);
  };
  try {
    const command = { kind: "play", move: "D3" };
    const local = engine.extend(state, command);
    assert.equal(applications, 1);
    applications = 0;
    const imported = structuredClone(state);
    const reconstructed = engine.extend(imported, command);
    assert.equal(applications, 3, "both imported historical commands must be executed");
    assert.deepEqual(reconstructed, local);
    applications = 0;
    const foreign = createWeiqiGameEngine(config).extend(state, command);
    assert.equal(applications, 3, "another engine's immutable states are not local cache keys");
    assert.deepEqual(foreign, local);
    imported.commands[0].move = "Z99";
    assert.throws(() => engine.extend(imported, command), /Cannot reconstruct/,
      "even a previously reconstructed import cannot bypass later command validation");
  } finally {
    Game.prototype.play = originalPlay;
  }
});

test("cached prefixes fork independent continuations and rejected moves cannot poison them", () => {
  const engine = createWeiqiGameEngine(config);
  const initial = engine.initialPosition();
  const prefix = engine.extend(initial, { kind: "play", move: "C3" }).state;
  const left = engine.extend(prefix, { kind: "play", move: "G7" });
  const right = engine.extend(prefix, { kind: "play", move: "F7" });
  assert.deepEqual(prefix.moves, ["C3"]);
  assert.deepEqual(left.state.moves, ["C3", "G7"]);
  assert.deepEqual(right.state.moves, ["C3", "F7"]);
  assert.throws(() => engine.extend(prefix, { kind: "play", move: "C3" }), /occupied/);
  assert.deepEqual(engine.extend(prefix, { kind: "play", move: "G7" }), left);
  assert.throws(() => { prefix.commands[0].move = "Z99"; }, TypeError);
  assert.throws(() => { prefix.board[0] = 1; }, TypeError);
  assert.deepEqual(initial.moves, []);
});

test("cached and imported replay states retain ko history rather than only the current board", () => {
  for (const [ruleset, reason] of [["japanese", "simple-ko"],
    ["chinese", "positional-superko"], ["aga", "situational-superko"]]) {
    const engine = createWeiqiGameEngine({ size: 5, ruleset });
    let state = engine.initialPosition();
    for (const move of ["C2", "C3", "B3", "B4", "D3", "D4", "A1", "C5", "C4"]) {
      state = engine.extend(state, { kind: "play", move }).state;
    }
    for (const source of [state, structuredClone(state)]) {
      assert.throws(() => engine.extend(source, { kind: "play", move: "C3" }),
        new RegExp(reason));
    }
    assert.equal(engine.extend(state, { kind: "play", move: "E5" }).state.moves.length, 10);
  }
});

test("cached transitions retain exact ruleset, handicap, settlement and resignation receipts", () => {
  for (const ruleset of ["chinese", "japanese", "aga", "newzealand", "ing"]) {
    for (const handicap of [0, 2]) {
      for (const terminal of [{ kind: "resign", color: 1 }, { kind: "settle", dead: [] }]) {
        const configuration = { size: 9, ruleset, handicap };
        const engine = createWeiqiGameEngine(configuration);
        let state = engine.initialPosition();
        const commands = [];
        for (const command of [{ kind: "play", move: "E5" },
          { kind: "play", move: "E4" }, { kind: "pass" }, { kind: "pass" }, terminal]) {
          commands.push(command);
          state = engine.extend(state, command).state;
          assert.deepEqual(state, createWeiqiGameSession(configuration, commands).state);
        }
        assert.ok(state.result);
        assert.throws(() => engine.extend(state, { kind: "pass" }), /game-ended/);
      }
    }
  }
});

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
