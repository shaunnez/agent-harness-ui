import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createApiServer } from "./api.mjs";
import { TaskOrchestrator } from "./orchestrator.mjs";
import { JsonTaskStore } from "./store.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataPath = process.env.AGENT_HARNESS_DATA ?? path.join(root, ".data", "tasks.json");
const configuredRepository = process.env.AGENT_HARNESS_REPOSITORY;
const suggestedRepository = configuredRepository ?? root;
const port = Number(process.env.AGENT_HARNESS_PORT ?? 4310);

const store = new JsonTaskStore(dataPath);
await store.init();
const orchestrator = new TaskOrchestrator(store);
const server = createApiServer({ store, orchestrator, suggestedRepository });

server.listen(port, "127.0.0.1", () => {
  console.log(`Agent Harness local runtime listening on http://127.0.0.1:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
