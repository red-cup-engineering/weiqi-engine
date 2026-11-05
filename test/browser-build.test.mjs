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
