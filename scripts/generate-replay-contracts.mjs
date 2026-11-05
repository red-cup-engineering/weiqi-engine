#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Use the original source owners explicitly. Never substitute a local test
// generator or silently resolve a registry version without result-reference support.
const [specificationRoot, codeRoot] = process.argv.slice(2);
if (!specificationRoot || !codeRoot)
  throw new TypeError('Usage: node scripts/generate-replay-contracts.mjs <Specification source root> <Code Fabrication source root>');
const { readEngineeringCodeWork } = await import(pathToFileURL(resolve(specificationRoot, 'src/engineering-design.mjs')));
const { projectEngineeringDesignCode } = await import(pathToFileURL(resolve(codeRoot, 'scripts/project-engineering-design-code.mjs')));
const root = resolve(import.meta.dirname, '..');
const carrier = join(root, 'specifications/replay-factory-design.json');
const design = JSON.parse(await readFile(carrier, 'utf8'));
const text = await readFile(join(root, 'src/replay.mjs'), 'utf8');
const expectedSha256 = 'sha256:' + createHash('sha256').update(text).digest('hex');
const codeWorkReadout = readEngineeringCodeWork({
  designCandidate: design.low,
  originalPlan: design.plan,
  originalDeliveryText: design.delivery,
  sourceViews: [{ owner: 'red-cup-engineering/weiqi-engine', path: 'src/replay.mjs', text, expectedSha256 }],
});
if (codeWorkReadout.status !== 'source-present-unassayed') throw new Error(JSON.stringify(codeWorkReadout));
const candidate = projectEngineeringDesignCode({ codeWorkReadout, cases: design.cases });
if (!Array.isArray(candidate.packages) || candidate.packages.length !== 1)
  throw new Error('Expected one original Weiqi package projection');
for (const file of candidate.packages[0].files) {
  const target = join(root, file.path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, file.text);
}
await writeFile(carrier, JSON.stringify({ ...design, codeWorkReadout }, null, 2));
console.log(`Generated original replay contracts for ${expectedSha256}`);
