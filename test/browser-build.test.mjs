import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { buildBrowserKernel } from "../scripts/build-browser-kernel.mjs";

// Build once: inspect the SAME artifact for completeness, provenance,
// whitespace and runtime ESM behavior. The web application's separate
// browser-projection-parity test owns comparing CHECKED-IN copies against
// this upstream generator; this test owns the generator's actual output.
test("upstream browser kernel is complete, generated and importable", async (t) => {
  const destination = await mkdtemp(join(tmpdir(), "weiqi-browser-kernel-"));
  try {
    const { moduleCount } = await buildBrowserKernel(destination);
    const generated = (await readdir(destination))
      .filter((name) => name.endsWith(".mjs")).sort();
    const expected = (await readdir(new URL("../src/", import.meta.url)))
      .filter((name) => name.endsWith(".mjs") &&
        !["match.mjs", "replay.mjs"].includes(name)).sort();

    await t.test("exact module set, not a brittle hardcoded count", () => {
      assert.deepEqual(generated, expected);
      assert.equal(moduleCount, expected.length);
    });

    await t.test("every emitted module has provenance and no trailing whitespace", async () => {
      for (const name of generated) {
        const bytes = await readFile(join(destination, name), "utf8");
        assert.match(bytes, /^\/\/\s*@generated\b/u, name);
        assert.doesNotMatch(bytes, /[^\S\r\n]+$/gmu, name);
      }
    });

    await t.test("actual ESM imports expose the rules and session contracts", async () => {
      const events = await import(pathToFileURL(join(destination, "events.mjs")).href);
      assert.equal(typeof events.annotateMove, "function");
      assert.equal(typeof events.annotatePass, "function");

      const session = await import(pathToFileURL(join(destination, "session.mjs")).href);
      assert.equal(typeof session.admitWeiqiGameCommand, "function");

      const kernel = await import(pathToFileURL(join(destination, "index.mjs")).href);
      assert.equal(typeof kernel.countPosition, "function");
      assert.equal(kernel.countPosition(new kernel.Game(9, "japanese")).mode, "territory");
      assert.equal(kernel.countPosition(new kernel.Game(9, "chinese")).mode, "area");
    });

    await t.test("generated SGF records preserve the selected game's rules through session replay", async () => {
      const kernel = await import(pathToFileURL(join(destination, "index.mjs")).href);
      const record = kernel.sgfToGameRecord("(;GM[1]SZ[9];B[cc](;RU[japanese]KM[6.5];W[gg];B[];W[])(;RU[chinese];W[dd]))");
      const commands = record.moves.map(({ point }) => point === "pass"
        ? { kind: "pass" } : { kind: "play", move: kernel.pointToCoord(record.size, point) });
      const session = kernel.createWeiqiGameSession({ size: record.size, ruleset: record.ruleset }, commands);
      assert.equal(session.config.ruleset, "japanese");
      assert.deepEqual(session.state.moves, ["C3", "G7", "pass", "pass"]);
      assert.equal(kernel.countPosition(kernel.materializeWeiqiGame(session)).mode, "territory");
      assert.equal(kernel.weiqiSessionToSgfRecord(session).komi, 6.5);
      assert.throws(() => kernel.sgfToGameRecord("(;SZ[9]RU[chinese];B[cc];KM[6.5])"),
        /game-info.*one node/i);
    });

    await t.test("generated accepted observations cannot rewrite later replay lessons", async () => {
      const kernel = await import(pathToFileURL(join(destination, "index.mjs")).href);
      const initial = kernel.createWeiqiGameSession({ size: 9, ruleset: "chinese" });
      const accepted = kernel.admitWeiqiGameCommand(initial, 0, { kind: "pass" });
      assert.equal(accepted.ok, true);
      accepted.events[0].term = "capture";
      accepted.events[0].detail.color = kernel.WHITE;
      const replay = kernel.materializeWeiqiGame(accepted.session);
      assert.equal(replay.moveEvents[0][0].term, "pass");
      assert.equal(replay.moveEvents[0][0].detail.color, kernel.BLACK);
      assert.deepEqual(replay.moveEvents,
        kernel.materializeWeiqiGame(JSON.parse(JSON.stringify(accepted.session))).moveEvents);
    });

    await t.test("generated sessions retain rescues by capture through saved replay", async () => {
      const kernel = await import(pathToFileURL(join(destination, "index.mjs")).href);
      for (const color of [kernel.BLACK, kernel.WHITE]) {
        const moves = ["C1", "B3", "B2", "B1", "A3", "A2"];
        if (color === kernel.BLACK) moves.unshift("pass");
        const commands = moves.map(move => move === "pass" ? { kind: "pass" } : { kind: "play", move });
        const session = kernel.createWeiqiGameSession({ size: 3, ruleset: "chinese" }, commands);
        const game = kernel.materializeWeiqiGame(JSON.parse(JSON.stringify(session)));
        const rescues = game.moveEvents.at(-1).filter(event => event.type === "atari-escaped");
        assert.deepEqual(rescues.map(event => event.detail), [{ color, groupSize: 1 }]);
        assert.equal(game.current.board[kernel.coordToPoint(3, 3, "A3")], 0);
        assert.equal(game.current.board[kernel.coordToPoint(3, 3, "B3")], color);
      }
    });

    await t.test("generated sessions report self-capture without teaching a false connection", async () => {
      const kernel = await import(pathToFileURL(join(destination, "index.mjs")).href);
      for (const color of [kernel.BLACK, kernel.WHITE]) {
        const moves = ["A1", "A2", "C1", "C2", "pass", "B2"];
        if (color === kernel.WHITE) moves.unshift("pass");
        const commands = moves.map((move) => move === "pass" ? { kind: "pass" } : { kind: "play", move });
        const session = kernel.createWeiqiGameSession({ size: 3, ruleset: "newzealand" }, commands);
        const next = kernel.admitWeiqiGameCommand(session, session.version, { kind: "play", move: "B1" });
        assert.equal(next.ok, true);
        assert.deepEqual(next.events.map((event) => event.type), ["capture", "group-killed"]);
        assert.equal(next.events[0].detail.selfCapture, true);
        assert.equal(next.events[0].detail.stonesCaptured, 3);
        assert.deepEqual(next.session.state.board.slice(0, 3), [0, 0, 0]);
        assert.equal(next.session.state.toMove, color === kernel.BLACK ? kernel.WHITE : kernel.BLACK);
        assert.equal(next.session.state[color === kernel.BLACK ? "capturedBlackStones" : "capturedWhiteStones"], 3);
        const replay = kernel.materializeWeiqiGame(JSON.parse(JSON.stringify(next.session)));
        assert.deepEqual(replay.moveEvents.at(-1), next.events);
        assert.deepEqual([...replay.current.board], next.session.state.board);
      }
    });

    await t.test("generated sessions refuse a multi-letter column without changing the turn", async () => {
      const kernel = await import(pathToFileURL(join(destination, "index.mjs")).href);
      const initial = kernel.createWeiqiGameSession({ size: 9, ruleset: "chinese" });
      assert.deepEqual(kernel.admitWeiqiGameCommand(initial, 0, { kind: "play", move: "AB1" }),
        { ok: false, reason: "off-board" });
      const corrected = kernel.admitWeiqiGameCommand(initial, 0, { kind: "play", move: "A1" });
      assert.equal(corrected.ok, true);
      assert.equal(corrected.session.state.board[0], kernel.BLACK);
      assert.equal(corrected.session.state.toMove, kernel.WHITE);
    });

    await t.test("generated bot policies continue a handicap game after an early pass", async () => {
      const kernel = await import(pathToFileURL(join(destination, "index.mjs")).href);
      const policies = await import(pathToFileURL(join(destination, "policies.mjs")).href);
      const session = kernel.createWeiqiGameSession({ size: 9, ruleset: "chinese", handicap: 2 }, [
        { kind: "play", move: "D4" }, { kind: "play", move: "E4" }, { kind: "pass" },
      ]);
      const game = kernel.materializeWeiqiGame(session);
      assert.ok(policies.candidateMoveCoords(game, kernel).length > 50);
      for (const tier of policies.BOT_TIERS) {
        const move = tier.id === "montecarlo"
          ? policies.chooseMonteCarloMove(game, kernel, () => 0.37, { playouts: 5, maxPlayoutMoves: 0 })
          : tier.chooser(game, kernel, () => 0.37);
        assert.notEqual(move, "pass", tier.id);
        const next = kernel.admitWeiqiGameCommand(session, session.version, { kind: "play", move });
        assert.equal(next.ok, true, tier.id);
        assert.equal(next.session.state.mainPhaseEnded, false);
        assert.equal(next.session.state.passStreak, 0);
      }
    });

    await t.test("generated search policies read continuations after resumed counting", async () => {
      const kernel = await import(pathToFileURL(join(destination, "index.mjs")).href);
      const policies = await import(pathToFileURL(join(destination, "policies.mjs")).href);
      const session = kernel.createWeiqiGameSession({ size: 9, ruleset: "chinese" }, [
        { kind: "play", move: "D4" }, { kind: "pass" }, { kind: "pass" },
        { kind: "play", move: "E4" },
      ]);
      const game = kernel.materializeWeiqiGame(session);
      const branches = [];
      const fork = game.fork.bind(game);
      game.fork = () => { const branch = fork(); branches.push(branch); return branch; };
      const move = policies.chooseMonteCarloMove(game, kernel, () => 0.37,
        { playouts: 12, maxPlayoutMoves: 0 });
      assert.ok(branches.some((branch) => branch.history.length > game.history.length + 1),
        "the generated search explores opponent replies, not only root placements");
      const next = kernel.admitWeiqiGameCommand(session, session.version, { kind: "play", move });
      assert.equal(next.ok, true);
      assert.equal(next.session.state.mainPhaseEnded, true, "historical counting remains recorded");
      assert.equal(next.session.state.passStreak, 0);
      const trial = kernel.materializeWeiqiGame(next.session);
      const length = trial.history.length;
      policies.randomPlayout(trial, kernel, () => 0.37, 3);
      assert.equal(trial.history.length, length + 3);
      assert.equal(game.history.length, session.version + 1, "search leaves the real game unchanged");
    });

    await t.test("generated SGF import refuses empty variations without losing valid empty nodes", async () => {
      const kernel = await import(pathToFileURL(join(destination, "index.mjs")).href);
      for (const text of ["(;GM[1]SZ[9];B[aa]()(;W[bb]))",
        "(;GM[1]SZ[9];B[aa](;W[bb])())"]) {
        assert.throws(() => kernel.sgfToGameRecord(text), /SGF game tree must contain at least one node/);
      }
      const record = kernel.sgfToGameRecord("(;GM[1]SZ[9];B[aa](; ;W[bb];)(;))");
      const commands = record.moves.map(({ point }) => ({
        kind: "play", move: kernel.pointToCoord(record.size, point),
      }));
      const session = kernel.createWeiqiGameSession({ size: record.size, ruleset: "chinese" }, commands);
      assert.equal(session.version, 2);
      assert.equal(session.state.board[0], kernel.BLACK);
      assert.equal(session.state.board[10], kernel.WHITE);
      assert.equal(session.state.toMove, kernel.BLACK);
    });

    await t.test("generated SGF import refuses turn-changing setup before a Study session exists", async () => {
      const kernel = await import(pathToFileURL(join(destination, "index.mjs")).href);
      for (const text of ["(;GM[1]SZ[9]PL[W])", "(;GM[1]SZ[9];B[aa];PL[B])"]) {
        assert.throws(() => kernel.sgfToGameRecord(text), /player-to-play setup PL.*not supported/);
      }
      const record = kernel.sgfToGameRecord("(;GM[1]SZ[9];B[aa](;W[bb])(;PL[B]))");
      const commands = record.moves.map(({ point }) => ({
        kind: "play", move: kernel.pointToCoord(record.size, point),
      }));
      const session = kernel.createWeiqiGameSession({ size: record.size, ruleset: "chinese" }, commands);
      assert.equal(session.version, 2);
      assert.equal(session.state.toMove, kernel.BLACK);
      assert.equal(session.state.board[0], kernel.BLACK);
      assert.equal(session.state.board[10], kernel.WHITE);
    });
  } finally {
    await rm(destination, { recursive: true, force: true });
  }
});
