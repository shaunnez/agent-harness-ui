// A deterministic `ResearchRuntime`. It exists to exercise the lifecycle, the persistence and
// the API without a model, a network call or a dependency, and to stay behind as the
// regression harness once a real runtime lands.
//
// It is deliberately not instant. A run advances one step at a time so that cancellation has
// somewhere to happen: a runtime that finishes inside `start()` cannot prove that
// queued -> running -> cancelling -> cancelled works. Tests drive `advance()` directly; the
// companion lets a short timer do it.

import { emptyResearchUsage } from "../../src/research-budget-policy.ts";

/** How many sub-questions the fake planner always wants to investigate. Anything below this
 *  in `budget.maxResearchers` truncates the run, which is how the fake demonstrates that it
 *  received — and respected — the budget policy rather than merely being handed it. */
const PLANNED_WORKERS = 3;

/** Deterministic spacing between emitted events, relative to the run's real start. */
const STEP_INTERVAL_MS = 1_000;

export class FakeResearchRuntime {
  #id;
  #runs = new Map();
  #autoAdvance;
  #stepDelayMs;
  #outcomeFor;

  constructor({ id = "fake", autoAdvance = true, stepDelayMs = 5, outcomeFor = defaultOutcome } = {}) {
    this.#id = id;
    this.#autoAdvance = autoAdvance;
    this.#stepDelayMs = stepDelayMs;
    this.#outcomeFor = outcomeFor;
  }

  get id() {
    return this.#id;
  }

  async start(request, signal) {
    if (this.#runs.has(request.id)) throw new Error(`Research run ${request.id} has already started.`);
    if (signal?.aborted) throw new Error("Research run was aborted before it started.");
    const startedAtMs = Date.now();
    const workers = Math.max(0, Math.min(PLANNED_WORKERS, request.budget.maxResearchers));
    const run = {
      request,
      outcome: this.#outcomeFor(request),
      workers,
      truncatedBy: workers < PLANNED_WORKERS ? "maxResearchers" : null,
      startedAtMs,
      state: "queued",
      steps: [],
      cursor: 0,
      emitted: [],
      waiters: [],
      closed: false,
      cancelRequested: false,
      usage: emptyResearchUsage(),
      budgetState: {
        modelCallsUsed: 0,
        toolCallsUsed: 0,
        searchCallsUsed: 0,
        researchersStarted: 0,
        elapsedMs: 0,
      },
      findings: [],
      error: null,
    };
    run.steps = this.#buildSteps(request.id, run);
    this.#runs.set(request.id, run);
    signal?.addEventListener("abort", () => void this.cancel(request.id), { once: true });
    this.#schedule(request.id);
    return {
      runId: request.id,
      runtimeId: this.#id,
      status: run.state,
      startedAt: new Date(startedAtMs).toISOString(),
      // Opaque on purpose. A real adapter puts its own correlation ids here; Eversor stores
      // the map and never reads a key out of it.
      runtimeMetadata: { fakeRunSlot: String(this.#runs.size + 1), fakeAdmittedWorkers: String(workers) },
    };
  }

  async status(runId) {
    const run = this.#require(runId);
    return {
      runId,
      status: run.state,
      usage: { ...run.usage },
      progress: {
        phase: run.state === "completed" ? "done" : "investigate",
        completedWorkers: run.budgetState.researchersStarted,
        activeWorkers: run.state === "running" ? 1 : 0,
        totalWorkers: run.workers,
      },
      budgetState: { ...run.budgetState, ...(run.truncatedBy ? { ceilingHit: run.truncatedBy } : {}) },
      ...(run.error ? { error: run.error } : {}),
    };
  }

  async cancel(runId) {
    const run = this.#runs.get(runId);
    if (!run || run.closed || run.cancelRequested) return;
    run.cancelRequested = true;
    run.state = "cancelling";
    this.#schedule(runId);
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
    const complete = run.state === "completed";
    return {
      runId,
      summary: `${complete ? "Deterministic" : "Partial"} answer to: ${run.request.objective}`,
      findings: run.findings,
      artifacts: complete
        ? [{ id: "brief", kind: "research-brief", name: "Research brief", contentRef: "inline:brief" }]
        : [],
      usage: { ...run.usage },
      unresolvedQuestions: complete ? [] : ["The run stopped before every worker reported."],
      ...(run.truncatedBy ? { truncatedBy: run.truncatedBy } : {}),
    };
  }

  // --- deterministic control ---------------------------------------------------------------

  /** Execute exactly one step. Returns false once the run has closed. */
  advance(runId) {
    const run = this.#require(runId);
    if (run.closed) return false;
    if (run.cancelRequested) {
      run.state = "cancelled";
      run.usage.partial = true;
      this.#emit(run, runId, "run.cancelled", { reason: "operator" });
      this.#close(run);
      return false;
    }
    const step = run.steps[run.cursor];
    if (!step) {
      this.#close(run);
      return false;
    }
    run.cursor += 1;
    step();
    if (!run.closed) this.#schedule(runId);
    return !run.closed;
  }

  advanceToEnd(runId) {
    while (this.advance(runId));
  }

  /** The budget the runtime was actually handed, for the test that proves it arrived. */
  receivedBudget(runId) {
    return { ...this.#require(runId).request.budget };
  }

  static get plannedWorkers() {
    return PLANNED_WORKERS;
  }

  // --- internals ----------------------------------------------------------------------------

  #schedule(runId) {
    if (!this.#autoAdvance) return;
    const timer = setTimeout(() => this.advance(runId), this.#stepDelayMs);
    timer.unref?.();
  }

  #require(runId) {
    const run = this.#runs.get(runId);
    if (!run) throw new Error(`Unknown research run ${runId}.`);
    return run;
  }

  #close(run) {
    run.closed = true;
    for (const resolve of run.waiters.splice(0)) resolve();
  }

  #emit(run, runId, type, data) {
    const ordinal = run.emitted.length + 1;
    run.budgetState.elapsedMs = ordinal * STEP_INTERVAL_MS;
    run.emitted.push({
      id: `${runId}-E${String(ordinal).padStart(3, "0")}`,
      ordinal,
      runId,
      timestamp: new Date(run.startedAtMs + ordinal * STEP_INTERVAL_MS).toISOString(),
      type,
      data,
    });
    for (const resolve of run.waiters.splice(0)) resolve();
  }

  #spend(run, { modelCalls = 0, toolCalls = 0, searchCalls = 0, inputTokens = 0, outputTokens = 0, model }) {
    run.usage.modelCalls += modelCalls;
    run.usage.toolCalls += toolCalls;
    run.usage.searchCalls += searchCalls;
    run.usage.inputTokens += inputTokens;
    run.usage.outputTokens += outputTokens;
    run.budgetState.modelCallsUsed += modelCalls;
    run.budgetState.toolCallsUsed += toolCalls;
    run.budgetState.searchCallsUsed += searchCalls;
    if (!model) return;
    run.usage.byModel ??= {};
    // No rate card exists for a fake model, and saying so is the point: an unpriced model
    // must read as unpriced rather than as free.
    run.usage.byModel[model] ??= { inputTokens: 0, outputTokens: 0, modelCalls: 0, priced: false };
    const entry = run.usage.byModel[model];
    entry.inputTokens += inputTokens;
    entry.outputTokens += outputTokens;
    entry.modelCalls += modelCalls;
  }

  #buildSteps(runId, run) {
    const steps = [
      () => {
        run.state = "running";
        this.#emit(run, runId, "run.started", { objective: run.request.objective });
        // Echoing the resolved ceilings proves the policy crossed the boundary intact.
        this.#emit(run, runId, "log", {
          message: "Runtime received the resolved budget.",
          budget: run.request.budget,
          plannedWorkers: PLANNED_WORKERS,
          admittedWorkers: run.workers,
        });
        this.#emit(run, runId, "phase.started", { phase: "investigate" });
        this.#spend(run, { modelCalls: 1, inputTokens: 800, outputTokens: 200, model: "fake-planner" });
      },
    ];
    if (run.outcome === "failure") {
      steps.push(() => {
        run.state = "failed";
        run.usage.partial = true;
        run.error = { code: "fake_runtime_failure", message: "The fake research runtime was asked to fail." };
        this.#emit(run, runId, "run.failed", run.error);
        this.#close(run);
      });
      return steps;
    }
    for (let index = 1; index <= run.workers; index += 1) {
      steps.push(() => {
        // Deliberately not namespaced by run. A real runtime numbers its own sources from
        // one, and the host is what makes two runs' `source-1` two different sources.
        const sourceId = `source-${index}`;
        const retrievedAt = new Date(run.startedAtMs + index * STEP_INTERVAL_MS).toISOString();
        this.#emit(run, runId, "worker.started", { worker: index, role: "researcher" });
        this.#emit(run, runId, "tool.called", { tool: "web_search", worker: index });
        this.#emit(run, runId, "source.retrieved", {
          source: {
            id: sourceId,
            sourceType: "web",
            url: `https://example.invalid/fake-source-${index}`,
            title: `Fake source ${index}`,
            retrievedAt,
            mediaType: "text/html",
          },
        });
        run.findings.push({
          id: `${runId}-F${index}`,
          claim: `Deterministic finding ${index} for "${run.request.objective}".`,
          producedBy: "researcher",
          confidence: 0.5,
          assumptions: [`Fake assumption ${index}.`],
          contradictions: [],
          // Slice 1 has no host-side snapshot to check a quote against, so nothing is verified
          // and nothing pretends to be. Slice 7 sets `quoteVerified` from a real substring test.
          verification: {
            status: "unverified",
            notes: "The deterministic fake runtime does not create host-retained source snapshots.",
          },
          evidence: [
            {
              sourceId,
              sourceType: "web",
              url: `https://example.invalid/fake-source-${index}`,
              title: `Fake source ${index}`,
              retrievedAt,
              locator: { section: `Section ${index}`, charStart: 100 * index, charEnd: 100 * index + 42 },
              excerpt: `Fake excerpt ${index} supporting the claim.`,
              quoteVerified: false,
              authority: "secondary",
            },
          ],
        });
        run.budgetState.researchersStarted += 1;
        this.#spend(run, {
          modelCalls: 2,
          toolCalls: 3,
          searchCalls: 1,
          inputTokens: 1_200,
          outputTokens: 400,
          model: "fake-researcher",
        });
        this.#emit(run, runId, "finding.created", { findingId: `${runId}-F${index}` });
        this.#emit(run, runId, "worker.completed", { worker: index });
      });
    }
    steps.push(() => {
      this.#spend(run, { modelCalls: 1, inputTokens: 900, outputTokens: 300, model: "fake-synthesiser" });
      this.#emit(run, runId, "phase.completed", { phase: "investigate" });
      if (run.truncatedBy) {
        this.#emit(run, runId, "budget.ceiling_hit", {
          ceiling: run.truncatedBy,
          requested: PLANNED_WORKERS,
          admitted: run.workers,
        });
      }
      this.#emit(run, runId, "usage.updated", { usage: { ...run.usage } });
      this.#emit(run, runId, "artifact.created", { artifactId: "brief", kind: "research-brief" });
      run.state = "completed";
      this.#emit(run, runId, "run.completed", {
        findings: run.findings.length,
        ...(run.truncatedBy ? { truncatedBy: run.truncatedBy } : {}),
      });
      this.#close(run);
    });
    return steps;
  }
}

function defaultOutcome(request) {
  // `metadata` is the neutral opaque label bag on `ResearchRequest`. A runtime that does not
  // recognise a key ignores it, which is exactly how a real adapter treats one it did not
  // define — so steering the fake through it costs the contract nothing.
  return request.metadata?.fakeOutcome === "failure" ? "failure" : "success";
}
