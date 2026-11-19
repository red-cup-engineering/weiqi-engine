// Explicit cross-package contract with the web application's compiled
// Science glossary. Never assume the engine lives in a former monorepo.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { TERM_REFERENCES } from "../src/events.mjs";

const file = process.argv[2] ?? process.env.WEIQI_GLOSSARY_FILE;
if (!file) {
  throw new Error("Provide the actual web glossary: npm run test:glossary -- <weiqi-web/public/data/glossary.json>");
}
const glossary = JSON.parse(await readFile(file, "utf8"));
for (const [term, reference] of Object.entries(TERM_REFERENCES)) {
  assert.equal(reference, `science://lenticule-science/weiqi/terms/${term}`);
  assert.equal(glossary[term]?.slug, term, `${term} is missing from the supplied glossary`);
  assert.equal(typeof glossary[term].definition, "string", `${term} needs a glossary definition`);
  assert.ok(glossary[term].definition.trim().length > 0, `${term} has an empty glossary definition`);
}
console.log(`Verified ${Object.keys(TERM_REFERENCES).length} semantic term references against ${resolve(file)}`);
