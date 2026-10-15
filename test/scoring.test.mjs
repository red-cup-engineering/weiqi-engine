import { test } from "node:test";
import assert from "node:assert/strict";
import { computeTerritory, marksWholeDeadGroups, removeDeadStones, scoreArea, scoreTerritory } from "../src/scoring.mjs";
import { BLACK, WHITE, EMPTY, coordToPoint } from "../src/board.mjs";
import { getRuleset } from "../src/rulesets.mjs";
import { parseDiagram } from "./helpers/diagram.mjs";
import { Game, countPosition } from "../src/game.mjs";

test("R6: a seki's shared liberties count for neither side under either scoring mode", () => {
  // regression-positions.md's R6, verbatim: 3x2 board, Black {A1,A2}, White
  // {C1,C2}, B1/B2 shared liberties, no eyes either side.
  const { position } = parseDiagram(["X . O", "X . O"], 3);
  const { blackTerritory, whiteTerritory } = computeTerritory(position);
  assert.equal(blackTerritory, 0, "B1/B2 border both colors, so they are not Black territory");
  assert.equal(whiteTerritory, 0, "B1/B2 border both colors, so they are not White territory");

  const ruleset = getRuleset("chinese");
  const area = scoreArea(position, ruleset);
  assert.equal(area.blackStones, 2);
  assert.equal(area.whiteStones, 2);
  assert.equal(area.blackScore, 2, "area score is stones + territory; no territory here");
  assert.equal(area.whiteScore - ruleset.komi, 2);
});

test("R7: an unconditionally dead stone can be settled and then scores as territory + prisoner", () => {
  const rows = ["X X X X", "X O * X", "X X X X"];
  const { position, markedPoints } = parseDiagram(rows, 4);
  // The White stone at B2 is dead; settle it by marking it dead directly
  // (its point) rather than the '*' marker (which denotes C2, its liberty).
  const whiteStonePoint = coordToPoint(4, 3, "B2");
  const settled = removeDeadStones(position, [whiteStonePoint]);
  assert.equal(settled.board[whiteStonePoint], EMPTY);
  assert.equal(settled.capturedWhiteStones, 1);

  const ruleset = getRuleset("japanese");
  const territoryScore = scoreTerritory(settled, ruleset);
  // After removing the dead stone, B2 and C2 (the '*' point) are both
  // enclosed solely by Black -> 2 points of Black territory, plus 1 prisoner.
  assert.equal(territoryScore.blackTerritory, 2);
  assert.equal(territoryScore.blackPrisoners, 1);
  assert.equal(territoryScore.blackScore, 3);
  assert.ok(markedPoints.length === 1);
});

test("R9: area score of the finished 7x5 board matches the corpus exactly", () => {
  const rows = [
    ". . X . O . .",
    ". . X O O . .",
    ". . X . O . .",
    ". . X X O . .",
    ". . X . O . .",
  ];
  const { position } = parseDiagram(rows, 7);
  const ruleset = getRuleset("chinese");
  const result = scoreArea(position, ruleset);
  assert.equal(result.blackStones, 6);
  assert.equal(result.blackTerritory, 10);
  assert.equal(result.blackScore, 16);
  assert.equal(result.whiteStones, 6);
  assert.equal(result.whiteTerritory, 10);
  assert.equal(result.whiteScore, 23.5);
  assert.equal(result.margin, "White by 7.5");
});

test("R10: territory score of the same finished board matches the corpus exactly", () => {
  const rows = [
    ". . X . O . .",
    ". . X O O . .",
    ". . X . O . .",
    ". . X X O . .",
    ". . X . O . .",
  ];
  const { position } = parseDiagram(rows, 7);
  const ruleset = getRuleset("japanese");
  const result = scoreTerritory(position, ruleset);
  assert.equal(result.blackTerritory, 10);
  assert.equal(result.blackPrisoners, 0);
  assert.equal(result.blackScore, 10);
  assert.equal(result.whiteTerritory, 10);
  assert.equal(result.whiteScore, 16.5);
  assert.equal(result.margin, "White by 6.5");
});

test("scoreTerritory uses AGA's komi_territory (6.5), not the area komi (7.5), on the R9/R10 board", () => {
  const rows = [
    ". . X . O . .",
    ". . X O O . .",
    ". . X . O . .",
    ". . X X O . .",
    ". . X . O . .",
  ];
  const { position } = parseDiagram(rows, 7);
  const aga = getRuleset("aga");
  const result = scoreTerritory(position, aga);
  // Same board as R10 (blackTerritory 10, no prisoners): the only
  // difference from R10's japanese-ruleset result is the komi used.
  assert.equal(result.blackScore, 10);
  assert.equal(result.whiteScore, 16.5, "must use aga.komi_territory (6.5), not aga.komi (7.5)");
  assert.equal(result.margin, "White by 6.5");

  // scoreArea, by contrast, correctly uses the area komi for AGA.
  const areaResult = scoreArea(position, aga);
  assert.equal(areaResult.whiteScore, 23.5, "scoreArea must still use aga.komi (7.5)");
});

test("R11: filling one's own territory is free under area scoring, costs one point under territory scoring", () => {
  const base = [
    ". . X . O . .",
    ". . X O O . .",
    ". . X . O . .",
    ". . X X O . .",
    ". . X . O . .",
  ];
  const { position: r9 } = parseDiagram(base, 7);
  // Black plays A3: column A (index 0), row 3 (array row index 2).
  const withExtraStone = base.map((r) => r.split(" "));
  withExtraStone[2][0] = "X";
  const { position: r11 } = parseDiagram(withExtraStone.map((r) => r.join(" ")), 7);

  const chinese = getRuleset("chinese");
  const areaBefore = scoreArea(r9, chinese);
  const areaAfter = scoreArea(r11, chinese);
  assert.equal(areaAfter.blackScore, areaBefore.blackScore, "filling own territory does not change area score");
  assert.equal(areaAfter.margin, "White by 7.5");

  const japanese = getRuleset("japanese");
  const territoryBefore = scoreTerritory(r9, japanese);
  const territoryAfter = scoreTerritory(r11, japanese);
  assert.equal(territoryAfter.blackScore, territoryBefore.blackScore - 1, "filling own territory costs exactly one point under territory scoring");
  assert.equal(territoryAfter.margin, "White by 7.5", "margin grows from 6.5 to the same 7.5 offset area scoring already showed");
});

test("removeDeadStones only removes the marked points and only credits the opponent", () => {
  const { position } = parseDiagram(["X O", "X ."], 2);
  const whitePoint = coordToPoint(2, 2, "B1");
  const settled = removeDeadStones(position, [whitePoint]);
  assert.equal(settled.board[whitePoint], EMPTY);
  assert.equal(settled.capturedWhiteStones, 1);
  assert.equal(settled.capturedBlackStones, 0);
  assert.equal(settled.board[coordToPoint(2, 2, "A1")], BLACK, "untouched points are unaffected");
});

test("one upstream territory reading produces the same area, territory and ownership result", () => {
  const rows = [
    ". . X . O . .",
    ". . X O O . .",
    ". . X . O . .",
    ". . X X O . .",
    ". . X . O . .",
  ];
  const { position } = parseDiagram(rows, 7);
  const territory = computeTerritory(position);
  for (const rulesetName of ["chinese", "japanese", "aga"]) {
    const ruleset = getRuleset(rulesetName);
    const game = new Game(7, rulesetName, position);
    const counted = countPosition(game);
    const area = scoreArea(position, ruleset);
    const japaneseStyle = scoreTerritory(position, ruleset);
    assert.deepEqual(scoreArea(position, ruleset, territory), area,
      "passing the authoritative territory result must never change area scoring");
    assert.deepEqual(scoreTerritory(position, ruleset, territory), japaneseStyle,
      "passing the authoritative territory result must never change territory scoring");
    assert.deepEqual(counted.ownership, territory.ownership,
      "the score and shaded territory belong to one position");
    assert.deepEqual(counted.score,
      ruleset.scoring === "territory" ? japaneseStyle : area);
  }
});


test("dead-stone validation recognizes whole connected groups with one group walk", () => {
  const { position } = parseDiagram([
    ". . . . .",
    ". . X . .",
    ". . X . .",
    ". . . . .",
    ". . . . .",
  ], 5);
  const x2 = coordToPoint(5, 5, "C2");
  const x3 = coordToPoint(5, 5, "C3");
  assert.equal(marksWholeDeadGroups(position, []), true);
  assert.equal(marksWholeDeadGroups(position, [x2]), false);
  assert.equal(marksWholeDeadGroups(position, [x3]), false);
  assert.equal(marksWholeDeadGroups(position, [x2, x3]), true);
  assert.equal(marksWholeDeadGroups(position, new Set([x3, x2, x2])), true);
});

