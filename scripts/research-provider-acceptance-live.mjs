import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { FallbackSearchProvider } from "../server/research/fallback-search-provider.mjs";
import { FirecrawlCaptureProvider } from "../server/research/firecrawl-capture-provider.mjs";
import { FirecrawlSearchProvider } from "../server/research/firecrawl-search-provider.mjs";
import { ProviderCreditLedger } from "../server/research/provider-credit-ledger.mjs";
import { ResearchProviderError } from "../server/research/research-provider-errors.mjs";
import { verifySnapshotEvidence } from "../server/research/research-source-snapshots.mjs";
import { ResearchWebTools } from "../server/research/research-web-tools.mjs";
import { SerperSearchProvider } from "../server/research/serper-search-provider.mjs";
import { DeepAgentsResearchRuntime } from "../server/research/deepagents/adapter.mjs";
import { createResearchRuntimeRegistry } from "../server/research/research-runtime-registry.mjs";
import { ResearchService } from "../server/research/research-service.mjs";
import { ResearchStore } from "../server/research/research-store.mjs";
import { migrateSqliteSchema } from "../server/sqlite-storage.mjs";

export async function runResearchProviderAcceptance({ environment, manifest }) {
  const sessionId = new Date().toISOString().replace(/[:.]/g, "-");
  const sessionDirectory = path.resolve(".data", "research-runtime-acceptance", sessionId);
  await mkdir(sessionDirectory, { recursive: true, mode: 0o700 });
  const firecrawlLedger = new ProviderCreditLedger({
    provider: "firecrawl",
    ceiling: manifest.limits.firecrawlCredits,
  });
  const serperLedger = new ProviderCreditLedger({
    provider: "serper",
    ceiling: manifest.limits.serperCalls,
  });
  const assertions = [];
  const report = {
    version: 1,
    sessionId,
    status: "failed",
    liveModelCalls: 0,
    scenarios: [],
    assertions,
    usage: null,
  };
  try {
    const htmlCase = requiredCase(manifest, "nz-dynamic-price-html");
    const pdfCase = requiredCase(manifest, "au-hardie-table-pdf");
    const fallbackCase = requiredCase(manifest, "synthetic-firecrawl-failure-serper-fallback");
    const firecrawlSearch = new FirecrawlSearchProvider({
      apiKey: environment.FIRECRAWL_API_KEY,
      ledger: firecrawlLedger,
    });
    const capture = new FirecrawlCaptureProvider({
      apiKey: environment.FIRECRAWL_API_KEY,
      ledger: firecrawlLedger,
    });

    const htmlTools = new ResearchWebTools({
      runId: `ACCEPT-${sessionId}-HTML`,
      budget: toolBudget(),
      searchProvider: {
        search: (_query, options) =>
          firecrawlSearch.search(htmlCase.searchQuery, {
            ...options,
            market: htmlCase.market,
          }),
      },
      captureProvider: capture,
      providerConfig: { defaultMarket: htmlCase.market, maxPdfPages: 3 },
      snapshotDirectory: path.join(sessionDirectory, "sources"),
    });
    const htmlSearch = await htmlTools.invoke("web_search", {
      query: htmlCase.searchQuery,
      market: htmlCase.market,
    });
    assert(htmlSearch.result.results.length > 0, "HTML search returned a usable public result.", assertions);
    const firstHtml = await htmlTools.invoke("fetch_source", { url: htmlCase.url });
    const secondHtml = await htmlTools.invoke("fetch_source", { url: htmlCase.url });
    assert(
      firstHtml.result.source.id === secondHtml.result.source.id,
      "Repeated HTML fetch reused the same retained source.",
      assertions,
    );
    const identityExcerpt = findExactTerm(firstHtml.result.content, htmlCase.identityTerms);
    assert(Boolean(identityExcerpt), "HTML retained a configured product-identity term.", assertions);
    await htmlTools.invoke("submit_finding", {
      claim: "The retained public product page contains the configured product identity.",
      evidence: [
        {
          sourceId: firstHtml.result.source.id,
          excerpt: identityExcerpt,
          authority: "primary",
        },
      ],
    });
    report.scenarios.push({
      id: htmlCase.id,
      status: "passed",
      source: publicSourceReceipt(firstHtml.result.source),
      search: htmlSearch.result.results.map((result) => ({
        title: result.title,
        url: result.url,
      })),
      duplicateCaptureReused: true,
    });

    const controlledPdfSearch = {
      async search(_query, options) {
        const live = await firecrawlSearch.search(pdfCase.searchQuery, {
          ...options,
          market: pdfCase.market,
        });
        return {
          ...live,
          results: [
            {
              title: "Controlled manifest PDF selection",
              url: pdfCase.url,
              snippet:
                "The live search was executed; the deterministic fake model receives the manifest URL.",
            },
            ...live.results.filter((result) => result.url !== pdfCase.url),
          ].slice(0, 5),
          metadata: { ...live.metadata, controlledManifestSelection: pdfCase.url },
        };
      },
    };
    const db = new DatabaseSync(path.join(sessionDirectory, "tasks.sqlite3"));
    let service = null;
    try {
      db.exec("PRAGMA foreign_keys = ON");
      migrateSqliteSchema(db);
      const store = new ResearchStore(db, {
        sourceSnapshotDirectory: path.join(sessionDirectory, "sources"),
      });
      const runtime = new DeepAgentsResearchRuntime({
        checkpointDbPath: path.join(sessionDirectory, "checkpoints.sqlite3"),
        sourceSnapshotDirectory: path.join(sessionDirectory, "sources"),
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          RESEARCH_MODEL_PROVIDER: "fake",
          RESEARCH_MODEL_FAKE_SCENARIO: "pdf",
        },
        searchProvider: controlledPdfSearch,
        captureProvider: capture,
        providerConfig: { defaultMarket: pdfCase.market, maxPdfPages: 3 },
        providerLedgers: [firecrawlLedger],
      });
      service = new ResearchService({
        store,
        registry: createResearchRuntimeRegistry([runtime]),
      });
      const created = await service.createRun({
        objective: `Retain the public PDF and cite ${pdfCase.successExcerpt} on physical page ${pdfCase.successPage}.`,
        profile: "quick",
        runtimeId: "deepagents",
        context: [],
      });
      await service.settled(created.id);
      const run = await service.getRun(created.id);
      assertCompletedAcceptanceRun(run, assertions);
      const result = await service.getResult(created.id);
      const sources = await service.listSources(created.id);
      const pdfSource = sources.find((source) => source.mediaType === "application/pdf");
      assert(Boolean(pdfSource), "The fake-model run retained a PDF source.", assertions);
      const expectedReference = {
        excerpt: pdfCase.successExcerpt,
        locator: { page: pdfCase.successPage },
        snapshotRef: `sha256:${pdfSource.contentSha256}`,
      };
      assert(
        await verifySnapshotEvidence({
          source: pdfSource,
          reference: expectedReference,
          snapshotDirectory: path.join(sessionDirectory, "sources"),
        }),
        "The expected PDF excerpt verified on physical page 2.",
        assertions,
      );
      assert(
        !(await verifySnapshotEvidence({
          source: pdfSource,
          reference: {
            ...expectedReference,
            locator: { page: pdfCase.negativePage },
          },
          snapshotDirectory: path.join(sessionDirectory, "sources"),
        })),
        "The absent physical page 3 citation was rejected.",
        assertions,
      );
      assert(
        result.findings.some((finding) =>
          finding.evidence.some(
            (evidence) => evidence.locator?.page === pdfCase.successPage && evidence.quoteVerified,
          ),
        ),
        "ResearchStore independently persisted page-verified PDF evidence.",
        assertions,
      );
      const other = await store.createRun({
        runtimeId: "fake",
        request: {
          id: "",
          objective: "Cross-run evidence rejection",
          profile: "quick",
          context: [],
          budget: toolBudget(),
        },
        budget: toolBudget(),
      });
      await store.recordResult(other.id, {
        findings: [
          {
            id: "F1",
            claim: "Cross-run source must not verify.",
            producedBy: "researcher",
            evidence: [{ sourceId: pdfSource.id, ...expectedReference }],
          },
        ],
        artifacts: [],
      });
      const crossRun = await store.getResult(other.id);
      assert(
        crossRun.findings[0].evidence[0].quoteVerified === false,
        "A source identity from another run did not verify.",
        assertions,
      );
      report.scenarios.push({
        id: pdfCase.id,
        status: "passed",
        runId: created.id,
        source: publicSourceReceipt(pdfSource),
        coverage: pdfSource.metadata?.coverage ?? null,
        parserMode: pdfSource.metadata?.parserMode ?? null,
        cacheState: pdfSource.metadata?.cacheState ?? "unknown",
      });
    } finally {
      await closeAcceptanceResources(service, db);
    }

    let syntheticPrimaryCalls = 0;
    const fallback = new FallbackSearchProvider({
      primary: {
        async search() {
          syntheticPrimaryCalls += 1;
          throw new ResearchProviderError({
            provider: "firecrawl",
            operation: "search",
            category: "transient",
            fallbackEligible: true,
            message: "Synthetic pre-transport Firecrawl failure.",
            attempt: {
              provider: "firecrawl",
              operation: "search",
              certainty: "not_sent",
              synthetic: true,
              charge: 0,
            },
          });
        },
      },
      fallback: new SerperSearchProvider({
        apiKey: environment.SERPER_API_KEY,
        ledger: serperLedger,
      }),
    });
    const fallbackResult = await fallback.search(fallbackCase.searchQuery, {
      market: fallbackCase.market,
      maxResults: 5,
    });
    assert(syntheticPrimaryCalls === 1, "Synthetic Firecrawl failure occurred exactly once.", assertions);
    assert(
      fallbackResult.metadata.selectedProvider === "serper",
      "Exactly one real Serper fallback was selected.",
      assertions,
    );
    serperLedger.close();
    report.scenarios.push({
      id: fallbackCase.id,
      status: "passed",
      primaryFailure: "synthetic pre-transport transient failure",
      selectedProvider: "serper",
      resultCount: fallbackResult.results.length,
    });

    report.usage = {
      firecrawl: firecrawlLedger.snapshot(),
      serper: serperLedger.snapshot(),
    };
    assert(
      report.usage.firecrawl.committedUpperBound <= manifest.limits.calculatedFirecrawlUpperBound,
      "Firecrawl committed upper bound stayed within the calculated 12 credits.",
      assertions,
    );
    assert(
      report.usage.serper.committedUpperBound <= manifest.limits.serperCalls,
      "Serper stayed within the one-call session allowance.",
      assertions,
    );
    const serialized = JSON.stringify(report);
    for (const credential of [environment.FIRECRAWL_API_KEY, environment.SERPER_API_KEY])
      assert(
        !serialized.includes(credential),
        "The acceptance report contains no provider credential values.",
        assertions,
      );
    report.status = "passed";
  } catch (error) {
    firecrawlLedger.close();
    serperLedger.close();
    report.failure = {
      code: error?.code ?? error?.category ?? "acceptance_failed",
      message: safeMessage(error),
    };
    report.usage = {
      firecrawl: firecrawlLedger.snapshot(),
      serper: serperLedger.snapshot(),
    };
  }
  return report;
}

function requiredCase(manifest, id) {
  const scenario = manifest.scenarios.find((candidate) => candidate.id === id);
  if (!scenario) throw new Error(`Acceptance manifest is missing ${id}.`);
  return scenario;
}

function toolBudget() {
  return {
    maxResearchers: 1,
    maxConcurrentResearchers: 1,
    maxDepth: 1,
    maxRuntimeMs: 180_000,
    maxModelCalls: 10,
    maxToolCalls: 12,
    maxSearchCalls: 2,
  };
}

function findExactTerm(content, terms) {
  for (const term of terms) {
    const match = content.match(new RegExp(escapeRegExp(term), "i"));
    if (match) return match[0];
  }
  return null;
}

function publicSourceReceipt(source) {
  return {
    id: source.id,
    url: source.url,
    mediaType: source.mediaType,
    contentSha256: source.contentSha256,
    contentBytes: source.contentBytes,
    retrievedAt: source.retrievedAt,
    metadata: source.metadata,
  };
}

function assert(condition, message, assertions) {
  assertions.push({ message, passed: Boolean(condition) });
  if (!condition) throw new Error(message);
}

export function assertCompletedAcceptanceRun(run, assertions) {
  const message = "The deterministic fake-model PDF run completed.";
  const passed = run?.status === "completed";
  assertions.push({ message, passed });
  if (passed) return;
  const error = new Error(
    `The deterministic fake-model PDF run failed: ${safeMessage(run?.error?.message ?? run?.status)}`,
  );
  error.code = run?.error?.code ?? "acceptance_pdf_run_failed";
  throw error;
}

export async function closeAcceptanceResources(service, database) {
  try {
    await service?.shutdown();
  } finally {
    database.close();
  }
}

function safeMessage(error) {
  const message = String(error?.message ?? error ?? "Acceptance failed.");
  return message.slice(0, 500).replace(/https?:\/\/\S+/g, "[redacted-url]");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
