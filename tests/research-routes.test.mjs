import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApiServer } from "../server/api.mjs";
import { FakeResearchRuntime } from "../server/research/fake-research-runtime.mjs";
import { createResearchRuntimeRegistry } from "../server/research/research-runtime-registry.mjs";
import { ResearchService } from "../server/research/research-service.mjs";
import { ResearchStore } from "../server/research/research-store.mjs";
import { SqliteTaskStore } from "../server/sqlite-store.mjs";
import { settle } from "./research-test-support.mjs";

const CSRF_TOKEN = "research-routes-token";

async function withServer(body, { researchRuntimeId = "fake", costBand = null } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-research-api-"));
  const store = new SqliteTaskStore(path.join(directory, "tasks.sqlite3"));
  await store.init();
  const runtime = new FakeResearchRuntime({ id: researchRuntimeId, autoAdvance: false });
  if (costBand) {
    runtime.costBand = () => costBand;
    runtime.citationSummary = () => ({
      rowsCited: 1,
      rowsFound: 0,
      webCited: 0,
      webVerified: 0,
      webNotFetched: 0,
      webExcerptRejected: 0,
      allowances: 0,
    });
  }
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

test("a live research project needs only a name and owns persistent questions, runs and review", async () => {
  await withServer(
    async ({ call, runtime, researchService, store }) => {
      const created = await call("POST", "/api/projects", { name: "Cost enquiries", kind: "research" });
      assert.equal(created.status, 201);
      const project = created.body.project;
      assert.equal(project.kind, "research");
      assert.match(project.repositoryPath, /^research:\/\//);
      assert.equal(
        (await call("GET", "/api/projects")).body.projects.find((item) => item.id === project.id).kind,
        "research",
      );
      await assert.rejects(
        store.create({
          title: "Delivery",
          description: "Wrong plane",
          repositoryPath: project.repositoryPath,
        }),
        { code: "PROJECT_RESEARCH_ONLY" },
      );

      const objective = "What does removing an asbestos soffit cost per square metre?";
      const input = { projectId: project.id, objective, runs: 3 };
      const asked = await call("POST", "/api/research/questions", input);
      assert.equal(asked.status, 201, JSON.stringify(asked.body));
      const questionId = asked.body.question.id;
      const runs = await researchService.listRuns({});
      assert.equal(runs.length, 3);
      assert.deepEqual(runs.map((run) => run.questionOrdinal).sort(), [1, 2, 3]);
      assert.ok(runs.every((run) => run.runtimeId === "claude-cli" && run.questionId === questionId));
      assert.equal((await call("POST", "/api/research/questions", input)).body.question.id, questionId);
      assert.equal((await researchService.listRuns({})).length, 3);
      assert.equal(
        (await call("GET", `/api/research/questions?projectId=${project.id}`)).body.questions.length,
        1,
      );
      assert.equal((await call("POST", `/api/projects/${project.id}/archive`, {})).status, 409);
      assert.equal(
        (
          await call("POST", `/api/research/questions/${questionId}/review`, {
            decision: "approved",
            evidenceSha: asked.body.question.evidenceSha,
          })
        ).status,
        409,
      );

      for (const run of runs) runtime.advanceToEnd(run.id);
      await Promise.all(runs.map((run) => researchService.settled(run.id)));
      const finished = (await call("GET", `/api/research/questions/${questionId}`)).body.question;
      assert.equal(finished.status, "not_established");
      assert.equal(finished.agreement.runsTotal, 3);
      assert.equal(finished.runs.length, 3);
      assert.equal(finished.citationsChecked, false);
      assert.equal(
        (
          await call("POST", `/api/research/questions/${questionId}/review`, {
            decision: "approved",
            evidenceSha: "stale",
          })
        ).status,
        409,
      );
      const reviewed = await call("POST", `/api/research/questions/${questionId}/review`, {
        decision: "approved",
        note: "Reviewed the no-band finding.",
        evidenceSha: finished.evidenceSha,
      });
      assert.equal(reviewed.status, 200);
      assert.equal(reviewed.body.question.review.evidenceSha, finished.evidenceSha);

      const quick = await call("POST", "/api/research/questions", {
        projectId: project.id,
        objective: "What is the cost of removing a roof membrane?",
        runs: 1,
      });
      assert.equal(quick.status, 201);
      const quickRun = (await researchService.listRuns({})).find(
        (run) => run.questionId === quick.body.question.id,
      );
      runtime.advanceToEnd(quickRun.id);
      await researchService.settled(quickRun.id);
      const quickResult = (await call("GET", `/api/research/questions/${quick.body.question.id}`)).body
        .question;
      assert.equal(quickResult.status, "unverified");
      assert.equal(quickResult.consensus, null);
      assert.equal(quickResult.agreement.lowRatio, null);

      assert.equal((await call("POST", `/api/projects/${project.id}/archive`, {})).status, 200);
      assert.equal(
        (
          await call("POST", "/api/research/questions", {
            projectId: project.id,
            objective: "What does another research scope cost?",
            runs: 1,
          })
        ).status,
        409,
      );
    },
    { researchRuntimeId: "claude-cli" },
  );
});

test("live question results show a retained cost band without claiming an unchecked QV citation passed", async () => {
  const costBand = {
    band: { low: 100, high: 120, unit: "m2", centre: "Auckland", basis: "Example band" },
    resolvedFrom: "qv",
    confidence: "low",
    components: [{ role: "Example component", basis: "qv", rowId: "missing-row", low: 100, high: 120 }],
    notEstablished: [],
  };
  await withServer(
    async ({ call, runtime, researchService }) => {
      const project = (await call("POST", "/api/projects", { name: "Cost checks", kind: "research" })).body
        .project;
      const asked = await call("POST", "/api/research/questions", {
        projectId: project.id,
        objective: "What does this scoped work cost per square metre?",
        runs: 3,
      });
      assert.equal(asked.status, 201);
      const runs = await researchService.listRuns({});
      for (const run of runs) runtime.advanceToEnd(run.id);
      await Promise.all(runs.map((run) => researchService.settled(run.id)));
      const question = (await call("GET", `/api/research/questions/${asked.body.question.id}`)).body.question;
      assert.equal(question.status, "agreed");
      assert.deepEqual(question.consensus, { low: 100, high: 120 });
      assert.equal(question.runs[0].components[0].check, "qv-missing");
      assert.equal(question.citationsChecked, true);
    },
    { researchRuntimeId: "claude-cli", costBand },
  );
});

test("a failed runtime start can be retried on the same question without erasing the failure", async () => {
  await withServer(
    async ({ call, runtime, researchService }) => {
      const project = (await call("POST", "/api/projects", { name: "Retry checks", kind: "research" })).body
        .project;
      const originalStart = runtime.start.bind(runtime);
      runtime.start = async () => {
        throw new Error("Capture unavailable.");
      };
      const objective = "What is the cost of repairing the failed start?";
      const asked = await call("POST", "/api/research/questions", {
        projectId: project.id,
        objective,
        runs: 1,
      });
      const id = asked.body.question.id;
      assert.equal(asked.body.question.retryable, true);
      assert.equal(asked.body.question.runs[0].error.code, "runtime_start_failed");
      assert.equal(
        (
          await call("POST", `/api/research/questions/${id}/review`, {
            decision: "approved",
            evidenceSha: asked.body.question.evidenceSha,
          })
        ).status,
        409,
      );
      runtime.start = originalStart;

      const retried = await call("POST", `/api/research/questions/${id}/retry`);
      assert.equal(retried.status, 200, JSON.stringify(retried.body));
      assert.equal(retried.body.question.retryable, false);
      assert.equal(retried.body.question.runs.length, 1);
      assert.equal(retried.body.question.runs[0].run, "r1");
      assert.equal(retried.body.question.priorAttempts[0].errorCode, "runtime_start_failed");
      assert.equal((await researchService.listRuns({})).length, 2);
      assert.equal((await call("POST", `/api/research/questions/${id}/retry`)).status, 409);

      const latest = (await researchService.listRuns({})).find((run) => run.questionOrdinal === 2);
      runtime.advanceToEnd(latest.id);
      await researchService.settled(latest.id);
      const finished = (await call("GET", `/api/research/questions/${id}`)).body.question;
      assert.equal(finished.status, "unverified");
      assert.equal(finished.priorAttempts.length, 1);
    },
    { researchRuntimeId: "claude-cli" },
  );
});

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
