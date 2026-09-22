import assert from "node:assert/strict";
import test from "node:test";
import {
  estimateFirecrawlCredits,
  evaluateRetrieval,
  renderRetrievalReport,
  runRetrievalBenchmark,
  summariseRetrievalBenchmark,
} from "../scripts/research-retrieval-benchmark/benchmark.mjs";
import {
  ExaRetrievalProvider,
  FirecrawlRetrievalProvider,
} from "../scripts/research-retrieval-benchmark/providers.mjs";
import { parseRetrievalBenchmarkArguments } from "../scripts/research-retrieval-benchmark.mjs";

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const pdfCase = {
  id: "pdf",
  kind: "pdf",
  url: "https://example.com/source.pdf",
  maxPages: 3,
  expectedTerms: ["alpha", "table value"],
  pageAnchors: [{ page: 2, text: "table value" }],
  tableChecks: [{ label: "row", cells: ["R2.0", "1.93"] }],
};

test("managed adapters request extraction without provider reasoning and normalize evidence", async () => {
  const observed = [];
  const fetchImpl = async (url, options) => {
    observed.push({ url, headers: options.headers, body: JSON.parse(options.body) });
    if (url.includes("firecrawl")) {
      return jsonResponse({
        success: true,
        data: {
          markdown: "alpha\n\ntable value R2.0 1.93",
          pages: [
            { pageNumber: 1, markdown: "alpha" },
            { pageNumber: 2, markdown: "table value R2.0 1.93" },
          ],
          blocks: [{ pageNumber: 1 }, { pageNumber: 2 }],
          metadata: { numPages: 2, totalPages: 9, sourceURL: pdfCase.url },
        },
      });
    }
    return jsonResponse({
      results: [{ url: pdfCase.url, title: "Document", text: "alpha table value R2.0 1.93" }],
      statuses: [{ status: "success" }],
    });
  };
  const firecrawl = await new FirecrawlRetrievalProvider({ apiKey: "fc-secret", fetchImpl }).retrieve(
    pdfCase,
  );
  const exa = await new ExaRetrievalProvider({ apiKey: "exa-secret", fetchImpl }).retrieve(pdfCase);

  assert.equal(firecrawl.pages[1].pageNumber, 2);
  assert.equal(firecrawl.metadata.estimatedCredits, 3);
  assert.equal(firecrawl.metadata.layoutBlockPages, 2);
  assert.equal(exa.pages.length, 0);
  assert.equal(exa.metadata.estimatedCostUsd, 0.001);
  assert.deepEqual(observed[0].body.formats, ["markdown"]);
  assert.equal(observed[0].body.parsers[0].pages, true);
  assert.equal(observed[0].body.parsers[0].blocks, true);
  assert.equal(observed[0].body.parsers[0].pageMarkers, true);
  assert.equal(observed[1].body.text, true);
  assert.equal(JSON.stringify([firecrawl, exa]).includes("secret"), false);
});

test("evaluation separates text recovery from physical page attribution", () => {
  const exaLike = {
    content: "alpha table value R2.0 1.93",
    pages: [],
  };
  const firecrawlLike = {
    ...exaLike,
    pages: [{ pageNumber: 2, content: "table value R2.0 1.93" }],
  };
  assert.deepEqual(evaluateRetrieval(pdfCase, exaLike), {
    expectedTermsFound: 2,
    expectedTermsTotal: 2,
    termHitRate: 1,
    pageAnchorsFound: 0,
    pageAnchorsTotal: 1,
    pageAttributionRate: 0,
    tableChecksFound: 1,
    tableChecksTotal: 1,
    priceSignalFound: false,
  });
  assert.equal(evaluateRetrieval(pdfCase, firecrawlLike).pageAttributionRate, 1);
});

test("runner records provider failures and repeat determinism", async () => {
  const providers = new Map([
    [
      "stable",
      {
        async retrieve() {
          return {
            provider: "stable",
            content: "alpha table value R2.0 1.93",
            pages: [{ pageNumber: 2, content: "table value" }],
            contentSha256: "same",
            metadata: { durationMs: 10 },
          };
        },
      },
    ],
    [
      "failed",
      {
        async retrieve() {
          throw new Error("blocked");
        },
      },
    ],
  ]);
  const runs = await runRetrievalBenchmark({
    cases: [pdfCase],
    providers,
    selectedProviders: ["stable", "failed"],
    repetitions: 2,
  });
  const summary = summariseRetrievalBenchmark(runs);
  assert.deepEqual(
    summary.map((item) => [item.provider, item.successes, item.errors]),
    [
      ["stable", 2, 0],
      ["failed", 0, 2],
    ],
  );
  assert.equal(summary[0].deterministicRate, 1);
  assert.match(runs[2].error, /blocked/);
});

test("argument parsing and Firecrawl preflight bound live usage", () => {
  assert.deepEqual(
    parseRetrievalBenchmarkArguments(["--providers=local,firecrawl", "--case=one", "--dry-run"]),
    {
      providers: ["local", "firecrawl"],
      repetitions: 2,
      casesPath: new URL("../scripts/research-retrieval-benchmark/cases.json", import.meta.url).pathname,
      caseIds: ["one"],
      maxFirecrawlCredits: 50,
      dryRun: true,
    },
  );
  assert.equal(estimateFirecrawlCredits([pdfCase, { kind: "html" }], 2), 10);
  assert.throws(() => parseRetrievalBenchmarkArguments(["--repetitions=4"]), /between 1 and 3/);
  assert.throws(() => parseRetrievalBenchmarkArguments(["--providers=unknown"]), /Unknown providers/);
});

test("report states storage and cost boundaries", () => {
  const run = {
    caseId: pdfCase.id,
    provider: "local",
    repetition: 1,
    content: "alpha table value R2.0 1.93",
    pages: [{ pageNumber: 2, content: "table value" }],
    contentSha256: "0123456789abcdef",
    metadata: { durationMs: 10, characterCount: 27 },
  };
  run.evaluation = evaluateRetrieval(pdfCase, run);
  const report = renderRetrievalReport({
    benchmark: {
      generatedAt: "2026-09-21T00:00:00.000Z",
      selectedProviders: ["local"],
      repetitions: 1,
      estimatedMaximumFirecrawlCredits: 0,
    },
    cases: [pdfCase],
    runs: [run],
    summary: summariseRetrievalBenchmark([run]),
    skipped: [],
  });
  assert.match(report, /original PDF bytes are not retained/i);
  assert.match(report, /unique source captures/i);
  assert.match(report, /Physical-page anchors/);
});
