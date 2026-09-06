import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createApiServer } from "../../server/api.mjs";
import { GitWorktreeManager } from "../../server/git-worktree.mjs";
import { TaskOrchestrator } from "../../server/orchestrator.mjs";
import { acquireRuntimeLock } from "../../server/runtime-lock.mjs";
import { SqliteTaskStore } from "../../server/sqlite-store.mjs";

const exec = promisify(execFile);
export const fixtureQuestionOutput = `# Revision comparison\n\nThe repository compares labels without normalisation.\n<grill-questions>{"questions":[{"question":"Should revision labels be normalised before comparison?","whyItMatters":"The current function uses exact equality; the repository does not define whitespace or case policy.","options":[{"label":"Normalise labels","description":"Trim whitespace and compare case-insensitively, retaining original display labels.","recommended":true},{"label":"Use exact labels","description":"Retain case and whitespace differences.","recommended":false}],"allowCustom":true}]}</grill-questions>`;

export async function createIsolatedApi({ port = 0, root: existingRoot, provider = "fixture" } = {}) {
  if (provider !== "fixture" && provider !== "codex")
    throw new Error("Choose fixture or codex provider explicitly.");
  // Existing roots require our ownership marker; no arbitrary database/repository override.
  const root = existingRoot ?? (await mkdtemp(path.join(os.tmpdir(), `mission-frontier-${provider}-`)));
  const marker = path.join(root, "frontier-isolated.json");
  const repositoryPath = path.join(root, "repository");
  const databasePath = path.join(root, "data", "tasks.sqlite3");
  if (existingRoot) {
    const ownership = JSON.parse(await readFile(marker, "utf8"));
    if (ownership.provider !== provider || ownership.root !== root)
      throw new Error("The isolated runtime ownership marker does not match.");
  } else {
    await mkdir(repositoryPath);
    await writeFile(
      path.join(repositoryPath, "README.md"),
      "# Revision label comparison\n\nA small disposable repository for the Mission Frontier investigation smoke.\nThe application compares revision labels exactly today. A policy for whitespace and letter case has not been chosen.\n",
    );
    await writeFile(
      path.join(repositoryPath, "revision.mjs"),
      "export function sameRevision(left, right) { return left === right; }\n",
    );
    await writeFile(
      path.join(repositoryPath, "revision.test.mjs"),
      "import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport {sameRevision} from './revision.mjs';\ntest('identical labels match', () => assert.equal(sameRevision('A1', 'A1'), true));\n",
    );
    await writeFile(
      path.join(repositoryPath, "AGENTS.md"),
      "# Investigation repository\nRead the repository to ground your conclusions. This is an investigate-only smoke: do not change files, publish, create PRs or implement code. A revision comparison product policy remains unsettled; ask a concise material question if needed.\n",
    );
    await exec("git", ["init", "-b", "main"], { cwd: repositoryPath });
    await exec("git", ["add", "README.md", "revision.mjs", "revision.test.mjs", "AGENTS.md"], {
      cwd: repositoryPath,
    });
    await exec(
      "git",
      [
        "-c",
        "user.name=Frontier QA",
        "-c",
        "user.email=frontier-qa@localhost",
        "commit",
        "-m",
        "Create disposable investigation fixture",
      ],
      { cwd: repositoryPath },
    );
    await writeFile(
      marker,
      JSON.stringify(
        { root, provider, repositoryPath, databasePath, createdAt: new Date().toISOString() },
        null,
        2,
      ),
    );
  }
  const lock = await acquireRuntimeLock(databasePath);
  const store = new SqliteTaskStore(databasePath, { legacyJsonPath: path.join(root, "data", "tasks.json") });
  try {
    await store.init();
  } catch (error) {
    await lock.release();
    throw error;
  }
  const orchestrator = new TaskOrchestrator(store, {
    worktreeManager: new GitWorktreeManager(path.join(root, "worktrees")),
    ...(provider === "fixture"
      ? {
          getStatus: async () => ({
            available: true,
            authenticated: true,
            authMethod: "deterministic-fixture",
            message: "Isolated API fixture. No model provider is called.",
          }),
          runCodex: async ({ prompt, onEvent }) => {
            onEvent?.({
              type: "activity",
              tone: "info",
              title: "Deterministic provider fixture",
              detail: "No real model ran for this API scenario.",
            });
            return {
              finalText: prompt.includes("<grill-questions>")
                ? fixtureQuestionOutput
                : prompt.includes("<scout-report>")
                  ? '<scout-report>{"status":"ok","findings":[{"file":"revision.mjs","line":1,"fact":"sameRevision uses strict equality.","confidence":"high"}],"uncertainties":[]}</scout-report>'
                  : "# Investigation evidence\n\nThe disposable repository's `revision.mjs` compares labels using strict equality.\n\n## Acceptance criteria\n\n- Retain display labels.\n- Apply the recorded operator decision to comparison.\n- Verify identical labels and missing values.\n\nDeterministic API fixture; no model has executed.",
              usage: { inputTokens: 100, cachedInputTokens: 40, outputTokens: 30, totalTokens: 130 },
            };
          },
        }
      : {}),
  });
  if (!(await store.listProjects()).length)
    await store.createProject({
      name: provider === "fixture" ? "Frontier API fixture" : "Frontier live smoke",
      repositoryPath,
    });
  const metrics = [];
  const server = createApiServer({
    store,
    orchestrator,
    suggestedRepository: repositoryPath,
    reportHttpMetric: (metric) => metrics.push(metric),
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  return {
    root,
    repositoryPath,
    databasePath,
    provider,
    origin,
    store,
    orchestrator,
    server,
    metrics,
    async close() {
      await orchestrator.shutdown();
      await new Promise((resolve) => server.close(resolve));
      store.close();
      await lock.release();
    },
  };
}
