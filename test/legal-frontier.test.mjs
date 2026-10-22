import assert from "node:assert/strict";
import { test } from "node:test";
import { Game } from "../src/game.mjs";
import { BLACK, WHITE, EMPTY, coordToPoint, findGroup, pointToCoord } from "../src/board.mjs";
import { createPositionFromCells } from "../src/position.mjs";
import { candidateMoveCoords } from "../src/policies.mjs";
import * as kernel from "../src/index.mjs";

const everyPoint = size => Array.from({ length: size * size },
  (_, point) => pointToCoord(size, point));

test("the lawful frontier equals the original full-history rules at every observed turn", () => {
  for (const ruleset of ["japanese", "chinese", "aga", "newzealand"]) {
    const game = new Game(5, ruleset);
    for (const next of ["A1", "E5", "B2", "D4", "pass", "C3"]) {
      const hash = game.current.boardHash;
      const historyLength = game.history.length;
      const eventsLength = game.moveEvents.length;
      const frontier = game.legalPlacementFrontier();
      assert.deepEqual(frontier, everyPoint(5).filter(coord => game.isLegal(coord)),
        `${ruleset}: frontier must reuse this Game's exact legality`);
      assert.ok(!frontier.includes("pass"), "pass is not a board liberty or placement");
      assert.equal(game.current.boardHash, hash);
      assert.equal(game.history.length, historyLength, "reading never appends moves");
      assert.equal(game.moveEvents.length, eventsLength, "reading never manufactures events");
      assert.equal(game.play(next).ok, true, `${ruleset}: fixture move ${next} must be legal`);
    }
  }
});

test("a static liberty is not necessarily a legal continuation: simple ko is historical", () => {
  const rows = [
    ". . . . .", ". . X . .", ". X O X .", ". O . O .", ". . O . .",
  ];
  const cells = rows.join(" ").split(/\\s+/).map(char => char === "X" ? BLACK : char === "O" ? WHITE : EMPTY);
  const position = createPositionFromCells(5, 5, cells, BLACK);
  const game = new Game(5, "japanese", position);
  assert.equal(game.play("C4").ok, true);
  const c3 = coordToPoint(5, 5, "C3");
  const c4 = coordToPoint(5, 5, "C4");
  assert.equal(game.current.board[c3], EMPTY);
  assert.ok(findGroup(game.current.board, 5, 5, c4).liberties.has(c3),
    "C3 is a genuine liberty in the fixed-position stone group");
  assert.equal(game.isLegal("C3"), false);
  assert.ok(!game.legalPlacementFrontier().includes("C3"),
    "recapture is ruled out by the actual historical ko regime");
  assert.ok(!game.fork().legalPlacementFrontier().includes("C3"),
    "a fork preserves history-indexed legality");
  const sameBoardWithoutHistory = new Game(5, "japanese", game.current);
  assert.equal(sameBoardWithoutHistory.isLegal("C3"), true);
  assert.ok(sameBoardWithoutHistory.legalPlacementFrontier().includes("C3"),
    "same board with different history means a different lawful frontier");
});

test("all five opponent policies consume only the source Game's lawful frontier", () => {
  const game = new Game(9, "chinese");
  const frontier = game.legalPlacementFrontier();
  const useful = candidateMoveCoords(game, kernel);
  assert.ok(frontier.length > 0);
  assert.ok(useful.length > 0);
  assert.ok(useful.every(coord => frontier.includes(coord)));
  assert.deepEqual(frontier, everyPoint(9));
  assert.equal(game.history.length, 1, "bot observation cannot perform the turn");
});

test("terminal games have no stone placements, independently of remaining empty points", () => {
  const game = new Game(5, "japanese");
  assert.ok(game.legalPlacementFrontier().length > 0);
  assert.equal(game.resign(WHITE).ok, true);
  assert.deepEqual(game.legalPlacementFrontier(), []);
  assert.deepEqual(candidateMoveCoords(game, kernel), []);
  assert.equal(game.isLegal("pass"), false);
});
