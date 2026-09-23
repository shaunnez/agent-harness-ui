import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createApiServer } from "./api.mjs";
import { createLinearClient } from "./integrations/linear-client.mjs";
import { LinearIntake, readLinearConfig } from "./integrations/linear-intake.mjs";
import { createLinearWebhookServer } from "./integrations/linear-webhook.mjs";
import { TaskOrchestrator } from "./orchestrator.mjs";
import { startPullRequestPolling } from "./pull-request-poller.mjs";
import { ClaudeCliRolesResearchRuntime } from "./research/claude-cli/roles-runtime.mjs";
import { ClaudeCliResearchRuntime } from "./research/claude-cli/runtime.mjs";
import { CodexCliResearchRuntime } from "./research/codex-cli/runtime.mjs";
import { FakeResearchRuntime } from "./research/fake-research-runtime.mjs";
import { createResearchRuntimeRegistry } from "./research/research-runtime-registry.mjs";
import { ResearchService } from "./research/research-service.mjs";
import { ResearchStore } from "./research/research-store.mjs";
import { acquireRuntimeLock } from "./runtime-lock.mjs";
import { SqliteTaskStore } from "./sqlite-store.mjs";
import { JsonTaskStore } from "./store.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataPath = process.env.AGENT_HARNESS_DATA ?? path.join(root, ".data", "tasks.json");
const databasePath =
  process.env.AGENT_HARNESS_DATABASE ??
  (dataPath.toLowerCase().endsWith(".json") ? `${dataPath.slice(0, -5)}.sqlite3` : `${dataPath}.sqlite3`);
const configuredRepository = process.env.AGENT_HARNESS_REPOSITORY;
const suggestedRepository = configuredRepository ?? root;
const port = Number(process.env.AGENT_HARNESS_PORT ?? 4310);

const jsonStore = process.env.AGENT_HARNESS_STORE === "json";
const linearConfig = await readLinearConfig(process.env.AGENT_HARNESS_LINEAR_CONFIG);
const linearPort = Number(process.env.AGENT_HARNESS_LINEAR_PORT ?? 4311);
if (
  linearConfig &&
  (jsonStore ||
    !process.env.LINEAR_CLIENT_SECRET ||
    !process.env.LINEAR_WEBHOOK_SECRET ||
    !Number.isInteger(linearPort) ||
    linearPort < 1 ||
    linearPort > 65535 ||
    linearPort === port)
) {
  throw new Error(
    "Linear intake requires SQLite, LINEAR_CLIENT_SECRET, LINEAR_WEBHOOK_SECRET, and a dedicated valid port.",
  );
}

// The store recovers interrupted runs during init, before the HTTP listener can reveal a
// duplicate process through EADDRINUSE. Own the store first so a second companion cannot
// rewrite live task state or start a second set of process-local coordinators.
const runtimeLock = await acquireRuntimeLock(jsonStore ? dataPath : databasePath);
const store = jsonStore
  ? new JsonTaskStore(dataPath, { singleProcessLock: true })
  : new SqliteTaskStore(databasePath, { legacyJsonPath: dataPath });
try {
  await store.init();
} catch (error) {
  await Promise.resolve(store.close?.()).catch(() => undefined);
  await runtimeLock.release().catch(() => undefined);
  throw error;
}
const orchestrator = new TaskOrchestrator(store);
try {
  await orchestrator.recoverMergeIntents();
} catch (error) {
  await store.close?.();
  await runtimeLock.release();
  throw error;
}
// The research plane needs the SQLite tables, so the legacy JSON store simply has no research
// surface. Nothing else changes for that configuration.
// `fake` remains the default (`DEFAULT_RESEARCH_RUNTIME_ID`); registering a runtime alongside
// it only makes that runtime *selectable* by an explicit `runtimeId` on the request, it does
// not change what an ordinary request without one gets (architecture §11 slice 2).
//
// `claude-cli` is registered and deliberately not made the default. It is the runtime with 28
// cost bands behind it, but it is not the default until phase 2 has measured whether one agent
// or four roles wins, and until it has served real reviewed work (consolidation plan, phase 4).
// It is also the only live research engine: the Deep Agents runtime was retired on 23 September
// 2026 and what it did well moved into `claude-cli` (host-owned tools, checked citations).
// `codex-cli` is the same recipe and harness on the ChatGPT plan, with GPT-6 Sol by default;
// it has no baseline of its own yet, so nothing selects it unless a request names it.
const researchService = jsonStore
  ? null
  : new ResearchService({
      store: new ResearchStore(store.databaseHandle()),
      // Settings → Research agent picks the engine and model for a run that names neither.
      settings: () => store.settings(),
      registry: createResearchRuntimeRegistry([
        new FakeResearchRuntime(),
        new ClaudeCliResearchRuntime(),
        new CodexCliResearchRuntime(),
        new ClaudeCliRolesResearchRuntime(),
      ]),
    });
const configuredPullRequestPollIntervalMs = Number(process.env.AGENT_HARNESS_GITHUB_POLL_MS ?? 30_000);
const pullRequestPollIntervalMs = Number.isFinite(configuredPullRequestPollIntervalMs)
  ? Math.max(5_000, configuredPullRequestPollIntervalMs)
  : 30_000;
let stopPullRequestPolling = () => {};
const linearIntake = linearConfig
  ? new LinearIntake({
      store,
      orchestrator,
      config: linearConfig,
      client: createLinearClient({
        clientId: linearConfig.clientId,
        clientSecret: process.env.LINEAR_CLIENT_SECRET,
      }),
    })
  : null;
const linearServer = linearIntake
  ? createLinearWebhookServer({
      intake: linearIntake,
      signingSecret: process.env.LINEAR_WEBHOOK_SECRET,
    })
  : null;

const server = createApiServer({
  store,
  orchestrator,
  suggestedRepository,
  researchService,
  linearIntake,
  reportHttpMetric(metric) {
    if (
      process.env.AGENT_HARNESS_HTTP_METRICS === "1" ||
      metric.durationMs >= 50 ||
      metric.responseBytes >= 250_000
    ) {
      console.info(JSON.stringify({ event: "http_response", ...metric }));
    }
  },
});

server.once("error", async (error) => {
  console.error("Agent Harness local runtime failed.", error);
  await shutdown(1);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Agent Harness local runtime listening on http://127.0.0.1:${port}`);
  if (linearServer) {
    linearServer.once("error", async () => {
      console.error("Linear webhook listener failed to start; stopping this companion.");
      await shutdown(1);
    });
    linearServer.listen(linearPort, "127.0.0.1", () => {
      console.log(`Linear webhook listener: http://127.0.0.1:${linearPort}/linear/webhook`);
      linearIntake.start();
    });
  }
  stopPullRequestPolling = startPullRequestPolling(orchestrator, {
    intervalMs: pullRequestPollIntervalMs,
  });
});

let shuttingDown = false;
async function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  stopPullRequestPolling();
  const linearClosed = linearServer?.listening
    ? new Promise((resolve) => linearServer.close(resolve))
    : Promise.resolve();
  await linearIntake?.stop();
  await linearClosed;
  const serverClosed = server.listening
    ? new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      })
    : Promise.resolve();
  const failures = [];
  // Research runs are cancelled before the store closes, so an in-flight run cannot outlive
  // the companion or write to a handle that has already gone.
  const [orchestratorResult, serverResult, researchResult] = await Promise.allSettled([
    orchestrator.shutdown(),
    serverClosed,
    researchService?.shutdown() ?? Promise.resolve(),
  ]);
  if (orchestratorResult.status === "rejected") failures.push(orchestratorResult.reason);
  if (serverResult.status === "rejected") failures.push(serverResult.reason);
  if (researchResult.status === "rejected") failures.push(researchResult.reason);
  try {
    await store.close?.();
  } catch (error) {
    failures.push(error);
  }
  try {
    await runtimeLock.release();
  } catch (error) {
    failures.push(error);
  }
  for (const failure of failures) console.error("Failed to stop the local runtime cleanly.", failure);
  process.exitCode = failures.length ? 1 : exitCode;
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    void shutdown(0);
  });
}
