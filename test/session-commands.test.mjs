import { test } from "node:test";
import assert from "node:assert/strict";
import { BLACK, WHITE, coordToPoint } from "../src/board.mjs";
import { gameRecordToSgf, sgfToGameRecord } from "../src/sgf.mjs";
import {
  admitWeiqiGameCommand,
  createWeiqiGameSession,
  handicapStones,
  materializeWeiqiGame,
  sgfResultOf,
  weiqiSessionToSgfRecord,

} from "../src/session.mjs";
import { WALL_MOVES, WALL_WITH_INVADER, sessionAfterMoves } from "./helpers/session-fixtures.mjs";

function admit(session, command) {
  const admitted = admitWeiqiGameCommand(session, session.version, command);
  assert.equal(admitted.ok, true, JSON.stringify(command));
  if (!admitted.ok) throw new Error(admitted.reason);
  return admitted.session;
}

test("a resignation ends the game for the resigning color and every later command is refused as game-ended", () => {
  let session = createWeiqiGameSession({ size: 9, ruleset: "chinese" });
  session = admit(session, { kind: "play", move: "C3" });
  session = admit(session, { kind: "resign", color: WHITE });
  assert.deepEqual(session.state.result, { by: "resignation", winner: BLACK, loser: WHITE });
  assert.equal(session.version, 2);
  assert.deepEqual(session.state.moves, ["C3"]);
  const after = admitWeiqiGameCommand(session, session.version, { kind: "play", move: "D4" });
  assert.deepEqual(after, { ok: false, reason: "game-ended" });
  const again = admitWeiqiGameCommand(session, session.version, { kind: "resign", color: BLACK });
  assert.deepEqual(again, { ok: false, reason: "game-ended" });
  assert.equal(materializeWeiqiGame(session).isLegal("D4"), false);
});

test("a settlement is admitted only after two passes, removes the named stones, and counts under the ruleset", () => {
  let session = sessionAfterMoves({ size: 5, ruleset: "chinese" }, [...WALL_MOVES, "pass", "A3"]);
  const early = admitWeiqiGameCommand(session, session.version, { kind: "settle", dead: ["A3"] });
  assert.deepEqual(early, { ok: false, reason: "main-phase-open" });
  session = admit(session, { kind: "pass" });
  session = admit(session, { kind: "pass" });
  assert.equal(session.state.mainPhaseEnded, true);
  const notAStone = admitWeiqiGameCommand(session, session.version, { kind: "settle", dead: ["C3"] });
  assert.deepEqual(notAStone, { ok: false, reason: "not-a-stone" });
  const offBoard = admitWeiqiGameCommand(session, session.version, { kind: "settle", dead: ["Z9"] });
  assert.deepEqual(offBoard, { ok: false, reason: "not-a-stone" });
  session = admit(session, { kind: "settle", dead: ["a3"] });
  const result = session.state.result;
  assert.ok(result && result.by === "count");
  if (!result || result.by !== "count") return;
  assert.equal(result.mode, "area");
  assert.deepEqual(result.dead, ["A3"]);
  assert.equal(result.winner, WHITE);
  assert.equal(result.score.blackScore, 10);
  assert.equal(result.score.whiteScore, 17.5);
  assert.equal(result.score.margin, "White by 7.5");
  const twice = admitWeiqiGameCommand(session, session.version, { kind: "settle", dead: [] });
  assert.deepEqual(twice, { ok: false, reason: "game-ended" });
});


test("versioned sessions reject settlement after resumed play until the next pass pair", () => {
  let session = createWeiqiGameSession({ size: 9, ruleset: "chinese" });
  for (const move of ["E5", "D4", "pass", "pass", "C3"]) {
    session = admit(session, move === "pass" ? { kind: "pass" } : { kind: "play", move });
  }
  assert.equal(session.state.mainPhaseEnded, true);
  assert.equal(session.state.passStreak, 0);
  const command = { kind: "settle", dead: [] };
  assert.deepEqual(admitWeiqiGameCommand(session, session.version, command),
    { ok: false, reason: "main-phase-open" });
  assert.throws(() => createWeiqiGameSession(session.config, [...session.commands, command]),
    /main-phase-open/, "an invalid finalization must not enter the replayable command record");
  for (const move of ["pass", "pass"]) session = admit(session, { kind: move });
  const settled = admitWeiqiGameCommand(session, session.version, command);
  assert.equal(settled.ok, true, "new accepted consecutive passes reopen the settlement window");
  if (settled.ok) assert.equal(settled.session.state.result.by, "count");
});


test("a Japanese settlement counts territory and the prisoner the dead stone becomes", () => {
  let session = sessionAfterMoves({ size: 5, ruleset: "japanese" }, WALL_WITH_INVADER);
  session = admit(session, { kind: "settle", dead: ["A3"] });
  const result = session.state.result;
  assert.ok(result && result.by === "count");
  if (!result || result.by !== "count") return;
  assert.equal(result.mode, "territory");
  assert.equal(result.score.blackScore, 6);
  assert.equal(result.score.whiteScore, 11.5);
});

test("a handicap game places the fixed-star stones for Black and gives White the first move", () => {
  const session = createWeiqiGameSession({ size: 9, ruleset: "chinese", handicap: 4 });
  assert.deepEqual(session.state.handicap, ["G7", "C3", "G3", "C7"]);
  assert.equal(session.state.toMove, WHITE);
  const game = materializeWeiqiGame(session);
  for (const coord of session.state.handicap) assert.equal(game.current.board[coordToPoint(9, 9, coord)], BLACK);
  const occupied = admitWeiqiGameCommand(session, 0, { kind: "play", move: "C3" });
  assert.deepEqual(occupied, { ok: false, reason: "occupied" });
  const white = admitWeiqiGameCommand(session, 0, { kind: "play", move: "E5" });
  assert.equal(white.ok, true);
  if (white.ok) assert.equal(white.session.state.toMove, BLACK);
  assert.deepEqual(handicapStones({ size: 9, ruleset: "chinese" }), []);
  assert.throws(() => createWeiqiGameSession({ size: 9, ruleset: "chinese", handicap: 6 }), /beyond 5 stones/);
  assert.throws(() => createWeiqiGameSession({ size: 7, ruleset: "chinese", handicap: 2 }), /7x7/);
  assert.throws(() => createWeiqiGameSession({ size: 9, ruleset: "chinese", handicap: 1 }), /at least 2/);
});

test("the SGF projection carries handicap stones, komi, the White-first move order, and the result", () => {
  let session = createWeiqiGameSession({ size: 9, ruleset: "chinese", handicap: 2 });
  session = admit(session, { kind: "play", move: "E5" });
  session = admit(session, { kind: "play", move: "E4" });
  session = admit(session, { kind: "resign", color: BLACK });
  const record = weiqiSessionToSgfRecord(session);
  assert.deepEqual(record.handicap, ["G7", "C3"]);
  assert.equal(record.komi, 7.5);
  assert.equal(record.result, "W+R");
  assert.deepEqual(record.moves.map((move) => move.color), [WHITE, BLACK]);
  const sgf = gameRecordToSgf(record);
  assert.match(sgf, /HA\[2\]/);
  assert.match(sgf, /RE\[W\+R\]/);
  assert.match(sgf, /;W\[ee\];B\[ed\]/);
  const parsed = sgfToGameRecord(sgf);
  assert.equal(parsed.result, "W+R");
  assert.deepEqual(parsed.handicap, ["G7", "C3"]);
  assert.equal(sgfResultOf(null), undefined);
});

test("a counted result serializes as the winner plus margin, and a draw as 0", () => {
  let session = sessionAfterMoves({ size: 5, ruleset: "chinese" }, [...WALL_MOVES, "pass", "pass"]);
  session = admit(session, { kind: "settle", dead: [] });
  assert.equal(weiqiSessionToSgfRecord(session).result, "W+7.5");
  let drawn = createWeiqiGameSession({ size: 5, ruleset: "newzealand" });
  // New Zealand komi is 7: Black needs a 7-point lead on the board for a draw. Black walls A-C (three columns of stones) against White's E column.
  for (const move of ["A1", "E1", "B1", "E2", "C1", "E3", "A2", "E4", "B2", "E5", "C2", "pass", "A3", "pass", "B3", "pass", "C3", "pass", "A4", "pass", "B4", "pass", "C4", "pass", "A5", "pass", "B5", "pass", "C5", "pass", "pass"]) drawn = admit(drawn, move === "pass" ? { kind: "pass" } : { kind: "play", move });
  drawn = admit(drawn, { kind: "settle", dead: [] });
  const result = drawn.state.result;
  assert.ok(result && result.by === "count");
  if (result && result.by === "count") {
    assert.equal(result.score.blackScore, 15);
    assert.equal(result.score.whiteScore, 5 + 7);
  }
});
