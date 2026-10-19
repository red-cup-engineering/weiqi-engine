import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { annotateMove, annotatePass, TERM_PATH } from "../src/events.mjs";
import { applyStonePlacement, createPositionFromCells } from "../src/position.mjs";
import { BLACK, WHITE, EMPTY, coordToPoint } from "../src/board.mjs";
import { Game } from "../src/game.mjs";

const ILLEGAL = { suicide: "illegal" };
const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const WEIQI_GLOSSARY_ROOT = resolve(
  PACKAGE_ROOT,
  "../../../../../../../../../science-services-section/services/philosophy-services-section/services/relationality-services-section/services/agency-services-section/services/being-services-section/services/doing-services-section/services/playing-services-section/services/gaming-services-section/services/board-games-services-section/services/weiqi-services-section/content/text/glossary/terms",
);

test("every semantic term reference resolves to the Weiqi science corpus", () => {
  for (const [term, reference] of Object.entries(TERM_PATH)) {
    assert.equal(reference, `science://lenticule-science/weiqi/terms/${term}`);
    const source = join(WEIQI_GLOSSARY_ROOT, `${term}.md`);
    assert.ok(existsSync(source), `${term} has no science-corpus source at ${source}`);
  }
});

test("every event carries a termRef matching TERM_PATH[term] (the field a UI hover-cards against)", () => {
  const cells = [BLACK, WHITE, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY];
  const { events } = playAndAnnotate(3, 3, cells, BLACK, "B2"); // atari-given, per the test below.
  assert.ok(events.length > 0);
  for (const e of events) {
    assert.equal(e.termRef, TERM_PATH[e.term], `${e.type} termRef should match TERM_PATH[${e.term}]`);
    assert.ok((e).termPath === undefined, "termPath should no longer exist -- renamed to termRef");
  }
});

test("annotatePass names counting opening rather than a terminal game", () => {
  const quiet = annotatePass(BLACK, false);
  assert.deepEqual(quiet.map((e) => e.type), ["pass"]);
  assert.equal(quiet[0].term, "pass");
  assert.equal(quiet[0].termRef, TERM_PATH.pass);
  assert.equal(quiet[0].detail.color, BLACK);

  const ending = annotatePass(WHITE, true);
  assert.deepEqual(ending.map((e) => e.type), ["pass", "counting-opened"]);
  assert.equal(ending[1].detail.trigger, "two-consecutive-passes");
  assert.equal(ending[1].term, "pass");
  assert.equal(ending[1].termRef, TERM_PATH.pass);
  assert.equal(ending[1].detail.color, WHITE);
});

function playAndAnnotate(width, height, cells, toMove, move, activeKoPoint = null) {
  const pos = createPositionFromCells(width, height, cells, toMove);
  const point = coordToPoint(width, height, move);
  const placement = applyStonePlacement(pos, point, ILLEGAL);
  if (!placement.ok) throw new Error(`Expected legal placement, got ${placement.reason}`);
  const result = annotateMove({
    width,
    height,
    prevPosition: pos,
    nextPosition: placement.position,
    point,
    color: toMove,
    captured: placement.captured,
    selfCaptured: placement.selfCaptured,
    activeKoPoint,
  });
  return { placement, ...result };
}

test("capture and group-killed fire together on an ordinary capturing move", () => {
  // R8 shape: O . / X . -- Black plays B1, capturing White's lone A1 stone.
  // On this literal, complete 2x2 board (R8's own diagram is explicitly a
  // whole true-edge board, not a fragment) the two points left empty by the
  // capture, A1 and B2, also happen to satisfy events.mts's simple,
  // no-diagonal-check eye heuristic once Black owns everything else -- a
  // genuine corollary of the board being this small (eye.md's definition is
  // just "an empty point... enclosed" and does not require the heuristic's
  // missing diagonal check), not a bug. So eye-formed events fire too; this
  // test only asserts capture and group-killed are the first two events
  // fired, in order, with the right details.
  const { events } = playAndAnnotate(2, 2, [WHITE, EMPTY, BLACK, EMPTY], BLACK, "B1");
  const types = events.map((e) => e.type);
  assert.deepEqual(types.slice(0, 2), ["capture", "group-killed"]);
  assert.equal(events[0].term, "capture");
  assert.equal(events[0].detail.stonesCaptured, 1);
  assert.equal(events[1].term, "life-and-death");
  assert.equal(events[1].detail.color, WHITE);
});

test("atari-given fires when a move reduces an opponent group from 2 liberties to 1, not when it was already in atari", () => {
  // X O . / . . . / . . .  -- Black plays B2, leaving White's B1 stone with one liberty (C1).
  const cells = [BLACK, WHITE, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY];
  const { events } = playAndAnnotate(3, 3, cells, BLACK, "B2");
  const atari = events.find((e) => e.type === "atari-given");
  assert.ok(atari, "expected an atari-given event");
  assert.equal(atari.detail.point, "C1");
  assert.equal(atari.detail.color, WHITE);
  assert.equal(atari.detail.groupSize, 1);
});

test("atari-given does not re-fire for a group that was already in atari before the move", () => {
  // White B1 already has just one liberty (C1); Black plays somewhere irrelevant (C3).
  const cells = [BLACK, WHITE, EMPTY, BLACK, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY];
  const { events } = playAndAnnotate(3, 3, cells, BLACK, "C3");
  assert.equal(events.some((e) => e.type === "atari-given"), false);
});

test("atari-escaped fires when the mover extends their own group out of atari", () => {
  // X O X / . . . / . . . -- White's B1 stone has exactly one liberty (B2).
  // White plays B2, merging into a 2-stone group with 3 liberties.
  const cells = [BLACK, WHITE, BLACK, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY];
  const { events } = playAndAnnotate(3, 3, cells, WHITE, "B2");
  const escaped = events.find((e) => e.type === "atari-escaped");
  assert.ok(escaped, "expected an atari-escaped event");
  assert.equal(escaped.detail.color, WHITE);
  assert.equal(escaped.detail.groupSize, 2);
});

test("connection fires only when a move merges two or more previously-distinct groups", () => {
  // X . X -- Black plays B1, connecting the two isolated stones at A1 and C1.
  const cells = [BLACK, EMPTY, BLACK, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY];
  const { events } = playAndAnnotate(3, 3, cells, BLACK, "B1");
  const connection = events.find((e) => e.type === "connection");
  assert.ok(connection, "expected a connection event");
  assert.equal(connection.detail.mergedGroups, 2);
});

test("connection does not fire for a plain single-group extension", () => {
  // X . . -- Black plays B1, extending the lone A1 stone (only one neighbor group).
  const cells = [BLACK, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY];
  const { events } = playAndAnnotate(3, 3, cells, BLACK, "B1");
  assert.equal(events.some((e) => e.type === "connection"), false);
});

test("eye-formed fires exactly once when a move completes a fully-enclosed empty point", () => {
  // 5x5: Black at B2, D2, C1 already on the board; Black plays C3, completing
  // a simple eye at C2 (all four of C2's neighbors are now Black), without
  // completing an eye at any of C3's other neighbors (B3, D3, C4 each still
  // border an empty, non-Black point).
  const cells = new Array(25).fill(EMPTY);
  cells[coordToPoint(5, 5, "B2")] = BLACK;
  cells[coordToPoint(5, 5, "D2")] = BLACK;
  cells[coordToPoint(5, 5, "C1")] = BLACK;
  const { events } = playAndAnnotate(5, 5, cells, BLACK, "C3");
  const eyeEvents = events.filter((e) => e.type === "eye-formed");
  assert.equal(eyeEvents.length, 1);
  assert.equal(eyeEvents[0].detail.point, "C2");
  assert.equal(eyeEvents[0].detail.color, BLACK);
});

test("ko-started and ko-resolved fire on the R1 ko shape, played out through a real Game", () => {
  const before = [
    ". . . . .",
    ". . X . .",
    ". X O X .",
    ". O . O .",
    ". . O . .",
  ];
  // Build the same position events.test uses its own diagram parsing for,
  // independent of the test/helpers module, to keep this test self-contained.
  const rows = before.map((r) => r.trim().split(/\s+/));
  const cells = new Array(25).fill(EMPTY);
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) {
      const sym = rows[row][col];
      cells[row * 5 + col] = sym === "X" ? BLACK : sym === "O" ? WHITE : EMPTY;
    }
  }
  const startPos = createPositionFromCells(5, 5, cells, BLACK);
  const game = new Game(5, "japanese", startPos);

  const capture = game.play("C4");
  assert.ok(capture.ok);
  if (!capture.ok) return;
  const koStarted = capture.events.find((e) => e.type === "ko-started");
  assert.ok(koStarted, "expected ko-started on the capturing move");
  assert.equal(koStarted.detail.point, "C3");
  assert.equal(game.activeKoPoint, coordToPoint(5, 5, "C3"));

  assert.equal(game.play("C3").ok, false, "immediate recapture forbidden");
  assert.ok(game.play("A1").ok);
  assert.ok(game.play("B1").ok);
  const retake = game.play("C3");
  assert.ok(retake.ok);
  if (!retake.ok) return;
  const koResolved = retake.events.find((e) => e.type === "ko-resolved");
  assert.ok(koResolved, "expected ko-resolved when White finally retakes C3");
  // A ko does not simply end when retaken -- ko.md describes the fight
  // continuing, with "the rest of the board" turned into leverage "for the
  // eventual return to the ko point," and this exact shape is symmetric:
  // White's retake at C3 recaptures Black's lone C4 stone in precisely the
  // same single-stone-for-single-stone pattern that started the ko in the
  // first place (C3's other neighbors B3/D3/C2 are untouched Black stones,
  // C4's other neighbors B4/D4/C5 are untouched White stones). So the same
  // move that resolves the ko at C3 immediately opens a mirrored one at
  // C4 -- activeKoPoint moves, it is not cleared to null.
  const koStartedAgain = retake.events.find((e) => e.type === "ko-started");
  assert.ok(koStartedAgain, "retaking C3 recaptures C4 in the same single-stone shape, opening a mirrored ko there");
  assert.equal(koStartedAgain.detail.point, "C4");
  assert.equal(game.activeKoPoint, coordToPoint(5, 5, "C4"), "the ko point moves to C4, mirroring the original C3 ko");
});
