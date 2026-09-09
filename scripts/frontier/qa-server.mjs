import { createIsolatedApi } from "./isolated-api.mjs";

const provider = process.argv.includes("--codex") ? "codex" : "fixture";
const rootIndex = process.argv.indexOf("--root");
const api = await createIsolatedApi({
  provider,
  port: Number(process.env.FRONTIER_QA_PORT ?? (provider === "codex" ? 4321 : 4322)),
  root: rootIndex >= 0 ? process.argv[rootIndex + 1] : undefined,
});
console.log(
  JSON.stringify({
    mode: provider === "codex" ? "actual-codex-isolated" : "deterministic-api-fixture",
    root: api.root,
    repositoryPath: api.repositoryPath,
    databasePath: api.databasePath,
    origin: api.origin,
  }),
);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await api.close();
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
