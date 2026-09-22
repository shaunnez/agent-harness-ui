// `ResearchRuntime` over the local Claude CLI, on the operator's subscription.
//
// This is the configuration behind all 90 recorded runs, and nothing more than it. Six flags:
//
//   claude -p "<objective>" --model claude-opus-5 --append-system-prompt <prompt>
//     --mcp-config <tools> --allowed-tools "<corpus tools>,WebSearch"
//     --output-format stream-json --verbose
//
// One agent. No roles, no subagents, no checkpointer. Verification in the recorded runs was
// running each scenario three times and comparing (`trio.mjs`, `agreement.mjs`), not a
// verifier agent — whether a verifier beats that is phase 2's question, and answering it early
// by building one here would have meant never finding out.
//
// What the Deep Agents runtime got right lives here now, and nowhere else:
//
// - Host-owned tools. The agent reads a web page only through `fetch_source`, which the
//   parent process runs (`host-tools/`), so the page is retained and a figure quoted from it
//   can be checked. The CLI's process tree holds no provider credential.
// - Checked citations. Every row id and web quote in the final answer is checked against the
//   capture or the retained page after the run (`citations.mjs`).
// - Tool errors as feedback, stopped when the model repeats the same failing call.
// - Budget ceilings enforced while the run is live, not only reported after it.
// - A provider outage kept apart from a research failure, so it can be scored as unassessed.
//
// Two things this file does that the shell script could not, both required by the contract:
// `--output-format stream-json --verbose` in place of `json`, so `events()` has intermediate
// lines to translate; and a concurrency cap, because eight parallel CLI spawns produced six
// empty outputs out of seventy-two while three produced none. An empty output is a concurrency
// symptom, not a content failure, so it is reported as retryable rather than as a bad scope.

import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { runProcess } from "../../process-runtime.mjs";
import { DEFAULT_RESEARCH_SOURCE_DIRECTORY } from "../research-web-tools.mjs";
import { assertSubscriptionAuth } from "./auth.mjs";
import { checkCostBandCitations } from "./citations.mjs";
import { buildClaudeEnvironment, classifyCall, runClaudeCall } from "./cli-call.mjs";
import { hostToolOf } from "./host-tools/definitions.mjs";
import { openHostToolSession } from "./host-tools/session.mjs";
import {
  findingsFromCostBand,
  parseCostBand,
  QV_ALLOWED_TOOLS,
  QV_HOST_TOOLS,
  QV_SYSTEM_PROMPT_PATH,
  qvMcpConfig,
  resolveCorpusIndexPath,
} from "./qv-recipe.mjs";
import { loadQvRows } from "./qv-rows.mjs";
import { redactSecretsInFile, scannedNeedles } from "./secret-scan.mjs";

export const CLAUDE_CLI_RESEARCH_RUNTIME_ID = "claude-cli";

/** The model all 90 recorded runs used. Overridable, but not by accident: a different model is
 *  a different baseline and the comparison against `17a-top30-results.json` stops meaning
 *  anything the moment it changes. */
export const DEFAULT_CLAUDE_CLI_MODEL = "claude-opus-5";

/** Eight parallel spawns produced 6 empty outputs out of 72; three produced none. The scopes
 *  were fine in isolation, so this is a spawn-concurrency limit rather than anything about the
 *  work, and it is enforced here rather than left to each caller to remember. */
export const DEFAULT_MAX_CONCURRENT_RUNS = 3;

export const DEFAULT_TRANSCRIPT_DIRECTORY = path.resolve(".data", "research-claude-cli");

/** A run that exits cleanly having emitted no terminal `result` line. Named so a caller can
 *  retry it without string-matching a message. */
export const EMPTY_OUTPUT_ERROR_CODE = "claude_cli_empty_output";

export class ClaudeCliResearchRuntime {
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
  #pythonBin;
  #now;
  #run;
  #assertAuth;
  #hostTools;
  #sourceSnapshotDirectory;
  #captureProvider;
  #webToolsOptions;

  constructor({
    id = CLAUDE_CLI_RESEARCH_RUNTIME_ID,
    env = process.env,
    model = null,
    binary = null,
    maxConcurrentRuns = DEFAULT_MAX_CONCURRENT_RUNS,
    transcriptDirectory = DEFAULT_TRANSCRIPT_DIRECTORY,
    systemPromptPath = QV_SYSTEM_PROMPT_PATH,
    allowedTools = QV_ALLOWED_TOOLS,
    corpusIndexPath = null,
    pythonBin = null,
    now = () => Date.now(),
    // Injected so the process boundary and the auth gate can be exercised without a CLI on
    // the machine. Nothing else in this class is swappable: the flags are the point.
    run = runProcess,
    assertAuth = assertSubscriptionAuth,
    // The host tools the agent may call. Empty turns them off, which is what reproducing the
    // recorded baseline exactly would need: those 90 runs had no way to fetch a page.
    hostTools = QV_HOST_TOOLS,
    sourceSnapshotDirectory = DEFAULT_RESEARCH_SOURCE_DIRECTORY,
    // Local fetching by default. A paid capture provider is opt-in, and its failures are the
    // only ones classified as a provider outage rather than one website failing.
    captureProvider = null,
    // For tests: `fetchImpl` and `lookup` reach `ResearchWebTools` so no test touches the network.
    webToolsOptions = {},
  } = {}) {
    this.#id = id;
    this.#env = env;
    this.#model = model ?? env.RESEARCH_CLAUDE_CLI_MODEL ?? DEFAULT_CLAUDE_CLI_MODEL;
    this.#binary = binary;
    this.#maxConcurrent = Math.max(1, Number(maxConcurrentRuns) || DEFAULT_MAX_CONCURRENT_RUNS);
    this.#transcriptDirectory = transcriptDirectory;
    this.#systemPromptPath = systemPromptPath;
    this.#allowedTools = [...allowedTools];
    this.#corpusIndexPath = corpusIndexPath;
    this.#pythonBin = pythonBin ?? env.RESEARCH_QV_PYTHON ?? "python3";
    this.#now = now;
    this.#run = run;
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

  /**
   * Admit a run. Resolves as soon as the run is admitted, which may be before the child is
   * spawned: over the concurrency cap the handle comes back `queued` and the child starts when
   * a slot frees. The service already models `queued`, so nothing downstream needs to know
   * that a queue exists.
   *
   * The subscription gate runs here, before anything is spawned, so a misconfigured machine
   * fails on the first run rather than after the batch has been queued.
   */
  async start(request) {
    if (this.#runs.has(request.id)) throw new Error(`Research run ${request.id} has already started.`);
    const { binary } = await this.#assertAuth({ binary: this.#binary });
    const corpusIndexPath = resolveCorpusIndexPath(this.#env, this.#corpusIndexPath);
    const systemPrompt = await readFile(this.#systemPromptPath, "utf8");
    const startedAtMs = this.#now();

    const run = {
      request,
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
    this.#enqueue(() => this.#spawn(run, { binary, corpusIndexPath, systemPrompt }));

    return {
      runId: request.id,
      runtimeId: this.#id,
      status: run.state,
      startedAt: new Date(startedAtMs).toISOString(),
      // Live, always: this runtime has no fake path. A run that cannot reach the subscription
      // fails in `start()` above rather than resolving something that looks like an answer.
      model: { provider: this.#id, model: this.#model, live: true },
      runtimeMetadata: { cliModel: this.#model, allowedTools: this.#allowedTools.join(",") },
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
        modelCallsUsed: Number(run.resultLine?.num_turns ?? 0),
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
      model: { provider: this.#id, model: this.#model, live: true },
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

  async #spawn(run, { binary, corpusIndexPath, systemPrompt }) {
    if (run.closed) return;
    const request = run.request;
    const workingDirectory = await mkdtemp(path.join(os.tmpdir(), "research-claude-cli-"));
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
      if (this.#hostTools.length)
        session = await openHostToolSession({
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
      const mcpConfigPath = path.join(workingDirectory, "mcp.json");
      await writeFile(
        mcpConfigPath,
        JSON.stringify(
          qvMcpConfig({
            pythonBin: this.#pythonBin,
            indexPath: corpusIndexPath,
            hostTools: session?.mcpEntry,
          }),
        ),
        "utf8",
      );

      run.state = "running";
      const call = await runClaudeCall({
        run: this.#run,
        binary,
        env: buildClaudeEnvironment(this.#env, workingDirectory),
        cwd: workingDirectory,
        objective: request.objective,
        model: this.#model,
        systemPrompt,
        mcpConfigPath,
        allowedTools: this.#allowedTools,
        maxUsd: request.budget?.maxUsd ?? null,
        timeoutMs: request.budget?.maxRuntimeMs ?? 30 * 60_000,
        signal: run.controller.signal,
        ceilings: request.budget ?? null,
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

  /** Check the answer's citations while the run's retained sources are still open. */
  async #checkCitations(run, call, { session, corpusIndexPath }) {
    const costBand = parseCostBand(call.finalText ?? "");
    if (!costBand) return;
    try {
      run.citations = await checkCostBandCitations(costBand, {
        rows: await loadQvRows(corpusIndexPath),
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
        kind: "claude-cli-transcript",
        name: "Claude CLI stream transcript",
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
      const verdict = classifyCall(call ?? {}, { emptyOutputCode: EMPTY_OUTPUT_ERROR_CODE });
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
