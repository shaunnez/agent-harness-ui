// One selected model for the service, shared by all workers in its Postgres database. A new
// question reads it once and pins that model to all of its runs, including later staged runs.

import { resolveApiModel } from "@eversor/research-engine/api-loop/providers.mjs";
import { API_LOOP_RESEARCH_MODELS } from "@eversor/research-engine/engine/contracts/policies.ts";
import { APPROVED_PROVIDERS } from "./config.mjs";

export const SERVICE_MODELS = Object.freeze(
  API_LOOP_RESEARCH_MODELS.filter((entry) =>
    APPROVED_PROVIDERS.includes(resolveApiModel(entry.id).providerId),
  ).map(({ id, label }) => ({ id, label })),
);

export function approvedModel(model) {
  const entry = SERVICE_MODELS.find((candidate) => candidate.id === model);
  if (!entry) {
    const error = new Error("Choose a model approved for the research service.");
    error.statusCode = 400;
    throw error;
  }
  return entry;
}

export class ModelSettings {
  #db;
  #defaultModel;

  constructor(db, defaultModel) {
    this.#db = db;
    this.#defaultModel = approvedModel(defaultModel).id;
  }

  async selected() {
    const { rows } = await this.#db.query("SELECT model FROM research_service_settings WHERE id = 1");
    return approvedModel(rows[0]?.model ?? this.#defaultModel).id;
  }

  async select(model) {
    approvedModel(model);
    await this.#db.query(
      `INSERT INTO research_service_settings (id, model) VALUES (1, $1)
       ON CONFLICT (id) DO UPDATE SET model = EXCLUDED.model`,
      [model],
    );
    return model;
  }

  async choices(env) {
    const selected = await this.selected();
    return {
      selected,
      models: SERVICE_MODELS.map((entry) => {
        const { provider } = resolveApiModel(entry.id);
        return { ...entry, configured: Boolean(env[provider.keyEnv]) };
      }),
    };
  }
}
