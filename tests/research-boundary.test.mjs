// Research is moving out of the harness into its own production service (Shaun, 25 September
// 2026; `research-agent-deepagents-spike-pack/32-RESEARCH-SPLIT-PLAN.md`). The production image
// will be built from the research code alone, so that code must not reach into the harness: no
// orchestrator, no task store, no delivery runtime, no Frontier source and no CLI.
//
// This walks the imports of every module under `server/research/` and fails on any path that
// leaves it. The harness may import research; research may not import the harness.

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const researchRoot = path.join(repositoryRoot, "server", "research");
const MODULE_EXTENSIONS = new Set([".mjs", ".js", ".ts"]);

// A child process is how a CLI gets in. These two run a fixed local tool and nothing else:
// `pdftotext` for PDF sources, and the operator's own PlanCheck token command.
const CHILD_PROCESS_ALLOWED = new Set([
  "server/research/research-pdf-text.mjs",
  "server/research/plancheck-token.mjs",
]);

// Every specifier a module names: static imports, re-exports, side-effect imports and dynamic
// `import("…")` with a literal. Static forms must start a line, so prose in a comment that
// happens to say `from "…"` is not read as an import.
function specifiersOf(source) {
  const found = new Set();
  const patterns = [
    /^\s*(?:import|export)\b[^;]*?\bfrom\s*["']([^"'\n]+)["']/gm,
    /^\s*import\s*["']([^"'\n]+)["']/gm,
    /\bimport\s*\(\s*["']([^"'\n]+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"'\n]+)["']\s*\)/g,
  ];
  for (const pattern of patterns) for (const match of source.matchAll(pattern)) found.add(match[1]);
  return [...found];
}

async function researchModules(directory = researchRoot) {
  const modules = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) modules.push(...(await researchModules(full)));
    else if (MODULE_EXTENSIONS.has(path.extname(entry.name))) modules.push(full);
  }
  return modules;
}

function relative(file) {
  return path.relative(repositoryRoot, file).split(path.sep).join("/");
}

test("the import scan sees every form of import", () => {
  const source = [
    'import a from "./a.mjs";',
    "import {",
    "  b,",
    '} from "../../b.mjs";',
    'export { c } from "../c.mjs";',
    'import "./side-effect.mjs";',
    'const d = await import("../../../src/d.ts");',
    'const e = require("e");',
    '// the agreed band comes from "three runs" that agree',
  ].join("\n");
  assert.deepEqual(specifiersOf(source).sort(), [
    "../../../src/d.ts",
    "../../b.mjs",
    "../c.mjs",
    "./a.mjs",
    "./side-effect.mjs",
    "e",
  ]);
});

test("research code imports nothing outside server/research", async () => {
  const modules = await researchModules();
  assert.ok(modules.length > 30, `expected the research tree, found ${modules.length} modules`);
  const escapes = [];
  for (const file of modules) {
    const source = await readFile(file, "utf8");
    for (const specifier of specifiersOf(source)) {
      if (specifier.startsWith("node:")) {
        if (specifier === "node:child_process" && !CHILD_PROCESS_ALLOWED.has(relative(file)))
          escapes.push(`${relative(file)} imports node:child_process`);
        continue;
      }
      if (!specifier.startsWith(".")) {
        // No npm packages yet. Adding one is a decision for the research package's own
        // manifest (Phase 2), not something to pick up from the harness's.
        escapes.push(`${relative(file)} imports the package "${specifier}"`);
        continue;
      }
      const target = path.resolve(path.dirname(file), specifier);
      if (target !== researchRoot && !target.startsWith(researchRoot + path.sep))
        escapes.push(`${relative(file)} imports ${relative(target)}`);
    }
  }
  assert.deepEqual(escapes, [], `research must not import the harness:\n${escapes.join("\n")}`);
});

test("research code names no retired or delivery CLI runtime", async () => {
  // The Claude, Codex and OpenCode research runtimes and the pack runtime were deleted on
  // 26 September 2026. A path back to any of them, or to a delivery runtime, is a regression.
  const forbidden =
    /(?:^|\/)(?:claude-cli|codex-cli|opencode-cli|pack|orchestrator[\w-]*|claude-runtime|codex-runtime)(?:\/|\.m?[jt]s$)/;
  const hits = [];
  for (const file of await researchModules()) {
    for (const specifier of specifiersOf(await readFile(file, "utf8")))
      if (forbidden.test(specifier)) hits.push(`${relative(file)} imports ${specifier}`);
  }
  assert.deepEqual(hits, []);
});
