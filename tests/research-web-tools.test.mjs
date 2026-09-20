import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  fetchValidatedSource,
  ResearchWebTools,
  verifySnapshotEvidence,
} from "../server/research/research-web-tools.mjs";

const BUDGET = Object.freeze({ maxToolCalls: 10, maxSearchCalls: 3 });
const PUBLIC_LOOKUP = async () => [{ address: "93.184.216.34", family: 4 }];
const SOURCE_HTML =
  "<html><head><title>Manufacturer application guide</title></head><body><h1>Application</h1><p>Apply two coats to the prepared substrate.</p></body></html>";

test("the host retains a content-addressed source and accepts an exact evidence excerpt", async () => {
  await withTools(async ({ tools, directory }) => {
    const search = await tools.invoke("web_search", { query: "waterproofing application" });
    assert.equal(search.result.results.length, 1);
    assert.equal(search.budgetState.searchCallsUsed, 1);

    const fetched = await tools.invoke("fetch_source", { url: search.result.results[0].url });
    assert.match(fetched.result.source.snapshotRef, /^sha256:[a-f0-9]{64}$/);
    assert.match(fetched.result.content, /Apply two coats/);
    const snapshots = await readdir(directory);
    assert.deepEqual(snapshots, [`${fetched.result.source.contentSha256}.txt`]);

    const excerpt = "Apply two coats to the prepared substrate.";
    const submitted = await tools.invoke("submit_finding", {
      claim: "The manufacturer calls for two coats.",
      evidence: [
        {
          sourceId: fetched.result.source.id,
          excerpt,
          locator: { section: "Application" },
          authority: "primary",
        },
      ],
      confidence: 0.9,
    });
    assert.equal(submitted.result.evidence[0].quoteVerified, true);
    assert.equal(
      await verifySnapshotEvidence({
        source: fetched.result.source,
        reference: submitted.result.evidence[0],
        snapshotDirectory: directory,
      }),
      true,
    );
    assert.equal(submitted.budgetState.toolCallsUsed, 3);
  });
});

test("the same normalized content has a stable hash and does not overwrite its snapshot", async () => {
  await withTools(async ({ tools, directory }) => {
    const first = await tools.invoke("fetch_source", { url: "https://example.test/one" });
    const second = await tools.invoke("fetch_source", { url: "https://example.test/two" });
    assert.equal(first.result.source.contentSha256, second.result.source.contentSha256);
    assert.equal((await readdir(directory)).length, 1);
  });
});

test("evidence is rejected when the excerpt is not retained, belongs to another run, or claims verification", async () => {
  await withTools(async ({ tools, directory }) => {
    const fetched = await tools.invoke("fetch_source", { url: "https://example.test/source" });
    await assert.rejects(
      tools.invoke("submit_finding", {
        claim: "Unsupported claim",
        evidence: [{ sourceId: fetched.result.source.id, excerpt: "This text is absent." }],
      }),
      (error) => error.code === "excerpt_not_found",
    );

    const otherRun = createTools({ runId: "RSCH-OTHER", directory });
    await assert.rejects(
      otherRun.invoke("submit_finding", {
        claim: "Cross-run claim",
        evidence: [{ sourceId: fetched.result.source.id, excerpt: "Apply two coats" }],
      }),
      (error) => error.code === "source_not_in_run",
    );

    await assert.rejects(
      tools.invoke("submit_finding", {
        claim: "Self-certified claim",
        evidence: [
          {
            sourceId: fetched.result.source.id,
            excerpt: "Apply two coats",
            quoteVerified: true,
          },
        ],
      }),
      (error) => error.code === "host_verification_required",
    );
  });
});

test("source fetching rejects unsupported schemes, private addresses, oversized bodies and timeouts", async () => {
  await assert.rejects(
    fetchValidatedSource("file:///etc/passwd"),
    (error) => error.code === "unsupported_url_scheme",
  );
  await assert.rejects(
    fetchValidatedSource("http://127.0.0.1/private"),
    (error) => error.code === "private_network_url",
  );
  await assert.rejects(
    fetchValidatedSource("https://user:password@example.test/private", { lookup: PUBLIC_LOOKUP }),
    (error) => error.code === "url_credentials_blocked",
  );
  await assert.rejects(
    fetchValidatedSource("https://example.test/large", {
      lookup: PUBLIC_LOOKUP,
      maxResponseBytes: 20,
      fetchImpl: async () => new Response("x".repeat(21), { headers: { "content-type": "text/plain" } }),
    }),
    (error) => error.code === "source_too_large",
  );
  await assert.rejects(
    fetchValidatedSource("https://example.test/slow", {
      lookup: PUBLIC_LOOKUP,
      timeoutMs: 20,
      fetchImpl: async (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
    }),
    (error) => error.code === "source_timeout",
  );
});

test("cancelling the run aborts an in-flight host fetch", async () => {
  const controller = new AbortController();
  const tools = new ResearchWebTools({
    runId: "RSCH-CANCEL-FETCH",
    budget: BUDGET,
    searchProvider: fixtureSearchProvider(),
    snapshotDirectory: os.tmpdir(),
    lookup: PUBLIC_LOOKUP,
    signal: controller.signal,
    fetchImpl: async (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        if (signal.aborted) reject(signal.reason);
        else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
  });
  const fetching = tools.invoke("fetch_source", { url: "https://example.test/slow" });
  controller.abort();
  await assert.rejects(fetching, (error) => error.code === "research_cancelled");
});

test("search and aggregate tool ceilings are host-enforced across tool names", async () => {
  const searchLimited = createTools({
    runId: "RSCH-SEARCH-LIMIT",
    directory: os.tmpdir(),
    budget: { maxToolCalls: 5, maxSearchCalls: 1 },
  });
  await searchLimited.invoke("web_search", { query: "first" });
  await assert.rejects(
    searchLimited.invoke("web_search", { query: "second" }),
    (error) => error.ceiling === "maxSearchCalls",
  );

  const aggregateLimited = createTools({
    runId: "RSCH-TOOL-LIMIT",
    directory: os.tmpdir(),
    budget: { maxToolCalls: 1, maxSearchCalls: 1 },
  });
  await aggregateLimited.invoke("read_context", {});
  await assert.rejects(
    aggregateLimited.invoke("web_search", { query: "blocked" }),
    (error) => error.ceiling === "maxToolCalls",
  );
});

test("a search-provider failure is normalized and keeps observed call counts", async () => {
  const tools = createTools({
    runId: "RSCH-SEARCH-FAIL",
    directory: os.tmpdir(),
    searchProvider: { search: async () => Promise.reject(new Error("provider unavailable")) },
  });
  await assert.rejects(
    tools.invoke("web_search", { query: "test" }),
    (error) => error.code === "search_failed" && /provider unavailable/.test(error.message),
  );
  assert.deepEqual(
    {
      toolCallsUsed: tools.budgetState().toolCallsUsed,
      searchCallsUsed: tools.budgetState().searchCallsUsed,
    },
    { toolCallsUsed: 1, searchCallsUsed: 1 },
  );
});

async function withTools(body) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "research-web-tools-test-"));
  try {
    return await body({ tools: createTools({ runId: "RSCH-WEB", directory }), directory });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function createTools({ runId, directory, budget = BUDGET, searchProvider = fixtureSearchProvider() }) {
  return new ResearchWebTools({
    runId,
    budget,
    searchProvider,
    snapshotDirectory: directory,
    lookup: PUBLIC_LOOKUP,
    fetchImpl: async () => new Response(SOURCE_HTML, { headers: { "content-type": "text/html" } }),
  });
}

function fixtureSearchProvider() {
  return {
    async search(query) {
      return {
        results: [
          {
            title: "Manufacturer application guide",
            url: "https://example.test/application",
            snippet: "Application instructions.",
          },
        ],
        metadata: { provider: "fixture", query },
      };
    },
  };
}
