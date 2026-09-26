// The research run lifecycle every research runtime shares, whatever answers the model calls:
// the queue, one host-tool session per run, QV from PlanCheck's rate library, host-owned
// `fetch_source`/`read_source`, every citation checked after the run, the transcript scanned for
// credentials, and a provider outage kept apart from a research failure.
//
// A driver supplies the model call (`api-loop/runtime.mjs`). This was the Claude CLI runtime until
// 26 September 2026, when Shaun retired every research engine but the API loop; the lifecycle is
// unchanged, so recorded runs re-check the same.
//
// - Host-owned tools. A web page is read only through `fetch_source`, which the host runs
//   (`host-tools/`), so the page is retained and a figure quoted from it can be checked.
// - Checked citations. Every row id and web quote in the final answer is checked against the
//   rows the run was shown or the retained page, after the run (`citations.mjs`).
// - Tool errors as feedback, stopped when the model repeats the same failing call.
// - Budget ceilings enforced while the run is live, not only reported after it.

import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { PlanCheckQvSession, planCheckQvConfig } from "../qv-plancheck.mjs";
import { DEFAULT_RESEARCH_SOURCE_DIRECTORY } from "../research-web-tools.mjs";
import { checkCostBandCitations } from "./citations.mjs";
import { hostToolOf } from "./host-tools/definitions.mjs";
import { openHostToolSession } from "./host-tools/session.mjs";
import { findingsFromCostBand, parseCostBand, QV_HOST_TOOLS, resolveCorpusIndexPath } from "./qv-recipe.mjs";
import { loadQvRows } from "./qv-rows.mjs";
import { redactSecretsInFile, scannedNeedles } from "./secret-scan.mjs";

/** Runs at once per runtime; the rest wait in the queue as `queued`. The API loop's tuned eval
 *  arm ran 39 at once (A7), so a caller may raise it; three is the conservative default. */
export const DEFAULT_MAX_CONCURRENT_RUNS = 3;

/** Where run transcripts go. The directory name predates the runtime's rename and is kept, so
 *  transcripts already on disk stay where the eval records point. */
export const DEFAULT_TRANSCRIPT_DIRECTORY = path.resolve(".data", "research-claude-cli");

export class HostedResearchRuntime {
  #id;
  #runs = new Map();
  #env;
  #model;
  #binary;
  #maxConcurrent;
  #active = 0;
  #queue = [];
  #transcriptDirectory;
  #systemPromptPath;
  #allowedTools;
  #corpusIndexPath;
  #now;
  #assertAuth;
  #hostTools;
  #sourceSnapshotDirectory;
  #captureProvider;
  #webToolsOptions;
  #driver;

  constructor({
    id,
    env = process.env,
    model = null,
    binary = null,
    maxConcurrentRuns = DEFAULT_MAX_CONCURRENT_RUNS,
    transcriptDirectory = DEFAULT_TRANSCRIPT_DIRECTORY,
    systemPromptPath,
    allowedTools = [],
    corpusIndexPath = null,
    now = () => Date.now(),
    // What answers the model calls: its key check, model call and verdict (`api-loop/runtime.mjs`).
    driver,
    assertAuth = driver?.assertAuth,
    // The host tools the agent may call.
    hostTools = QV_HOST_TOOLS,
    sourceSnapshotDirectory = DEFAULT_RESEARCH_SOURCE_DIRECTORY,
    // Local fetching by default. A paid capture provider is opt-in, and its failures are the
    // only ones classified as a provider outage rather than one website failing.
    captureProvider = null,
    // For tests: `fetchImpl` and `lookup` reach `ResearchWebTools` so no test touches the network.
    webToolsOptions = {},
  } = {}) {
    if (!id || !driver || !systemPromptPath)
      throw new Error("A hosted research runtime needs an id, a driver and a system prompt.");
    this.#id = id;
    this.#env = env;
    this.#driver = driver;
    this.#model = model ?? driver.defaultModel(env);
    this.#binary = binary;
    this.#maxConcurrent = Math.max(1, Number(maxConcurrentRuns) || DEFAULT_MAX_CONCURRENT_RUNS);
    this.#transcriptDirectory = transcriptDirectory;
    this.#systemPromptPath = systemPromptPath;
    this.#allowedTools = [...allowedTools];
    this.#corpusIndexPath = corpusIndexPath;
    this.#now = now;
    this.#assertAuth = assertAuth;
    this.#hostTools = [...hostTools];
    this.#sourceSnapshotDirectory = sourceSnapshotDirectory;
    this.#captureProvider = captureProvider;
    this.#webToolsOptions = webToolsOptions;
    if (!this.#hostTools.length) this.#allowedTools = this.#allowedTools.filter((tool) => !hostToolOf(tool));
  }

  get id() {
    return this.#id;
  }

  /** The error code this runtime fails with when a run finishes having said nothing. */
  get emptyOutputCode() {
    return this.#driver.emptyOutputCode;
  }

  /**
   * Admit a run. Resolves as soon as the run is admitted, which may be before the child is
   * spawned: over the concurrency cap the handle comes back `queued` and the child starts when
   * a slot frees. The service already models `queued`, so nothing downstream needs to know
   * that a queue exists.
   *
   * The driver's key check runs here, before anything is queued, so a misconfigured machine
   * fails on the first run as a failed start rather than after the batch has been queued.
   */
  async start(request) {
    if (this.#runs.has(request.id)) throw new Error(`Research run ${request.id} has already started.`);
    const { binary } = await this.#assertAuth({ binary: this.#binary });
    // PlanCheck's rate library, or the local capture: one of the two, decided per run.
    // A capture path passed to the constructor is an explicit choice of the local file.
    const planCheck = this.#corpusIndexPath ? null : planCheckQvConfig(this.#env);
    const corpusIndexPath = planCheck ? null : resolveCorpusIndexPath(this.#env, this.#corpusIndexPath);
    const systemPrompt = await readFile(this.#systemPromptPath, "utf8");
    const startedAtMs = this.#now();

    // The Settings choice the service snapshotted onto this run, when it is for this runtime.
    // Otherwise the runtime's own default answers, with the CLI's own reasoning default.
    const policy = request.researchPolicy?.runtime === this.#id ? request.researchPolicy : null;
    const run = {
      request,
      model: policy?.model ?? this.#model,
      reasoning: policy?.reasoning ?? null,
      state: "queued",
      emitted: [],
      waiters: [],
      closed: false,
      ordinal: 0,
      controller: new AbortController(),
      startedAtMs,
      toolCalls: new Map(),
      toolCallCount: 0,
      searchCallCount: 0,
      finalText: "",
      resultLine: null,
      usage: null,
      costBand: null,
      artifacts: [],
      error: null,
      cancelRequested: false,
      transcriptPath: null,
      workingDirectory: null,
      sawCeiling: false,
      // Why the host stopped the run, when it did: a ceiling crossed, a repeated failing tool
      // call, a provider outage. Set before the child is signalled, read when it has exited.
      stopped: null,
      truncatedBy: null,
      citations: null,
      unresolvedWarnings: [],
      providerUsage: [],
    };
    this.#runs.set(request.id, run);
    this.#enqueue(() => this.#spawn(run, { binary, corpusIndexPath, planCheck, systemPrompt }));

    return {
      runId: request.id,
      runtimeId: this.#id,
      status: run.state,
      startedAt: new Date(startedAtMs).toISOString(),
      // Live, always: this runtime has no fake path. A run that cannot reach its provider fails
      // in `start()` above rather than resolving something that looks like an answer.
      model: { provider: this.#id, model: run.model, live: true },
      runtimeMetadata: this.#driver.metadata({
        model: run.model,
        reasoning: run.reasoning,
        allowedTools: this.#allowedTools,
        env: this.#env,
      }),
    };
  }

  async status(runId) {
    const run = this.#require(runId);
    return {
      runId,
      status: run.state,
      usage: run.usage ?? { partial: run.state !== "completed" },
      progress: {
        phase: run.state === "completed" ? "done" : run.state === "queued" ? "queued" : "investigate",
      },
      budgetState: {
        modelCallsUsed: Number(run.resultLine?.num_turns ?? run.usage?.modelCalls ?? 0),
        toolCallsUsed: run.toolCallCount,
        searchCallsUsed: run.searchCallCount,
        // One agent, so exactly one researcher ever starts. Reported rather than left absent
        // so the ceiling ledger reads the same shape as every other runtime's.
        researchersStarted: run.state === "queued" ? 0 : 1,
        elapsedMs: Math.max(0, this.#now() - run.startedAtMs),
        ...(truncationOf(run) ? { ceilingHit: truncationOf(run) } : {}),
      },
      ...(run.error ? { error: run.error } : {}),
    };
  }

  async cancel(runId) {
    const run = this.#runs.get(runId);
    if (!run || run.closed) return;
    run.cancelRequested = true;
    run.controller.abort();
    // A run still in the queue has no child to signal, so it is closed here directly.
    if (run.state === "queued") this.#finish(run, { cancelled: true });
  }

  async *events(runId, cursor) {
    const run = this.#require(runId);
    let index = Number(cursor ?? 0);
    for (;;) {
      while (index < run.emitted.length) {
        const event = run.emitted[index];
        index += 1;
        yield event;
      }
      if (run.closed) return;
      await new Promise((resolve) => run.waiters.push(resolve));
    }
  }

  async result(runId) {
    const run = this.#require(runId);
    if (!run.closed) throw new Error(`Research run ${runId} has not finished.`);
    const usage = { ...(run.usage ?? {}), partial: run.state !== "completed" };
    const findings = findingsFromCostBand(run.costBand, { runId, citations: run.citations });
    const truncatedBy = truncationOf(run);
    return {
      runId,
      model: { provider: this.#id, model: run.model, live: true },
      ...(run.costBand?.band?.basis ? { summary: run.costBand.band.basis } : {}),
      findings,
      artifacts: run.artifacts,
      usage,
      unresolvedQuestions: [
        ...(run.costBand?.notEstablished ?? []),
        ...run.unresolvedWarnings,
        ...(run.error && !run.costBand ? [run.error.message] : []),
      ],
      ...(run.providerUsage.length ? { providerUsage: run.providerUsage } : {}),
      ...(truncatedBy ? { truncatedBy } : {}),
    };
  }

  /** How the run's citations checked out, for a benchmark reporting it next to the band. */
  citationSummary(runId) {
    return this.#require(runId).citations?.summary ?? null;
  }

  /** What a research question needs from one finished run: its cost band and how each of the
   *  band's components checked out, in component order. `citations` is null when no check ran
   *  (no band, or the capture could not be read), which is "unchecked", never "passed". */
  outcome(runId) {
    const run = this.#require(runId);
    if (!run.closed) return null;
    return {
      costBand: run.costBand,
      citations: run.citations
        ? { summary: run.citations.summary, checks: run.citations.components.map((item) => item.check) }
        : null,
    };
  }

  /** The parsed cost band, for a caller computing three-run agreement. Outside the neutral
   *  contract on purpose: agreement is a property of a set of runs, not of one, and the shape
   *  it needs is the recipe's, not the contract's. */
  costBand(runId) {
    return this.#require(runId).costBand;
  }

  // --- concurrency ----------------------------------------------------------------------------

  #enqueue(task) {
    this.#queue.push(task);
    this.#pump();
  }

  #pump() {
    while (this.#active < this.#maxConcurrent && this.#queue.length) {
      const task = this.#queue.shift();
      this.#active += 1;
      void Promise.resolve()
        .then(task)
        .finally(() => {
          this.#active -= 1;
          this.#pump();
        });
    }
  }

  // --- the run ---------------------------------------------------------------------------------

  async #spawn(run, { binary, corpusIndexPath, planCheck = null, systemPrompt }) {
    if (run.closed) return;
    const request = run.request;
    const workingDirectory = await mkdtemp(path.join(os.tmpdir(), "research-run-"));
    run.workingDirectory = workingDirectory;
    // Scoped by runtime id as well as run id: phase 1 and phase 2 are run over the same
    // scenarios with the same run ids, and a shared directory would interleave two
    // experiments' transcripts under one name.
    const transcriptDirectory = path.join(this.#transcriptDirectory, this.#id, request.id);
    await mkdir(transcriptDirectory, { recursive: true });
    run.transcriptPath = path.join(transcriptDirectory, "stream.jsonl");
    let session = null;
    const transcript = createWriteStream(run.transcriptPath, { flags: "w" });
    const stop = (verdict) => {
      if (run.stopped || run.closed) return;
      run.stopped = verdict;
      run.controller.abort();
    };
    try {
      const qv = planCheck ? new PlanCheckQvSession(planCheck) : null;
      if (this.#hostTools.length || qv)
        session = await openHostToolSession({
          qv,
          runId: request.id,
          budget: request.budget,
          context: request.context ?? [],
          directory: workingDirectory,
          tools: this.#hostTools,
          signal: run.controller.signal,
          snapshotDirectory: this.#sourceSnapshotDirectory,
          captureProvider: this.#captureProvider,
          webToolsOptions: this.#webToolsOptions,
          emit: (type, data) => this.#emit(run, type, data),
          onTerminal: stop,
        });
      run.state = "running";
      const call = await this.#driver.call({
        binary,
        env: this.#env,
        workingDirectory,
        objective: request.objective,
        model: run.model,
        reasoning: run.reasoning,
        systemPrompt,
        allowedTools: this.#allowedTools,
        budget: request.budget ?? null,
        signal: run.controller.signal,
        // The run's host session: the driver calls every tool through it.
        session,
        checkComponents: (components) =>
          this.#checkComponents(components, {
            session,
            corpusIndexPath,
            emit: (type, data) => this.#emit(run, type, data),
          }),
        emit: (type, data) => this.#emit(run, type, data),
        onCeiling: (ceiling, counts) =>
          stop({
            outcome: "terminal",
            code: "research_ceiling_exceeded",
            message: `The run crossed its ${ceiling} ceiling (${counts.limit}).`,
            ceiling,
          }),
        onRawLine: (line) => transcript.write(`${line}\n`),
        onEvent: (type, data) => {
          // A host tool's result is announced by the host, with the retained snapshot behind
          // it. The stream's copy of the same result carries none of that, and persisting both
          // would put an unverifiable duplicate of every fetched page in the sources table.
          if (type === "source.retrieved" && hostToolOf(data?.source?.metadata?.tool)) return;
          this.#emit(run, type, data);
        },
      });
      await closeStream(transcript);
      await this.#scanTranscript(run);
      await this.#checkCitations(run, call, { session, corpusIndexPath });
      this.#finish(run, { call });
    } catch (error) {
      await closeStream(transcript);
      this.#finish(run, { call: { spawnError: error } });
    } finally {
      if (session) {
        run.providerUsage = await session.close().catch(() => []);
      }
      await rm(workingDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** A credential in a transcript is redacted and reported by name, never by value. */
  async #scanTranscript(run) {
    const found = await redactSecretsInFile(run.transcriptPath, scannedNeedles(this.#env));
    if (found.length)
      this.#emit(run, "log", {
        message: "A credential value appeared in the CLI transcript and was redacted.",
        redacted: found,
      });
  }

  /** Check a list of cited components, and return the rows they cite as the host holds them. */
  async #checkComponents(components, { session, corpusIndexPath, emit }) {
    const rows = session?.qv ? session.qv.citationRows() : await loadQvRows(corpusIndexPath);
    const checked = await checkCostBandCitations(
      { components },
      {
        rows,
        webTools: session?.webTools ?? null,
        snapshotDirectory: this.#sourceSnapshotDirectory,
        emitSource: (data) => emit("source.retrieved", data),
      },
    );
    return { ...checked, rows };
  }

  /** Check the answer's citations while the run's retained sources are still open. */
  async #checkCitations(run, call, { session, corpusIndexPath }) {
    const costBand = parseCostBand(call.finalText ?? "");
    if (!costBand) return;
    try {
      run.citations = await checkCostBandCitations(costBand, {
        // PlanCheck's library is checked against the rows this run was shown; the local capture
        // against the whole file.
        rows: session?.qv ? session.qv.citationRows() : await loadQvRows(corpusIndexPath),
        webTools: session?.webTools ?? null,
        snapshotDirectory: this.#sourceSnapshotDirectory,
        emitSource: (data) => this.#emit(run, "source.retrieved", data),
      });
      run.unresolvedWarnings = session?.webTools.unresolvedCoverageWarnings() ?? [];
    } catch (error) {
      // A citation check that could not run leaves every citation unchecked, which the
      // findings already say. It is not a reason to lose the band.
      this.#emit(run, "log", { message: `Citation check failed: ${error?.message ?? error}` });
    }
  }

  #finish(run, { call = null, cancelled = false } = {}) {
    if (run.closed) return;
    if (call) {
      run.finalText = call.finalText ?? run.finalText;
      run.resultLine = call.resultLine ?? run.resultLine;
      run.toolCallCount = call.toolCallCount ?? run.toolCallCount;
      run.searchCallCount = call.searchCallCount ?? run.searchCallCount;
      run.usage = call.usage ?? run.usage;
      if (call.sawCeiling) run.sawCeiling = true;
    }
    run.costBand = parseCostBand(run.finalText);
    if (run.transcriptPath)
      run.artifacts.push({
        id: "cli-transcript",
        kind: this.#driver.transcript.kind,
        name: this.#driver.transcript.name,
        contentRef: run.transcriptPath,
      });

    if (cancelled || run.cancelRequested) {
      run.state = "cancelled";
      this.#emit(run, "run.cancelled", { reason: "operator" });
    } else if (run.stopped) {
      // The host stopped it, so the child's exit is a consequence rather than the cause.
      run.error = {
        code: run.stopped.outcome === "provider_unavailable" ? "provider_unavailable" : run.stopped.code,
        message: run.stopped.message,
      };
      if (run.stopped.ceiling) run.truncatedBy = run.stopped.ceiling;
      run.state = "failed";
      this.#emit(run, "run.failed", {
        ...run.error,
        ...(run.truncatedBy ? { truncatedBy: run.truncatedBy } : {}),
      });
    } else {
      const verdict = this.#driver.classify(call ?? {});
      if (verdict.timedOut) run.sawCeiling = true;
      if (verdict.ok) {
        run.state = "completed";
        this.#emit(run, "run.completed", {
          band: run.costBand?.band ?? null,
          resolvedFrom: run.costBand?.resolvedFrom ?? null,
          findings: findingsFromCostBand(run.costBand, { runId: run.request.id }).length,
          ...(run.citations ? { citations: run.citations.summary } : {}),
        });
      } else {
        run.error = verdict.error;
        run.state = "failed";
        this.#emit(run, "run.failed", run.error);
      }
    }
    if (run.usage) run.usage.partial = run.state !== "completed";
    run.closed = true;
    if (!run.controller.signal.aborted) run.controller.abort();
    for (const resolve of run.waiters.splice(0)) resolve();
  }

  #emit(run, type, data) {
    run.ordinal += 1;
    run.emitted.push({
      id: randomUUID(),
      ordinal: run.ordinal,
      runId: run.request.id,
      timestamp: new Date().toISOString(),
      type,
      data,
    });
    for (const resolve of run.waiters.splice(0)) resolve();
  }

  #require(runId) {
    const run = this.#runs.get(runId);
    if (!run) throw new Error(`Unknown research run ${runId}.`);
    return run;
  }
}

/** The ceiling a run stopped at, if any. A plan rate limit and a timeout have always been
 *  reported as `maxRuntimeMs`; a ceiling the host enforced names itself. */
function truncationOf(run) {
  return run.truncatedBy ?? (run.sawCeiling ? "maxRuntimeMs" : null);
}

function closeStream(stream) {
  return new Promise((resolve) => stream.end(resolve));
}
