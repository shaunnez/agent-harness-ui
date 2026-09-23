// Research projects and questions (slice A of `27-RESEARCH-PROJECTS-UI-PLAN.md`): a research
// project has no repository and refuses delivery work; a question is one or three runs whose
// status comes from the recorded agreement rule; a failed or plan-limited run makes a question
// incomplete, never "not established"; a repeated external request reuses its question; and a
// review is pinned to the evidence it was made against. Stub runtimes only: nothing here spends.

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApiServer } from "../server/api.mjs";
import { checkCostBandCitations } from "../server/research/claude-cli/citations.mjs";
import { FakeResearchRuntime } from "../server/research/fake-research-runtime.mjs";
import { unitMeasure } from "../server/research/research-question-record.mjs";
import { ResearchQuestionService } from "../server/research/research-question-service.mjs";
import { ResearchQuestionStore } from "../server/research/research-question-store.mjs";
import { createResearchRuntimeRegistry } from "../server/research/research-runtime-registry.mjs";
import { ResearchService } from "../server/research/research-service.mjs";
import { ResearchStore } from "../server/research/research-store.mjs";
import { SqliteTaskStore } from "../server/sqlite-store.mjs";

const CSRF_TOKEN = "research-questions-token";

/** A fake runtime that also reports a cost band per run, scripted by objective and run label:
 *  a band `[low, high]`, `null` for a run that found none, or `"fail"` for a run that dies. */
class BandedRuntime extends FakeResearchRuntime {
  #requests = new Map();
  #script;

  constructor(script) {
    super({
      autoAdvance: false,
      outcomeFor: (request) => (this.#planned(request) === "fail" ? "failure" : "success"),
    });
    this.#script = script;
  }

  async start(request, signal) {
    this.#requests.set(request.id, request);
    return super.start(request, signal);
  }

  outcome(runId) {
    const planned = this.#planned(this.#requests.get(runId));
    if (planned === "fail") return null;
    const band = planned
      ? { low: planned[0], high: planned[1], unit: planned[2] ?? "m2", centre: "Auckland", basis: "QV rows" }
      : null;
    return {
      costBand: {
        resolvedFrom: band ? "qv" : "not_established",
        confidence: "medium",
        band,
        components: band
          ? [
              {
                role: "Pole wall",
                rowId: "row-1",
                source: null,
                basis: "qv",
                low: planned[0],
                high: planned[1],
                unit: "m2",
              },
              {
                role: "Drainage",
                rowId: null,
                source: null,
                basis: "allowance",
                low: 20,
                high: 30,
                unit: "m2",
              },
            ]
          : [],
        notEstablished: band ? [] : ["No published rate for this scope."],
      },
      citations: band
        ? {
            summary: { rowsCited: 1, rowsFound: 1, webCited: 0, webVerified: 0, allowances: 1 },
            checks: ["qv-found", "allowance"],
          }
        : null,
    };
  }

  #planned(request) {
    const plan = this.#script[request?.objective] ?? {};
    return plan[request?.metadata?.run];
  }
}

async function withServer(script, body) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-research-questions-"));
  const store = new SqliteTaskStore(path.join(directory, "tasks.sqlite3"));
  await store.init();
  const runtime = new BandedRuntime(script);
  const runs = new ResearchStore(store.databaseHandle(), {
    sourceSnapshotDirectory: path.join(directory, "research-sources"),
  });
  const researchService = new ResearchService({
    store: runs,
    registry: createResearchRuntimeRegistry([runtime]),
  });
  const researchQuestions = new ResearchQuestionService({
    questions: new ResearchQuestionStore(store.databaseHandle()),
    research: researchService,
    runs,
    projects: async () => (await store.listProjects()).map((project) => ({ kind: "delivery", ...project })),
  });
  const server = createApiServer({
    store,
    suggestedRepository: directory,
    csrfToken: CSRF_TOKEN,
    researchService,
    researchQuestions,
    orchestrator: { status: async () => ({ available: true }), isRunning: () => false },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, pathname, payload) => {
    const response = await fetch(`${origin}${pathname}`, {
      method,
      headers: { "content-type": "application/json", "x-agent-harness-csrf": CSRF_TOKEN },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    return { status: response.status, body: await response.json() };
  };
  const finish = async (question) => {
    for (const run of question.runs) {
      runtime.advanceToEnd(run.runId);
      await researchService.settled(run.runId);
    }
    return (await call("GET", `/api/research/questions/${question.id}`)).body.question;
  };
  try {
    return await body({ call, finish, directory, store });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
}

async function researchProject(call, name = "QS cost research") {
  const created = await call("POST", "/api/projects", { name, kind: "research" });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return created.body.project;
}

test("a research project needs no repository, and every delivery route refuses it", async () => {
  await withServer({}, async ({ call, directory }) => {
    const project = await researchProject(call);
    assert.equal(project.kind, "research");
    assert.equal(project.repositoryPath, `research://${project.id}`);

    const delivery = await call("POST", "/api/projects", { name: "Harness", repositoryPath: directory });
    assert.equal(delivery.status, 201);
    assert.equal(delivery.body.project.kind, "delivery");
    // A research project given a repository is a client mistake, not a default.
    const mixed = await call("POST", "/api/projects", {
      name: "Mixed",
      kind: "research",
      repositoryPath: directory,
    });
    assert.equal(mixed.status, 400);

    const listed = (await call("GET", "/api/projects")).body.projects;
    assert.deepEqual(
      listed.map((item) => [item.name, item.kind]),
      [
        ["Harness", "delivery"],
        ["QS cost research", "research"],
      ],
    );

    const task = await call("POST", "/api/tasks", {
      title: "Anything",
      description: "Should never reach a research project.",
      workflow: "implement",
      repositoryPath: project.repositoryPath,
    });
    assert.equal(task.status, 400);
    assert.match(task.body.error, /research project has no repository/);

    // Questions only belong to research projects.
    const wrong = await call("POST", "/api/research/questions", {
      projectId: delivery.body.project.id,
      objective: "What does a retaining wall cost?",
    });
    assert.equal(wrong.status, 400);
    assert.match(wrong.body.error, /delivery project/);
  });
});

test("projects saved before kind existed read as delivery projects", async () => {
  await withServer({}, async ({ call, store, directory }) => {
    await store.updateSettings((settings) => {
      settings.projects = [
        { id: "legacy", name: "Legacy", repositoryPath: directory, createdAt: "2026-09-01T00:00:00Z" },
      ];
    });
    const [legacy] = (await call("GET", "/api/projects")).body.projects;
    assert.equal(legacy.kind, "delivery");
  });
});

test("three agreeing runs make an agreed question, shaped like the recorded review feed", async () => {
  const objective = "Timber pole retaining wall, 1.8 m retained, per m2 of face.";
  await withServer(
    { [objective]: { r1: [727, 838], r2: [700, 820], r3: [740, 860] } },
    async ({ call, finish }) => {
      const project = await researchProject(call);
      const asked = await call("POST", "/api/research/questions", { projectId: project.id, objective });
      assert.equal(asked.status, 201);
      const question = asked.body.question;
      assert.equal(question.runsPlanned, 3);
      assert.deepEqual(
        question.runs.map((run) => run.run),
        ["r1", "r2", "r3"],
      );
      assert.equal(question.status, "queued");
      assert.deepEqual(question.source, { kind: "manual" });

      const done = await finish(question);
      assert.equal(done.status, "agreed");
      assert.deepEqual(done.consensus, { low: 727, high: 838 });
      assert.deepEqual(done.range, { min: 700, max: 860 });
      assert.equal(done.agreement.runsWithBand, 3);
      assert.equal(done.unit, "m2");
      assert.equal(done.citationsChecked, true);
      assert.deepEqual(
        done.runs[0].components.map((item) => item.check),
        ["qv-found", "allowance"],
      );
      assert.deepEqual(
        done.qvSources.map((row) => [row.rowId, row.citedBy]),
        [["row-1", 3]],
      );
      assert.equal(done.provenance, "live");
      assert.match(done.evidenceSha, /^[0-9a-f]{64}$/);
      assert.ok(done.runs[0].activity.some((entry) => entry.kind === "completed"));

      const listed = (await call("GET", `/api/research/questions?projectId=${project.id}`)).body.questions;
      assert.equal(listed.length, 1);
      assert.equal(listed[0].evidenceSha, done.evidenceSha, "the fingerprint ignores the activity feed");
    },
  );
});

test("disputed, not established and incomplete follow the recorded rule; a failed run is never 'found nothing'", async () => {
  const script = {
    "Disputed scope.": { r1: [500, 700], r2: [800, 1100], r3: [520, 690] },
    "Unpriced scope.": { r1: null, r2: null, r3: null },
    "Crashed scope.": { r1: null, r2: "fail", r3: null },
    "Quick scope.": { r1: [100, 120] },
    "Mixed units.": {
      r1: [60, 100, "m² of soffit"],
      r2: [2000, 6000, "per house (residential soffit and fascia)"],
      r3: [55, 95, "NZD/m²"],
    },
    "Same measure, different words.": {
      r1: [150, 420, "m² treated area (footprint plus 1-2m margin)"],
      r2: [146, 420, "m² building footprint"],
      r3: [160, 400, "per m2"],
    },
  };
  await withServer(script, async ({ call, finish }) => {
    const project = await researchProject(call);
    const ask = async (objective, extra = {}) =>
      finish(
        (await call("POST", "/api/research/questions", { projectId: project.id, objective, ...extra })).body
          .question,
      );

    assert.equal((await ask("Disputed scope.")).status, "disputed");
    const unpriced = await ask("Unpriced scope.");
    assert.equal(unpriced.status, "not_established");
    assert.deepEqual(unpriced.openQuestions, ["No published rate for this scope."]);
    const crashed = await ask("Crashed scope.");
    assert.equal(crashed.status, "incomplete");
    assert.equal(crashed.runs[1].status, "failed");
    assert.ok(crashed.runs[1].error);

    const quick = await ask("Quick scope.", { runs: 1 });
    assert.equal(quick.runsPlanned, 1);
    assert.equal(quick.runs.length, 1);
    assert.equal(quick.status, "agreed");

    // Runs pricing per m² and per house are not "40x apart"; they are not comparable at all.
    const mixed = await ask("Mixed units.");
    assert.equal(mixed.status, "disputed");
    assert.equal(mixed.consensus, null);
    assert.equal(mixed.agreement.lowRatio, null);
    assert.equal(mixed.unit, null);
    assert.equal(mixed.unitsDiffer.length, 3);
    // Prose around the same measure is not a difference.
    const same = await ask("Same measure, different words.");
    assert.equal(same.status, "agreed");
    assert.equal(same.unitsDiffer, null);

    const two = await call("POST", "/api/research/questions", {
      projectId: project.id,
      objective: "x",
      runs: 2,
    });
    assert.equal(two.status, 400);
  });
});

test("a repeated external request reuses its question and starts no more runs", async () => {
  await withServer({}, async ({ call }) => {
    const project = await researchProject(call);
    const request = {
      projectId: project.id,
      objective: "Asbestos soffit removal, per m2.",
      source: { kind: "external", provider: "linear", requestId: "ENG-42" },
    };
    const first = await call("POST", "/api/research/questions", request);
    const second = await call("POST", "/api/research/questions", request);
    assert.equal(first.status, 201);
    assert.equal(second.status, 200);
    assert.equal(second.body.reused, true);
    assert.equal(second.body.question.id, first.body.question.id);
    assert.equal((await call("GET", "/api/research/runs")).body.runs.length, 3);
    assert.deepEqual(first.body.question.source, {
      kind: "external",
      provider: "linear",
      requestId: "ENG-42",
    });
  });
});

test("a review is pinned to the evidence it saw, and only a finished question can be reviewed", async () => {
  const objective = "Concrete paving slab, per m2.";
  await withServer(
    { [objective]: { r1: [190, 240], r2: [175, 220], r3: [210, 240] } },
    async ({ call, finish }) => {
      const project = await researchProject(call);
      const question = (await call("POST", "/api/research/questions", { projectId: project.id, objective }))
        .body.question;

      const early = await call("POST", `/api/research/questions/${question.id}/review`, {
        decision: "approved",
        note: "",
        evidenceSha: question.evidenceSha,
      });
      assert.equal(early.status, 409);
      assert.match(early.body.error, /once its runs have finished/);

      const done = await finish(question);
      const stale = await call("POST", `/api/research/questions/${done.id}/review`, {
        decision: "approved",
        note: "",
        evidenceSha: "0".repeat(64),
      });
      assert.equal(stale.status, 409);
      assert.match(stale.body.error, /evidence changed/);

      const noReason = await call("POST", `/api/research/questions/${done.id}/review`, {
        decision: "rejected",
        note: " ",
        evidenceSha: done.evidenceSha,
      });
      assert.equal(noReason.status, 400);

      const approved = await call("POST", `/api/research/questions/${done.id}/review`, {
        decision: "approved",
        note: "Matches our last three jobs.",
        evidenceSha: done.evidenceSha,
      });
      assert.equal(approved.status, 200);
      assert.equal(approved.body.question.review.decision, "approved");
      assert.equal(approved.body.question.review.evidenceSha, done.evidenceSha);
      // Reviewing does not change the evidence, so the review stays current.
      assert.equal(approved.body.question.evidenceSha, done.evidenceSha);
    },
  );
});

test("each component is labelled by its weakest citation", async () => {
  const rows = new Map([["row-1", { id: "row-1", text: "Row one", priced: true }]]);
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-citation-checks-"));
  try {
    const { components } = await checkCostBandCitations(
      {
        components: [
          { role: "Found", rowId: "row-1" },
          { role: "Missing", rowId: "row-9" },
          { role: "Unfetched web", source: "https://example.com/rate" },
          { role: "Allowance", basis: "allowance" },
          { role: "Nothing" },
        ],
      },
      { rows, webTools: null, snapshotDirectory: directory },
    );
    assert.deepEqual(
      components.map((item) => item.check),
      ["qv-found", "qv-missing", "web-not-fetched", "allowance", "unsourced"],
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("units are compared by measure, with whole-job totals told apart from rates", () => {
  // Unit text as live runs wrote it on 23 September.
  const cases = {
    "m² treated area (footprint plus 1-2m margin)": "per m²",
    "$/m² extra-over standard foundation": "per m²",
    "NZD per m2, net increase": "per m²",
    "NZD/m² roof area, extra cost of membrane over long-run": "per m²",
    "per house (residential soffit and fascia, incl. disposal)": "per house",
    "lump sum, 1200m²": "total",
    "$ total for 1200m² (covering only)": "total",
    "NZD, GST exclusive; net increase for 1200 m²": "total",
    "NZD excluding GST, per assumed 500 m² building": "total",
    "NZD per assumed 30 m² job, excluding GST": "total",
    "NZD ex GST per assumed small soffit job": "total",
    "NZD excluding GST, additional construction cost": null,
  };
  for (const [unit, measure] of Object.entries(cases)) assert.equal(unitMeasure(unit), measure, unit);
});
