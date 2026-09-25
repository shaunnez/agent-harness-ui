// Research projects and questions (slice A of `27-RESEARCH-PROJECTS-UI-PLAN.md`): a research
// project has no repository and refuses delivery work; a question is one, three or five runs whose
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

  objectiveOf(runId) {
    return this.#requests.get(runId)?.objective ?? null;
  }

  #planned(request) {
    // Scripted by the question; a scoped run's objective carries its pinned scope after it.
    const objective = String(request?.objective ?? "");
    const plan = this.#script[objective] ?? this.#script[objective.split("\n\n")[0]] ?? {};
    return plan[request?.metadata?.run];
  }
}

async function withServer(script, body, { scoper = null } = {}) {
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
    scoper,
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
    return await body({ call, finish, directory, store, runtime });
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
      // Five is the default now; this test asks for three, the recorded review feed's shape.
      const asked = await call("POST", "/api/research/questions", {
        projectId: project.id,
        objective,
        runs: 3,
      });
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
    "Lone band.": { r1: [100, 120], r2: null, r3: null },
    "Two bands.": { r1: [100, 120], r2: [105, 125], r3: null },
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

    // One band among three runs agrees with itself: the runs disagree on whether it can be priced.
    const lone = await ask("Lone band.");
    assert.equal(lone.status, "disputed");
    assert.equal(lone.consensus, null);
    assert.deepEqual(lone.range, { min: 100, max: 120 });
    assert.equal(lone.agreement.runsWithBand, 1);
    // Two banded runs that agree still agree, as the recorded rule has it.
    assert.equal((await ask("Two bands.")).status, "agreed");

    const quick = await ask("Quick scope.", { runs: 1 });
    assert.equal(quick.runsPlanned, 1);
    assert.equal(quick.runs.length, 1);
    assert.equal(quick.status, "single_run");

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
    assert.equal((await call("GET", "/api/research/runs")).body.runs.length, 5);
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
    // A rate first, with the job total alongside it: still a rate (Luna, concrete paving, 24 September).
    "$/m2 finished slab, and total for 300 m2": "per m²",
    "NZD/m3 placed, total for 40 m3": "per m³",
    "$/m of channel drain": "per metre",
    "$/each leaf": "each",
  };
  for (const [unit, measure] of Object.entries(cases)) assert.equal(unitMeasure(unit), measure, unit);
});

const PINNED = Object.freeze({
  item: "Timber pole retaining wall, 1.8 m retained",
  measure: "per m²",
  unitText: "m² of wall face",
  quantityBasis: "",
  inclusions: ["poles", "lagging", "drainage"],
  exclusions: [],
  centre: "Auckland",
  assumptions: [],
  clarifications: ["ground conditions not stated"],
});

/** A scoper that answers with `PINNED` and counts its calls. */
function stubScoper() {
  const scoper = {
    calls: 0,
    async scope() {
      scoper.calls += 1;
      return {
        scope: { ...PINNED },
        scopedBy: { runtime: "codex-cli", model: "gpt-6-luna", reasoning: "medium" },
      };
    },
  };
  return scoper;
}

test("a draft scope starts nothing; an asked scope is pinned onto every run and into the fingerprint", async () => {
  const objective = "What does a pole retaining wall cost?";
  const scoper = stubScoper();
  await withServer(
    { [objective]: { r1: [700, 820], r2: [700, 820], r3: [700, 820] } },
    async ({ call, finish, runtime }) => {
      const project = await researchProject(call);
      const draft = await call("POST", "/api/research/questions/scope", { projectId: project.id, objective });
      assert.equal(draft.status, 200, JSON.stringify(draft.body));
      assert.deepEqual(draft.body.scope, PINNED);
      assert.equal(
        (await call("GET", `/api/research/questions?projectId=${project.id}`)).body.questions.length,
        0,
      );

      const bad = await call("POST", "/api/research/questions", {
        projectId: project.id,
        objective,
        scope: { ...PINNED, measure: "per whatever" },
      });
      assert.equal(bad.status, 400);

      const asked = await call("POST", "/api/research/questions", {
        projectId: project.id,
        objective,
        scope: { ...PINNED, centre: "Wellington" },
        scopedBy: draft.body.scopedBy,
      });
      assert.equal(asked.status, 201, JSON.stringify(asked.body));
      const question = asked.body.question;
      assert.equal(question.objective, objective, "the question keeps the operator's words");
      assert.equal(question.scope.centre, "Wellington");
      assert.deepEqual(question.scopedBy, { runtime: "codex-cli", model: "gpt-6-luna", reasoning: "medium" });
      assert.equal(question.scopeReviewed, true);
      for (const run of question.runs) {
        const given = runtime.objectiveOf(run.runId);
        assert.ok(given.startsWith(`${objective}\n\nPinned scope.`), given);
        assert.match(given, /- Centre: Wellington/);
      }
      const done = await finish(question);
      assert.equal(done.status, "agreed");

      const unscoped = await finish(
        (await call("POST", "/api/research/questions", { projectId: project.id, objective })).body.question,
      );
      assert.equal(unscoped.scope, null);
      assert.equal(unscoped.status, "agreed");
      assert.notEqual(unscoped.evidenceSha, done.evidenceSha, "the scope is part of the evidence");

      // A scopedBy the server does not recognise reads as the operator's own scope.
      const claimed = await call("POST", "/api/research/questions", {
        projectId: project.id,
        objective,
        scope: PINNED,
        scopedBy: { runtime: "oracle", model: "gpt-9" },
      });
      assert.deepEqual(claimed.body.question.scopedBy, { runtime: "operator" });
      assert.equal(scoper.calls, 1, "only the draft called the scoper");
    },
    { scoper },
  );
});

test("a band in another measure than the pinned scope is disputed, even when the numbers agree", async () => {
  const objective = "Pole wall, scoped per m².";
  await withServer(
    {
      [objective]: { r1: [700, 820], r2: [700, 820, "lump sum for the wall"], r3: [700, 820] },
      "Quick, but priced as a total.": { r1: [70000, 90000, "lump sum for the wall"] },
    },
    async ({ call, finish }) => {
      const project = await researchProject(call);
      const asked = await call("POST", "/api/research/questions", {
        projectId: project.id,
        objective,
        scope: PINNED,
      });
      const done = await finish(asked.body.question);
      assert.equal(done.status, "disputed");
      assert.equal(done.consensus, null);
      assert.equal(done.unitsDiffer.length, 3);

      const quick = await finish(
        (
          await call("POST", "/api/research/questions", {
            projectId: project.id,
            objective: "Quick, but priced as a total.",
            scope: PINNED,
            runs: 1,
          })
        ).body.question,
      );
      // One run off the scope's measure is not "one run, not cross-checked": it answered another question.
      assert.equal(quick.status, "disputed");
      assert.deepEqual(quick.unitsDiffer, ["lump sum for the wall"]);
    },
  );
});

test("an external request is scoped automatically, once, and says nobody reviewed the scope", async () => {
  const objective = "Supply and fix 90 mm PVC downpipe.";
  const scoper = stubScoper();
  await withServer(
    { [objective]: { r1: [40, 60], r2: [42, 58], r3: [41, 61] } },
    async ({ call }) => {
      const project = await researchProject(call);
      const request = {
        projectId: project.id,
        objective,
        source: { kind: "external", provider: "plancheck", requestId: "TND-9-item-4" },
      };
      const first = await call("POST", "/api/research/questions", request);
      assert.equal(first.status, 201);
      assert.deepEqual(first.body.question.scope, PINNED);
      assert.equal(first.body.question.scopeReviewed, false);
      const again = await call("POST", "/api/research/questions", request);
      assert.equal(again.status, 200);
      assert.equal(again.body.reused, true);
      assert.equal(scoper.calls, 1, "a repeated request is found before anything is scoped");
    },
    { scoper },
  );
});

test("without a scoper, a draft is refused and questions are asked unscoped", async () => {
  await withServer({}, async ({ call }) => {
    const project = await researchProject(call);
    const draft = await call("POST", "/api/research/questions/scope", {
      projectId: project.id,
      objective: "Roof?",
    });
    assert.equal(draft.status, 503);
  });
});

test("runs that failed to start can be retried, keeping the failed attempt on the record", async () => {
  const objective = "Timber pole retaining wall, per m2.";
  await withServer({ [objective]: { r1: [300, 380] } }, async ({ call, finish, runtime }) => {
    const project = await researchProject(call);
    const start = runtime.start.bind(runtime);
    runtime.start = async () => {
      throw new Error("Not logged in.");
    };
    const asked = (await call("POST", "/api/research/questions", { projectId: project.id, objective, runs: 1 }))
      .body.question;
    assert.equal(asked.retryable, true);
    assert.equal(asked.runs[0].error.code, "runtime_start_failed");
    const early = await call("POST", `/api/research/questions/${asked.id}/review`, {
      decision: "approved",
      note: "",
      evidenceSha: asked.evidenceSha,
    });
    assert.equal(early.status, 409);
    assert.match(early.body.error, /failed to start/);

    runtime.start = start;
    const retried = await call("POST", `/api/research/questions/${asked.id}/retry`);
    assert.equal(retried.status, 200, JSON.stringify(retried.body));
    assert.equal(retried.body.question.retryable, false);
    assert.equal(retried.body.question.runs.length, 1);
    assert.equal(retried.body.question.runs[0].run, "r1");
    assert.deepEqual(
      retried.body.question.priorAttempts.map((run) => [run.attempt, run.run, run.errorCode]),
      [[1, "r1", "runtime_start_failed"]],
    );
    // Only a failed start is retried here; a run that is going is not.
    assert.equal((await call("POST", `/api/research/questions/${asked.id}/retry`)).status, 409);

    const done = await finish(retried.body.question);
    assert.equal(done.status, "single_run");
    assert.equal(done.priorAttempts.length, 1);
  });
});

test("a research project with runs still going cannot be archived", async () => {
  const objective = "Concrete paving slab, per m2.";
  await withServer(
    { [objective]: { r1: [190, 240], r2: [175, 220], r3: [210, 240] } },
    async ({ call, finish }) => {
      const project = await researchProject(call);
      const question = (
        await call("POST", "/api/research/questions", { projectId: project.id, objective, runs: 3 })
      ).body.question;
      const early = await call("POST", `/api/projects/${project.id}/archive`, {});
      assert.equal(early.status, 409);
      assert.match(early.body.error, /active research runs/);
      await finish(question);
      assert.equal((await call("POST", `/api/projects/${project.id}/archive`, {})).status, 200);
      const archived = await call("POST", "/api/research/questions", {
        projectId: project.id,
        objective,
        runs: 1,
      });
      assert.equal(archived.status, 409);
    },
  );
});

test("a database that ran main's earlier question table is carried over, review and runs included", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { createResearchSchema } = await import("../server/research/research-schema.mjs");
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-research-migrate-"));
  try {
    const db = new DatabaseSync(path.join(directory, "research.sqlite3"));
    db.exec("CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    createResearchSchema(db);
    // Put the table back in main's shape, as a companion that ran main left it.
    db.exec(`
      DROP TABLE research_reviews;
      DROP TABLE research_questions;
      CREATE TABLE research_questions (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, objective TEXT NOT NULL, engine_json TEXT NOT NULL,
        runs_planned INTEGER NOT NULL, created_at TEXT NOT NULL, source_json TEXT NOT NULL,
        source_key TEXT NOT NULL, review_json TEXT);
      UPDATE research_runs SET question_ordinal = NULL;
    `);
    db.prepare("INSERT INTO research_questions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      "q-main",
      "p1",
      "What does removing an asbestos soffit cost per square metre?",
      JSON.stringify({ runtime: "claude-cli", model: "claude-opus-5-5", reasoning: "high" }),
      3,
      "2026-09-24T04:00:00.000Z",
      JSON.stringify({ kind: "manual" }),
      "manual:abc",
      JSON.stringify({
        decision: "approved",
        note: "Fine.",
        reviewer: "Local operator",
        decidedAt: "2026-09-24T05:00:00.000Z",
        evidenceSha: "e".repeat(64),
      }),
    );
    const store = new ResearchStore(db);
    for (let ordinal = 1; ordinal <= 4; ordinal += 1) {
      const run = await store.createRun({
        runtimeId: "fake",
        request: { objective: "x", profile: "standard" },
        budget: {},
      });
      db.prepare("UPDATE research_runs SET question_id = 'q-main', question_ordinal = ? WHERE id = ?").run(
        ordinal,
        run.id,
      );
    }
    createResearchSchema(db);
    const questions = new ResearchQuestionStore(db);
    const question = questions.getQuestion("q-main");
    assert.equal(question.title, "What does removing an asbestos soffit cost per square metre?");
    assert.equal(question.profile, "standard");
    assert.equal(question.runsPlanned, 3);
    assert.equal(questions.latestReview("q-main").decision, "approved");
    assert.deepEqual(
      db
        .prepare("SELECT run_label FROM research_runs WHERE question_id = 'q-main' ORDER BY question_ordinal")
        .all()
        .map((row) => row.run_label),
      ["r1", "r2", "r3", "r1"],
    );
    // The earlier table is kept for recovery, and a second start changes nothing.
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM research_questions_main_v1").get().n, 1);
    createResearchSchema(db);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM research_questions").get().n, 1);
    db.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
