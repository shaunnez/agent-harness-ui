// The research service end to end, offline: Postgres is PGlite in memory, and the API loop is a
// stub with the same id that answers every run with a checked band, so a batch goes from PlanCheck's
// POST to graded answers without a model call.

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createResearchServiceApp, usOnly } from "../src/app.mjs";
import { tokenSha256, validateBatch } from "../src/batches.mjs";
import { DEFAULT_SERVICE_MODEL, loadConfig } from "../src/config.mjs";

const TOKEN = "rsk_test-token-for-plancheck-000000";
const OTHER_TOKEN = "rsk_test-token-for-someone-else-000";

function baseEnv(overrides = {}) {
  return {
    RESEARCH_DATABASE_URL: "pglite:memory",
    RESEARCH_SERVICE_PORT: "0",
    RESEARCH_SERVICE_CLIENTS: `plancheck:${tokenSha256(TOKEN)},other:${tokenSha256(OTHER_TOKEN)}`,
    RESEARCH_RUNS_PER_QUESTION: "3",
    RESEARCH_MIN_CONCURRENT_RUNS: "1",
    RESEARCH_MAX_CONCURRENT_RUNS: "4",
    RESEARCH_INITIAL_CONCURRENT_RUNS: "2",
    RESEARCH_WORKER_INTERVAL_MS: "20",
    ...overrides,
  };
}

/** Answers like the API loop: every run completes with one QV-checked component. `failStarts`
 *  makes the first N starts throw, as a missing key would. */
class StubApiLoop {
  id = "api-loop";
  starts = 0;
  models = [];
  active = new Map();
  maxQuestionsActive = 0;
  #runs = new Map();
  #failStarts;
  #hold;

  constructor({ failStarts = 0, holdMs = 30 } = {}) {
    this.#failStarts = failStarts;
    this.#hold = holdMs;
  }

  async start(request) {
    this.starts += 1;
    if (this.#failStarts > 0) {
      this.#failStarts -= 1;
      throw new Error("FIREWORKS_API_KEY is not set.");
    }
    this.models.push(request.researchPolicy?.model);
    this.#runs.set(request.id, { request, status: "running" });
    const question = request.metadata?.questionId;
    this.active.set(request.id, question);
    this.maxQuestionsActive = Math.max(this.maxQuestionsActive, new Set(this.active.values()).size);
    return {
      runId: request.id,
      status: "running",
      model: { provider: "api-loop", model: request.researchPolicy.model, live: false },
    };
  }

  async *events(runId) {
    yield { id: `${runId}-started`, type: "run.started", timestamp: new Date().toISOString(), data: {} };
    await new Promise((resolve) => setTimeout(resolve, this.#hold));
    this.#runs.get(runId).status = "completed";
    this.active.delete(runId);
  }

  async status(runId) {
    return {
      runId,
      status: this.#runs.get(runId)?.status ?? "failed",
      usage: { inputTokens: 10, outputTokens: 5, estimatedCostUsd: 0.01, partial: false },
    };
  }

  async result(runId) {
    return { runId, findings: [], artifacts: [], usage: { partial: false } };
  }

  outcome() {
    return {
      costBand: {
        band: { unit: "m2", low: 100, high: 120, basis: "QV row qv-1." },
        components: [{ role: "Membrane", basis: "qv", rowId: "qv-1", unit: "m2", low: 100, high: 120 }],
      },
      citations: { checks: ["qv-found"] },
    };
  }

  async cancel(runId) {
    const run = this.#runs.get(runId);
    if (run) run.status = "cancelled";
  }
}

async function withService(options, operation) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "research-service-"));
  const config = loadConfig(baseEnv({ RESEARCH_DATA_DIR: directory, ...(options.env ?? {}) }));
  const runtime = options.runtime ?? new StubApiLoop();
  const app = await createResearchServiceApp({
    config,
    env: {},
    runtime,
    scoper: null,
    log: (m, f) => process.env.DEBUG_SERVICE && console.log("LOG", m, JSON.stringify(f)),
  });
  const address = await app.listen();
  const base = `http://127.0.0.1:${address.port}`;
  const call = async (method, route, { body, token = TOKEN, headers = {} } = {}) => {
    const response = await fetch(`${base}${route}`, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json() };
  };
  try {
    await operation({ app, call, runtime, base });
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
}

async function waitForBatch(call, id, predicate, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { body } = await call("GET", `/v1/batches/${id}`);
    if (predicate(body.batch)) return body.batch;
    if (Date.now() > deadline)
      throw new Error(`Batch ${id} did not settle: ${JSON.stringify(body.batch.counts)}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

const batch = (batchId, ids) => ({
  batchId,
  reference: { tender: "T-100" },
  items: ids.map((id) => ({
    id,
    description: `Supply and lay torch-on membrane, item ${id}`,
    unit: "m2",
    quantity: 120,
    location: "Auckland",
  })),
});

test("the service refuses a provider that is not US-hosted, an unlisted model, and no clients", () => {
  assert.throws(
    () => loadConfig(baseEnv({ RESEARCH_MODEL: "opencode-go/deepseek-v4.1-flash" })),
    /US-hosted provider/,
  );
  assert.throws(
    () => loadConfig(baseEnv({ RESEARCH_MODEL: "fireworks-us/some-other-model" })),
    /not one of the API loop's research models/,
  );
  assert.throws(() => loadConfig(baseEnv({ RESEARCH_SERVICE_CLIENTS: "" })), /RESEARCH_SERVICE_CLIENTS/);
  assert.throws(() => loadConfig(baseEnv({ RESEARCH_SERVICE_CLIENTS: "plancheck:not-a-hash" })), /sha256/);
  assert.throws(() => loadConfig(baseEnv({ RESEARCH_DATABASE_URL: "" })), /RESEARCH_DATABASE_URL/);
  const config = loadConfig(baseEnv());
  assert.equal(config.model, DEFAULT_SERVICE_MODEL);
  assert.equal(config.provider, "fireworks-us");
  assert.equal(config.consoleEnabled, true);
  assert.equal(loadConfig(baseEnv({ RESEARCH_SERVICE_HOST: "0.0.0.0" })).consoleEnabled, false);
});

test("a run on any other model is refused where it starts, too", async () => {
  const guarded = usOnly(new StubApiLoop());
  await assert.rejects(
    guarded.start({
      id: "RSCH-001",
      researchPolicy: { runtime: "api-loop", model: "opencode-go/deepseek-v4.1-flash" },
    }),
    /runs only on fireworks-us or baseten/,
  );
  await assert.rejects(guarded.start({ id: "RSCH-002" }), /no model/);
});

test("a batch's items are checked before anything is stored", () => {
  assert.throws(() => validateBatch({ items: [] }), /batchId is required/);
  assert.throws(() => validateBatch({ batchId: "b", items: [] }), /at least one item/);
  assert.throws(
    () =>
      validateBatch({
        batchId: "b",
        items: [
          { id: "1", description: "x" },
          { id: "1", description: "y" },
        ],
      }),
    /twice/,
  );
  assert.throws(() => validateBatch({ batchId: "b", items: [{ id: "1" }] }), /description is required/);
  assert.throws(
    () => validateBatch({ batchId: "b", items: [{ id: "1", description: "x", quantity: -1 }] }),
    /quantity/,
  );
  assert.throws(
    () =>
      validateBatch({
        batchId: "b",
        items: Array.from({ length: 201 }, (_, i) => ({ id: String(i), description: "x" })),
      }),
    /at most 200/,
  );
});

test("PlanCheck's batch is researched to graded answers, paced, and a resend starts nothing", async () => {
  await withService({}, async ({ call, runtime, app }) => {
    assert.equal((await call("POST", "/v1/batches", { body: batch("B-1", ["a"]), token: null })).status, 401);
    assert.equal(
      (
        await call("POST", "/v1/batches", {
          body: batch("B-1", ["a"]),
          token: "rsk_wrong-token-000000000000",
        })
      ).status,
      401,
    );

    const created = await call("POST", "/v1/batches", { body: batch("B-1", ["a", "b", "c", "d"]) });
    assert.equal(created.status, 201);
    assert.equal(created.body.created, true);
    assert.equal(created.body.batch.counts.queued, 4);
    const id = created.body.batch.id;

    const done = await waitForBatch(call, id, (current) => current.status === "done");
    assert.deepEqual(done.counts, { queued: 0, researching: 0, done: 4, failed: 0 });
    for (const item of done.items) {
      assert.equal(item.answer.grade, "confident", `${item.id}: ${JSON.stringify(item.answer.reasons)}`);
      assert.deepEqual(item.answer.bestBand, { low: 100, high: 120 });
      assert.equal(item.answer.unit, "m2");
      assert.equal(item.answer.currency, "NZD");
      assert.equal(item.answer.gstBasis, "exclusive");
      assert.match(item.answer.evidenceSha, /^[0-9a-f]{64}$/);
    }
    assert.equal(runtime.starts, 12, "three runs for each of four items");
    assert.ok(runtime.models.every((model) => model === DEFAULT_SERVICE_MODEL));
    // Pacer at 2 runs, 3 runs a question: room for two questions at once, never more.
    assert.ok(
      runtime.maxQuestionsActive <= app.worker.questionLimit,
      `${runtime.maxQuestionsActive} questions at once`,
    );

    // The same batch again, and an item again in a new batch: nothing new is started.
    const resent = await call("POST", "/v1/batches", { body: batch("B-1", ["a"]) });
    assert.equal(resent.status, 200);
    assert.equal(resent.body.batch.id, id);
    const again = await call("POST", "/v1/batches", { body: batch("B-2", ["a"]) });
    assert.equal(again.status, 201);
    const second = await waitForBatch(call, again.body.batch.id, (current) => current.status === "done");
    assert.equal(second.items[0].questionId, done.items[0].questionId);
    assert.equal(runtime.starts, 12);

    const byExternal = await call("GET", "/v1/batches?batchId=B-1");
    assert.equal(byExternal.body.batch.id, id);
    // Another client cannot read it, by either id.
    assert.equal((await call("GET", `/v1/batches/${id}`, { token: OTHER_TOKEN })).status, 404);
    assert.equal((await call("GET", "/v1/batches?batchId=B-1", { token: OTHER_TOKEN })).status, 404);
  });
});

test("runs that never started are started again by the worker", async () => {
  const runtime = new StubApiLoop({ failStarts: 3 });
  await withService({ runtime }, async ({ call }) => {
    const created = await call("POST", "/v1/batches", { body: batch("B-9", ["x"]) });
    const done = await waitForBatch(call, created.body.batch.id, (current) => current.status === "done");
    assert.equal(done.items[0].answer.grade, "confident");
    assert.equal(runtime.starts, 6, "three failed starts, then three that ran");
  });
});

test("the review console answers on loopback only, and PlanCheck's routes need no console", async () => {
  await withService({}, async ({ base, call }) => {
    const health = await call("GET", "/healthz", { token: null });
    assert.equal(health.status, 200);
    assert.equal(health.body.database, "pglite");
    assert.equal(health.body.pacing.limit, 2);

    const projects = await call("GET", "/api/research/projects", { token: null });
    assert.equal(projects.status, 200);
    assert.deepEqual(
      projects.body.projects.map((project) => project.id),
      ["plancheck"],
    );
    // A page on another site cannot reach it through the browser.
    assert.equal(
      (
        await call("GET", "/api/research/projects", {
          token: null,
          headers: { origin: "https://evil.example" },
        })
      ).status,
      404,
    );
    // Nor can a rebound hostname. `fetch` will not send another Host, so this goes through `http`.
    const rebound = await new Promise((resolve, reject) => {
      const request = http.request(
        `${base}/api/research/projects`,
        { headers: { host: "evil.example" } },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      );
      request.on("error", reject);
      request.end();
    });
    assert.equal(rebound, 404);
    const form = await fetch(`${base}/api/research/questions`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    });
    assert.equal(form.status, 415);
  });
  await withService({ env: { RESEARCH_SERVICE_HOST: "0.0.0.0" } }, async ({ call }) => {
    assert.equal((await call("GET", "/api/research/projects", { token: null })).status, 404);
    assert.equal((await call("GET", "/healthz", { token: null })).status, 200);
  });
});

test("the service serves the built review console on loopback, and nothing outside it", async () => {
  const consoleDir = await mkdtemp(path.join(os.tmpdir(), "research-console-dist-"));
  await mkdir(path.join(consoleDir, "assets"));
  await writeFile(path.join(consoleDir, "index.html"), "<title>Eversor Research</title>");
  await writeFile(path.join(consoleDir, "assets", "app-abc123.js"), "console.log(1)");
  const raw = (base, route, headers = {}) =>
    new Promise((resolve, reject) => {
      const request = http.request(`${base}${route}`, { headers }, (response) => {
        let body = "";
        response.on("data", (chunk) => (body += chunk));
        response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body }));
      });
      request.on("error", reject);
      request.end();
    });
  try {
    await withService({ env: { RESEARCH_CONSOLE_DIR: consoleDir } }, async ({ base, call }) => {
      const index = await raw(base, "/");
      assert.equal(index.status, 200);
      assert.match(index.body, /Eversor Research/);
      assert.equal(index.headers["cache-control"], "no-cache");
      assert.equal(index.headers["x-frame-options"], "DENY");
      // A route inside the app gets the app; a missing asset does not.
      assert.match((await raw(base, "/questions/RQ-001")).body, /Eversor Research/);
      assert.equal((await raw(base, "/assets/missing.js")).status, 404);
      const asset = await raw(base, "/assets/app-abc123.js");
      assert.equal(asset.status, 200);
      assert.match(asset.headers["content-type"], /text\/javascript/);
      assert.match(asset.headers["cache-control"], /immutable/);
      // Nothing outside the console's directory, however the path is spelled.
      for (const outside of ["/../package.json", "/%2e%2e/package.json", "/assets/%2e%2e/%2e%2e/package.json"])
        assert.notEqual((await raw(base, outside)).body.includes('"name"'), true, outside);
      assert.equal((await raw(base, "/", { host: "evil.example" })).status, 404);

      const info = await call("GET", "/api/research/console", { token: null });
      assert.equal(info.status, 200);
      assert.equal(info.body.engine.model, DEFAULT_SERVICE_MODEL);
      assert.equal(info.body.runsPerQuestion, 3);
      assert.equal(info.body.pacing.limit, 2);
    });
    await withService(
      { env: { RESEARCH_CONSOLE_DIR: consoleDir, RESEARCH_SERVICE_HOST: "0.0.0.0" } },
      async ({ base }) => {
        assert.equal((await raw(base, "/")).status, 404, "no console where there is no sign-in");
      },
    );
  } finally {
    await rm(consoleDir, { recursive: true, force: true });
  }
});
