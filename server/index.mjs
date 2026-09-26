import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createApiServer } from "./api.mjs";
import { createLinearClient } from "./integrations/linear-client.mjs";
import { LinearIntake, readLinearConfig } from "./integrations/linear-intake.mjs";
import { createLinearWebhookServer } from "./integrations/linear-webhook.mjs";
import { TaskOrchestrator } from "./orchestrator.mjs";
import { withProjectKind } from "./project-policy.mjs";
import { startPullRequestPolling } from "./pull-request-poller.mjs";
import { API_LOOP_KEY_VARS } from "./research/api-loop/providers.mjs";
import { ApiLoopResearchRuntime } from "./research/api-loop/runtime.mjs";
import { FakeResearchRuntime } from "./research/fake-research-runtime.mjs";
import { ResearchQuestionService } from "./research/research-question-service.mjs";
import { ResearchQuestionStore } from "./research/research-question-store.mjs";
import { createResearchRuntimeRegistry } from "./research/research-runtime-registry.mjs";
import { ResearchScoper } from "./research/research-scope.mjs";
import { ResearchService } from "./research/research-service.mjs";
import { ResearchStore } from "./research/research-store.mjs";
import { acquireRuntimeLock } from "./runtime-lock.mjs";
import { SqliteTaskStore } from "./sqlite-store.mjs";
import { createStaticUi } from "./static-ui.mjs";
import { JsonTaskStore } from "./store.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataPath = process.env.AGENT_HARNESS_DATA ?? path.join(root, ".data", "tasks.json");
const databasePath =
  process.env.AGENT_HARNESS_DATABASE ??
  (dataPath.toLowerCase().endsWith(".json") ? `${dataPath.slice(0, -5)}.sqlite3` : `${dataPath}.sqlite3`);
const configuredRepository = process.env.AGENT_HARNESS_REPOSITORY;
const suggestedRepository = configuredRepository ?? root;
const port = Number(process.env.AGENT_HARNESS_PORT ?? 4310);
// Loopback unless told otherwise. A container sets 0.0.0.0 because its own loopback is not
// reachable from outside it; the container runtime then publishes the port to the host's
// loopback only (see compose.yaml). Never set this on a machine whose other interfaces are
// reachable: the Host check below is not an access control against a client that lies.
const bindHost = process.env.AGENT_HARNESS_HOST ?? "127.0.0.1";
const linearBindHost = process.env.AGENT_HARNESS_LINEAR_HOST ?? "127.0.0.1";
// The built UI is served from the companion's own origin when a build exists. `npm run
// dev:frontier` is unaffected: Vite keeps serving source on 5199 and proxies `/api` here.
const staticUi =
  process.env.AGENT_HARNESS_UI_DIR === "off"
    ? null
    : await createStaticUi(process.env.AGENT_HARNESS_UI_DIR ?? path.join(root, "dist", "frontier"));

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
// `api-loop` is the only research engine (Shaun, 26 September 2026): DeepSeek 4.1 Flash with no
// CLI, the companion calling the chat API itself with a key from its own environment
// (OPENCODE_API_KEY, FIREWORKS_API_KEY or BASETEN_API_KEY, and PARALLEL_API_KEY for search), and the host checking
// each answer. The eval's best arm (A10: 10 of 15 held-out questions against Opus 5.5's 5). The
// Claude, Codex, OpenCode, pack and four-role research runtimes are retired; the Claude and Codex
// CLIs still run every delivery stage. `fake` stays for tests and fixture runs.
// The API loop's keys are taken out of this process's environment before anything is spawned, so
// no delivery agent, CLI or repository test command started from here can inherit them. Only the
// API-loop runtime holds them; it starts no child process.
const apiLoopEnv = { ...process.env };
for (const name of [...API_LOOP_KEY_VARS, "PARALLEL_API_KEY"]) delete process.env[name];
const researchStore = jsonStore ? null : new ResearchStore(store.databaseHandle());
const researchService = jsonStore
  ? null
  : new ResearchService({
      store: researchStore,
      // Settings → Research agent picks the engine and model for a run that names neither.
      settings: () => store.settings(),
      registry: createResearchRuntimeRegistry([
        new FakeResearchRuntime(),
        new ApiLoopResearchRuntime({ env: apiLoopEnv }),
      ]),
    });
await researchService?.recoverInterrupted();
// Questions group one or three runs under a research project; they add no runtime of their own.
const researchQuestions = researchService
  ? new ResearchQuestionService({
      questions: new ResearchQuestionStore(store.databaseHandle()),
      research: researchService,
      runs: researchStore,
      projects: async () => (await store.listProjects()).map(withProjectKind),
      scoper: new ResearchScoper({ env: apiLoopEnv }),
    })
  : null;
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
  researchQuestions,
  linearIntake,
  staticUi,
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

server.listen(port, bindHost, () => {
  console.log(`Agent Harness local runtime listening on http://${bindHost}:${port}`);
  if (staticUi) console.log(`Frontier UI served at http://127.0.0.1:${port}/`);
  if (linearServer) {
    linearServer.once("error", async () => {
      console.error("Linear webhook listener failed to start; stopping this companion.");
      await shutdown(1);
    });
    linearServer.listen(linearPort, linearBindHost, () => {
      console.log(`Linear webhook listener: http://${linearBindHost}:${linearPort}/linear/webhook`);
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
