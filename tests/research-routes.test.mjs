import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApiServer } from "../server/api.mjs";
import { FakeResearchRuntime } from "@eversor/research-engine/fake-research-runtime.mjs";
import { createResearchRuntimeRegistry } from "@eversor/research-engine/research-runtime-registry.mjs";
import { ResearchService } from "@eversor/research-engine/research-service.mjs";
import { ResearchStore } from "@eversor/research-engine/research-store.mjs";
import { SqliteTaskStore } from "../server/sqlite-store.mjs";
import { settle } from "./research-test-support.mjs";

const CSRF_TOKEN = "research-routes-token";

async function withServer(body, { researchRuntimeId = "fake" } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-research-api-"));
  const store = new SqliteTaskStore(path.join(directory, "tasks.sqlite3"));
  await store.init();
  const runtime = new FakeResearchRuntime({ id: researchRuntimeId, autoAdvance: false });
  const researchService = new ResearchService({
    store: new ResearchStore(store.databaseHandle()),
    registry: createResearchRuntimeRegistry([runtime]),
    ...(researchRuntimeId === "fake" ? {} : { settings: () => store.settings() }),
  });
  const server = createApiServer({
    store,
    suggestedRepository: directory,
    csrfToken: CSRF_TOKEN,
    researchService,
    orchestrator: { status: async () => ({ available: true }), isRunning: () => false },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, pathname, payload) => {
    const response = await fetch(`${origin}${pathname}`, {
      method,
      ...(payload === undefined
        ? {}
        : {
            body: JSON.stringify(payload),
            headers: { "content-type": "application/json", "x-agent-harness-csrf": CSRF_TOKEN },
          }),
      ...(payload === undefined && method !== "GET"
        ? { headers: { "content-type": "application/json", "x-agent-harness-csrf": CSRF_TOKEN } }
        : {}),
    });
    return { status: response.status, body: await response.json() };
  };
  try {
    return await body({ call, runtime, researchService, store, origin });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
}

test("a research run can be created, watched, and read back through the API", async () => {
  await withServer(async ({ call, runtime, researchService }) => {
    assert.deepEqual((await call("GET", "/api/research/runtimes")).body, { runtimes: ["fake"] });

    const created = await call("POST", "/api/research/runs", {
      objective: "Decide whether the research plane is real.",
      profile: "standard",
      context: [{ type: "project_document", id: "RESEARCH-RUNTIME-ARCHITECTURE.md" }],
    });
    assert.equal(created.status, 201);
    const runId = created.body.run.id;
    assert.equal(created.body.run.status, "queued");
    assert.equal(created.body.run.budget.maxResearchers, 3);

    // A run in flight has no result to read, and says so rather than returning an empty one.
    const early = await call("GET", `/api/research/runs/${runId}/result`);
    assert.equal(early.status, 409);
    assert.equal(early.body.status, "queued");

    runtime.advanceToEnd(runId);
    await researchService.settled(runId);

    const fetched = await call("GET", `/api/research/runs/${runId}`);
    assert.equal(fetched.body.run.status, "completed");
    assert.equal(fetched.body.run.usage.partial, false);
    assert.equal(fetched.body.run.usage.modelCalls, 8);
    assert.equal(fetched.body.run.usage.byModel["fake-researcher"].priced, false);

    const listed = await call("GET", "/api/research/runs");
    assert.deepEqual(
      listed.body.runs.map((run) => run.id),
      [runId],
    );

    const events = await call("GET", `/api/research/runs/${runId}/events?limit=3`);
    assert.equal(events.body.events.length, 3);
    assert.equal(events.body.events[0].type, "run.started");
    assert.equal(events.body.nextCursor, "3");
    const rest = await call("GET", `/api/research/runs/${runId}/events?cursor=3`);
    assert.ok(rest.body.events.at(-1).type === "run.completed");

    const result = await call("GET", `/api/research/runs/${runId}/result`);
    assert.equal(result.status, 200);
    assert.equal(result.body.result.findings.length, 3);
    assert.equal(result.body.result.findings[0].evidence[0].quoteVerified, false);

    const sources = await call("GET", `/api/research/runs/${runId}/sources`);
    assert.equal(sources.body.sources.length, 3);

    assert.equal((await call("GET", "/api/research/runs/RSCH-999")).status, 404);
  });
});

test("cancelling through the API reaches cancelled and keeps the partial result", async () => {
  await withServer(async ({ call, runtime, researchService }) => {
    const runId = (await call("POST", "/api/research/runs", { objective: "Stop me." })).body.run.id;
    runtime.advance(runId);
    await settle();
    runtime.advance(runId);
    await settle();

    const cancelling = await call("POST", `/api/research/runs/${runId}/cancel`);
    assert.equal(cancelling.status, 200);
    assert.equal(cancelling.body.run.status, "cancelling");
    assert.ok(cancelling.body.run.cancellationRequestedAt);

    runtime.advance(runId);
    await researchService.settled(runId);

    const cancelled = await call("GET", `/api/research/runs/${runId}`);
    assert.equal(cancelled.body.run.status, "cancelled");
    assert.equal(cancelled.body.run.usage.partial, true);

    // Cancelling a terminal run is a no-op rather than an error.
    const again = await call("POST", `/api/research/runs/${runId}/cancel`);
    assert.equal(again.body.run.status, "cancelled");
    assert.equal((await call("POST", "/api/research/runs/RSCH-999/cancel")).status, 404);
  });
});

test("a research run cannot reserve or start SDLC work", async () => {
  await withServer(async ({ call, runtime, researchService, store }) => {
    const rejected = await call("POST", "/api/research/runs", {
      objective: "Sneak into the SDLC plane.",
      workflow: "implement",
      repositoryPath: "/repo",
    });
    assert.equal(rejected.status, 400);
    assert.match(rejected.body.error, /not an SDLC task; remove workflow, repositoryPath/);

    const runId = (await call("POST", "/api/research/runs", { objective: "Stay in my lane." })).body.run.id;
    runtime.advanceToEnd(runId);
    await researchService.settled(runId);

    // No task row, no runtime task status, no worktree reservation — the research plane shares
    // a database file with the SDLC plane and nothing else.
    assert.deepEqual(await store.list(), []);
    assert.deepEqual((await call("GET", "/api/tasks")).body.tasks, []);
    assert.deepEqual((await call("GET", "/api/runtime/worktrees")).body.rows, []);
    assert.match(runId, /^RSCH-/);
  });
});

test("research request validation rejects unusable input before a runtime is started", async () => {
  await withServer(async ({ call }) => {
    assert.equal((await call("POST", "/api/research/runs", { objective: "   " })).status, 400);
    assert.equal(
      (await call("POST", "/api/research/runs", { objective: "x", profile: "exhaustive" })).status,
      400,
    );
    assert.equal(
      (await call("POST", "/api/research/runs", { objective: "x", context: [{ type: "web" }] })).status,
      400,
    );
    assert.equal(
      (await call("POST", "/api/research/runs", { objective: "x", metadata: { depth: 3 } })).status,
      400,
    );
    const unknown = await call("POST", "/api/research/runs", { objective: "x", runtimeId: "deepagents" });
    assert.equal(unknown.status, 400);
    assert.match(unknown.body.error, /Unknown research runtime "deepagents"/);
  });
});

test("the research surface does not exist when no research service is wired", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-research-absent-"));
  const store = new SqliteTaskStore(path.join(directory, "tasks.sqlite3"));
  await store.init();
  const server = createApiServer({
    store,
    suggestedRepository: directory,
    csrfToken: CSRF_TOKEN,
    orchestrator: { status: async () => ({ available: true }), isRunning: () => false },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/research/runs`);
    assert.equal(response.status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
