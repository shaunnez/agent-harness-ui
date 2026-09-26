// Shared set-up for the research engine tests: an API-loop runtime whose model is a script, whose
// QV is a local stand-in for PlanCheck's rate library, and whose web is a fixture. Nothing here
// reaches a provider or the network, and the only key is a test value.
//
// The API loop is the only research runtime left, so it is how the shared lifecycle in
// `server/research/engine/hosted-runtime.mjs` (queue, host session, citation checks, transcript
// scan) is exercised end to end.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { ApiLoopResearchRuntime } from "@eversor/research-engine/api-loop/runtime.mjs";

export const KEY = "sk-test-opencode-key-1234567890";
export const SHA = "b".repeat(64);
export const ROW_ID = `${SHA}:t2:r3`;
export const PAGE_URL = "https://supplier.example.test/connection";
export const PAGE_TEXT =
  "Standard stormwater connection: $310 per metre installed, excluding traffic management.";

/** One PlanCheck library row, whose QV id (the first source row) is `ROW_ID`. */
export const PLANCHECK_ROW = Object.freeze({
  id: "uuid-row",
  trade: "Drainage",
  section: "Channel drains",
  group_label: "Proprietary channel",
  description: "Proprietary channel and grate",
  unit: "m",
  regional_values: { Auckland: { low: 330, high: 330 } },
  provenance: { url: "https://costbuilder.qv.co.nz/drainage/", snapshot_sha256: SHA, source_rows: [ROW_ID] },
  review_status: "unreviewed",
});

export const BUDGET = Object.freeze({
  maxRuntimeMs: 30_000,
  maxResearchers: 1,
  maxConcurrentResearchers: 1,
  maxDepth: 1,
  maxModelCalls: 20,
  maxToolCalls: 20,
  maxSearchCalls: 10,
});

/** The web as the host's `fetch_source` sees it: one public address, one page. */
export const FIXTURE_WEB = Object.freeze({
  lookup: async () => [{ address: "93.184.216.34", family: 4 }],
  fetchImpl: async () =>
    new Response(`<html><head><title>Supplier rates</title></head><body><p>${PAGE_TEXT}</p></body></html>`, {
      headers: { "content-type": "text/html" },
    }),
});

export const reply = (message, usage = { prompt_tokens: 1000, completion_tokens: 100 }) => ({
  choices: [{ message, finish_reason: message.tool_calls ? "tool_calls" : "stop" }],
  usage,
});

export const toolCall = (id, name, args) => ({
  id,
  type: "function",
  function: { name, arguments: JSON.stringify(args) },
});

export const fenced = (answer) => `\`\`\`json\n${JSON.stringify(answer)}\n\`\`\``;

/** A cost-band answer in the recipe's schema around the given components. */
export function answerWith(components) {
  return {
    id: "fixture",
    resolved_from: "qv+web",
    confidence: "medium",
    components: components.map((component) => ({ unit: "m", centre: "Auckland", ...component })),
    band: { unit: "m", low: 600, high: 740, centre: "Auckland", basis: "Fixture." },
    not_established: [],
    qv_queries_tried: ["channel drain"],
  };
}

/**
 * A model that follows a script. `step(index, body)` returns the reply for the run's `index`th
 * model call (a reply, `{status}` for an HTTP failure, or a promise of either). A step function
 * rather than a list, so the host sending an answer back for review is answered too, and so
 * several runs can share one model. Records every request body, and counts runs by session.
 */
export function scriptedModel(step) {
  const requests = [];
  const perSession = new Map();
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    const session = init.headers["x-opencode-session"];
    const index = perSession.get(session) ?? 0;
    perSession.set(session, index + 1);
    const next = await step(index, body);
    if (next?.status) return new Response(next.body ?? "{}", { status: next.status });
    return Response.json(next);
  };
  /** How many runs reached the model: the loop sends one session id per run. */
  return { fetchImpl, requests, sessions: () => perSession.size };
}

/** Tools first, then the answer, however many times the host asks for it. */
export function toolsThenAnswer(calls, answer) {
  return (index) =>
    index === 0 ? reply({ content: "", tool_calls: calls }) : reply({ content: fenced(answer) });
}

/** A stand-in for PlanCheck's local rate library: every search returns `rows`. */
export async function withPlanCheck(body, { rows = [PLANCHECK_ROW] } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "research-hosted-"));
  const tokenFile = path.join(directory, "token");
  await writeFile(tokenFile, "test-token\n");
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    response.setHeader("content-type", "application/json");
    if (url.pathname.endsWith("/facets")) return response.end(JSON.stringify({ sections: [] }));
    response.end(JSON.stringify({ rows, next_cursor: null }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await body({ directory, tokenFile, api: `http://127.0.0.1:${server.address().port}` });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
}

/** The env a run needs: a model key, and PlanCheck as the QV source. */
export function runtimeEnv({ api, tokenFile }, extra = {}) {
  return {
    OPENCODE_API_KEY: KEY,
    RESEARCH_QV_SOURCE: "plancheck",
    RESEARCH_PLANCHECK_API: api,
    RESEARCH_PLANCHECK_TOKEN_FILE: tokenFile,
    ...extra,
  };
}

export const NO_SEARCH = Object.freeze({
  search: async () => ({ results: [], metadata: { provider: "stub" } }),
});

/** An API-loop runtime over `withPlanCheck`, the fixture web and a scripted model. */
export async function withApiLoopRuntime(
  body,
  { step, env = {}, webToolsOptions = {}, captureProvider = null, maxConcurrentRuns } = {},
) {
  return withPlanCheck(async (planCheck) => {
    const model = scriptedModel(step);
    const runtime = new ApiLoopResearchRuntime({
      env: runtimeEnv(planCheck, env),
      fetchImpl: model.fetchImpl,
      webToolsOptions: { ...FIXTURE_WEB, searchProvider: NO_SEARCH, ...webToolsOptions },
      captureProvider,
      transcriptDirectory: path.join(planCheck.directory, "transcripts"),
      sourceSnapshotDirectory: path.join(planCheck.directory, "sources"),
      ...(maxConcurrentRuns ? { maxConcurrentRuns } : {}),
    });
    return body({ runtime, model, directory: planCheck.directory });
  });
}

export function runRequest(id, budget = {}) {
  return {
    id,
    objective: "Price the pinned stormwater scope.",
    profile: "standard",
    context: [],
    budget: { ...BUDGET, ...budget },
  };
}

export async function drain(runtime, runId) {
  const events = [];
  for await (const event of runtime.events(runId)) events.push(event);
  return events;
}
