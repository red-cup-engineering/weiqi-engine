import { test } from "node:test";
import assert from "node:assert/strict";
import { BLACK, EMPTY, WHITE, coordToPoint } from "../src/board.mjs";
import {
  admitWeiqiGameCommand,
  createWeiqiGameSession,
  materializeWeiqiGame,
} from "../src/session.mjs";

function admitted(session, command) {
  const outcome = admitWeiqiGameCommand(session, session.version, command);
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  return outcome.session;
}

test("a writable observer board cannot contaminate the cached initial game", () => {
  const session = createWeiqiGameSession({ size: 9, ruleset: "chinese" });
  const foreign = materializeWeiqiGame(session);
  const a1 = coordToPoint(9, 9, "A1");
  foreign.current.board[a1] = BLACK;
  foreign.current.capturedBlackStones = 900;
  assert.equal(session.state.board[a1], EMPTY, "immutable session record has no foreign move");

  const reread = materializeWeiqiGame(session);
  assert.equal(reread.current.board[a1], EMPTY, "cached game remains an empty board");
  assert.equal(reread.current.capturedBlackStones, 0, "prisoner count remains source-owned");
  const result = admitWeiqiGameCommand(session, session.version, { kind: "play", move: "A1" });
  assert.equal(result.ok, true, "foreign mutation cannot fabricate an occupied refusal");
  assert.equal(result.session.state.board[a1], BLACK);
});

test("every historical board, not just the current board, is isolated on materialization", () => {
  let session = createWeiqiGameSession({ size: 9, ruleset: "chinese" });
  for (const coord of ["E5", "F5", "E4", "F4", "pass", "pass"]) {
    session = admitted(session, coord === "pass"
      ? { kind: "pass" } : { kind: "play", move: coord });
  }
  const original = materializeWeiqiGame(session);
  const firstRead = materializeWeiqiGame(session);
  assert.equal(firstRead.history.length, session.version + 1);

  // Poison every writable history buffer to expose a shallow-fork alias.
  for (const position of firstRead.history) {
    position.board.fill(WHITE);
    position.capturedWhiteStones = 900;
  }
  firstRead.history.push(firstRead.current);

  const reread = materializeWeiqiGame(session);
  assert.equal(reread.history.length, original.history.length,
    "observer cannot append an event to the private rule history");
  for (let index = 0; index < original.history.length; index++) {
    assert.notStrictEqual(reread.history[index].board, firstRead.history[index].board,
      "each position owns its board buffer at history index " + index);
    assert.deepEqual(reread.history[index].board, original.history[index].board,
      "actual historical stones remain unchanged at " + index);
    assert.equal(reread.history[index].capturedWhiteStones,
      original.history[index].capturedWhiteStones);
  }
  assert.equal(reread.passStreak, 2);
  const settled = admitWeiqiGameCommand(session, session.version, { kind: "settle", dead: [] });
  assert.equal(settled.ok, true, "untainted two-pass position still settles");
  assert.equal(settled.session.state.result.by, "count");
});

test("a previous observer cannot mutate the separately admitted successor's board", () => {
  const opening = createWeiqiGameSession({ size: 9, ruleset: "japanese" });
  const successor = admitted(opening, { kind: "play", move: "E5" });
  const inspect = materializeWeiqiGame(opening);
  const e5 = coordToPoint(9, 9, "E5");
  inspect.current.board[e5] = WHITE;
  assert.equal(materializeWeiqiGame(opening).current.board[e5], EMPTY);
  assert.equal(materializeWeiqiGame(successor).current.board[e5], BLACK);
  const white = admitWeiqiGameCommand(successor, successor.version, { kind: "play", move: "F5" });
  assert.equal(white.ok, true);
  assert.equal(white.session.state.board[coordToPoint(9, 9, "F5")], WHITE);
});
