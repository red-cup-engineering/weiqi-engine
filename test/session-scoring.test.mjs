import { test } from "node:test";
import assert from "node:assert/strict";
import { BLACK, EMPTY, WHITE, coordToPoint } from "../src/board.mjs";
import { computeTerritory } from "../src/scoring.mjs";
import { admitWeiqiGameCommand, createWeiqiGameSession, materializeWeiqiGame, scoreWeiqiSession, weiqiSessionToSgfRecord } from "../src/session.mjs";
import { walledSession } from "./helpers/session-fixtures.mjs";

// Walled positions come from the shared upstream test-only session fixture.
function ownerAt(ownership, coord) {
  return ownership[coordToPoint(5, 5, coord)];
}

test("computeTerritory's ownership map names exactly the points its counts add up", () => {
  const session = walledSession("chinese", ["pass", "pass"]);
  const { score, ownership, position } = scoreWeiqiSession(session);
  const territory = computeTerritory(position);
  const blackPoints = [...ownership].filter((owner) => owner === BLACK).length;
  const whitePoints = [...ownership].filter((owner) => owner === WHITE).length;
  assert.equal(blackPoints, territory.blackTerritory);
  assert.equal(whitePoints, territory.whiteTerritory);
  assert.equal(blackPoints, score.blackTerritory);
  for (const row of [1, 2, 3, 4, 5]) {
    assert.equal(ownerAt(ownership, `A${row}`), BLACK, `A${row} is Black territory`);
    assert.equal(ownerAt(ownership, `E${row}`), WHITE, `E${row} is White territory`);
    assert.equal(ownerAt(ownership, `C${row}`), EMPTY, `C${row} is dame`);
    assert.equal(ownerAt(ownership, `B${row}`), EMPTY, "an occupied point is never marked as territory");
  }
});

test("a Chinese-rules session is counted by area with the ruleset's own komi", () => {
  const session = walledSession("chinese", ["pass", "pass"]);
  assert.equal(session.state.mainPhaseEnded, true);
  const { mode, score, ruleset } = scoreWeiqiSession(session);
  assert.equal(mode, "area");
  assert.equal(ruleset.name, "chinese");
  assert.equal(score.blackScore, 10);
  assert.equal(score.whiteScore, 10 + 7.5);
  assert.equal(score.margin, "White by 7.5");
});

test("a Japanese-rules session is counted by territory with the ruleset's own komi", () => {
  const session = walledSession("japanese", ["pass", "pass"]);
  const { mode, score } = scoreWeiqiSession(session);
  assert.equal(mode, "territory");
  assert.equal(score.blackScore, 5);
  assert.equal(score.whiteScore, 5 + 6.5);
  assert.equal(score.margin, "White by 6.5");
});

test("an AGA session counts area (its primary komi), never the territory komi", () => {
  const { mode, score } = scoreWeiqiSession(walledSession("aga", ["pass", "pass"]));
  assert.equal(mode, "area");
  assert.equal(score.whiteScore, 10 + 7.5);
});

test("agreed dead points are removed as prisoners before counting, by coordinate or index", () => {
  // White drops a stone at A3 inside Black's wall; unsettled, it neutralizes
  // Black's whole A column. Marking it dead restores the territory and, under
  // territory scoring, credits Black one prisoner.
  const session = walledSession("chinese", ["pass", "A3", "pass", "pass"]);
  assert.equal(session.state.mainPhaseEnded, true);

  const unsettled = scoreWeiqiSession(session);
  assert.equal(unsettled.score.blackTerritory, 0, "an unsettled invader neutralizes the region it touches");
  assert.equal(unsettled.score.blackScore, 5);

  const settled = scoreWeiqiSession(session, ["A3"]);
  assert.equal(settled.position.board[coordToPoint(5, 5, "A3")], EMPTY);
  assert.equal(settled.position.capturedWhiteStones, 1);
  assert.equal(settled.score.blackTerritory, 5);
  assert.equal(settled.score.blackScore, 10);
  assert.equal(ownerAt(settled.ownership, "A3"), BLACK);
  assert.equal(settled.score.whiteScore, 10 + 7.5, "area scoring does not count the prisoner twice");

  const byIndex = scoreWeiqiSession(session, [coordToPoint(5, 5, "A3")]);
  assert.deepEqual(byIndex.score, settled.score);

  const japanese = scoreWeiqiSession(walledSession("japanese", ["pass", "A3", "pass", "pass"]), ["A3"]);
  assert.equal(japanese.score.blackPrisoners, 1);
  assert.equal(japanese.score.blackScore, 6, "territory scoring counts the prisoner");
});

test("a dead point off the board is refused instead of silently ignored", () => {
  const session = walledSession("chinese");
  assert.throws(() => scoreWeiqiSession(session, [25]), TypeError);
  assert.throws(() => scoreWeiqiSession(session, ["F1"]), /out of range/i);
});

test("scoring never mutates the session or requires the main phase to have ended", () => {
  const session = walledSession("chinese");
  const before = JSON.stringify(session);
  const { score } = scoreWeiqiSession(session);
  assert.equal(score.margin, "White by 7.5");
  assert.equal(JSON.stringify(session), before);
  assert.equal(session.state.mainPhaseEnded, false);
});


test("dead-point reading refuses empty intersections and deduplicates coordinate/index aliases", () => {
  const session = walledSession("japanese", ["pass", "A3", "pass", "pass"]);
  const point = coordToPoint(5, 5, "A3");
  const single = scoreWeiqiSession(session, ["A3"]);
  const aliases = scoreWeiqiSession(session, [" a03 ", point, "A3"]);
  assert.deepEqual(aliases.score, single.score);
  assert.deepEqual(aliases.position.board, single.position.board);
  assert.equal(aliases.score.blackPrisoners, 1);
  assert.throws(() => scoreWeiqiSession(session, ["C3"]), /not an occupied stone/,
    "an empty point is not a dead stone even when its index is in range");
  assert.throws(() => scoreWeiqiSession(session, [coordToPoint(5, 5, "C3")]),
    /not an occupied stone/);
});

test("terminal session records derive a unique dead set from duplicate submitted coordinates", () => {
  let session = walledSession("japanese", ["pass", "A3", "pass", "pass"]);
  const submitted = { kind: "settle", dead: [" A03 ", "a3", "A3"] };
  const admission = admitWeiqiGameCommand(session, session.version, submitted);
  assert.equal(admission.ok, true);
  if (!admission.ok) return;
  const canonical = admitWeiqiGameCommand(session, session.version,
    { kind: "settle", dead: ["A3"] });
  assert.equal(canonical.ok, true);
  if (!canonical.ok) return;
  assert.deepEqual(admission.session.state.result.dead, ["A3"]);
  assert.deepEqual(admission.session.state.result.score, canonical.session.state.result.score);
  assert.deepEqual(admission.session.commands.at(-1), submitted,
    "the immutable command log still records the actual admitted request");
  assert.equal(admission.session.state.result.score.blackPrisoners, 1);
});



test("session scoring refuses partial group death but counts whole groups", () => {
  const session = walledSession("japanese", ["pass", "A3", "pass", "pass"]);
  const partial = ["B3"];
  assert.throws(() => scoreWeiqiSession(session, partial), /complete connected group/,
    "the five Black B-column stones share liberties and life/death status");
  assert.deepEqual(admitWeiqiGameCommand(session, session.version,
    { kind: "settle", dead: partial }), { ok: false, reason: "incomplete-dead-group" });
  const whole = ["B1", "B2", "B3", "B4", "B5"];
  const counted = scoreWeiqiSession(session, whole);
  assert.equal(counted.score.whitePrisoners, 5);
  const admitted = admitWeiqiGameCommand(session, session.version,
    { kind: "settle", dead: whole });
  assert.equal(admitted.ok, true);
  if (admitted.ok) {
    assert.deepEqual(admitted.session.state.result.dead, whole);
    assert.deepEqual(admitted.session.state.result.score, counted.score);
  }
});


test("accepted and provisional scores cannot be rewritten after being read", () => {
  // Source-owned scoreArea/scoreTerritory are arithmetic helpers; the
  // complete countPosition projection owns the immutable scored receipt.
  for (const ruleset of ["chinese", "japanese", "aga", "newzealand", "ing"]) {
    const counting = createWeiqiGameSession({ size: 9, ruleset }, [
      { kind: "play", move: "C3" },
      { kind: "play", move: "G7" },
      { kind: "pass" },
      { kind: "pass" },
    ]);
    const preview = scoreWeiqiSession(counting);
    const previewScore = preview.score.blackScore;
    assert.equal(Object.isFrozen(preview.score), true, ruleset + " provisional score is immutable");
    assert.equal(Reflect.set(preview.score, "blackScore", -999), false);
    assert.equal(preview.score.blackScore, previewScore);

    const admitted = admitWeiqiGameCommand(counting, counting.version,
      { kind: "settle", dead: [] });
    assert.equal(admitted.ok, true, ruleset + " settlement is admitted");
    if (!admitted.ok) continue;
    const original = admitted.session.state.result.score.blackScore;
    assert.equal(Object.isFrozen(admitted.session.state.result.score), true);
    assert.equal(Reflect.set(admitted.session.state.result.score, "blackScore", 999), false);
    assert.equal(admitted.session.state.result.score.blackScore, original);
    const fromHistory = materializeWeiqiGame(admitted.session).result.score;
    assert.equal(Object.isFrozen(fromHistory), true, ruleset + " replayed score is immutable");
    assert.equal(fromHistory.blackScore, original);
  }
});


test("handicap settlement, provisional count, and SGF use the same ruleset-specific nominal komi", () => {
  const cases = [
    ["japanese", "territory", 0, 0],
    ["chinese", "area", -2, 2],
    ["aga", "area", 0, 3],
    ["newzealand", "area", 0, 0],
    ["ing", "area", 0, 0],
  ];
  for (const [ruleset, mode, blackAdjustment, whiteAdjustment] of cases) {
    const opening = createWeiqiGameSession({ size: 9, ruleset, handicap: 4 });
    assert.equal(opening.state.toMove, WHITE);
    assert.equal(opening.state.handicap.length, 4);
    const counted = scoreWeiqiSession(opening);
    const score = counted.score;
    assert.equal(counted.mode, mode);
    assert.equal(score.komi, 0.5);
    assert.equal(score.handicap, 4);
    assert.equal(score.blackHandicapAdjustment, blackAdjustment);
    assert.equal(score.whiteHandicapAdjustment, whiteAdjustment);
    assert.equal(score.blackScore, mode === "area" ? 81 + blackAdjustment : 77,
      "no White stones: all empty points belong to the four Black hoshi");
    assert.equal(score.whiteScore, 0.5 + whiteAdjustment);
    assert.equal(Object.isFrozen(score), true);

    const counting = createWeiqiGameSession(opening.config, [{ kind: "pass" }, { kind: "pass" }]);
    const settled = admitWeiqiGameCommand(counting, counting.version, { kind: "settle", dead: [] });
    assert.equal(settled.ok, true);
    if (!settled.ok) continue;
    assert.deepEqual(settled.session.state.result.score, score,
      "the final result must equal the earlier rules-owned position count");
    const sgfRecord = weiqiSessionToSgfRecord(settled.session);
    assert.equal(sgfRecord.komi, 0.5, "SGF must export actual handicap komi, not even-game komi");
    assert.equal(sgfRecord.handicap.length, 4);
  }
  // The exact same ruleset still retains even-game compensation without a handicap.
  assert.equal(scoreWeiqiSession(createWeiqiGameSession({size: 9, ruleset: "japanese"})).score.whiteScore, 6.5);
  assert.equal(scoreWeiqiSession(createWeiqiGameSession({size: 9, ruleset: "chinese"})).score.whiteScore, 7.5);
});
