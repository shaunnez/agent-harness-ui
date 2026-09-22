// Phase 2: planner → researcher → verifier → synthesiser, as four sequential CLI calls this
// code makes, each with its own prompt and tools, feeding each output to the next.
//
// It implements the same `ResearchRuntime` interface and emits the same final cost-band schema
// as the single-agent runtime, so `trio.mjs` and `agreement.mjs` score the two identically.
// That is not incidental: a comparison where the two sides are measured differently answers
// nothing, and the whole value of phase 2 is being able to say which one won — including
// saying that four roles did not, which is a result worth the day.
//
// A role run holds one concurrency slot for its whole sequence rather than one per call. Four
// calls each grabbing a slot would let three concurrent role runs put twelve children in
// flight, which is the condition that produced six empty outputs out of seventy-two.

import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { runProcess } from "../../process-runtime.mjs";
import { assertSubscriptionAuth } from "./auth.mjs";
import { buildClaudeEnvironment, classifyCall, runClaudeCall } from "./cli-call.mjs";
import { findingsFromCostBand, parseCostBand, qvMcpConfig, resolveCorpusIndexPath } from "./qv-recipe.mjs";
import { RESEARCH_ROLE_SEQUENCE, verifierEffect } from "./roles.mjs";
import {
  DEFAULT_CLAUDE_CLI_MODEL,
  DEFAULT_MAX_CONCURRENT_RUNS,
  DEFAULT_TRANSCRIPT_DIRECTORY,
  EMPTY_OUTPUT_ERROR_CODE,
} from "./runtime.mjs";

export const CLAUDE_CLI_ROLES_RUNTIME_ID = "claude-cli-roles";

export class ClaudeCliRolesResearchRuntime {
  #id;
  #runs = new Map();
  #env;
  #model;
  #modelByRole;
  #binary;
  #maxConcurrent;
  #active = 0;
  #queue = [];
  #transcriptDirectory;
  #sequence;
  #corpusIndexPath;
  #pythonBin;
  #now;
  #run;
  #assertAuth;

  constructor({
    id = CLAUDE_CLI_ROLES_RUNTIME_ID,
    env = process.env,
    model = null,
    /** Per-role model overrides. Empty by default so phase 2 changes one thing — the role
     *  split — rather than the split and the model mix at once. */
    modelByRole = {},
    binary = null,
    maxConcurrentRuns = DEFAULT_MAX_CONCURRENT_RUNS,
    transcriptDirectory = DEFAULT_TRANSCRIPT_DIRECTORY,
    sequence = RESEARCH_ROLE_SEQUENCE,
    corpusIndexPath = null,
    pythonBin = null,
    now = () => Date.now(),
    run = runProcess,
    assertAuth = assertSubscriptionAuth,
  } = {}) {
    this.#id = id;
    this.#env = env;
    this.#model = model ?? env.RESEARCH_CLAUDE_CLI_MODEL ?? DEFAULT_CLAUDE_CLI_MODEL;
    this.#modelByRole = { ...modelByRole };
    this.#binary = binary;
    this.#maxConcurrent = Math.max(1, Number(maxConcurrentRuns) || DEFAULT_MAX_CONCURRENT_RUNS);
    this.#transcriptDirectory = transcriptDirectory;
    this.#sequence = [...sequence];
    this.#corpusIndexPath = corpusIndexPath;
    this.#pythonBin = pythonBin ?? env.RESEARCH_QV_PYTHON ?? "python3";
    this.#now = now;
    this.#run = run;
    this.#assertAuth = assertAuth;
  }

  get id() {
    return this.#id;
  }

  async start(request) {
    if (this.#runs.has(request.id)) throw new Error(`Research run ${request.id} has already started.`);
    const { binary } = await this.#assertAuth({ binary: this.#binary });
    const corpusIndexPath = resolveCorpusIndexPath(this.#env, this.#corpusIndexPath);
    const prompts = new Map();
    for (const entry of this.#sequence) prompts.set(entry.role, await readFile(entry.promptPath, "utf8"));
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
      outputs: {},
      roleRuns: [],
      usage: null,
      costBand: null,
      artifacts: [],
      error: null,
      cancelRequested: false,
      sawCeiling: false,
      toolCallCount: 0,
      searchCallCount: 0,
      currentRole: null,
    };
    this.#runs.set(request.id, run);
    this.#enqueue(() => this.#sequenceRun(run, { binary, corpusIndexPath, prompts }));

    return {
      runId: request.id,
      runtimeId: this.#id,
      status: run.state,
      startedAt: new Date(startedAtMs).toISOString(),
      model: { provider: this.#id, model: this.#model, live: true },
      runtimeMetadata: {
        cliModel: this.#model,
        roles: this.#sequence.map((entry) => entry.role).join(","),
      },
    };
  }

  async status(runId) {
    const run = this.#require(runId);
    return {
      runId,
      status: run.state,
      usage: run.usage ?? { partial: run.state !== "completed" },
      progress: {
        phase: run.state === "completed" ? "done" : (run.currentRole ?? run.state),
        completedWorkers: run.roleRuns.filter((entry) => entry.ok).length,
        activeWorkers: run.currentRole ? 1 : 0,
        totalWorkers: this.#sequence.length,
      },
      budgetState: {
        modelCallsUsed: run.roleRuns.reduce((total, entry) => total + (entry.usage?.modelCalls ?? 0), 0),
        toolCallsUsed: run.toolCallCount,
        searchCallsUsed: run.searchCallCount,
        researchersStarted: run.roleRuns.length,
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
    return {
      runId,
      model: { provider: this.#id, model: this.#model, live: true },
      ...(run.costBand?.band?.basis ? { summary: run.costBand.band.basis } : {}),
      findings: findingsFromCostBand(run.costBand, { runId }),
      artifacts: run.artifacts,
      usage: { ...(run.usage ?? {}), partial: run.state !== "completed" },
      unresolvedQuestions: [
        ...(run.costBand?.notEstablished ?? []),
        ...(run.error && !run.costBand ? [run.error.message] : []),
      ],
      ...(run.sawCeiling ? { truncatedBy: "maxRuntimeMs" } : {}),
    };
  }

  costBand(runId) {
    return this.#require(runId).costBand;
  }

  /** What the verifier changed, read off the role outputs. Phase 2's real question, and the
   *  one number in this file that has no counterpart in the single-agent runtime. */
  verifierEffect(runId) {
    const run = this.#require(runId);
    return verifierEffect({
      researcherText: run.outputs.researcher?.text ?? "",
      verifierText: run.outputs.verifier?.text ?? "",
      costBand: run.costBand,
    });
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

  // --- the sequence ---------------------------------------------------------------------------

  async #sequenceRun(run, { binary, corpusIndexPath, prompts }) {
    if (run.closed) return;
    const request = run.request;
    const workingDirectory = await mkdtemp(path.join(os.tmpdir(), "research-claude-cli-roles-"));
    // Scoped by runtime id as well as run id: phase 1 and phase 2 are run over the same
    // scenarios with the same run ids, and a shared directory would interleave two
    // experiments' transcripts under one name.
    const transcriptDirectory = path.join(this.#transcriptDirectory, this.#id, request.id);
    await mkdir(transcriptDirectory, { recursive: true });
    const mcpConfigPath = path.join(workingDirectory, "mcp.json");
    await writeFile(
      mcpConfigPath,
      JSON.stringify(qvMcpConfig({ pythonBin: this.#pythonBin, indexPath: corpusIndexPath })),
      "utf8",
    );
    const env = buildClaudeEnvironment(this.#env, workingDirectory);
    // Split evenly across the roles, so one role cannot eat the whole run's wall clock and
    // leave the verifier no time to run — which would reintroduce exactly the "no guarantee
    // the verifier runs" problem that not using `--agents` was meant to avoid.
    const perRoleTimeoutMs = Math.floor(
      (request.budget?.maxRuntimeMs ?? 30 * 60_000) / this.#sequence.length,
    );

    run.state = "running";
    try {
      for (const entry of this.#sequence) {
        if (run.closed || run.cancelRequested) break;
        run.currentRole = entry.role;
        this.#emit(run, "phase.started", { phase: entry.role, role: entry.role });
        const transcriptPath = path.join(transcriptDirectory, `${entry.role}.jsonl`);
        const transcript = createWriteStream(transcriptPath, { flags: "w" });
        const call = await runClaudeCall({
          run: this.#run,
          binary,
          env,
          cwd: workingDirectory,
          objective: entry.buildObjective({ scope: request.objective, outputs: run.outputs }),
          model: this.#modelByRole[entry.role] ?? this.#model,
          systemPrompt: prompts.get(entry.role),
          mcpConfigPath,
          allowedTools: entry.allowedTools,
          // The dollar ceiling is the whole run's, divided across the roles for the same reason
          // the clock is: a researcher that spent the lot would starve the verifier.
          maxUsd: request.budget?.maxUsd ? request.budget.maxUsd / this.#sequence.length : null,
          timeoutMs: perRoleTimeoutMs,
          signal: run.controller.signal,
          onRawLine: (line) => transcript.write(`${line}\n`),
          onEvent: (type, data) => this.#emit(run, type, { ...data, role: entry.role }),
        });
        await closeStream(transcript);
        const verdict = classifyCall(call, { emptyOutputCode: EMPTY_OUTPUT_ERROR_CODE });
        if (verdict.timedOut || call.sawCeiling) run.sawCeiling = true;
        run.toolCallCount += call.toolCallCount;
        run.searchCallCount += call.searchCallCount;
        run.roleRuns.push({ role: entry.role, ok: verdict.ok, usage: call.usage, error: verdict.error });
        run.outputs[entry.role] = { text: call.finalText };
        run.artifacts.push({
          id: `cli-transcript-${entry.role}`,
          kind: "claude-cli-transcript",
          name: `Claude CLI stream transcript (${entry.role})`,
          contentRef: transcriptPath,
        });
        this.#emit(run, "phase.completed", { phase: entry.role, role: entry.role, ok: verdict.ok });
        if (!verdict.ok) {
          // A role that failed ends the sequence. Continuing would let the synthesiser write a
          // band from evidence nobody checked, which is the one thing this structure exists to
          // prevent, and a band produced that way would score as a success.
          run.error = { ...verdict.error, role: entry.role };
          break;
        }
      }
      run.currentRole = null;
      this.#finish(run, {});
    } catch (error) {
      run.error = { code: "claude_cli_roles_failed", message: error?.message ?? String(error) };
      this.#finish(run, {});
    } finally {
      await rm(workingDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  #finish(run, { cancelled = false }) {
    if (run.closed) return;
    run.costBand = parseCostBand(run.outputs.synthesiser?.text ?? "");
    run.usage = sumUsage(run.roleRuns.map((entry) => entry.usage).filter(Boolean), {
      toolCalls: run.toolCallCount,
      searchCalls: run.searchCallCount,
    });

    if (cancelled || run.cancelRequested) {
      run.state = "cancelled";
      this.#emit(run, "run.cancelled", { reason: "operator" });
    } else if (run.error) {
      run.state = "failed";
      this.#emit(run, "run.failed", run.error);
    } else if (run.roleRuns.length !== this.#sequence.length) {
      run.error = {
        code: "claude_cli_roles_incomplete",
        message: `Only ${run.roleRuns.length} of ${this.#sequence.length} roles ran.`,
      };
      run.state = "failed";
      this.#emit(run, "run.failed", run.error);
    } else {
      run.state = "completed";
      this.#emit(run, "run.completed", {
        band: run.costBand?.band ?? null,
        resolvedFrom: run.costBand?.resolvedFrom ?? null,
        verifier: this.verifierEffect(run.request.id),
      });
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

/** Four calls, one spend. Per-model figures are merged rather than replaced, so a run that
 *  used different models per role still reports each of them. */
function sumUsage(usages, { toolCalls, searchCalls }) {
  const total = {
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    modelCalls: 0,
    toolCalls,
    searchCalls,
    estimatedCostUsd: 0,
    partial: false,
    byModel: {},
  };
  for (const usage of usages) {
    total.inputTokens += usage.inputTokens ?? 0;
    total.outputTokens += usage.outputTokens ?? 0;
    total.cachedTokens += usage.cachedTokens ?? 0;
    total.modelCalls += usage.modelCalls ?? 0;
    total.estimatedCostUsd += usage.estimatedCostUsd ?? 0;
    for (const [model, entry] of Object.entries(usage.byModel ?? {})) {
      const existing = total.byModel[model] ?? {
        inputTokens: 0,
        outputTokens: 0,
        modelCalls: 0,
        estimatedCostUsd: 0,
        priced: true,
      };
      total.byModel[model] = {
        inputTokens: existing.inputTokens + (entry.inputTokens ?? 0),
        outputTokens: existing.outputTokens + (entry.outputTokens ?? 0),
        modelCalls: existing.modelCalls + (entry.modelCalls ?? 0),
        estimatedCostUsd: existing.estimatedCostUsd + (entry.estimatedCostUsd ?? 0),
        priced: existing.priced && entry.priced !== false,
      };
    }
  }
  if (!Object.keys(total.byModel).length) delete total.byModel;
  return total;
}

function closeStream(stream) {
  return new Promise((resolve) => stream.end(resolve));
}
