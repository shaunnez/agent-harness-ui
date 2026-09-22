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
    fetchValidatedSource("https://example.test/disguised", {
      lookup: PUBLIC_LOOKUP,
      fetchImpl: async () => new Response("%PDF-disguised", { headers: { "content-type": "text/plain" } }),
    }),
    (error) => error.code === "unsupported_media_type",
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

test("PDF capture is deduplicated, readable by physical page and page-grounded", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "research-pdf-tools-"));
  let captures = 0;
  try {
    const tools = new ResearchWebTools({
      runId: "RSCH-PDF",
      budget: BUDGET,
      searchProvider: fixtureSearchProvider(),
      captureProvider: {
        async capture() {
          captures += 1;
          await new Promise((resolve) => setTimeout(resolve, 10));
          return {
            mediaType: "application/pdf",
            content: "",
            pages: [],
            validatedPdf: {
              totalPages: 2,
              parsedPages: 2,
              pageCap: 3,
              coverage: "complete",
              capTruncated: false,
              pages: [
                { pageNumber: 1, content: `${"x".repeat(50_100)} page one` },
                { pageNumber: 2, content: "THERMAL PERFORMANCE is retained here." },
              ],
            },
            metadata: { provider: "fixture", finalUrl: "https://example.test/guide.pdf", title: "Guide" },
          };
        },
      },
      providerConfig: { defaultMarket: "NZ", maxPdfPages: 3 },
      snapshotDirectory: directory,
      lookup: PUBLIC_LOOKUP,
    });
    const [first, second] = await Promise.all([
      tools.invoke("fetch_source", { url: "https://example.test/guide.pdf#one" }),
      tools.invoke("fetch_source", { url: "https://example.test/guide.pdf#two" }),
    ]);
    assert.equal(captures, 1);
    assert.equal(first.result.source.id, second.result.source.id);
    assert.equal(first.result.contentTruncated, true);

    const late = await tools.invoke("read_source", { sourceId: first.result.source.id, page: 2 });
    assert.match(late.result.content, /THERMAL PERFORMANCE/);
    const finding = await tools.invoke("submit_finding", {
      claim: "The guide includes thermal performance.",
      evidence: [{ sourceId: first.result.source.id, excerpt: "THERMAL PERFORMANCE", locator: { page: 2 } }],
    });
    assert.equal(finding.result.evidence[0].quoteVerified, true);
    await assert.rejects(
      tools.invoke("submit_finding", {
        claim: "Wrong page",
        evidence: [
          { sourceId: first.result.source.id, excerpt: "THERMAL PERFORMANCE", locator: { page: 1 } },
        ],
      }),
      (error) => error.code === "excerpt_not_found",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("capped PDF coverage keeps a missing OCR phrase unresolved rather than verified absent", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "research-capped-pdf-"));
  try {
    const tools = new ResearchWebTools({
      runId: "RSCH-CAPPED-PDF",
      budget: BUDGET,
      searchProvider: fixtureSearchProvider(),
      captureProvider: {
        async capture() {
          return {
            mediaType: "application/pdf",
            content: "",
            pages: [],
            validatedPdf: {
              totalPages: 5,
              parsedPages: 2,
              pageCap: 2,
              coverage: "capped",
              capTruncated: true,
              pages: [
                { pageNumber: 1, content: "Cover" },
                { pageNumber: 2, content: "Contents without the target phrase" },
              ],
            },
            metadata: { provider: "fixture", finalUrl: "https://example.test/scan.pdf" },
          };
        },
      },
      providerConfig: { defaultMarket: "NZ", maxPdfPages: 2 },
      snapshotDirectory: directory,
      lookup: PUBLIC_LOOKUP,
    });
    const fetched = await tools.invoke("fetch_source", { url: "https://example.test/scan.pdf" });
    await assert.rejects(
      tools.invoke("submit_finding", {
        claim: "The plan is present.",
        evidence: [
          {
            sourceId: fetched.result.source.id,
            excerpt: "Plan of Garage",
            locator: { page: 2 },
          },
        ],
      }),
      (error) => error.code === "excerpt_not_found",
    );
    assert.match(tools.unresolvedCoverageWarnings()[0], /beyond page 2 remains unresolved/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("host tools classify their own run deadline and publish no late result", async () => {
  const tools = new ResearchWebTools({
    runId: "RSCH-DEADLINE",
    budget: { ...BUDGET, maxRuntimeMs: 15 },
    searchProvider: {
      async search(_query, { signal }) {
        return new Promise((_resolve, reject) => {
          if (signal.aborted) reject(signal.reason);
          else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      },
    },
    snapshotDirectory: os.tmpdir(),
    lookup: PUBLIC_LOOKUP,
  });
  await assert.rejects(
    tools.invoke("web_search", { query: "deadline" }),
    (error) => error.code === "deadline_exceeded",
  );
  tools.close();
});

test("failed captures are retained per run and do not trigger a second paid attempt", async () => {
  let captures = 0;
  const tools = new ResearchWebTools({
    runId: "RSCH-FAILED-DEDUPE",
    budget: BUDGET,
    searchProvider: fixtureSearchProvider(),
    captureProvider: {
      async capture() {
        captures += 1;
        const error = new Error("safe failure");
        error.category = "invalid_response";
        throw error;
      },
    },
    providerConfig: { defaultMarket: "NZ", maxPdfPages: 3 },
    snapshotDirectory: os.tmpdir(),
    lookup: PUBLIC_LOOKUP,
  });
  await assert.rejects(tools.invoke("fetch_source", { url: "https://example.test/fail" }));
  await assert.rejects(tools.invoke("fetch_source", { url: "https://example.test/fail" }));
  assert.equal(captures, 1);
});

test("capture fallback is one safe local HTML attempt and never applies to PDFs or terminal failures", async () => {
  let localCalls = 0;
  const directory = await mkdtemp(path.join(os.tmpdir(), "research-fallback-"));
  const transientCapture = {
    async capture() {
      const error = new Error("safe transient failure");
      error.category = "transient";
      error.fallbackEligible = true;
      error.attempt = { provider: "firecrawl", operation: "capture" };
      throw error;
    },
  };
  const tools = new ResearchWebTools({
    runId: "RSCH-CAPTURE-FALLBACK",
    budget: BUDGET,
    searchProvider: fixtureSearchProvider(),
    captureProvider: transientCapture,
    providerConfig: { defaultMarket: "NZ", maxPdfPages: 3 },
    snapshotDirectory: directory,
    lookup: PUBLIC_LOOKUP,
    fetchImpl: async () => {
      localCalls += 1;
      return new Response(SOURCE_HTML, { headers: { "content-type": "text/html" } });
    },
  });
  const captured = await tools.invoke("fetch_source", { url: "https://example.test/page" });
  assert.equal(captured.result.source.metadata.provider, "local");
  assert.equal(localCalls, 1);

  await assert.rejects(
    tools.invoke("fetch_source", { url: "https://example.test/document.pdf" }),
    (error) => error.code === "transient",
  );
  assert.equal(localCalls, 1);

  const cancelled = new ResearchWebTools({
    runId: "RSCH-CAPTURE-CANCELLED",
    budget: BUDGET,
    searchProvider: fixtureSearchProvider(),
    captureProvider: {
      async capture() {
        const error = new Error("cancelled");
        error.category = "cancelled";
        error.fallbackEligible = true;
        throw error;
      },
    },
    providerConfig: { defaultMarket: "NZ", maxPdfPages: 3 },
    snapshotDirectory: os.tmpdir(),
    lookup: PUBLIC_LOOKUP,
    fetchImpl: async () => {
      localCalls += 1;
      return new Response(SOURCE_HTML, { headers: { "content-type": "text/html" } });
    },
  });
  await assert.rejects(
    cancelled.invoke("fetch_source", { url: "https://example.test/cancelled" }),
    (error) => error.code === "cancelled",
  );
  assert.equal(localCalls, 1);
  await rm(directory, { recursive: true, force: true });
});

test("public Firecrawl mode rejects document context before any capture", () => {
  assert.throws(
    () =>
      new ResearchWebTools({
        runId: "RSCH-PRIVATE",
        budget: BUDGET,
        context: [{ type: "document", id: "private" }],
        searchProvider: fixtureSearchProvider(),
        captureProvider: { capture: async () => null },
      }),
    /refuses non-empty document context/,
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
