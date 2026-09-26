// The research service's configuration, read once from its environment and checked before it
// starts. Anything unsafe for customer tender text fails here, loudly, rather than at the first
// batch.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveApiModel } from "@eversor/research-engine/api-loop/providers.mjs";
import { API_LOOP_RESEARCH_MODELS } from "@eversor/research-engine/engine/contracts/policies.ts";

/** Fireworks' US-only endpoint, under evaluation as the production provider (F10). */
export const DEFAULT_SERVICE_MODEL = "fireworks-us/accounts/fireworks/routers/deepseek-v4p1-flash-us";

/** Providers that keep DeepSeek traffic inside the US. OpenCode Go is for testing and may route
 *  to DeepSeek's own infrastructure, so tender text never goes there; DeepSeek's own API is not a
 *  provider at all. */
export const US_PROVIDERS = Object.freeze(["fireworks-us", "baseten"]);

const RUN_COUNTS = new Set([1, 3, 5]);

export function loadConfig(env = process.env) {
  const problems = [];
  const host = env.RESEARCH_SERVICE_HOST ?? "127.0.0.1";
  const port = integer(env.RESEARCH_SERVICE_PORT, 4400, problems, "RESEARCH_SERVICE_PORT", {
    min: 0,
    max: 65535,
  });
  const databaseUrl = env.RESEARCH_DATABASE_URL ?? "";
  if (!databaseUrl)
    problems.push("Set RESEARCH_DATABASE_URL (postgres://…, or pglite:<directory> to run locally).");

  const model = env.RESEARCH_MODEL ?? DEFAULT_SERVICE_MODEL;
  let providerId = null;
  try {
    providerId = resolveApiModel(model).providerId;
  } catch (error) {
    problems.push(`RESEARCH_MODEL: ${error.message}`);
  }
  // Settings would read an unlisted model as the default, which is OpenCode Go's; refuse it here.
  if (providerId && !API_LOOP_RESEARCH_MODELS.some((entry) => entry.id === model))
    problems.push(`RESEARCH_MODEL ${model} is not one of the API loop's research models.`);
  if (providerId && !US_PROVIDERS.includes(providerId))
    problems.push(
      `RESEARCH_MODEL uses ${providerId}. The research service sends tender text, so it runs only on a US-hosted provider: ${US_PROVIDERS.join(" or ")}.`,
    );

  const clients = parseClients(env.RESEARCH_SERVICE_CLIENTS ?? "", problems);
  const minRuns = integer(env.RESEARCH_MIN_CONCURRENT_RUNS, 1, problems, "RESEARCH_MIN_CONCURRENT_RUNS", {
    min: 1,
  });
  const maxRuns = integer(env.RESEARCH_MAX_CONCURRENT_RUNS, 6, problems, "RESEARCH_MAX_CONCURRENT_RUNS", {
    min: 1,
  });
  const initialRuns = integer(
    env.RESEARCH_INITIAL_CONCURRENT_RUNS,
    Math.min(3, maxRuns),
    problems,
    "RESEARCH_INITIAL_CONCURRENT_RUNS",
    {
      min: 1,
    },
  );
  if (minRuns > maxRuns) problems.push("RESEARCH_MIN_CONCURRENT_RUNS is above RESEARCH_MAX_CONCURRENT_RUNS.");
  const runsPerQuestion = integer(env.RESEARCH_RUNS_PER_QUESTION, 5, problems, "RESEARCH_RUNS_PER_QUESTION");
  if (!RUN_COUNTS.has(runsPerQuestion)) problems.push("RESEARCH_RUNS_PER_QUESTION must be 5, 3 or 1.");
  const dataDirectory = path.resolve(env.RESEARCH_DATA_DIR ?? ".data");

  if (problems.length) {
    const error = new Error(`The research service cannot start:\n- ${problems.join("\n- ")}`);
    error.problems = problems;
    throw error;
  }
  return Object.freeze({
    host,
    port,
    databaseUrl,
    model,
    provider: providerId,
    clients,
    // The review console's routes carry no sign-in yet (Phase 5), so they answer only on a
    // loopback listener. PlanCheck's batch routes take a client token wherever the service runs.
    consoleEnabled: isLoopback(host),
    pacing: { min: minRuns, max: maxRuns, initial: Math.min(Math.max(initialRuns, minRuns), maxRuns) },
    runsPerQuestion,
    project: {
      id: env.RESEARCH_PROJECT_ID ?? "plancheck",
      name: env.RESEARCH_PROJECT_NAME ?? "PlanCheck",
    },
    workerIntervalMs: integer(env.RESEARCH_WORKER_INTERVAL_MS, 2_000, [], "", { min: 100 }),
    dataDirectory,
    // The built review console; the same place relative to this file in the repo and in the image.
    consoleDirectory: path.resolve(
      env.RESEARCH_CONSOLE_DIR ?? fileURLToPath(new URL("../../../dist/research-console/", import.meta.url)),
    ),
    sourceSnapshotDirectory: path.join(dataDirectory, "research-sources"),
    transcriptDirectory: path.join(dataDirectory, "research-transcripts"),
  });
}

/** `name:sha256hex` pairs, comma separated. Only the hash of a client's token is configured, so
 *  the service's environment never holds a credential PlanCheck could be impersonated with. */
function parseClients(value, problems) {
  const clients = [];
  for (const entry of value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)) {
    const match = entry.match(/^([a-z][a-z0-9-]{0,39}):([0-9a-f]{64})$/);
    if (!match) {
      problems.push("RESEARCH_SERVICE_CLIENTS entries are name:sha256-of-token (64 lower-case hex digits).");
      continue;
    }
    clients.push({ name: match[1], tokenSha256: match[2] });
  }
  if (!clients.length)
    problems.push(
      "Set RESEARCH_SERVICE_CLIENTS to at least one name:sha256 pair; `npm run client-token -w @eversor/research-service` makes one.",
    );
  return Object.freeze(clients);
}

function integer(value, fallback, problems, name, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value == null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    problems.push(`${name} must be a whole number from ${min} to ${max}.`);
    return fallback;
  }
  return number;
}

export function isLoopback(host) {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}
