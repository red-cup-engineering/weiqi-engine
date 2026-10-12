import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { buildBrowserKernel } from "../scripts/build-browser-kernel.mjs";

test("browser kernel projection strips source modules into importable ESM", async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), "weiqi-browser-kernel-"));
  try {
    const { moduleCount } = await buildBrowserKernel(outputDirectory);
    assert.equal(moduleCount, 10);

    const events = await import(pathToFileURL(join(outputDirectory, "events.mjs")).href);
    assert.equal(typeof events.annotateMove, "function");
    assert.equal(typeof events.annotatePass, "function");
    const session = await import(pathToFileURL(join(outputDirectory, "session.mjs")).href);
    assert.equal(typeof session.admitWeiqiGameCommand, "function");
    const kernel = await import(pathToFileURL(join(outputDirectory, "index.mjs")).href);
    assert.equal(typeof kernel.countPosition, "function");
    assert.equal(kernel.countPosition(new kernel.Game(9, "japanese")).mode, "territory");
    assert.equal(kernel.countPosition(new kernel.Game(9, "chinese")).mode, "area");
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});
