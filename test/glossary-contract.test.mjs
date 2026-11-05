import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { TERM_REFERENCES } from "../src/events.mjs";

test("glossary integration refuses missing terms and empty definitions without a silent skip", async () => {
  const directory = await mkdtemp(join(tmpdir(), "weiqi-glossary-contract-"));
  try {
    const file = join(directory, "glossary.json");
    const script = fileURLToPath(new URL("../scripts/verify-glossary.mjs", import.meta.url));
    const glossary = Object.fromEntries(Object.keys(TERM_REFERENCES)
      .map(term => [term, { slug: term, definition: `Fixture definition for ${term}.` }]));
    const run = () => spawnSync(process.execPath, [script, file], { encoding: "utf8" });
    await writeFile(file, JSON.stringify(glossary));
    assert.equal(run().status, 0);
    glossary.pass.definition = "  ";
    await writeFile(file, JSON.stringify(glossary));
    const empty = run();
    assert.notEqual(empty.status, 0);
    assert.match(empty.stderr, /empty glossary definition/);
    delete glossary.pass;
    await writeFile(file, JSON.stringify(glossary));
    const missing = run();
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /pass is missing/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
