// `ResearchRuntime` implemented over a Deep Agents child process (architecture §2.2, §6).
//
// No `deepagents`, `langchain`, `@langchain/*` or `langsmith` import may appear in this file
// — `worker.mjs` is the only file in the repository permitted to import those
// (`tests/research-deepagents-import-containment.test.mjs` checks this mechanically). This
// file spawns a child, dispatches its explicitly named host-tool requests, parses the NDJSON
// it writes to stdout, and normalizes what comes back into the neutral `ResearchRuntime`
// shape. Everything Deep Agents/LangGraph-shaped — the graph, checkpoint and thread id —
// stays on the far side of that pipe.

import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { runProcess } from "../../process-runtime.mjs";
import { DEFAULT_RESEARCH_SOURCE_DIRECTORY, ResearchWebTools } from "../research-web-tools.mjs";
import { resolveSearchProvider } from "../tavily-search-provider.mjs";
import { buildChildEnvironment } from "./child-env.mjs";
import { decodeWorkerLine, encodeHostMessage } from "./event-protocol.mjs";
import { resolveModelConfig, splitModelConfigForChild } from "./model-config.mjs";

const WORKER_ENTRYPOINT = fileURLToPath(new URL("./worker.mjs", import.meta.url));
const RUN_LABEL = "Research (Deep Agents)";

/** Default location for the LangGraph checkpoint database. Separate file from
 *  `.data/tasks.sqlite3` by design (architecture §7.2) — Eversor never opens it. */
export const DEFAULT_CHECKPOINT_DB_PATH = path.resolve(".data", "research-checkpoints.sqlite3");

export class DeepAgentsResearchRuntime {
  #id;
  #runs = new Map();
  #checkpointDbPath;
  #env;
  #nodeBin;
  #now;
  #sourceSnapshotDirectory;
  #searchProvider;
  #webToolsOptions;

  constructor({
    id = "deepagents",
    checkpointDbPath = DEFAULT_CHECKPOINT_DB_PATH,
    env = process.env,
    nodeBin = process.execPath,
    now = () => Date.now(),
    sourceSnapshotDirectory = DEFAULT_RESEARCH_SOURCE_DIRECTORY,
    searchProvider = null,
    webToolsOptions = {},
  } = {}) {
    this.#id = id;
    this.#checkpointDbPath = checkpointDbPath;
    this.#env = env;
    this.#nodeBin = nodeBin;
    this.#now = now;
    this.#sourceSnapshotDirectory = sourceSnapshotDirectory;
    this.#searchProvider = searchProvider;
    this.#webToolsOptions = webToolsOptions;
  }

  get id() {
    return this.#id;
  }

  async start(request) {
    if (this.#runs.has(request.id)) throw new Error(`Research run ${request.id} has already started.`);
    await mkdir(path.dirname(this.#checkpointDbPath), { recursive: true }).catch(() => undefined);
    const modelConfig = resolveModelConfig(this.#env);
    const searchProvider = this.#searchProvider ?? resolveSearchProvider(this.#env);
    const { forChild: modelForChild, apiKey } = splitModelConfigForChild(modelConfig);
    const workingDirectory = await mkdtemp(path.join(os.tmpdir(), "research-deepagents-"));
    const controller = new AbortController();
    const startedAtMs = this.#now();
    const threadId = `deepagents:${request.id}`;

    const run = {
      state: "running",
      emitted: [],
      waiters: [],
      closed: false,
      ordinal: 0,
      controller,
      workingDirectory,
      childPid: null,
      childStdin: null,
      usage: null,
      budgetState: null,
      truncatedBy: null,
      finalResult: null,
      error: null,
      cancelRequested: false,
      startedAtMs,
      webTools: null,
    };
    run.webTools = new ResearchWebTools({
      runId: request.id,
      budget: request.budget,
      context: request.context ?? [],
      searchProvider,
      snapshotDirectory: this.#sourceSnapshotDirectory,
      signal: controller.signal,
      onEvent: (type, data) => {
        if (!run.closed) this.#emit(run, request.id, type, data);
      },
      ...this.#webToolsOptions,
    });
    this.#runs.set(request.id, run);

    const childConfig = {
      runId: request.id,
      objective: request.objective,
      context: request.context ?? [],
      constraints: request.constraints ?? null,
      outputSchema: request.outputSchema ?? null,
      budget: request.budget,
      model: modelForChild,
      checkpoint: { dbPath: this.#checkpointDbPath, threadId },
    };

    const env = buildChildEnvironment(this.#env, {
      modelApiKeyEnvVar: modelConfig.apiKeyEnvVar,
      modelApiKey: apiKey,
      tempDirectory: workingDirectory,
    });

    this.#emit(run, request.id, "run.started", { objective: request.objective });

    runProcess(this.#nodeBin, [WORKER_ENTRYPOINT], {
      cwd: workingDirectory,
      env,
      input: `${JSON.stringify(childConfig)}\n`,
      keepStdinOpen: true,
      signal: controller.signal,
      timeoutMs: request.budget.maxRuntimeMs,
      label: RUN_LABEL,
      onSpawn: (child) => {
        run.childPid = child.pid ?? null;
        run.childStdin = child.stdin;
        child.stdin.on("error", (error) => {
          if (!run.closed && error?.code !== "EPIPE")
            this.#emit(run, request.id, "log", {
              message: `Research worker input failed: ${error?.message ?? error}`,
            });
        });
      },
      onStdoutLine: (line) => this.#handleLine(run, request.id, line),
    }).then(
      (result) => this.#handleExit(run, request.id, result, null),
      (error) => this.#handleExit(run, request.id, null, error),
    );

    return {
      runId: request.id,
      runtimeId: this.#id,
      status: run.state,
      startedAt: new Date(startedAtMs).toISOString(),
      // Opaque. Eversor persists this and never interprets it (architecture §4.1(b)).
      runtimeMetadata: {
        threadId,
        checkpointDbPath: this.#checkpointDbPath,
        ...(run.childPid ? { childPid: String(run.childPid) } : {}),
      },
    };
  }

  async status(runId) {
    const run = this.#require(runId);
    return {
      runId,
      status: run.state,
      usage: run.usage ?? { partial: run.state !== "completed" },
      progress: { phase: run.state === "completed" ? "done" : "investigate" },
      ...(run.budgetState
        ? { budgetState: { ...run.budgetState, ...(run.truncatedBy ? { ceilingHit: run.truncatedBy } : {}) } }
        : {}),
      ...(run.error ? { error: run.error } : {}),
    };
  }

  /** Cancellation, layer 2 and 3 (architecture §9.4). Layer 1 — persisting intent before any
   *  signal — is `ResearchService.cancel()`'s job and already happened by the time this runs.
   *  Aborting the controller is what `runProcess` listens on: SIGTERM first, then the existing
   *  `terminateProcessTree` escalation to SIGKILL if the child does not exit in time. */
  async cancel(runId) {
    const run = this.#runs.get(runId);
    if (!run || run.closed) return;
    run.cancelRequested = true;
    run.controller.abort();
  }

  async *events(runId, cursor) {
    const run = this.#require(runId);
    let index = Number(cursor ?? 0);
    while (true) {
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
    const usage = {
      ...(run.usage ?? {}),
      partial: run.state !== "completed" ? true : Boolean(run.usage?.partial),
    };
    if (run.finalResult) {
      return {
        ...run.finalResult,
        runId,
        usage: { ...usage, ...(run.finalResult.usage ?? {}), partial: usage.partial },
        ...(run.truncatedBy ? { truncatedBy: run.truncatedBy } : {}),
      };
    }
    return {
      runId,
      findings: [],
      artifacts: [],
      usage,
      unresolvedQuestions: [run.error?.message ?? "The Deep Agents worker ended before producing a result."],
      ...(run.truncatedBy ? { truncatedBy: run.truncatedBy } : {}),
    };
  }

  // --- internals ----------------------------------------------------------------------------

  #handleLine(run, runId, line) {
    const message = decodeWorkerLine(line);
    if (!message) {
      // Not a protocol message — noise from a dependency, or a crash trace. Kept visible as a
      // log event rather than silently dropped or treated as a run-ending malformation.
      this.#emit(run, runId, "log", { message: `worker: ${line.slice(0, 500)}` });
      return;
    }
    switch (message.type) {
      case "research_event":
        this.#emit(run, runId, message.event, message.data ?? {});
        break;
      case "usage":
        run.usage = message.usage ?? run.usage;
        if (message.budgetState) run.budgetState = message.budgetState;
        this.#emit(run, runId, "usage.updated", { usage: run.usage });
        break;
      case "result":
        run.finalResult = message.result ?? null;
        if (message.result?.truncatedBy) run.truncatedBy = message.result.truncatedBy;
        break;
      case "error":
        run.error = message.error ?? { message: "The Deep Agents worker reported an error." };
        if (message.error?.truncatedBy) run.truncatedBy = message.error.truncatedBy;
        break;
      case "log":
        this.#emit(run, runId, "log", { message: message.message });
        break;
      case "tool_request":
        void this.#handleToolRequest(run, runId, message);
        break;
      default:
        break;
    }
  }

  async #handleToolRequest(run, runId, message) {
    if (run.closed || !run.childStdin || !message.requestId) return;
    let response;
    try {
      const payload = await run.webTools.invoke(message.tool, message.input ?? {});
      response = { type: "tool_response", requestId: message.requestId, ok: true, ...payload };
    } catch (error) {
      response = {
        type: "tool_response",
        requestId: message.requestId,
        ok: false,
        error: {
          code: error?.code ?? "host_tool_failed",
          message: error?.message ?? String(error),
          ...(error?.ceiling ? { ceiling: error.ceiling } : {}),
        },
        budgetState: run.webTools.budgetState(),
      };
    }
    if (run.closed || !run.childStdin) return;
    try {
      run.childStdin.write(encodeHostMessage(response));
    } catch (error) {
      this.#emit(run, runId, "log", {
        message: `Could not reply to host tool request ${message.requestId}: ${error?.message ?? error}`,
      });
    }
  }

  #handleExit(run, runId, processResult, spawnError) {
    if (run.closed) return;
    if (run.cancelRequested) {
      run.state = "cancelled";
      this.#emit(run, runId, "run.cancelled", { reason: "operator" });
    } else if (spawnError) {
      run.error ??= {
        code:
          /timeout/i.test(spawnError.name ?? "") || spawnError.code === "PROCESS_TIMEOUT"
            ? "research_timeout"
            : "child_process_failed",
        message: spawnError.message ?? String(spawnError),
      };
      if (run.error.code === "research_timeout") run.truncatedBy ??= "maxRuntimeMs";
      run.state = "failed";
      this.#emit(run, runId, "run.failed", run.error);
    } else if (processResult.code !== 0) {
      run.error ??= {
        code: "child_process_exited_abnormally",
        message: `The Deep Agents worker exited with code ${processResult.code}${processResult.signal ? ` (signal ${processResult.signal})` : ""}.`,
      };
      run.state = "failed";
      this.#emit(run, runId, "run.failed", run.error);
    } else if (run.error) {
      run.state = "failed";
      this.#emit(run, runId, "run.failed", run.error);
    } else if (!run.finalResult) {
      run.error = {
        code: "runtime_ended_without_result",
        message: "The Deep Agents worker exited without reporting a result.",
      };
      run.state = "failed";
      this.#emit(run, runId, "run.failed", run.error);
    } else {
      run.state = "completed";
      this.#emit(run, runId, "run.completed", {
        findings: run.finalResult.findings?.length ?? 0,
        ...(run.truncatedBy ? { truncatedBy: run.truncatedBy } : {}),
      });
    }
    run.closed = true;
    if (!run.controller.signal.aborted) run.controller.abort();
    for (const resolve of run.waiters.splice(0)) resolve();
    void rm(run.workingDirectory, { recursive: true, force: true }).catch(() => undefined);
  }

  #emit(run, runId, type, data) {
    run.ordinal += 1;
    run.emitted.push({
      id: randomUUID(),
      ordinal: run.ordinal,
      runId,
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
