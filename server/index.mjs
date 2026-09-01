import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createApiServer } from "./api.mjs";
import { TaskOrchestrator } from "./orchestrator.mjs";
import { startPullRequestPolling } from "./pull-request-poller.mjs";
import { JsonTaskStore } from "./store.mjs";
import { SqliteTaskStore } from "./sqlite-store.mjs";
import { acquireRuntimeLock } from "./runtime-lock.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataPath = process.env.AGENT_HARNESS_DATA ?? path.join(root, ".data", "tasks.json");
const databasePath =
  process.env.AGENT_HARNESS_DATABASE ??
  (dataPath.toLowerCase().endsWith(".json") ? `${dataPath.slice(0, -5)}.sqlite3` : `${dataPath}.sqlite3`);
const configuredRepository = process.env.AGENT_HARNESS_REPOSITORY;
const suggestedRepository = configuredRepository ?? root;
const port = Number(process.env.AGENT_HARNESS_PORT ?? 4310);

const jsonStore = process.env.AGENT_HARNESS_STORE === "json";
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
const configuredPullRequestPollIntervalMs = Number(process.env.AGENT_HARNESS_GITHUB_POLL_MS ?? 30_000);
const pullRequestPollIntervalMs = Number.isFinite(configuredPullRequestPollIntervalMs)
  ? Math.max(5_000, configuredPullRequestPollIntervalMs)
  : 30_000;
let stopPullRequestPolling = () => {};
const server = createApiServer({
  store,
  orchestrator,
  suggestedRepository,
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
  stopPullRequestPolling = startPullRequestPolling(orchestrator, {
    intervalMs: pullRequestPollIntervalMs,
  });
});

let shuttingDown = false;
async function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  stopPullRequestPolling();
  const serverClosed = server.listening
    ? new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      })
    : Promise.resolve();
  const failures = [];
  const [orchestratorResult, serverResult] = await Promise.allSettled([
    orchestrator.shutdown(),
    serverClosed,
  ]);
  if (orchestratorResult.status === "rejected") failures.push(orchestratorResult.reason);
  if (serverResult.status === "rejected") failures.push(serverResult.reason);
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
