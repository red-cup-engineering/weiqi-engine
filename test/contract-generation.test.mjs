import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("regeneration writes projected runtime code without overwriting behavioral tests", async () => {
  const directory = await mkdtemp(join(tmpdir(), "weiqi-contract-generation-"));
  try {
    const root = join(directory, "game"), spec = join(directory, "spec"), code = join(directory, "code");
    for (const path of ["game/scripts", "game/specifications", "game/src", "game/test", "spec/src", "code/scripts"]) {
      await mkdir(join(directory, path), { recursive: true });
    }
    await copyFile(new URL("../scripts/generate-replay-contracts.mjs", import.meta.url), join(root, "scripts/generate-replay-contracts.mjs"));
    await writeFile(join(root, "src/replay.mjs"), "export const example = 1;\n");
    await writeFile(join(root, "specifications/replay-factory-design.json"), JSON.stringify({ low: {}, plan: {}, delivery: "", cases: [] }));
    const behaviorTest = "// Package-owned behavioral assertions.\n";
    await writeFile(join(root, "test/engineering-code-contracts.test.mjs"), behaviorTest);
    // Controlled supplier ports isolate this CLI's file-ownership behavior.
    // Native supplier qualification belongs to its own integration suite.
    await writeFile(join(spec, "src/engineering-design.mjs"), `
      export function readEngineeringCodeWork({ sourceViews }) {
        if (sourceViews[0].text !== "export const example = 1;\\n") throw new Error("wrong source");
        return { status: "source-present-unassayed" };
      }
    `);
    await writeFile(join(code, "scripts/project-engineering-design-code.mjs"), `
      export function projectEngineeringDesignCode() {
        return { packages: [{ files: [
          { path: "src/engineering-code-contracts.mjs", text: "export const generated = true;\\n" },
          { path: "test/engineering-code-contracts.test.mjs", text: "unwanted whole-state snapshot" }
        ] }] };
      }
    `);
    execFileSync(process.execPath, [join(root, "scripts/generate-replay-contracts.mjs"), spec, code]);
    assert.equal(await readFile(join(root, "src/engineering-code-contracts.mjs"), "utf8"), "export const generated = true;\n");
    assert.equal(await readFile(join(root, "test/engineering-code-contracts.test.mjs"), "utf8"), behaviorTest);
    const design = JSON.parse(await readFile(join(root, "specifications/replay-factory-design.json"), "utf8"));
    assert.equal(design.codeWorkReadout.status, "source-present-unassayed");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
