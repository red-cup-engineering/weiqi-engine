import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { buildBrowserKernel } from "../scripts/build-browser-kernel.mjs";

test("browser projection marks every emitted module as generated", async () => {
  const destination = mkdtempSync(path.join(tmpdir(), "weiqi-browser-kernel-"));
  try {
    const result = await buildBrowserKernel(destination);
    const modules = readdirSync(destination).filter((name) => name.endsWith(".mjs"));
    assert.equal(modules.length, result.moduleCount);
    for (const module of modules) {
      assert.match(readFileSync(path.join(destination, module), "utf8"), /^\/\/\s*@generated\b/u);
    }
  } finally {
    rmSync(destination, { recursive: true, force: true });
  }
});

test("browser projection emits no trailing whitespace", async () => {
  const destination = mkdtempSync(path.join(tmpdir(), "weiqi-browser-kernel-"));
  try {
    await buildBrowserKernel(destination);
    for (const module of readdirSync(destination).filter((name) => name.endsWith(".mjs"))) {
      assert.doesNotMatch(readFileSync(path.join(destination, module), "utf8"), /[^\S\r\n]+$/gmu);
    }
  } finally {
    rmSync(destination, { recursive: true, force: true });
  }
});
