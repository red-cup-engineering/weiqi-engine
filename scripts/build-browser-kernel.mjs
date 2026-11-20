import { readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildBrowserBundle } from "@red-cup-engineering/project-browser-asset-tree-computer-systems-publishing-engineering-services-section/browser-bundle";

const kernelRoot = fileURLToPath(new URL("../", import.meta.url));
// Stable browser module URLs used by existing clients. Shared chunks preserve class identity across entries.
const browserEntries = [
  "board", "events", "flow-certificate", "game", "index", "policies", "position",
  "reel", "rulesets", "scoring", "session", "sgf", "tactics", "zobrist",
];

async function verifyBrowserKernel(outputDirectory) {
  const kernel = await import(pathToFileURL(path.join(outputDirectory, "index.mjs")).href);
  if (typeof kernel.Game !== "function") {
    throw new Error(`Browser kernel at ${outputDirectory} does not export Game`);
  }
  if (typeof kernel.countPosition !== "function") {
    throw new Error(`Browser kernel at ${outputDirectory} does not export the ruleset-aware countPosition`);
  }
  const japanese = new kernel.Game(9, "japanese");
  if (kernel.countPosition(japanese).mode !== "territory") {
    throw new Error(`Browser kernel at ${outputDirectory} must count Japanese games by territory`);
  }

  const game = new kernel.Game(9, "chinese");
  const moves = ["C3", "G7", "C7"];
  for (const move of moves) {
    const outcome = game.play(move);
    if (!outcome.ok) {
      throw new Error(`Browser kernel at ${outputDirectory} rejected ${move}: ${outcome.reason}`);
    }
  }
  if (game.history.length !== moves.length + 1) {
    throw new Error(`Browser kernel at ${outputDirectory} produced ${game.history.length} positions, expected ${moves.length + 1}`);
  }
}

/** Build the kernel's browser ESM projection into one static application's public directory. */
export async function buildBrowserKernel(outputDirectory) {
  const destination = path.resolve(outputDirectory);
  const result = await buildBrowserBundle({
    absWorkingDir: kernelRoot,
    entryPoints: browserEntries.map(name => `src/${name}.mjs`),
    bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022",
    outdir: destination, outExtension: { ".js": ".mjs" }, chunkNames: "chunks/[name]-[hash]",
    metafile: true,
  });
  await verifyBrowserKernel(destination);
  const emitted = new Set(Object.keys(result.metafile.outputs).map(file => path.resolve(kernelRoot, file)));
  const chunks = path.join(destination, "chunks");
  for (const file of await readdir(chunks)) {
    if (/^chunk-[A-Z0-9]{8}\.mjs$/u.test(file) && !emitted.has(path.join(chunks, file))) {
      await unlink(path.join(chunks, file));
    }
  }
  return { destination, moduleCount: browserEntries.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const outputDirectory = process.argv[2];
  if (!outputDirectory) {
    throw new Error("usage: node build-browser-kernel.mjs <output-directory>");
  }
  const result = await buildBrowserKernel(outputDirectory);
  console.log(`Built and verified ${result.moduleCount} browser kernel modules in ${result.destination}`);
}
