// The research service's entry point: `npm start -w @eversor/research-service`.
//
// The provider and search keys are copied out of this process's environment and then deleted
// from it before anything starts, so the only children research ever runs (`pdftotext`, and the
// PlanCheck token command until PlanCheck issues a service credential) never inherit them. Only
// the API loop and the scoper are given the copy.

import { API_LOOP_KEY_VARS } from "@eversor/research-engine/api-loop/providers.mjs";
import { createResearchServiceApp } from "./app.mjs";
import { loadConfig } from "./config.mjs";

function log(message, fields = {}) {
  console.log(JSON.stringify({ at: new Date().toISOString(), message, ...fields }));
}

let config;
try {
  config = loadConfig(process.env);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const env = { ...process.env };
for (const name of [...API_LOOP_KEY_VARS, "PARALLEL_API_KEY"]) delete process.env[name];

const app = await createResearchServiceApp({ config, env, log });
const address = await app.listen();
log("research service listening", {
  host: address.address,
  port: address.port,
  database: app.db.kind,
  model: config.model,
  pacing: app.pacer.snapshot(),
  console: config.consoleEnabled ? "loopback" : "off",
  clients: config.clients.map((client) => client.name),
});

let closing = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    if (closing) return;
    closing = true;
    log("research service stopping", { signal });
    await app.close().catch((error) => log("stop failed", { error: error.message }));
    process.exit(0);
  });
