// The pilot session runner (plan §Q3, §Q4).
//
// It wraps the accepted runtime rather than reimplementing it: `DeepAgentsResearchRuntime`,
// the provider resolver's own providers, the shared credit ledgers and `ResearchStore` are all
// the ones the previous slice accepted. What is new here is the *session*: one admission
// decision for four cases, one provider ledger no case can reset, sequential execution, and a
// stop rule that distinguishes an ordinary quality failure from a contract failure.

import path from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { DeepAgentsResearchRuntime } from "../../server/research/deepagents/adapter.mjs";
import { FallbackSearchProvider } from "../../server/research/fallback-search-provider.mjs";
import { FirecrawlCaptureProvider } from "../../server/research/firecrawl-capture-provider.mjs";
import { FirecrawlSearchProvider } from "../../server/research/firecrawl-search-provider.mjs";
import { createResearchRuntimeRegistry } from "../../server/research/research-runtime-registry.mjs";
import { ResearchService } from "../../server/research/research-service.mjs";
import { ResearchStore } from "../../server/research/research-store.mjs";
import { verifySnapshotEvidence } from "../../server/research/research-source-snapshots.mjs";
import { SerperSearchProvider } from "../../server/research/serper-search-provider.mjs";
import { migrateSqliteSchema } from "../../server/sqlite-storage.mjs";
import {
  createSessionDirectory,
  ensureDirectory,
  safeEvent,
  writeJsonArtifact,
  writeJsonlArtifact,
} from "./artifacts.mjs";
import { assertPublicOnlyRequest, caseBudgetOverride, casePrompt, sessionBounds } from "./contracts.mjs";
import {
  assertLiveGuards,
  assertNativeRuntimeReady,
  buildPreflightReport,
  collectGitLineage,
  probeNativeRuntime,
  resolvePilotModel,
} from "./preflight.mjs";
import { ledgerDelta, PilotSessionLedger } from "./session-ledger.mjs";

export const DEFAULT_SESSION_ROOT = path.resolve(".data", "research-model-pilots");

/** Failure codes that are the model's problem, not the harness's. The session continues
 *  through these so the fixed four-case corpus stays interpretable; everything else stops it. */
const QUALITY_FAILURE_CODES = new Set([
  "model_or_tool_error",
  "model_call_ceiling_exceeded",
  "research_ceiling_exceeded",
  "graph_recursion_limit_exceeded",
  "runtime_ended_without_result",
  "research_timeout",
  // A run deadline reaches the child as SIGTERM, which the worker reports as a cancellation
  // even though no operator asked for one. An *operator* cancellation is a different thing:
  // it arrives as a terminal `cancelled` status, which `stopDecision` stops the session on.
  "research_cancelled",
]);

export function pilotSessionId(now = new Date()) {
  return now.toISOString().replace(/[:.]/g, "-");
}

export async function runModelPilotSession({
  manifest,
  manifestHash,
  manifestPath,
  environment = process.env,
  mode = "dry-run",
  sessionRoot = DEFAULT_SESSION_ROOT,
  sessionId = pilotSessionId(),
  createProviders = liveProviderFactory,
  runtimeOptions = {},
  nativeRuntimeOptions = {},
  // Seams, not switches. A deterministic test substitutes providers and guards; nothing here
  // lets an operator skip a guard, because the CLI never passes these.
  liveGuards = assertLiveGuards,
}) {
  const live = mode === "live";
  for (const entry of manifest.cases) assertPublicOnlyRequest({ objective: casePrompt(entry), context: [] });

  const runtime = live
    ? { ok: true, ...(await assertNativeRuntimeReady(nativeRuntimeOptions)) }
    : await probeNativeRuntime(nativeRuntimeOptions);
  const git = await collectGitLineage({});
  const guards = live
    ? await liveGuards({ environment, manifest, git })
    : { model: resolvePilotModel(environment, { live: false }), allowance: null };

  const providerConfig = {
    searchProvider: "firecrawl",
    searchFallback: "serper",
    captureProvider: "firecrawl",
    pdfProvider: "firecrawl",
    firecrawlPdfMode: "ocr",
    freshness: { maxAge: 0, storeInCache: false },
  };
  const preflight = buildPreflightReport({
    mode,
    manifest,
    manifestHash,
    manifestPath,
    model: guards.model,
    allowance: guards.allowance,
    git,
    runtime,
    providerConfig,
  });

  const directory = await createSessionDirectory(sessionRoot, sessionId);
  await writeJsonArtifact(path.join(directory, "preflight.json"), preflight);
  if (!live)
    return {
      mode,
      sessionId,
      directory,
      preflight,
      status: "dry-run",
      cases: [],
      ledgers: null,
      stopped: null,
    };

  const firecrawl = new PilotSessionLedger({
    provider: "firecrawl",
    ceiling: manifest.session.firecrawlSessionCeiling,
  });
  const serper = new PilotSessionLedger({ provider: "serper", ceiling: manifest.session.serperCallCeiling });
  const cases = [];
  let stopped = null;
  let sessionError = null;
  let capturesRemaining = manifest.session.maxUniqueCaptures;
  try {
    for (const entry of manifest.cases) {
      const before = { firecrawl: firecrawl.snapshot(), serper: serper.snapshot() };
      const allowedCaptures = Math.min(entry.budget.maxUniqueCaptures, capturesRemaining);
      if (allowedCaptures < 1) {
        stopped = { caseId: entry.id, reason: "session_capture_allowance_exhausted" };
        break;
      }
      let executed;
      try {
        executed = await runPilotCase({
          entry,
          directory,
          environment,
          firecrawl,
          serper,
          allowedCaptures,
          providerConfig,
          createProviders,
          runtimeOptions,
          before,
        });
      } catch (error) {
        // A case that could not even be constructed is still a retained, readable case: the
        // session stops, but it never disappears from the corpus or the report.
        executed = await recordCaseFailure({ entry, directory, error, before, firecrawl, serper });
      }
      cases.push(executed);
      capturesRemaining -= executed.capturesUsed;
      if (executed.stopSession) {
        stopped = { caseId: entry.id, reason: executed.stopReason };
        break;
      }
    }
  } catch (error) {
    sessionError = { code: error?.code ?? "pilot_session_failed", message: boundedMessage(error) };
  } finally {
    firecrawl.close();
    serper.close();
  }
  return {
    mode,
    sessionId,
    directory,
    preflight,
    status: sessionError ? "failed" : stopped ? "stopped" : "completed",
    cases,
    stopped: stopped ?? (sessionError ? { caseId: null, reason: sessionError.code } : null),
    sessionError,
    ledgers: { firecrawl: firecrawl.snapshot(), serper: serper.snapshot() },
  };
}

async function runPilotCase({
  entry,
  directory,
  environment,
  firecrawl,
  serper,
  allowedCaptures,
  providerConfig,
  createProviders,
  runtimeOptions,
  before,
}) {
  const caseDirectory = path.join(directory, "cases", entry.id);
  const snapshotDirectory = path.join(directory, "sources");
  const leases = { firecrawl: firecrawl.lease(entry.id), serper: serper.lease(entry.id) };
  const providers = createProviders({ entry, environment, leases });
  await ensureDirectory(caseDirectory);
  const database = new DatabaseSync(path.join(caseDirectory, "case.sqlite3"));
  const startedAtMs = Date.now();
  let service = null;
  let executed;
  try {
    database.exec("PRAGMA foreign_keys = ON");
    migrateSqliteSchema(database);
    const store = new ResearchStore(database, { sourceSnapshotDirectory: snapshotDirectory });
    const researchRuntime = new DeepAgentsResearchRuntime({
      checkpointDbPath: path.join(caseDirectory, "checkpoints.sqlite3"),
      sourceSnapshotDirectory: snapshotDirectory,
      env: childEnvironment(environment),
      searchProvider: providers.searchProvider,
      captureProvider: providers.captureProvider,
      providerConfig: {
        ...providerConfig,
        defaultMarket: entry.market,
        maxPdfPages: entry.budget.maxPdfPages,
      },
      providerLedgers: [leases.firecrawl, leases.serper],
      ...runtimeOptions,
      webToolsOptions: { maxUniqueCaptures: allowedCaptures, ...(runtimeOptions.webToolsOptions ?? {}) },
    });
    service = new ResearchService({
      store,
      registry: createResearchRuntimeRegistry([researchRuntime]),
    });
    const created = await service.createRun({
      objective: casePrompt(entry),
      profile: "quick",
      runtimeId: researchRuntime.id,
      context: [],
      budget: caseBudgetOverride(entry),
      metadata: { pilotCase: entry.id, pilotMarket: entry.market },
    });
    await service.settled(created.id);
    const run = await service.getRun(created.id);
    const result = await service.getResult(created.id);
    const sources = await service.listSources(created.id);
    const events = await collectEvents(service, created.id);
    const verification = await verifyFindings({ result, sources, snapshotDirectory });
    executed = { runId: created.id, run, result, sources, events, verification };
  } finally {
    // Every terminal path closes the service, the leases and the database, in that order.
    await service?.shutdown().catch(() => undefined);
    leases.firecrawl.close();
    leases.serper.close();
    database.close();
  }

  const after = { firecrawl: firecrawl.snapshot(), serper: serper.snapshot() };
  const accounting = {
    caseId: entry.id,
    durationMs: Date.now() - startedAtMs,
    model: executed.run?.usage ?? null,
    budgetState: executed.run?.budgetState ?? null,
    providers: {
      firecrawl: ledgerDelta(before.firecrawl, after.firecrawl),
      serper: ledgerDelta(before.serper, after.serper),
    },
  };
  const capturesUsed = Math.max(
    executed.sources.length,
    accounting.providers.firecrawl.attempts.filter((attempt) => attempt.operation === "capture").length,
  );
  accounting.capturesUsed = capturesUsed;
  accounting.allowedCaptures = allowedCaptures;
  const stop = stopDecision({ entry, executed, accounting });
  await writeJsonlArtifact(path.join(caseDirectory, "events.jsonl"), executed.events.map(safeEvent));
  await writeJsonArtifact(path.join(caseDirectory, "result.json"), {
    caseId: entry.id,
    runId: executed.runId,
    status: executed.run?.status ?? "failed",
    error: executed.run?.error ?? null,
    truncatedBy: executed.run?.budgetState?.ceilingHit ?? null,
    summary: executed.result?.summary ?? null,
    findings: executed.result?.findings ?? [],
    unresolvedQuestions: executed.result?.unresolvedQuestions ?? [],
    sources: executed.sources.map(sourceReceipt),
    verification: executed.verification,
  });
  await writeJsonArtifact(path.join(caseDirectory, "accounting.json"), accounting);
  return {
    id: entry.id,
    runId: executed.runId,
    status: executed.run?.status ?? "failed",
    error: executed.run?.error ?? null,
    result: executed.result,
    sources: executed.sources.map(sourceReceipt),
    verification: executed.verification,
    accounting,
    capturesUsed,
    allowedCaptures,
    stopSession: stop.stopSession,
    stopReason: stop.reason,
  };
}

async function recordCaseFailure({ entry, directory, error, before, firecrawl, serper }) {
  const caseDirectory = path.join(directory, "cases", entry.id);
  const after = { firecrawl: firecrawl.snapshot(), serper: serper.snapshot() };
  const accounting = {
    caseId: entry.id,
    durationMs: null,
    model: null,
    budgetState: null,
    providers: {
      firecrawl: ledgerDelta(before.firecrawl, after.firecrawl),
      serper: ledgerDelta(before.serper, after.serper),
    },
    capturesUsed: 0,
    allowedCaptures: 0,
  };
  const failure = { code: error?.code ?? "pilot_case_failed", message: boundedMessage(error) };
  await writeJsonArtifact(path.join(caseDirectory, "result.json"), {
    caseId: entry.id,
    runId: null,
    status: "failed",
    error: failure,
    truncatedBy: null,
    summary: null,
    findings: [],
    unresolvedQuestions: [`The case did not execute: ${failure.message}`],
    sources: [],
    verification: [],
  });
  await writeJsonArtifact(path.join(caseDirectory, "accounting.json"), accounting);
  await writeJsonlArtifact(path.join(caseDirectory, "events.jsonl"), []);
  return {
    id: entry.id,
    runId: null,
    status: "failed",
    error: failure,
    result: { summary: null, findings: [], unresolvedQuestions: [] },
    sources: [],
    verification: [],
    accounting,
    capturesUsed: 0,
    allowedCaptures: 0,
    stopSession: true,
    stopReason: `structural_failure:${failure.code}`,
  };
}

function boundedMessage(error) {
  return String(error?.message ?? error ?? "unknown failure")
    .slice(0, 500)
    .replace(/[\r\n]+/g, " ");
}

function stopDecision({ executed, accounting }) {
  if (accounting.providers.firecrawl.contractViolation || accounting.providers.serper.contractViolation)
    return { stopSession: true, reason: "provider_charge_contract_violation" };
  const status = executed.run?.status ?? "failed";
  if (status === "cancelled") return { stopSession: true, reason: "cancelled" };
  if (status === "failed") {
    const code = executed.run?.error?.code ?? "unknown";
    if (!QUALITY_FAILURE_CODES.has(code)) return { stopSession: true, reason: `structural_failure:${code}` };
  }
  return { stopSession: false, reason: null };
}

async function collectEvents(service, runId) {
  const events = [];
  let cursor = 0;
  for (;;) {
    const page = await service.listEvents(runId, { afterOrdinal: cursor, limit: 500 });
    if (!page?.events?.length) break;
    events.push(...page.events);
    cursor = page.events.at(-1).ordinal;
    if (!page.nextCursor) break;
  }
  return events;
}

/** Reopen every retained snapshot and check every excerpt again, independently of whatever
 *  the run reported at the time. A quote that verifies here is exact; it is still only exact. */
async function verifyFindings({ result, sources, snapshotDirectory }) {
  const byId = new Map(sources.map((source) => [source.id, source]));
  const verified = [];
  for (const finding of result?.findings ?? []) {
    for (const [index, reference] of (finding.evidence ?? []).entries()) {
      const source = byId.get(reference.sourceId) ?? null;
      let quoteVerified = false;
      if (source) {
        quoteVerified = await verifySnapshotEvidence({ source, reference, snapshotDirectory }).catch(
          () => false,
        );
      }
      verified.push({
        findingId: finding.id,
        evidenceIndex: index,
        sourceId: reference.sourceId,
        url: source?.url ?? reference.url ?? null,
        mediaType: source?.mediaType ?? null,
        page: reference.locator?.page ?? null,
        reportedQuoteVerified: Boolean(reference.quoteVerified),
        storeQuoteVerified: Boolean(quoteVerified),
      });
    }
  }
  return verified;
}

function sourceReceipt(source) {
  return {
    id: source.id,
    url: source.url,
    title: source.title,
    mediaType: source.mediaType,
    retrievedAt: source.retrievedAt,
    contentSha256: source.contentSha256,
    contentBytes: source.contentBytes,
    coverage: source.metadata?.coverage ?? null,
    parserMode: source.metadata?.parserMode ?? null,
    cacheState: source.metadata?.cacheState ?? null,
  };
}

/** Only what the adapter needs to resolve the frozen model. No provider credential. */
function childEnvironment(environment) {
  return {
    PATH: environment.PATH,
    HOME: environment.HOME,
    ...(environment.SYSTEMROOT ? { SYSTEMROOT: environment.SYSTEMROOT } : {}),
    ...(environment.USERPROFILE ? { USERPROFILE: environment.USERPROFILE } : {}),
    RESEARCH_MODEL_PROVIDER: environment.RESEARCH_MODEL_PROVIDER,
    RESEARCH_MODEL_ID: environment.RESEARCH_MODEL_ID,
    ...(environment.RESEARCH_MODEL_BASE_URL
      ? { RESEARCH_MODEL_BASE_URL: environment.RESEARCH_MODEL_BASE_URL }
      : {}),
    ...(environment.RESEARCH_MODEL_API_KEY
      ? { RESEARCH_MODEL_API_KEY: environment.RESEARCH_MODEL_API_KEY }
      : {}),
    RESEARCH_MODEL_MAX_OUTPUT_TOKENS: environment.RESEARCH_MODEL_MAX_OUTPUT_TOKENS,
  };
}

export function liveProviderFactory({ environment, leases }) {
  const search = new FirecrawlSearchProvider({
    apiKey: environment.FIRECRAWL_API_KEY,
    ledger: leases.firecrawl,
  });
  const searchProvider = environment.SERPER_API_KEY
    ? new FallbackSearchProvider({
        primary: search,
        fallback: new SerperSearchProvider({
          apiKey: environment.SERPER_API_KEY,
          ledger: leases.serper,
        }),
      })
    : search;
  return {
    searchProvider,
    captureProvider: new FirecrawlCaptureProvider({
      apiKey: environment.FIRECRAWL_API_KEY,
      ledger: leases.firecrawl,
    }),
  };
}

export { sessionBounds };
