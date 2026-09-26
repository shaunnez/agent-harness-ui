// The research service keeps research in Postgres; the harness keeps it in SQLite. Both run the
// same engine, so the same writes must read back as the same records from either one: the same
// runs, events, sources, results, questions and reviews, and so the same status, grading and
// evidence fingerprint for every question.
//
// Postgres here is PGlite (the same Postgres, in process), through the service's own adapter.
// The last test puts every recorded held-out eval run through both databases and the real
// question service, and checks each question grades as it was recorded.

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  PgResearchProjectStore,
  PgResearchQuestionStore,
} from "@eversor/research-engine/pg/question-store.mjs";
import { PgResearchStore } from "@eversor/research-engine/pg/research-store.mjs";
import { migrateResearchSchema } from "@eversor/research-engine/pg/schema.mjs";
import { ResearchQuestionService } from "@eversor/research-engine/research-question-service.mjs";
import { ResearchQuestionStore } from "@eversor/research-engine/research-question-store.mjs";
import { createResearchSchema } from "@eversor/research-engine/research-schema.mjs";
import { ResearchStore } from "@eversor/research-engine/research-store.mjs";
import { openDatabase } from "@eversor/research-service/src/db.mjs";
import { evalQuestions, passes } from "../scripts/research-eval.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOLDOUT = path.join(repositoryRoot, "research-agent-deepagents-spike-pack", "31-holdout");
const PROJECT = { id: "parity", name: "Parity" };

function openSqlite() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  createResearchSchema(db);
  return {
    runs: new ResearchStore(db),
    questions: new ResearchQuestionStore(db),
    close: () => db.close(),
  };
}

/** PGlite in memory by default. `RESEARCH_TEST_POSTGRES_URL` points the same tests at a real
 *  server through `pg`, as production runs; its public schema is emptied before each test. */
async function openPg() {
  const url = process.env.RESEARCH_TEST_POSTGRES_URL;
  const db = await openDatabase(url ?? "pglite:memory");
  if (url) await db.exec("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrateResearchSchema(db);
  await new PgResearchProjectStore(db).ensure({ ...PROJECT, now: "2026-09-26T00:00:00.000Z" });
  return {
    runs: new PgResearchStore(db),
    questions: new PgResearchQuestionStore(db),
    close: () => db.close(),
  };
}

/** The same writes against one database, and everything read back along the way. */
async function exercise({ runs, questions }) {
  const seen = {};
  const request = (objective) => ({
    objective,
    profile: "standard",
    context: [],
    budget: { maxModelCalls: 40 },
  });
  const first = await runs.createRun({
    runtimeId: "api-loop",
    request: request("Price a 90 mm stud wall."),
    budget: { maxModelCalls: 40 },
    now: "2026-09-26T01:00:00.000Z",
  });
  const second = await runs.createRun({
    runtimeId: "api-loop",
    request: request("Price a splashback."),
    budget: { maxModelCalls: 40 },
    now: "2026-09-26T01:00:00.000Z",
  });
  seen.created = [first, second];
  seen.started = await runs.updateRun(
    first.id,
    (draft) => {
      draft.status = "running";
      draft.usage = { inputTokens: 10, outputTokens: 2, partial: true };
      draft.model = { provider: "api-loop", model: "fireworks-us/x", live: true };
      draft.runtimeMetadata = { cliModel: "fireworks-us/x" };
    },
    { now: "2026-09-26T01:01:00.000Z" },
  );
  seen.metadata = await runs.runtimeMetadata(first.id);
  for (const [index, type] of ["run.started", "tool.called", "tool.called"].entries())
    seen[`event${index}`] = await runs.appendEvent(first.id, {
      id: `e${index}`,
      type,
      timestamp: `2026-09-26T01:02:0${index}.000Z`,
      data: { index },
    });
  // A repeated event id is ignored, not renumbered.
  seen.repeat = await runs.appendEvent(first.id, { id: "e1", type: "tool.called", timestamp: "x", data: {} });
  seen.page1 = await runs.listEvents(first.id, { limit: 2 });
  seen.page2 = await runs.listEvents(first.id, { afterOrdinal: seen.page1.nextCursor, limit: 2 });
  seen.sourceA = await runs.upsertSource(first.id, {
    id: "source-1",
    sourceType: "web",
    url: "https://example.com/a",
    title: "A",
    retrievedAt: "2026-09-26T01:03:00.000Z",
    contentSha256: "abc",
    contentBytes: 123,
    mediaType: "text/html",
    metadata: { status: 200 },
  });
  // A later sighting without content keeps what the first one recorded.
  seen.sourceAgain = await runs.upsertSource(first.id, {
    id: "source-1",
    sourceType: "web",
    url: "https://example.com/a",
    title: "A, again",
    retrievedAt: "2026-09-26T01:04:00.000Z",
  });
  await runs.upsertSource(first.id, {
    id: "qv-9",
    sourceType: "qv",
    retrievedAt: "2026-09-26T01:03:30.000Z",
  });
  await runs.recordResult(
    first.id,
    {
      summary: "About $180 a metre.",
      findings: [
        {
          id: "f1",
          claim: "Band $150–$210/m",
          producedBy: "api-loop",
          confidence: "medium",
          evidence: [
            { sourceId: "source-1", excerpt: "$180 per metre", locator: { page: 2 }, authority: "supplier" },
            { sourceId: "qv-9" },
            // Cited without ever being announced: backfilled.
            {
              sourceId: "source-late",
              sourceType: "web",
              url: "https://example.com/late",
              retrievedAt: "2026-09-26T01:05:00.000Z",
            },
          ],
        },
        { id: "f2", claim: "Labour included", producedBy: "api-loop", evidence: [] },
      ],
      artifacts: [
        { id: "transcript", kind: "api-loop-transcript", name: "Transcript", contentRef: "file:x" },
      ],
      unresolvedQuestions: ["Height?"],
      truncatedBy: null,
    },
    { now: "2026-09-26T01:06:00.000Z" },
  );
  await runs.recordOutcome(first.id, {
    costBand: { band: { unit: "m", low: 150, high: 210 } },
    citations: null,
  });
  seen.finished = await runs.updateRun(
    first.id,
    (draft) => {
      draft.status = "completed";
      draft.usage = { inputTokens: 100, outputTokens: 20, partial: false };
    },
    { now: "2026-09-26T01:07:00.000Z" },
  );
  seen.result = await runs.getResult(first.id);
  seen.noResult = await runs.getResult(second.id);
  seen.sources = await runs.listSources(first.id);
  seen.list = await runs.listRuns({ limit: 10 });
  seen.interrupted = await runs.listInterruptedRuns();
  seen.missing = await runs.getRun("RSCH-999");

  const ask = {
    projectId: PROJECT.id,
    title: "Stud wall",
    objective: "Price a 90 mm stud wall.",
    profile: "standard",
    runsPlanned: 3,
    source: { kind: "external", provider: "plancheck", requestId: "item-1" },
    sourceKey: "plancheck:item-1",
    scope: {
      scope: { measure: "m" },
      scopedBy: { runtime: "api-loop", model: "x", reasoning: null },
      reviewed: false,
    },
    now: "2026-09-26T02:00:00.000Z",
  };
  seen.question = await questions.createQuestion(ask);
  seen.reused = await questions.createQuestion({ ...ask, now: "2026-09-26T03:00:00.000Z" });
  const id = seen.question.question.id;
  await questions.attachRun(id, second.id, "r2", 2);
  await questions.attachRun(id, first.id, "r1", 1);
  seen.order = await questions.runOrder(id);
  seen.attached = await runs.getRun(first.id);
  seen.byKey = await questions.findBySourceKey("plancheck:item-1");
  seen.noKey = await questions.findBySourceKey("plancheck:nope");
  seen.review1 = await questions.addReview(id, {
    decision: "rejected",
    note: "Wrong unit.",
    reviewer: "operator",
    decidedAt: "2026-09-26T04:00:00.000Z",
    evidenceSha: "sha-1",
  });
  seen.review2 = await questions.addReview(id, {
    decision: "approved",
    note: "",
    reviewer: "operator",
    decidedAt: "2026-09-26T05:00:00.000Z",
    evidenceSha: "sha-2",
  });
  seen.latest = await questions.latestReview(id);
  seen.listed = await questions.listQuestions(PROJECT.id);
  return seen;
}

test("every store operation reads back the same from Postgres as from SQLite", async () => {
  const sqlite = openSqlite();
  const pg = await openPg();
  try {
    const fromSqlite = await exercise(sqlite);
    const fromPg = await exercise(pg);
    for (const key of Object.keys(fromSqlite))
      assert.deepEqual(fromPg[key], fromSqlite[key], `${key} differs between Postgres and SQLite`);
    // And the checks mean something: the records are the ones the writes asked for.
    assert.equal(fromPg.created[0].id, "RSCH-001");
    assert.equal(fromPg.page1.events.length, 2);
    assert.equal(fromPg.page2.events.length, 1);
    assert.equal(fromPg.sourceAgain.contentSha256, "abc");
    assert.equal(fromPg.result.findings[0].evidence.length, 3);
    assert.equal(fromPg.reused.reused, true);
    assert.deepEqual(
      fromPg.order.map((entry) => entry.ordinal),
      [1, 2],
    );
    assert.equal(fromPg.latest.decision, "approved");
  } finally {
    sqlite.close();
    await pg.close();
  }
});

/** A recorded eval result's runs, written through a store as a live question's runs would be. */
async function loadRecorded({ runs, questions }, question, result) {
  const created = await questions.createQuestion({
    projectId: PROJECT.id,
    title: question.id,
    objective: question.objective,
    profile: "standard",
    runsPlanned: result.runs.length,
    source: { kind: "manual" },
    sourceKey: null,
    scope: question.scope
      ? {
          scope: question.scope,
          scopedBy: { runtime: "api-loop", model: "recorded", reasoning: null },
          reviewed: false,
        }
      : null,
    now: "2026-09-26T00:00:00.000Z",
  });
  for (const [index, recorded] of result.runs.entries()) {
    const run = await runs.createRun({
      runtimeId: "api-loop",
      request: { objective: question.objective, profile: "standard", context: [] },
      budget: {},
      now: "2026-09-26T00:00:00.000Z",
    });
    await runs.recordOutcome(run.id, {
      costBand:
        recorded.band || recorded.checks.length
          ? { band: recorded.band, components: recorded.checks.map(() => ({})) }
          : null,
      citations: recorded.checks.length ? { checks: recorded.checks } : null,
    });
    await runs.updateRun(
      run.id,
      (draft) => {
        draft.status = recorded.status;
        draft.usage = recorded.usage ?? null;
        draft.error = recorded.error ?? null;
      },
      { now: "2026-09-26T00:10:00.000Z" },
    );
    await questions.attachRun(created.question.id, run.id, recorded.run, index + 1);
  }
  return created.question.id;
}

function questionService(stores) {
  return new ResearchQuestionService({
    questions: stores.questions,
    runs: stores.runs,
    research: {},
    projects: async () => [{ ...PROJECT, kind: "research", archivedAt: null }],
  });
}

test("every recorded held-out eval question grades the same through Postgres as recorded", async () => {
  const questions = new Map(
    (await evalQuestions(path.join(HOLDOUT, "question-set.json"))).map((question) => [question.id, question]),
  );
  const sqlite = openSqlite();
  const pg = await openPg();
  let compared = 0;
  try {
    const services = { sqlite: questionService(sqlite), pg: questionService(pg) };
    for (const arm of await readdir(path.join(HOLDOUT, "results"))) {
      for (const name of (await readdir(path.join(HOLDOUT, "results", arm))).filter((file) =>
        file.endsWith(".json"),
      )) {
        const result = JSON.parse(await readFile(path.join(HOLDOUT, "results", arm, name), "utf8"));
        const question = questions.get(result.question);
        const ids = {
          sqlite: await loadRecorded(sqlite, question, result),
          pg: await loadRecorded(pg, question, result),
        };
        const fromSqlite = await services.sqlite.get(ids.sqlite);
        const fromPg = await services.pg.get(ids.pg);
        const label = `${arm} ${result.question}`;
        assert.deepEqual(fromPg, fromSqlite, `${label}: the Postgres record differs from SQLite's`);
        assert.equal(fromPg.status, result.status, `${label}: status`);
        assert.equal(passes(fromPg), result.passes, `${label}: passes`);
        assert.deepEqual(fromPg.range, result.range, `${label}: range`);
        compared += 1;
      }
    }
  } finally {
    sqlite.close();
    await pg.close();
  }
  assert.equal(compared, 45, "every held-out result");
});
