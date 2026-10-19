import { test } from "node:test";
import assert from "node:assert/strict";
import { Game, _checkKoViolationForTests } from "../src/game.mjs";
import { applyStonePlacement, createPositionFromCells } from "../src/position.mjs";
import { BLACK, WHITE, EMPTY, coordToPoint } from "../src/board.mjs";
import { parseDiagram } from "./helpers/diagram.mjs";

test("R1: simple ko forbids the immediate recapture", () => {
  // regression-positions.md R1, on a real 5x5 board via a real Game.
  // Before Black's capturing move: White stone alone at C3 (one liberty, C4).
  // . . . . .
  // . . X . .
  // . X O X .
  // . O . O .
  // . . O . .
  const before = [
    ". . . . .",
    ". . X . .",
    ". X O X .",
    ". O . O .",
    ". . O . .",
  ];
  const { position: beforePos } = parseDiagram(before, 5, BLACK);
  const game = new Game(5, "japanese", beforePos); // Japanese: simple_ko regime.
  const black = game.play("C4"); // Black captures the lone White stone at C3.
  assert.ok(black.ok);

  // Confirm the position now matches R1's "after" diagram.
  const after = [
    ". . . . .",
    ". . X . .",
    ". X * X .",
    ". O X O .",
    ". . O . .",
  ];
  const { position: expectedAfter } = parseDiagram(after, 5, WHITE);
  assert.equal(game.current.boardHash, expectedAfter.boardHash);

  const white = game.play("C3");
  assert.equal(white.ok, false);
  if (white.ok) return;
  assert.equal(white.reason, "simple-ko");
});

test("R1 continued: once White has played elsewhere, White may legally play C3 on a later turn (simple ko only forbids the immediate recapture)", () => {
  const before = [
    ". . . . .",
    ". . X . .",
    ". X O X .",
    ". O . O .",
    ". . O . .",
  ];
  const { position: beforePos } = parseDiagram(before, 5, BLACK);
  const game = new Game(5, "japanese", beforePos);
  game.play("C4"); // Black captures White's stone at C3.
  assert.equal(game.play("C3").ok, false, "immediate recapture is still forbidden");
  assert.ok(game.play("A1").ok); // White tenukis (plays elsewhere) instead.
  assert.ok(game.play("B1").ok); // Black plays elsewhere too.
  // It is White's move again. Recreating the original board by playing C3
  // now would recreate history[length-2] (the position right after A1,
  // before Black's B1), NOT the original pre-capture board -- so simple
  // ko no longer forbids it.
  const retake = game.play("C3");
  assert.ok(retake.ok, "after both sides have played elsewhere, simple ko no longer forbids White retaking C3");
});

test("suicide is illegal under Japanese rules, live through Game.play", () => {
  // regression-positions.md R4, verbatim: a 5x5 board whose Black ring
  // (B2:D4, hollow at C3) keeps its liberties on the outside and so stays
  // unconditionally alive. (Until 2026-09-16 the corpus drew this as a 3x3
  // "interior fragment", which as a complete board would have made White's
  // center move an ordinary capture of the whole ring; the corpus now draws
  // the board this test always used.)
  const rows = [
    ". . . . .",
    ". X X X .",
    ". X . X .",
    ". X X X .",
    ". . . . .",
  ];
  const { position } = parseDiagram(rows, 5, WHITE);

  const japaneseGame = new Game(5, "japanese", position);
  const illegal = japaneseGame.play("C3");
  assert.equal(illegal.ok, false);
  if (!illegal.ok) assert.equal(illegal.reason, "suicide");
});

test("suicide is legal and self-removes under New Zealand rules, live through Game.play", () => {
  // regression-positions.md R5, verbatim. NOT R4's single-stone shape: a
  // suicide move that captures nothing and self-removes only the stone
  // just placed leaves the board byte-for-byte identical to the position
  // immediately beforehand (place, then immediately un-place) -- which is
  // *always* the most recent entry in Game's history, so New Zealand's own
  // ko_regime (positional_superko, per rulesets.md) rejects that exact move
  // as a repeated position on any real Game, independent of whether suicide
  // itself is legal (R4 now states this, and the superko test below proves
  // it). That is a genuine interaction between the two rules, not a kernel
  // bug: it is why R5 and this Game-level test need a self-capture that
  // removes more than the placed stone, so the resulting board actually
  // differs from its predecessor and only the suicide rule is under test.
  //
  // Ring at B2:E4 (6x5 board) enclosing a two-point gap, C3/D3; White
  // already has a stone at C3 (its one liberty is D3). White plays D3,
  // connecting to C3: the 2-stone group has zero liberties and is
  // self-captured entirely, leaving the board with C3 also empty --
  // different from the position beforehand, so no superko conflict.
  const rows = [
    ". . . . . .",
    ". X X X X .",
    ". X O . X .",
    ". X X X X .",
    ". . . . . .",
  ];
  const { position } = parseDiagram(rows, 6, WHITE);

  const nzGame = new Game(6, "newzealand", position);
  const legal = nzGame.play("D3");
  assert.ok(legal.ok);
  assert.equal(nzGame.current.board[coordToPoint(6, 5, "C3")], EMPTY);
  assert.equal(nzGame.current.board[coordToPoint(6, 5, "D3")], EMPTY);
  assert.equal(nzGame.current.capturedWhiteStones, 2);
});

test("occupied and off-board moves are rejected with the right reason", () => {
  const game = new Game(9, "chinese");
  game.play("C3");
  const occupied = game.play("C3");
  assert.equal(occupied.ok, false);
  if (!occupied.ok) assert.equal(occupied.reason, "occupied");

  const offBoard = new Game(9, "chinese").play("Z9");
  assert.equal(offBoard.ok, false);
  if (!offBoard.ok) assert.equal(offBoard.reason, "off-board");
});

test("pass is always legal and two consecutive passes open counting without a winner", () => {
  const game = new Game(9, "chinese");
  const first = game.play("pass");
  assert.ok(first.ok);
  assert.equal(game.mainPhaseEnded, false);
  if (first.ok) {
    assert.deepEqual(first.events.map((e) => e.type), ["pass"]);
    assert.equal(first.events[0].detail.color, BLACK);
  }

  const second = game.play("pass");
  assert.ok(second.ok);
  assert.equal(game.mainPhaseEnded, true);
  assert.equal(game.result, null, "a provisional count has no winner");
  assert.equal(game.isLegal("C3"), true, "the player can resume play from counting");
  if (second.ok) {
    // The second consecutive pass is both a pass and, per pass.md/R12, the
    // move that ends the main phase -- both events fire on this one turn.
    assert.deepEqual(second.events.map((e) => e.type), ["pass", "counting-opened"]);
    assert.equal(second.events[1].detail.color, WHITE);
    assert.equal(second.events[1].term, "pass");
  }
});

test("passStreak resets after a stone is played", () => {
  const game = new Game(9, "chinese");
  game.play("pass");
  game.play("C3");
  assert.equal(game.passStreak, 0);
  assert.equal(game.mainPhaseEnded, false);
});

test("counting-opened fires only when an active pass pair is completed", () => {
  const game = new Game(9, "chinese");
  game.play("pass");
  game.play("pass"); // passStreak reaches 2 here; counting-opened already asserted above.
  const third = game.play("pass");
  assert.ok(third.ok);
  if (third.ok) assert.deepEqual(third.events.map((e) => e.type), ["pass"]);
});

test("counting-opened fires again after resumed play and a new pass pair", () => {
  const game = new Game(9, "chinese");
  game.play("pass");
  game.play("pass"); // main phase ends once.
  game.play("C3"); // resume play, per pass.md, to resolve a disagreement.
  assert.equal(game.passStreak, 0);
  game.play("pass");
  const second = game.play("pass");
  assert.ok(second.ok);
  if (second.ok) assert.deepEqual(second.events.map((e) => e.type), ["pass", "counting-opened"]);
});


test("settlement requires a new active pair of passes after play resumes", () => {
  for (const ruleset of ["chinese", "japanese", "aga", "newzealand", "ing"]) {
    const game = new Game(9, ruleset);
    for (const move of ["E5", "D4", "pass", "pass"]) {
      assert.equal(game.play(move).ok, true, `${ruleset}: ${move} admitted`);
    }
    assert.equal(game.passStreak, 2);
    assert.equal(game.mainPhaseEnded, true);
    assert.equal(game.fork().settle([]).ok, true, "settlement is legal during active two-pass count");

    assert.equal(game.play("C3").ok, true);
    assert.equal(game.mainPhaseEnded, true, "historical phase-ended flag remains sticky");
    assert.equal(game.passStreak, 0);
    assert.deepEqual(game.settle([]), { ok: false, reason: "main-phase-open" },
      `${ruleset}: resumed play cannot be finalized without a new pass pair`);
    assert.equal(game.result, null, "refusing settlement must not alter game result");
    assert.equal(game.play("pass").ok, true);
    assert.deepEqual(game.settle([]), { ok: false, reason: "main-phase-open" },
      "one pass is not enough after resuming");
    assert.equal(game.play("pass").ok, true);
    assert.equal(game.passStreak, 2);
    assert.equal(game.settle([]).ok, true, "a new consecutive pass pair allows settlement");
    assert.equal(game.result?.by, "count");
  }
});


// --- Superko regime logic (checkKoViolation), tested directly --------
//
// R2/R3 in regression-positions.md are explicitly flagged by their author
// as "structural specifications, not fully hand-traced move lists" for a
// two-independent-ko long cycle. Rather than leave that caveat unresolved,
// these tests verify the exact rule R2/R3 describes -- positional superko
// forbids ANY board recurrence regardless of whose turn it is, situational
// superko forbids it only when it's also the same player's turn again --
// directly against synthetic histories built from real Positions, which is
// what the R2/R3 note itself calls for ("verify... against the kernel's
// own board-history representation").

function samePosition(cells, toMove) {
  return createPositionFromCells(3, 3, cells, toMove);
}

test("positional superko forbids a board recurrence regardless of whose turn it is (R2)", () => {
  const boardA = [BLACK, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY];
  const history = [samePosition(boardA, WHITE)]; // this board occurred once already, White to move then.
  const candidate = samePosition(boardA, WHITE); // same board recurs, same player to move.
  const candidateOppositeTurn = samePosition(boardA, BLACK); // same board recurs, opposite player to move.
  assert.equal(_checkKoViolationForTests(history, candidate, "positional_superko"), "positional-superko");
  assert.equal(
    _checkKoViolationForTests(history, candidateOppositeTurn, "positional_superko"),
    "positional-superko",
    "PSK ignores whose turn it is",
  );
});

test("situational superko permits a board recurrence when it is the other player's turn (R3), but forbids it when it is the same player's turn again", () => {
  const boardA = [BLACK, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY];
  const history = [samePosition(boardA, WHITE)];
  const sameTurn = samePosition(boardA, WHITE);
  const otherTurn = samePosition(boardA, BLACK);
  assert.equal(_checkKoViolationForTests(history, sameTurn, "situational_superko"), "situational-superko");
  assert.equal(
    _checkKoViolationForTests(history, otherTurn, "situational_superko"),
    null,
    "SSK permits the recurrence because the player to move differs from the earlier occurrence",
  );
});

test("simple ko only inspects the single position one ply before the opponent's last move, not full history", () => {
  const boardA = [BLACK, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY];
  const boardB = [EMPTY, BLACK, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY];
  // History: ... boardA (long ago) ... boardB (immediately before opponent's last move) ... current.
  const history = [samePosition(boardA, WHITE), samePosition(boardB, BLACK), samePosition(boardA, WHITE)];
  // Candidate recreates boardA, which DID occur (twice!) earlier, but not
  // as history[length-2] (that slot holds a different board) -- simple ko
  // does not forbid this, only positional/situational superko would.
  const recreatesOldBoardA = samePosition(boardA, BLACK);
  assert.equal(_checkKoViolationForTests(history, recreatesOldBoardA, "simple_ko"), null);
  assert.equal(_checkKoViolationForTests(history, recreatesOldBoardA, "positional_superko"), "positional-superko");

  // Candidate recreates boardB, which IS history[length-2] -- simple ko forbids this one.
  const recreatesBoardB = samePosition(boardB, BLACK);
  assert.equal(_checkKoViolationForTests(history, recreatesBoardB, "simple_ko"), "simple-ko");
});

// --- Triple ko and superko-variant disagreement, played through a real Game ---
//
// The tests above check checkKoViolation directly against synthetic
// histories. These two instead play a real, hand-verified sequence of
// moves through Game.play on a real board, per ko-and-superko.md's own
// worked examples (the "three interlocking ko fights" cycle, and exercise
// 2's "opposite player to move" case).

test("triple ko: three independent single-stone kos cycle the whole board back to its start after six plies -- legal at every step under simple ko, but the completing move is illegal under both positional and situational superko", () => {
  // Three side-by-side copies of R1's ko shape (see R1's test above),
  // separated by fully empty buffer columns so a capture in one never
  // touches another. koA (cols A-E) and koC (cols M-Q) are R1 verbatim: a
  // lone White stone Black can capture. koB (cols G-L) has every color
  // swapped -- a lone BLACK stone White can capture -- which is what lets
  // six plies alternate B,W,B,W,B,W (capture A, capture B, capture C,
  // retake A, retake B, retake C) and still land back on Black to move,
  // exactly as ko-and-superko.md's worked example describes: "the whole
  // board is back to exactly the position it held before Black's first
  // capture, and it is Black's turn again."
  const rows = [
    ". . . . . . . . . . . . . . . . .",
    ". . X . . . . . O . . . . . X . .",
    ". X O X . . . O X O . . . X O X .",
    ". O . O . . . X . X . . . O . O .",
    ". . O . . . . . X . . . . . O . .",
  ];
  const { position: start } = parseDiagram(rows, 17, BLACK);
  // B,W,B,W,B,W: capture koA, capture koB (fresh, not a retake), capture
  // koC (fresh), retake koA, retake koB, retake koC.
  const moves = ["C4", "J4", "P4", "C3", "J3", "P3"];

  // Simple ko (Japanese) only ever looks one move-pair back. No single
  // move in this sequence recreates history[length-2] at the time it's
  // played (each of the three kos passes through a distinct combination
  // of before/after states no earlier ply visited), so every one of the
  // six moves is legal and the cycle genuinely completes.
  const japanese = new Game(17, "japanese", start);
  for (const m of moves) assert.ok(japanese.play(m).ok, `${m} should be legal under simple ko`);
  assert.equal(japanese.current.boardHash, start.boardHash, "after all six plies the board matches the starting arrangement exactly");
  assert.equal(japanese.current.toMove, start.toMove, "and it is Black's move again, exactly as at the start");

  // Positional superko (Chinese): the first five moves are exactly as
  // legal (none of them recreates ANY earlier position -- each ko passes
  // through a combination of states no earlier ply visited). The sixth
  // move is different: it is precisely the move that would recreate the
  // starting position's board, so positional superko forbids it there,
  // and nowhere earlier in the sequence.
  const chinese = new Game(17, "chinese", start);
  for (const m of moves.slice(0, 5)) assert.ok(chinese.play(m).ok, `${m} should still be legal under positional superko`);
  const chineseSixth = chinese.play(moves[5]);
  assert.equal(chineseSixth.ok, false);
  if (!chineseSixth.ok) assert.equal(chineseSixth.reason, "positional-superko");

  // Situational superko (AGA) agrees with positional superko here, for
  // the reason ko-and-superko.md gives: the cycle's period is even (six
  // plies), so the player to move at the recurrence (Black) matches the
  // player to move at the original position (also Black) -- "both
  // variants agree" is the documented common case, and this is it.
  const aga = new Game(17, "aga", start);
  for (const m of moves.slice(0, 5)) assert.ok(aga.play(m).ok, `${m} should still be legal under situational superko`);
  const agaSixth = aga.play(moves[5]);
  assert.equal(agaSixth.ok, false);
  if (!agaSixth.ok) assert.equal(agaSixth.reason, "situational-superko");
});

test("positional and situational superko disagree when a recreated position has the opposite player to move from its earlier occurrence (ko-and-superko.md exercise 2 / R3), demonstrated on a real captured-and-verified position rather than a synthetic one", () => {
  // Real sending-two-returning-one sequences are ko-and-superko.md's
  // textbook illustration of this rule difference, but (per the doctrine's
  // own account of how rare and specific such positions are -- "very few
  // distinguishing examples are known") tracing one out move-by-move needs
  // a much larger board than this corpus's small regression fixtures use.
  // This is a minimal witness of the *identical* rule difference instead:
  // R4's ring (already verified above), where White's suicide move at
  // C3 captures nothing and self-removes only the stone just placed --
  // leaving the board byte-for-byte identical to `before`, with only the
  // player to move changed. That is exactly exercise 2's shape: "a move
  // would recreate a board position that occurred earlier in the game,
  // but the player to move next is the opposite of who was to move next
  // at that earlier occurrence."
  const rows = [
    ". . . . .",
    ". X X X .",
    ". X . X .",
    ". X X X .",
    ". . . . .",
  ];
  const { position: before } = parseDiagram(rows, 5, WHITE);

  // Positional superko: New Zealand allows the suicide (suicide: legal),
  // but its ko_regime is positional_superko, and the resulting board
  // recreates `before` -- the sole entry in history so far -- so the move
  // is illegal anyway, for a different reason than suicide.
  const nz = new Game(5, "newzealand", before);
  const nzMove = nz.play("C3");
  assert.equal(nzMove.ok, false);
  if (!nzMove.ok) assert.equal(nzMove.reason, "positional-superko");

  // Situational superko: no ruleset in this corpus pairs
  // situational_superko with legal suicide, so check the regime directly
  // against the same history and the same capture-resolved candidate
  // position New Zealand's Game computed internally above -- the R2/R3
  // pattern, fed a real Position instead of a hand-built one.
  const point = coordToPoint(5, 5, "C3");
  const candidate = applyStonePlacement(before, point, { suicide: "legal" });
  assert.ok(candidate.ok);
  if (!candidate.ok) return;
  assert.equal(candidate.position.boardHash, before.boardHash, "the board is unchanged: place, then immediately self-capture");
  assert.notEqual(candidate.position.toMove, before.toMove, "but the player to move has flipped");
  assert.equal(_checkKoViolationForTests([before], candidate.position, "positional_superko"), "positional-superko");
  assert.equal(
    _checkKoViolationForTests([before], candidate.position, "situational_superko"),
    null,
    "SSK permits it: the recreated position has the opposite player to move from its earlier occurrence",
  );
});


test("agreed dead stones are a canonical set, even when coordinate aliases repeat", () => {
  const game = new Game(9, "japanese");
  for (const move of ["E5", "D4", "pass", "pass"]) assert.equal(game.play(move).ok, true);
  const aliases = game.fork();
  assert.equal(aliases.settle([" E05 ", "d4", "E5", "D04", " e5 "]).ok, true);
  const unique = game.fork();
  assert.equal(unique.settle(["D4", "E5"]).ok, true);
  assert.deepEqual(aliases.result.dead, ["D4", "E5"],
    "one canonical board coordinate for each dead stone, in board order");
  assert.deepEqual(aliases.result.score, unique.result.score,
    "repeated aliases may not change score or prisoner counts");
  assert.equal(aliases.result.score.blackPrisoners, 1);
  assert.equal(aliases.result.score.whitePrisoners, 1);
  assert.equal(game.result, null, "settling a fork must not change the parent game");
});



test("settlement refuses partial connected dead groups, yet accepts complete ones", () => {
  for (const ruleset of ["chinese", "japanese", "aga"]) {
    const game = new Game(9, ruleset);
    for (const move of ["E5", "A1", "E6", "A2", "pass", "pass"]) {
      assert.equal(game.play(move).ok, true, ruleset + " " + move);
    }
    const partial = game.fork();
    assert.deepEqual(partial.settle(["E5"]),
      { ok: false, reason: "incomplete-dead-group" },
      "the first stone cannot be removed while the adjacent E6 stone survives");
    assert.equal(partial.result, null, "a rejected settlement cannot terminate the game");
    const complete = game.fork();
    assert.equal(complete.settle([" E05 ", "E6"]).ok, true);
    assert.deepEqual(complete.result.dead, ["E5", "E6"]);
    assert.equal(complete.result.score.whitePrisoners, 2);
    assert.equal(game.result, null);
  }
});

