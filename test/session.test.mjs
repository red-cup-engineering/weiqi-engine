import assert from "node:assert/strict";
import { test } from "node:test";
import { Game } from "../src/game.mjs";
import {
  admitWeiqiGameCommand,
  createWeiqiGameSession,
  materializeWeiqiGame,
  weiqiSessionToSgfRecord,
} from "../src/session.mjs";

const config = Object.freeze({ size: 9, ruleset: "chinese" });

test("versioned session admission preserves a replayable legal game", () => {
  const initial = createWeiqiGameSession(config);
  const black = admitWeiqiGameCommand(initial, 0, { kind: "play", move: "C3" });
  assert.ok(black.ok);
  if (!black.ok) return;
  const white = admitWeiqiGameCommand(black.session, 1, { kind: "play", move: "G7" });
  assert.ok(white.ok);
  if (!white.ok) return;
  assert.equal(white.session.version, 2);
  assert.deepEqual(white.session.state.moves, ["C3", "G7"]);
  assert.equal(materializeWeiqiGame(white.session).current.toMove, 1);
});

test("session admission refuses stale and illegal commands without advancing the record", () => {
  const initial = createWeiqiGameSession(config);
  const accepted = admitWeiqiGameCommand(initial, 0, { kind: "play", move: "C3" });
  assert.ok(accepted.ok);
  if (!accepted.ok) return;
  const stale = admitWeiqiGameCommand(accepted.session, 0, { kind: "play", move: "G7" });
  assert.deepEqual(stale, { ok: false, reason: "version-mismatch", expectedVersion: 0, actualVersion: 1 });
  const occupied = admitWeiqiGameCommand(accepted.session, 1, { kind: "play", move: "C3" });
  assert.deepEqual(occupied, { ok: false, reason: "occupied" });
  assert.deepEqual(accepted.session.state.moves, ["C3"]);
});

test("the session supplies one SGF interchange projection from accepted commands", () => {
  const session = createWeiqiGameSession(config, [
    { kind: "play", move: "C3" },
    { kind: "pass" },
  ]);
  assert.deepEqual(weiqiSessionToSgfRecord(session), {
    size: 9,
    ruleset: "chinese",
    komi: 7.5,
    moves: [
      { color: 1, point: 20 },
      { color: 2, point: "pass" },
    ],
  });
});

test("accepted session snapshots match full log replay after every command across sizes and rulesets", () => {
  for (const size of [5, 9, 13, 19]) {
    for (const ruleset of ["chinese", "japanese", "aga", "newzealand", "ing"]) {
      const config = { size, ruleset };
      let session = createWeiqiGameSession(config);
      const placements = [
        [0, 0], [size - 1, size - 1], [Math.floor(size / 2), Math.floor(size / 2)],
        [size - 1, 0], [0, size - 1], [1, 0], [size - 2, size - 1],
      ];
      for (const [col, row] of placements) {
        const move = String.fromCharCode(65 + col + (col >= 8 ? 1 : 0)) + (row + 1);
        const admitted = admitWeiqiGameCommand(session, session.version, { kind: "play", move });
        assert.equal(admitted.ok, true, `${size}x${size} ${ruleset}: ${move}`);
        if (!admitted.ok) return;
        assert.deepEqual(admitted.session,
          createWeiqiGameSession(config, [...session.commands, { kind: "play", move }]),
          `${size}x${size} ${ruleset}: admitted snapshot must equal independent full replay`);
        assert.equal(Object.isFrozen(admitted.session), true);
        assert.equal(Object.isFrozen(admitted.session.commands), true);
        assert.equal(session.version + 1, admitted.session.version);
        session = admitted.session;
      }
      for (const command of [{ kind: "pass" }, { kind: "pass" }]) {
        const admitted = admitWeiqiGameCommand(session, session.version, command);
        assert.equal(admitted.ok, true);
        if (!admitted.ok) return;
        assert.deepEqual(admitted.session,
          createWeiqiGameSession(config, [...session.commands, command]),
          "two-pass result must agree with independent replay");
        session = admitted.session;
      }
    }
  }
});

test("handicap, settlement, and resignation receipts remain exactly reproducible", () => {
  const cases = [
    {
      config: { size: 9, ruleset: "chinese", handicap: 4 },
      commands: [{ kind: "play", move: "E5" }, { kind: "play", move: "E4" },
        { kind: "resign", color: 1 }],
    },
    {
      config: { size: 5, ruleset: "chinese" },
      commands: ["B1", "D1", "B2", "D2", "B3", "D3", "B4", "D4", "B5", "D5",
        "pass", "A3", "pass", "pass"].map(move =>
        move === "pass" ? { kind: "pass" } : { kind: "play", move })
        .concat({ kind: "settle", dead: ["a3"] }),
    },
  ];
  for (const { config, commands } of cases) {
    let session = createWeiqiGameSession(config);
    for (const command of commands) {
      const admitted = admitWeiqiGameCommand(session, session.version, command);
      assert.equal(admitted.ok, true, JSON.stringify({ config, command }));
      if (!admitted.ok) return;
      const replayed = createWeiqiGameSession(config, [...session.commands, command]);
      assert.deepEqual(admitted.session, replayed);
      assert.deepEqual(materializeWeiqiGame(admitted.session).current.board,
        materializeWeiqiGame(replayed).current.board);
      session = admitted.session;
    }
    assert.ok(session.state.result, "both terminal commands must produce a result");
  }
});

test("locally admitted sessions reuse their validated rules history; imported sessions always replay", () => {
  const originalPlay = Game.prototype.play;
  let played = 0;
  Game.prototype.play = function countedPlay(...args) {
    played += 1;
    return originalPlay.apply(this, args);
  };
  try {
    let session = createWeiqiGameSession(config);
    const moves = ["C3", "G7", "D3", "F7", "E3", "F6"];
    for (const move of moves) {
      const next = admitWeiqiGameCommand(session, session.version, { kind: "play", move });
      assert.equal(next.ok, true, move);
      session = next.session;
    }
    assert.equal(played, moves.length,
      "newly admitted local moves must not replay the accepted prefix at each turn");

    const left = materializeWeiqiGame(session);
    const right = materializeWeiqiGame(session);
    assert.equal(played, moves.length, "views of trusted sessions fork history without replay");
    assert.equal(left.history.length, moves.length + 1);
    assert.equal(right.history.length, moves.length + 1);
    assert.equal(left.play("B3").ok, true);
    assert.equal(right.history.length, moves.length + 1,
      "a caller's mutable Game cannot change another continuation");
    assert.equal(materializeWeiqiGame(session).history.length, moves.length + 1);

    const imported = structuredClone(session);
    const before = played;
    const reconstructed = materializeWeiqiGame(imported);
    assert.equal(played - before, moves.length,
      "unknown or imported records must prove every historical move");
    assert.deepEqual(reconstructed.current.board, right.current.board);
    const corrupted = structuredClone(session);
    corrupted.commands[0].move = "Z99";
    assert.throws(() => materializeWeiqiGame(corrupted), /Cannot reconstruct Weiqi session/,
      "a forged imported record must not inherit the trusted local cache");
  } finally {
    Game.prototype.play = originalPlay;
  }
});

test("mutating a derived game event cannot corrupt the internally validated session", () => {
  let session = createWeiqiGameSession(config);
  for (const move of ["E4", "D4", "D3", "A1", "C4", "A2", "D5"]) {
    const outcome = admitWeiqiGameCommand(session, session.version, { kind: "play", move });
    assert.equal(outcome.ok, true, move);
    session = outcome.session;
  }
  const first = materializeWeiqiGame(session);
  const event = first.moveEvents.at(-1).find((e) => e.type === "capture");
  assert.ok(event, "the rules engine must report the real capture");
  const originalCount = event.detail.stonesCaptured;
  event.detail.stonesCaptured = 999;
  const again = materializeWeiqiGame(session);
  assert.equal(again.moveEvents.at(-1).find((e) => e.type === "capture").detail.stonesCaptured,
    originalCount, "published view events must not mutate the cached rules history");
});
