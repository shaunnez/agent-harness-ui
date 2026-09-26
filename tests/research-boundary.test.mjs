// Research is moving out of the harness into its own production service (Shaun, 25 September
// 2026; `research-agent-deepagents-spike-pack/32-RESEARCH-SPLIT-PLAN.md`). The production image
// will be built from the research code alone, so that code must not reach into the harness: no
// orchestrator, no task store, no delivery runtime, no Frontier source and no CLI.
//
// This walks the imports of every module in `packages/research-engine/src/` and fails on any path
// that leaves the package. The harness may import research, by the package name only; research may
// not import the harness.

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = path.join(repositoryRoot, "packages", "research-engine");
const researchRoot = path.join(packageRoot, "src");
const PACKAGE_NAME = "@eversor/research-engine";
const MODULE_EXTENSIONS = new Set([".mjs", ".js", ".ts", ".tsx"]);

// A child process is how a CLI gets in. These two run a fixed local tool and nothing else:
// `pdftotext` for PDF sources, and the operator's own PlanCheck token command.
const CHILD_PROCESS_ALLOWED = new Set([
  "packages/research-engine/src/research-pdf-text.mjs",
  "packages/research-engine/src/plancheck-token.mjs",
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

async function modulesIn(directory) {
  const modules = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) modules.push(...(await modulesIn(full)));
    else if (MODULE_EXTENSIONS.has(path.extname(entry.name))) modules.push(full);
  }
  return modules;
}

const researchModules = () => modulesIn(researchRoot);

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

test("research code imports nothing outside its package", async () => {
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
        // No npm packages yet, not even its own name: inside the package, imports are relative.
        // Adding a dependency is a decision for this package's manifest, not the harness's.
        escapes.push(`${relative(file)} imports the package "${specifier}"`);
        continue;
      }
      const target = path.resolve(path.dirname(file), specifier);
      if (!target.startsWith(researchRoot + path.sep))
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

test("the research package declares no dependencies", async () => {
  const manifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  assert.equal(manifest.name, PACKAGE_NAME);
  for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"])
    assert.equal(manifest[field], undefined, `${PACKAGE_NAME} declares ${field}`);
});

test("the harness imports research by the package name only", async () => {
  // A relative path into the package would still work in this repo but break once the package is
  // built or published on its own, and it hides the dependency from anyone reading the import.
  const reachIns = [];
  for (const top of ["server", "src", "scripts", "tests", "worker", "apps"]) {
    for (const file of await modulesIn(path.join(repositoryRoot, top))) {
      for (const specifier of specifiersOf(await readFile(file, "utf8"))) {
        if (!specifier.startsWith(".")) continue;
        const target = path.resolve(path.dirname(file), specifier);
        if (target === packageRoot || target.startsWith(packageRoot + path.sep))
          reachIns.push(`${relative(file)} imports ${specifier}`);
      }
    }
  }
  assert.deepEqual(reachIns, [], `use ${PACKAGE_NAME}/… instead:\n${reachIns.join("\n")}`);
});

test("the research service imports only the engine, its own files and its declared packages", async () => {
  // `apps/research-service` is what production runs (32-RESEARCH-SPLIT-PLAN.md, Phase 3): the
  // engine, Postgres, and nothing of the harness.
  const serviceRoot = path.join(repositoryRoot, "apps", "research-service");
  const manifest = JSON.parse(await readFile(path.join(serviceRoot, "package.json"), "utf8"));
  const declared = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ]);
  assert.deepEqual(Object.keys(manifest.dependencies ?? {}).sort(), [PACKAGE_NAME, "pg"]);
  const escapes = [];
  for (const file of await modulesIn(serviceRoot)) {
    for (const specifier of specifiersOf(await readFile(file, "utf8"))) {
      if (specifier.startsWith("node:")) {
        if (specifier === "node:child_process") escapes.push(`${relative(file)} imports node:child_process`);
        continue;
      }
      if (specifier.startsWith(".")) {
        const target = path.resolve(path.dirname(file), specifier);
        if (!target.startsWith(serviceRoot + path.sep))
          escapes.push(`${relative(file)} imports ${relative(target)}`);
        continue;
      }
      const name = specifier.startsWith("@")
        ? specifier.split("/").slice(0, 2).join("/")
        : specifier.split("/")[0];
      if (!declared.has(name))
        escapes.push(`${relative(file)} imports the undeclared package "${specifier}"`);
    }
  }
  assert.deepEqual(escapes, [], `the research service must not reach the harness:\n${escapes.join("\n")}`);
});
