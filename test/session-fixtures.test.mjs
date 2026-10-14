import assert from "node:assert/strict";
import { test } from "node:test";
import {
  WALL_MOVES, WALL_WITH_INVADER, commandOfMove, sessionAfterMoves, walledSession,
} from "./helpers/session-fixtures.mjs";
import { BLACK, WHITE, coordToPoint } from "../src/board.mjs";

test("wall fixture is admitted through the rules-owned session and has reproducible geometry", () => {
  const wall = walledSession("chinese");
  assert.equal(wall.version, WALL_MOVES.length);
  assert.equal(wall.state.toMove, BLACK);
  assert.equal(wall.state.board[coordToPoint(5, 5, "B3")], BLACK);
  assert.equal(wall.state.board[coordToPoint(5, 5, "D3")], WHITE);
  assert.equal(wall.state.board[coordToPoint(5, 5, "C3")], 0);
  assert.equal(Object.isFrozen(wall.commands), true);
  assert.equal(Object.isFrozen(WALL_MOVES), true);
});

test("fixture commands represent passes as pass, not play with move=pass", () => {
  const game = sessionAfterMoves({ size: 5, ruleset: "chinese" }, WALL_WITH_INVADER);
  assert.equal(game.version, WALL_WITH_INVADER.length);
  assert.deepEqual(game.commands.slice(10).map(({ kind }) => kind),
    ["pass", "play", "pass", "pass"]);
  assert.equal(game.state.passStreak, 2);
  assert.deepEqual(commandOfMove("pass"), { kind: "pass" });
  assert.deepEqual(commandOfMove("A3"), { kind: "play", move: "A3" });
});

test("invalid fixtures fail loudly at the first named command", () => {
  assert.throws(
    () => sessionAfterMoves({ size: 5, ruleset: "chinese" }, ["B1", "B1"]),
    /command 2.*occupied/,
  );
  assert.throws(
    () => sessionAfterMoves({ size: 5, ruleset: "chinese" }, ["Z9"]),
    /command 1.*off-board/,
  );
});
