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
import { assertSubscriptionAuth } from "./auth.mjs";
import { buildClaudeEnvironment, classifyCall, runClaudeCall } from "./cli-call.mjs";
import {
  QV_ALLOWED_TOOLS,
  QV_SYSTEM_PROMPT_PATH,
  findingsFromCostBand,
  parseCostBand,
  qvMcpConfig,
  resolveCorpusIndexPath,
} from "./qv-recipe.mjs";

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
        ...(run.sawCeiling ? { ceilingHit: "maxRuntimeMs" } : {}),
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
    const findings = findingsFromCostBand(run.costBand, { runId });
    return {
      runId,
      model: { provider: this.#id, model: this.#model, live: true },
      ...(run.costBand?.band?.basis ? { summary: run.costBand.band.basis } : {}),
      findings,
      artifacts: run.artifacts,
      usage,
      unresolvedQuestions: [
        ...(run.costBand?.notEstablished ?? []),
        ...(run.error && !run.costBand ? [run.error.message] : []),
      ],
      ...(run.sawCeiling ? { truncatedBy: "maxRuntimeMs" } : {}),
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

    const mcpConfigPath = path.join(workingDirectory, "mcp.json");
    await writeFile(
      mcpConfigPath,
      JSON.stringify(qvMcpConfig({ pythonBin: this.#pythonBin, indexPath: corpusIndexPath })),
      "utf8",
    );
    const transcript = createWriteStream(run.transcriptPath, { flags: "w" });

    run.state = "running";
    try {
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
        onRawLine: (line) => transcript.write(`${line}\n`),
        onEvent: (type, data) => this.#emit(run, type, data),
      });
      await closeStream(transcript);
      this.#finish(run, { call });
    } catch (error) {
      await closeStream(transcript);
      this.#finish(run, { call: { spawnError: error } });
    } finally {
      await rm(workingDirectory, { recursive: true, force: true }).catch(() => undefined);
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
    } else {
      const verdict = classifyCall(call ?? {}, { emptyOutputCode: EMPTY_OUTPUT_ERROR_CODE });
      if (verdict.timedOut) run.sawCeiling = true;
      if (verdict.ok) {
        run.state = "completed";
        this.#emit(run, "run.completed", {
          band: run.costBand?.band ?? null,
          resolvedFrom: run.costBand?.resolvedFrom ?? null,
          findings: findingsFromCostBand(run.costBand, { runId: run.request.id }).length,
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

function closeStream(stream) {
  return new Promise((resolve) => stream.end(resolve));
}
