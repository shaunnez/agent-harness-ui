import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createApiServer } from "./api.mjs";
import { TaskOrchestrator } from "./orchestrator.mjs";
import { startPullRequestPolling } from "./pull-request-poller.mjs";
import { JsonTaskStore } from "./store.mjs";
import { SqliteTaskStore } from "./sqlite-store.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataPath = process.env.AGENT_HARNESS_DATA ?? path.join(root, ".data", "tasks.json");
const databasePath =
  process.env.AGENT_HARNESS_DATABASE ??
  (dataPath.toLowerCase().endsWith(".json") ? `${dataPath.slice(0, -5)}.sqlite3` : `${dataPath}.sqlite3`);
const configuredRepository = process.env.AGENT_HARNESS_REPOSITORY;
const suggestedRepository = configuredRepository ?? root;
const port = Number(process.env.AGENT_HARNESS_PORT ?? 4310);

const store =
  process.env.AGENT_HARNESS_STORE === "json"
    ? new JsonTaskStore(dataPath, { singleProcessLock: true })
    : new SqliteTaskStore(databasePath, { legacyJsonPath: dataPath });
await store.init();
const orchestrator = new TaskOrchestrator(store);
try {
  await orchestrator.recoverMergeIntents();
} catch (error) {
  await store.close?.();
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
  stopPullRequestPolling();
  await Promise.resolve(store.close?.()).catch((closeError) =>
    console.error("Failed to close the task store after a server error.", closeError),
  );
  console.error("Agent Harness local runtime failed.", error);
  process.exit(1);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Agent Harness local runtime listening on http://127.0.0.1:${port}`);
  stopPullRequestPolling = startPullRequestPolling(orchestrator, {
    intervalMs: pullRequestPollIntervalMs,
  });
});

let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    stopPullRequestPolling();
    server.close(async () => {
      try {
        await store.close?.();
        process.exit(0);
      } catch (error) {
        console.error("Failed to close the task store cleanly.", error);
        process.exit(1);
      }
    });
  });
}
