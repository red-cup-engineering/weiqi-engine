import assert from "node:assert/strict";
import { test } from "node:test";
import * as kernel from "../src/index.mjs";
import { candidateMoveCoords, chooseMonteCarloMove } from "../src/policies.mjs";

const CORNER_FIGHT = ["A1", "B1", "C3", "B3", "C1", "C2", "A3", "B2"];

test("Monte Carlo ranks safe legal replies through a corner fight under every ruleset", () => {
  for (const size of [9, 13, 19]) {
    for (const ruleset of ["chinese", "japanese", "aga", "newzealand", "ing"]) {
      for (const swapColors of [false, true]) {
        const game = new kernel.Game(size, ruleset);
        for (const move of [...(swapColors ? ["pass"] : []), ...CORNER_FIGHT]) {
          assert.equal(game.play(move).ok, true, `${ruleset}: ${move}`);
        }
        const before = structuredClone({ history: game.history, events: game.moveEvents,
          activeKoPoint: game.activeKoPoint, passStreak: game.passStreak,
          mainPhaseEnded: game.mainPhaseEnded, result: game.result });
        const branches = [];
        const fork = game.fork.bind(game);
        game.fork = () => {
          const branch = fork();
          const play = branch.play.bind(branch);
          branch.play = (move) => {
            assert.ok(candidateMoveCoords(branch, kernel).includes(move),
              `tree expansion must share the root's legal, non-self-harming candidates: ${move}`);
            const outcome = play(move);
            assert.equal(outcome.ok, true, "every searched tree move must be legal");
            return outcome;
          };
          branches.push(branch);
          return branch;
        };
        const updates = [];
        const move = chooseMonteCarloMove(game, kernel, () => 0.37,
          { playouts: 8, maxPlayoutMoves: 0, onProgress: (update) => updates.push(update) });
        assert.ok(candidateMoveCoords(game, kernel).includes(move));
        assert.equal(branches.length, 8);
        assert.ok(branches.some((branch) => branch.history.length > game.history.length + 1),
          "the regression must exercise opponent replies, not only root moves");
        assert.equal(updates.at(-1).completed, 8);
        assert.deepEqual({ history: game.history, events: game.moveEvents,
          activeKoPoint: game.activeKoPoint, passStreak: game.passStreak,
          mainPhaseEnded: game.mainPhaseEnded, result: game.result }, before,
        "search must not change the player's real game");
      }
    }
  }
});

test("search policy does not change New Zealand's legal multi-stone self-capture rule", () => {
  const game = new kernel.Game(9, "newzealand");
  for (const move of ["A1", "A2", "C1", "C2", "pass", "B2", "pass", "D1"]) {
    assert.equal(game.play(move).ok, true);
  }
  assert.equal(game.isLegal("B1"), true, "removing three stones does not repeat the board");
  assert.equal(candidateMoveCoords(game, kernel).includes("B1"), false,
    "a legal self-capture remains a policy choice to avoid, not a new rule prohibition");
  const move = chooseMonteCarloMove(game, kernel, () => 0.37,
    { playouts: 8, maxPlayoutMoves: 0 });
  assert.equal(game.isLegal(move), true);
  assert.equal(game.play("B1").ok, true);
  assert.deepEqual([...game.current.board.slice(0, 3)], [0, 0, 0]);
  assert.equal(game.current.capturedBlackStones, 3);
});

test("tree replies keep the full ko history under every declared ko regime", () => {
  const cells = [".....", "..X..", ".XOX.", ".O.O.", "..O.."].join("")
    .split("").map((cell) => cell === "X" ? kernel.BLACK : cell === "O" ? kernel.WHITE : kernel.EMPTY);
  for (const ruleset of ["chinese", "japanese", "aga", "newzealand", "ing"]) {
    const game = new kernel.Game(5, ruleset,
      kernel.createPositionFromCells(5, 5, cells, kernel.BLACK));
    assert.equal(game.play("C4").ok, true);
    assert.equal(game.isLegal("C3"), false, `${ruleset}: immediate recapture is forbidden`);
    assert.equal(new kernel.Game(5, ruleset, game.current).isLegal("C3"), true,
      "a current position alone cannot prove ko legality");
    const fork = game.fork.bind(game);
    let replies = 0;
    game.fork = () => {
      const trial = fork();
      assert.equal(trial.isLegal("C3"), false);
      const play = trial.play.bind(trial);
      trial.play = (move) => {
        assert.ok(candidateMoveCoords(trial, kernel).includes(move));
        assert.equal(trial.isLegal(move), true);
        if (trial.history.length > game.history.length) replies++;
        return play(move);
      };
      return trial;
    };
    const move = chooseMonteCarloMove(game, kernel, () => 0.37,
      { playouts: 12, maxPlayoutMoves: 0 });
    assert.ok(replies > 0, `${ruleset}: actual opponent replies were searched`);
    assert.equal(game.isLegal(move), true);
    assert.equal(game.isLegal("C3"), false, "search did not erase the player's ko history");
    assert.equal(game.history.length, 2);
  }
});
