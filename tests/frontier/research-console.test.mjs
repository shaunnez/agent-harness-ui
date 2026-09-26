// The research console's build (`vite.research-console.config.mjs`): it builds, it carries the
// world and the research windows, and it carries none of the harness's delivery surfaces
// (32-RESEARCH-SPLIT-PLAN.md, Phase 4). The build itself fails on a forbidden module; this test
// also proves the check is not vacuous.

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { forbiddenConsoleModules } from "../../scripts/research-console/boundary.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const config = path.join(root, "vite.research-console.config.mjs");

async function consoleBuild() {
  const outDir = await mkdtemp(path.join(os.tmpdir(), "research-console-"));
  let ids = [];
  try {
    await build({
      configFile: config,
      logLevel: "silent",
      build: { outDir, emptyOutDir: true },
      plugins: [
        {
          name: "list-modules",
          buildEnd() {
            ids = [...this.getModuleIds()];
          },
        },
      ],
    });
    const html = await readFile(path.join(outDir, "index.html"), "utf8");
    const modules = ids
      .filter((id) => id.startsWith(root) && !id.includes("/node_modules/"))
      .map((id) => path.relative(root, id.split("?")[0]).split(path.sep).join("/"));
    return { html, modules, ids };
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}

test("the research console builds with the world and research windows, and nothing of delivery", async () => {
  const { html, modules, ids } = await consoleBuild();
  assert.match(html, /<title>Eversor Research<\/title>/);
  for (const expected of [
    "src/frontier/research-console/ResearchConsoleApp.tsx",
    "src/frontier/world-3d/ProofWorld.tsx",
    "src/frontier/views/research/ResearchQuestions.tsx",
    "src/frontier/views/research/ResearchQuestionView.tsx",
    "src/frontier/views/research/ResearchAsk.tsx",
    "src/frontier/views/research/ResearchBaseSelection.tsx",
  ])
    assert.ok(modules.includes(expected), `${expected} is in the console`);
  assert.deepEqual(forbiddenConsoleModules(ids, root), []);
  // Nothing from the harness server, and no path into the harness's own entry.
  assert.deepEqual(
    modules.filter((id) => id.startsWith("server/") || id === "src/frontier/main.tsx"),
    [],
  );
});

test("the boundary names the harness surfaces the console must not carry", () => {
  const at = (relative) => path.join(root, relative);
  assert.deepEqual(
    forbiddenConsoleModules(
      [
        at("src/frontier/views/TaskPanel.tsx"),
        at("src/frontier/views/WorkflowCommand.tsx"),
        at("src/frontier/views/Grill.tsx"),
        at("src/frontier/views/LinearSettings.tsx"),
        at("src/frontier/views/NewTask.tsx"),
        at("src/frontier/app/FrontierApp.tsx"),
        at("src/frontier/runtime/live-gateway.ts"),
        at("src/frontier/fixtures/gateway.ts"),
        at("src/api.ts"),
        // Allowed: research views, the world, research fixtures, shared UI.
        at("src/frontier/views/research/ResearchAsk.tsx"),
        at("src/frontier/world-3d/ProofWorld.tsx"),
        at("src/frontier/fixtures/research/questions.ts"),
        at("src/frontier/ui/Modal.tsx"),
      ],
      root,
    ),
    [
      "src/frontier/views/TaskPanel.tsx",
      "src/frontier/views/WorkflowCommand.tsx",
      "src/frontier/views/Grill.tsx",
      "src/frontier/views/LinearSettings.tsx",
      "src/frontier/views/NewTask.tsx",
      "src/frontier/app/FrontierApp.tsx",
      "src/frontier/runtime/live-gateway.ts",
      "src/frontier/fixtures/gateway.ts",
      "src/api.ts",
    ],
  );
});
