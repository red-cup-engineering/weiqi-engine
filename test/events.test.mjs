import { test } from "node:test";
import assert from "node:assert/strict";
import { annotateMove, annotatePass, TERM_PATH, TERM_REFERENCES } from "../src/events.mjs";
import { applyStonePlacement, createPositionFromCells } from "../src/position.mjs";
import { BLACK, WHITE, EMPTY, coordToPoint, findGroup, pointToCoord } from "../src/board.mjs";
import { Game } from "../src/game.mjs";

const ILLEGAL = { suicide: "illegal" };
test("semantic terms use stable Science references, independent of checkout layout", () => {
  assert.equal(TERM_PATH, TERM_REFERENCES, "the legacy export retains object identity");
  assert.deepEqual(Object.keys(TERM_REFERENCES).sort(),
    ["atari", "capture", "connection", "eye", "ko", "life-and-death", "pass"]);
  for (const [term, reference] of Object.entries(TERM_PATH)) {
    assert.equal(reference, `science://lenticule-science/weiqi/terms/${term}`);
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

test("legal self-capture does not announce a connection between removed groups", () => {
  for (const color of [BLACK, WHITE]) {
    const game = new Game(3, "newzealand");
    const moves = ["A1", "A2", "C1", "C2", "pass", "B2"];
    if (color === WHITE) moves.unshift("pass");
    for (const move of moves) assert.equal(game.play(move).ok, true, move);

    const result = game.play("B1");
    assert.equal(result.ok, true);
    assert.deepEqual([...game.current.board.slice(0, 3)], [EMPTY, EMPTY, EMPTY]);
    assert.equal(result.events.some((event) => event.type === "connection"), false);
    assert.deepEqual(result.events.map((event) => event.type), ["capture", "group-killed"]);
    assert.deepEqual(result.events[0].detail, {
      point: "B1", by: color === BLACK ? WHITE : BLACK,
      stonesCaptured: 3, groupsCaptured: 1, selfCapture: true,
    });
    assert.equal(result.events[1].detail.color, color);
    assert.equal(result.events[1].detail.groupSize, 3);
    assert.equal(result.events[1].detail.selfCapture, true);
    assert.equal(game.current[color === BLACK ? "capturedBlackStones" : "capturedWhiteStones"], 3);
    assert.deepEqual(game.moveEvents.at(-1), result.events);
  }
});

test("suicide-illegal rules refuse the same join without adding any semantic event", () => {
  for (const ruleset of ["chinese", "japanese", "aga", "ing"]) {
    const game = new Game(3, ruleset);
    for (const move of ["A1", "A2", "C1", "C2", "pass", "B2"]) {
      assert.equal(game.play(move).ok, true, `${ruleset}: ${move}`);
    }
    const before = game.current;
    const eventCount = game.moveEvents.length;
    assert.deepEqual(game.play("B1"), { ok: false, reason: "suicide" }, ruleset);
    assert.equal(game.current, before);
    assert.equal(game.moveEvents.length, eventCount);
  }
});

test("a surviving join still announces connection under every declared ruleset", () => {
  for (const ruleset of ["chinese", "japanese", "aga", "newzealand", "ing"]) {
    for (const color of [BLACK, WHITE]) {
      const game = new Game(3, ruleset);
      const moves = ["A1", "A3", "C1", "C3"];
      if (color === WHITE) moves.unshift("pass");
      for (const move of moves) assert.equal(game.play(move).ok, true);
      const result = game.play("B1");
      assert.equal(result.ok, true);
      assert.deepEqual([...game.current.board.slice(0, 3)], [color, color, color]);
      const connections = result.events.filter((event) => event.type === "connection");
      assert.equal(connections.length, 1, `${ruleset}, color ${color}`);
      assert.deepEqual(connections[0].detail, { point: "B1", color, mergedGroups: 2 });
    }
  }
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


test("capturing an attacker records a remote group's escape under every ruleset", () => {
  for (const ruleset of ["chinese", "japanese", "aga", "newzealand", "ing"]) {
    for (const color of [BLACK, WHITE]) {
      const game = new Game(3, ruleset);
      const moves = ["C1", "B3", "B2", "B1", "A3"];
      if (color === BLACK) moves.unshift("pass");
      for (const move of moves) assert.equal(game.play(move).ok, true);
      const rescuedPoint = coordToPoint(3, 3, "B3");
      assert.equal(game.current.toMove, color);
      assert.equal(findGroup(game.current.board, 3, 3, rescuedPoint).liberties.size, 1);
      const result = game.play("A2");
      assert.equal(result.ok, true);
      assert.equal(findGroup(game.current.board, 3, 3, rescuedPoint).liberties.size, 2);
      assert.deepEqual(result.events.filter(event => event.type === "atari-escaped")
        .map(event => event.detail), [{ color, groupSize: 1 }]);
      assert.equal(result.events.find(event => event.type === "capture").detail.stonesCaptured, 1);
      assert.equal(game.current.board[coordToPoint(3, 3, "A3")], EMPTY);
    }
  }
});

test("escape observations equal surviving groups gaining liberties on every 3x2 position", () => {
  const width = 3, height = 2, length = width * height;
  let placements = 0;
  for (let encoded = 0; encoded < 3 ** length; encoded++) {
    let rest = encoded;
    const cells = Array.from({ length }, () => { const cell = rest % 3; rest = Math.floor(rest / 3); return cell; });
    for (const color of [BLACK, WHITE]) {
      const before = createPositionFromCells(width, height, cells, color);
      const seen = new Set(), threatened = [];
      for (let point = 0; point < length; point++) {
        if (cells[point] !== color || seen.has(point)) continue;
        const group = findGroup(cells, width, height, point);
        for (const stone of group.stones) seen.add(stone);
        if (group.liberties.size === 1) threatened.push(group);
      }
      for (let point = 0; point < length; point++) {
        const placed = applyStonePlacement(before, point, ILLEGAL);
        if (!placed.ok) continue;
        placements++;
        const expected = threatened.filter(group => placed.position.board[group.stones[0]] === color)
          .map(group => findGroup(placed.position.board, width, height, group.stones[0]))
          .filter(group => group.liberties.size > 1).map(group => group.stones.length).sort((a, b) => a - b);
        const { events } = annotateMove({ width, height, prevPosition: before,
          nextPosition: placed.position, point, color, captured: placed.captured,
          selfCaptured: placed.selfCaptured, activeKoPoint: null });
        const escapes = events.filter(event => event.type === "atari-escaped");
        assert.deepEqual(escapes.map(event => event.detail.groupSize).sort((a, b) => a - b), expected,
          `position ${encoded}, color ${color}, move ${pointToCoord(width, point)}`);
        assert.ok(escapes.every(event => event.detail.color === color));
        assert.deepEqual([...before.board], cells, "observing a move must not alter its prior position");
      }
    }
  }
  assert.ok(placements > 1000, "exercise capture, extension, unchanged and already-safe groups");
});
