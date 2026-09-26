// Tool answers shared across runs: a second run's identical search, page or QV read is answered
// from the cache and says so, each run still retains its own snapshot and its own shown rows,
// failures are never kept, and the Postgres store serves the same answers to another worker.

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  MemoryToolCacheStore,
  searchCacheKey,
  ToolCache,
} from "@eversor/research-engine/engine/tool-cache.mjs";
import { migrateResearchSchema } from "@eversor/research-engine/pg/schema.mjs";
import { PgToolCacheStore } from "@eversor/research-engine/pg/tool-cache-store.mjs";
import { PlanCheckQvSession } from "@eversor/research-engine/qv-plancheck.mjs";
import { ResearchWebTools } from "@eversor/research-engine/research-web-tools.mjs";
import { openDatabase } from "@eversor/research-service/src/db.mjs";

const BUDGET = Object.freeze({ maxToolCalls: 20, maxSearchCalls: 10 });
const PUBLIC_LOOKUP = async () => [{ address: "93.184.216.34", family: 4 }];
const SOURCE_HTML =
  "<html><head><title>Price list</title></head><body><p>Supply and fix: $120 per m2.</p></body></html>";

function counted() {
  const calls = { search: 0, fetch: 0 };
  return {
    calls,
    searchProvider: {
      async search(query) {
        calls.search += 1;
        return {
          results: [{ title: "Price list", url: "https://example.test/prices", snippet: "Supply and fix." }],
          metadata: { provider: "fixture", query },
        };
      },
    },
    fetchImpl: async () => {
      calls.fetch += 1;
      return new Response(SOURCE_HTML, { headers: { "content-type": "text/html" } });
    },
  };
}

function tools({ runId, directory, toolCache, stub }) {
  return new ResearchWebTools({
    runId,
    budget: BUDGET,
    searchProvider: stub.searchProvider,
    snapshotDirectory: directory,
    lookup: PUBLIC_LOOKUP,
    fetchImpl: stub.fetchImpl,
    toolCache,
  });
}

async function withDirectory(body) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "research-tool-cache-"));
  try {
    return await body(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("a second run's identical search and page come from the cache and say when they were fetched", async () => {
  await withDirectory(async (directory) => {
    const stub = counted();
    const toolCache = new ToolCache();
    const first = tools({ runId: "RSCH-1", directory, toolCache, stub });
    const second = tools({ runId: "RSCH-2", directory, toolCache, stub });

    const searched = await first.invoke("web_search", { query: "Roofing  price" });
    const again = await second.invoke("web_search", { query: "roofing price" });
    assert.equal(stub.calls.search, 1);
    assert.deepEqual(again.result.results, searched.result.results);
    // Each run still counts its own search against its own budget.
    assert.equal(again.budgetState.searchCallsUsed, 1);

    const fetched = await first.invoke("fetch_source", { url: "https://example.test/prices" });
    const reused = await second.invoke("fetch_source", { url: "https://example.test/prices" });
    assert.equal(stub.calls.fetch, 1);
    assert.equal(fetched.result.source.metadata.cachedCaptureAt, undefined);
    assert.match(reused.result.source.metadata.cachedCaptureAt, /^\d{4}-\d\d-\d\dT/);
    // The same page text, so the same content-addressed snapshot, retained by each run.
    assert.equal(reused.result.source.contentSha256, fetched.result.source.contentSha256);
    assert.equal(reused.result.source.id, "source-1");
    assert.equal(toolCache.stats().hits, 2);
  });
});

test("two runs asking at once share one fetch, and a failure is not kept", async () => {
  const toolCache = new ToolCache();
  let computes = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const slow = async () => {
    computes += 1;
    await gate;
    return { answer: 42 };
  };
  const both = Promise.all([
    toolCache.remember("search", "k", slow),
    toolCache.remember("search", "k", slow),
  ]);
  release();
  const [a, b] = await both;
  assert.equal(computes, 1);
  assert.deepEqual([a.value, b.value], [{ answer: 42 }, { answer: 42 }]);
  a.value.answer = 0;
  assert.equal(b.value.answer, 42, "each caller gets its own copy");

  let attempts = 0;
  const flaky = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("timed out");
    return "ok";
  };
  await assert.rejects(toolCache.remember("capture", "page", flaky), /timed out/);
  assert.equal((await toolCache.remember("capture", "page", flaky)).value, "ok");
  assert.equal(attempts, 2);
});

test("a run sharing another run's fetch fetches for itself when that one fails", async () => {
  const toolCache = new ToolCache();
  let calls = 0;
  const first = toolCache.remember("capture", "page", async () => {
    calls += 1;
    throw new Error("the other run was cancelled");
  });
  const second = toolCache.remember("capture", "page", async () => {
    calls += 1;
    return "text";
  });
  await assert.rejects(first, /cancelled/);
  assert.equal((await second).value, "text");
  assert.equal(calls, 2);
});

test("an answer older than the time to live is fetched again", async () => {
  let clock = Date.parse("2026-09-26T00:00:00Z");
  const toolCache = new ToolCache({ ttlMs: 60_000, now: () => clock, store: new MemoryToolCacheStore() });
  let computes = 0;
  const compute = async () => ++computes;
  assert.equal((await toolCache.remember("qv", "u", compute)).value, 1);
  clock += 30_000;
  assert.equal((await toolCache.remember("qv", "u", compute)).value, 1);
  clock += 31_000;
  assert.equal((await toolCache.remember("qv", "u", compute)).value, 2);
});

test("search keys ignore case and spacing but not the market", () => {
  assert.equal(searchCacheKey(" Roof  Price ", "nz"), searchCacheKey("roof price", "NZ"));
  assert.notEqual(searchCacheKey("roof price", "NZ"), searchCacheKey("roof price", "AU"));
});

test("QV reads are shared, and each run's citations still check only the rows it was shown", async () => {
  const SHA = "a".repeat(64);
  const row = {
    id: "uuid-1",
    trade: "Roofing",
    section: "Longrun",
    group_label: "Corrugate",
    description: "0.40mm corrugate",
    unit: "m2",
    regional_values: { Auckland: { low: 60, high: 60 } },
    provenance: { url: "https://qv.test/roofing/", source_rows: [`${SHA}:t1:r1`] },
  };
  let requests = 0;
  const fetchImpl = async () => {
    requests += 1;
    return Response.json({ rows: [row] });
  };
  const toolCache = new ToolCache();
  const tokens = { token: async () => "t", refused: async () => null };
  const session = () =>
    new PlanCheckQvSession({ baseUrl: "http://plancheck.test", tokens, fetchImpl, cache: toolCache });
  const one = session();
  const two = session();
  const three = session();
  await one.invoke("search_qv", { query: "corrugate" });
  await two.invoke("search_qv", { query: "corrugate" });
  assert.equal(requests, 1);
  assert.ok(two.citationRows().get(`${SHA}:t1:r1`));
  assert.equal(three.citationRows().get(`${SHA}:t1:r1`), null, "a run never shown the row cannot cite it");
});

test("the Postgres store shares answers between workers and prunes old ones", async () => {
  const db = await openDatabase("pglite:memory");
  try {
    await migrateResearchSchema(db);
    let clock = Date.parse("2026-09-26T00:00:00Z");
    const now = () => clock;
    const workerA = new ToolCache({ store: new PgToolCacheStore(db, { now }), now });
    const workerB = new ToolCache({ store: new PgToolCacheStore(db, { now }), now });
    let computes = 0;
    await workerA.remember("search", "q", async () => ({ results: [++computes] }));
    const shared = await workerB.remember("search", "q", async () => ({ results: [++computes] }));
    assert.deepEqual(shared.value, { results: [1] });
    assert.equal(shared.hit, true);
    clock += 25 * 60 * 60_000;
    assert.equal(await new PgToolCacheStore(db, { now }).prune(), 1);
  } finally {
    await db.close();
  }
});
