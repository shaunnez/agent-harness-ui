import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateBenchmarkRun,
  renderBenchmarkReport,
  runBenchmark,
  summariseBenchmark,
} from "../scripts/research-search-benchmark/benchmark.mjs";
import {
  ExaBenchmarkProvider,
  FirecrawlBenchmarkProvider,
  SerperBenchmarkProvider,
  TavilyBenchmarkProvider,
} from "../scripts/research-search-benchmark/providers.mjs";
import { parseBenchmarkArguments } from "../scripts/research-search-benchmark.mjs";

function response(payload) {
  return new Response(JSON.stringify(payload), { status: 200 });
}

test("provider adapters send localized search-only requests and normalize results", async () => {
  const observed = [];
  const fetchImpl = async (url, options) => {
    observed.push({ url, options, body: JSON.parse(options.body) });
    if (url.includes("serper")) {
      return response({
        organic: [{ title: "Serper result", link: "https://supplier.co.nz/p", snippet: "$20" }],
      });
    }
    if (url.includes("tavily")) {
      return response({
        results: [{ title: "Tavily result", url: "https://supplier.co.nz/p", content: "$21" }],
        request_id: "request-1",
        usage: { credits: 1 },
      });
    }
    if (url.includes("exa")) {
      return response({ results: [{ title: "Exa result", url: "https://supplier.co.nz/p" }] });
    }
    return response({
      success: true,
      data: { web: [{ title: "Firecrawl result", url: "https://supplier.co.nz/p", description: "$22" }] },
    });
  };
  const providers = [
    new SerperBenchmarkProvider({ apiKey: "serper-secret", fetchImpl }),
    new TavilyBenchmarkProvider({ apiKey: "tavily-secret", fetchImpl }),
    new ExaBenchmarkProvider({ apiKey: "exa-secret", fetchImpl }),
    new FirecrawlBenchmarkProvider({ fetchImpl }),
  ];

  const results = [];
  for (const provider of providers) {
    results.push(await provider.search({ query: "product price", market: "NZ", maxResults: 5 }));
  }

  assert.deepEqual(
    results.map((result) => [result.provider, result.results[0].rank, result.results[0].url]),
    [
      ["serper", 1, "https://supplier.co.nz/p"],
      ["tavily", 1, "https://supplier.co.nz/p"],
      ["exa", 1, "https://supplier.co.nz/p"],
      ["firecrawl", 1, "https://supplier.co.nz/p"],
    ],
  );
  assert.equal(observed[0].body.gl, "nz");
  assert.equal(observed[1].body.country, "new zealand");
  assert.equal(observed[1].body.include_answer, false);
  assert.equal(observed[1].body.include_raw_content, false);
  assert.equal(observed[2].body.userLocation, "NZ");
  assert.equal(observed[2].body.contents, undefined);
  assert.equal(observed[3].body.location, "New Zealand");
  assert.equal(observed[3].body.scrapeOptions, undefined);
  assert.equal(observed[3].options.headers.Authorization, undefined);
  assert.equal(JSON.stringify(results).includes("secret"), false);
});

test("benchmark evaluation keeps discovery signals separate and reports errors", async () => {
  const testCase = {
    id: "case-1",
    label: "NZ price",
    query: "example product price",
    market: "NZ",
    intent: "price",
    targetTerms: ["example", "product"],
    referenceHosts: ["manufacturer.example"],
    localHostSuffixes: [".nz"],
  };
  const providers = new Map([
    [
      "good",
      {
        async search() {
          return {
            provider: "good",
            request: {},
            results: [
              {
                rank: 1,
                title: "Example product data sheet PDF",
                url: "https://manufacturer.example/data-sheet.pdf",
                snippet: "Installation guide",
              },
              {
                rank: 2,
                title: "Buy example product for NZ$20",
                url: "https://supplier.co.nz/example",
                snippet: "In stock",
              },
            ],
            metadata: { durationMs: 40, estimatedCredits: 1 },
            rawResponse: {},
          };
        },
      },
    ],
    [
      "failed",
      {
        async search() {
          throw new Error("rate limited");
        },
      },
    ],
  ]);

  const runs = await runBenchmark({
    cases: [testCase],
    providers,
    selectedProviders: ["good", "failed"],
    repetitions: 1,
    maxResults: 5,
  });
  assert.deepEqual(runs[0].evaluation, {
    referenceSourceEligible: true,
    referenceSourceRank: 1,
    localDomainEligible: true,
    localResultsTop5: 1,
    priceSignalsTop5: 1,
    technicalDocumentSignalsTop5: 1,
    targetTermCoverageTop5: 1,
  });
  assert.match(runs[1].error, /rate limited/);
  const summary = summariseBenchmark(runs);
  assert.deepEqual(
    summary.map((item) => [item.provider, item.successes, item.errors]),
    [
      ["good", 1, 0],
      ["failed", 0, 1],
    ],
  );
  const report = renderBenchmarkReport({
    benchmark: {
      generatedAt: "2026-09-21T00:00:00.000Z",
      selectedProviders: ["good", "failed"],
      repetitions: 1,
      maxResults: 5,
    },
    cases: [testCase],
    runs,
    summary,
    skipped: [{ provider: "missing", reason: "no key" }],
  });
  assert.match(report, /small directional benchmark/i);
  assert.match(report, /manufacturer\.example\/data-sheet\.pdf/);
  assert.match(report, /rate limited/);
  assert.match(report, /missing: no key/);
});

test("argument parsing bounds live benchmark size", () => {
  assert.deepEqual(parseBenchmarkArguments(["--providers=firecrawl,exa", "--case=one", "--dry-run"]), {
    providers: ["firecrawl", "exa"],
    repetitions: 2,
    maxResults: 10,
    casesPath: new URL("../scripts/research-search-benchmark/cases.json", import.meta.url).pathname,
    caseIds: ["one"],
    dryRun: true,
  });
  assert.throws(() => parseBenchmarkArguments(["--repetitions=20"]), /between 1 and 5/);
  assert.throws(() => parseBenchmarkArguments(["--providers=unknown"]), /Unknown providers/);
});

test("error evaluations do not fabricate zero-quality evidence as successful results", () => {
  const evaluation = evaluateBenchmarkRun(
    {
      targetTerms: [],
      referenceHosts: [],
      localHostSuffixes: [".nz"],
    },
    { error: "failed", results: [] },
  );
  assert.equal(evaluation.referenceSourceRank, null);
  assert.equal(evaluation.localDomainEligible, true);
  assert.equal(evaluation.localResultsTop5, 0);
});
