import assert from "node:assert/strict";
import test from "node:test";
import {
  parseCurrentPdfGateArguments,
  renderCurrentPdfGateReport,
} from "../scripts/research-current-pdf-gate.mjs";
import { renderPdfGateReport, summarisePdfGate } from "../scripts/research-pdf-gate/benchmark.mjs";
import { PlanCheckPdfProvider } from "../scripts/research-pdf-gate/providers.mjs";
import { parsePdfGateArguments } from "../scripts/research-pdf-gate.mjs";

const testCase = {
  id: "public-pdf",
  localFilename: "public.pdf",
  sourceSha256: "source-hash",
  maxPages: 3,
};

test("legacy PlanCheck adapter validates source identity and does not expose credentials", async () => {
  const calls = [];
  const provider = new PlanCheckPdfProvider({
    repositoryPath: "/plancheck",
    sourceDirectory: "/sources",
    adapterPath: "/adapter.py",
    executeVision: true,
    commandRunner: async (command, args, options) => {
      calls.push({ command, args, options });
      return {
        stdout: JSON.stringify({
          sourceSha256: "source-hash",
          sourceBytes: 10,
          totalPages: 8,
          parsedPageLimit: 3,
          sparsePages: [2],
          content: "=== Page 1 ===\nalpha",
          pages: [{ pageNumber: 1, content: "alpha" }],
          pagesFromText: 2,
          pagesFromVision: 1,
          pagesMissing: [],
          visionCalls: 1,
          durationMs: 12,
        }),
      };
    },
  });
  const result = await provider.retrieve(testCase);
  assert.equal(result.provider, "plancheck-legacy-assessment");
  assert.equal(result.metadata.extractorRoute, "legacy-assessment-text-extraction");
  assert.equal(result.metadata.pagesFromVision, 1);
  assert.equal(result.metadata.originalSourceBytesRetained, true);
  assert.equal(calls[0].args.includes("--execute-vision"), true);
  assert.equal(JSON.stringify(result).includes("ANTHROPIC_API_KEY"), false);
});

test("legacy PlanCheck adapter refuses path traversal and source drift", async () => {
  const provider = new PlanCheckPdfProvider({
    repositoryPath: "/plancheck",
    sourceDirectory: "/sources",
    adapterPath: "/adapter.py",
    commandRunner: async () => ({ stdout: JSON.stringify({ sourceSha256: "changed" }) }),
  });
  await assert.rejects(() => provider.plan(testCase), /Source hash mismatch/);
  await assert.rejects(
    () => provider.plan({ ...testCase, localFilename: "../private.pdf" }),
    /Unsafe local source filename/,
  );
});

test("PDF gate has explicit paid-call ceilings", () => {
  const options = parsePdfGateArguments(["--execute-vision", "--max-firecrawl-credits=90"]);
  assert.equal(options.executeVision, true);
  assert.equal(options.maxFirecrawlCredits, 90);
  assert.equal(options.maxPlanCheckVisionPages, 25);
  assert.throws(() => parsePdfGateArguments(["--max-plancheck-vision-pages=201"]), /between 0 and 200/);
});

test("current PDF replacement gate is separately guarded and cost bounded", () => {
  const options = parseCurrentPdfGateArguments(["--dry-run", "--max-usd=0.5"]);
  assert.equal(options.dryRun, true);
  assert.equal(options.maxUsd, 0.5);
  assert.throws(() => parseCurrentPdfGateArguments(["--max-usd=0"]), /greater than zero/);
  assert.throws(() => parseCurrentPdfGateArguments(["--max-usd=11"]), /no more than 10/);
});

test("current PDF replacement report distinguishes retained Firecrawl evidence and visual misses", () => {
  const evaluation = {
    expectedTermsFound: 1,
    expectedTermsTotal: 2,
    pageAnchorsFound: 1,
    pageAnchorsTotal: 2,
  };
  const run = (provider, usage = {}) => ({
    provider,
    content: "Appendix 2: Plans",
    evaluation,
    metadata: {
      durationMs: 10,
      extractionComplete: true,
      incompletePages: [],
      policyBlocked: [],
      usage,
    },
  });
  const report = renderCurrentPdfGateReport({
    generatedAt: "2026-09-21T00:00:00.000Z",
    testCase: {
      url: "https://example.com/public.pdf",
      sourceSha256: "abc",
      maxPages: 1,
      expectedTerms: ["Appendix 2: Plans", "Plan of Garage"],
    },
    plancheck: {
      totalPages: 1,
      extractorRoute: "current-detection-transcription",
      transcriptionModel: "claude-haiku-4-5",
      escalationModel: "claude-sonnet-5",
      maxUsd: 1,
      cold: {
        pages: [
          {
            pageNumber: 1,
            source: "transcription",
            textCharacters: 10,
            truncated: false,
            reproducible: true,
          },
        ],
      },
      warm: { pages: [{ pageNumber: 1, source: "transcription", fromCache: true }] },
    },
    cold: run("plancheck-current-detection-cold", {
      providerCallsReturned: 1,
      cacheHits: 0,
      knownUsd: 0.01,
      accountingComplete: true,
    }),
    warm: run("plancheck-current-detection-warm", {
      providerCallsReturned: 0,
      cacheHits: 1,
      knownUsd: 0,
      accountingComplete: true,
    }),
    firecrawl: run("firecrawl"),
  });
  assert.match(report, /made no new Firecrawl request/i);
  assert.match(report, /current-detection-transcription/);
  assert.match(report, /Plan of Garage.*City of Perth/s);
  assert.match(report, /Equal automated scores.*not perfect OCR/i);
});

test("report preserves public-only and private-document boundaries", () => {
  const report = renderPdfGateReport({
    benchmark: {
      generatedAt: "2026-09-21T00:00:00.000Z",
      estimatedFirecrawlCredits: 4,
      estimatedPlanCheckVisionCalls: 1,
    },
    cases: [
      {
        ...testCase,
        label: "Public PDF",
        market: "NZ",
        profile: "scan",
        url: "https://example.com/public.pdf",
        pdfMode: "ocr",
      },
    ],
    plans: [{ caseId: testCase.id, totalPages: 8, sparsePages: [2] }],
    runs: [],
    summary: [],
  });
  assert.match(report, /No customer, tender, or private document/i);
  assert.match(report, /zero-data-retention for parsed documents is an Enterprise control/i);
  assert.match(report, /Private PlanCheck documents therefore remain local/i);
  assert.match(report, /not the current detection worker/i);
  assert.match(report, /does not establish that Firecrawl outperforms the current application/i);
});

test("PDF gate reports incomplete extraction as partial, not success", () => {
  const evaluation = {
    expectedTermsFound: 1,
    expectedTermsTotal: 2,
    pageAnchorsFound: 0,
    pageAnchorsTotal: 1,
    tableChecksFound: 0,
    tableChecksTotal: 0,
  };
  const summary = summarisePdfGate([
    {
      provider: "plancheck-legacy-assessment",
      evaluation,
      metadata: {
        durationMs: 100,
        extractionComplete: false,
        pagesMissing: [2],
        visionCalls: 1,
      },
    },
  ]);
  assert.equal(summary[0].complete, 0);
  assert.equal(summary[0].partial, 1);
  assert.equal(summary[0].pagesMissing, 1);
  assert.equal(summary[0].termHitRate, 0.5);
});
