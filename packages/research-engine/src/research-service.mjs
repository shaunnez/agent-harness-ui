// Research lifecycle. Owns the order of operations that a runtime must not be trusted with:
// persist before you signal, reconcile before you publish a terminal state, and never lose
// the spend of a run that failed.
//
// It has no reference to the orchestrator, the task store, a repository or a worktree. A
// research run is not a task and cannot become one: there is no code path from here into the
// SDLC plane, which is the strongest form the guarantee can take.

import {
  emptyResearchUsage,
  researchSoftOverruns,
  resolveResearchBudget,
} from "./engine/contracts/budget-policy.ts";
import { RESEARCH_ENGINES, researchPoliciesOf } from "./engine/contracts/policies.ts";
import { isResearchProfile, readResearchModelIdentity } from "./engine/contracts/runtime-contract.ts";
import { DEFAULT_RESEARCH_RUNTIME_ID } from "./research-runtime-registry.mjs";

const MAX_OBJECTIVE_LENGTH = 4_000;

/** A run the process stopped while it was still queued: never started, nothing spent. */
export const INTERRUPTED_BEFORE_START_CODE = "interrupted_before_start";
/** The failure codes of a run that never started, which a question may retry. */
export const NOT_STARTED_CODES = Object.freeze(["runtime_start_failed", INTERRUPTED_BEFORE_START_CODE]);
const MAX_CONTEXT_REFS = 20;
const MAX_METADATA_KEYS = 20;

// Submitting one of these would mean research had quietly grown an SDLC surface. Rejecting
// them keeps the mistake loud instead of letting a research run reserve repository work.
const SDLC_ONLY_FIELDS = ["workflow", "taskId", "repositoryPath", "stage", "priority", "candidateId"];

export class ResearchService {
  #store;
  #registry;
  #inFlight = new Map();
  #now;
  #settings;

  /** `settings` reads the operator's saved Settings, whose Research section says which engine
   *  and model answer a run that names neither. Without it, a run with no runtime id goes to the
   *  fake runtime, as it always has. */
  constructor({ store, registry, settings = null, now = () => new Date().toISOString() }) {
    if (!store) throw new Error("ResearchService requires a ResearchStore.");
    if (!registry) throw new Error("ResearchService requires a research runtime registry.");
    this.#store = store;
    this.#registry = registry;
    this.#settings = settings;
    this.#now = now;
  }

  runtimeIds() {
    return this.#registry.ids();
  }

  async createRun(input) {
    const request = this.#validate(input);
    const policies = this.#settings ? researchPoliciesOf(await this.#settings()) : null;
    // A request that names a runtime still wins; one that names none gets the Settings choice.
    const runtimeId = String(input.runtimeId ?? policies?.agent.runtime ?? DEFAULT_RESEARCH_RUNTIME_ID);
    const runtime = this.#registry.resolve(runtimeId);
    // Snapshotted into the stored request, so a finished run always says what answered it and a
    // later change in Settings never rewrites it.
    const researchPolicy = snapshotResearchPolicy(runtimeId, policies, input.runtimeId != null);
    if (researchPolicy) request.researchPolicy = researchPolicy;
    const record = await this.#store.createRun({
      runtimeId,
      request,
      budget: request.budget,
      now: this.#now(),
    });
    let handle;
    try {
      handle = await runtime.start(record.request);
    } catch (error) {
      // A runtime that cannot start still leaves a durable, explainable row. A run that
      // vanishes because the thing meant to run it threw is the failure mode audit §12 calls
      // out, and it is not repeated here.
      return this.#fail(record.id, {
        code: "runtime_start_failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    const started = await this.#store.updateRun(
      record.id,
      (draft) => {
        draft.status = handle.status ?? "running";
        draft.usage = emptyResearchUsage();
        if (handle.runtimeMetadata) draft.runtimeMetadata = { ...handle.runtimeMetadata };
        // Stamped once, at start, from what the runtime reported. Not re-derived later and
        // never guessed: a run whose runtime reported nothing stays `model: null` rather than
        // acquiring a plausible-looking identity it did not earn.
        draft.model = readResearchModelIdentity(handle.model);
      },
      { now: this.#now() },
    );
    this.#consume(record.id, runtime);
    return started;
  }

  async getRun(runId) {
    return this.#store.getRun(runId);
  }

  async listRuns(options) {
    return this.#store.listRuns(options);
  }

  /** A run is not resumable after the process that ran it exits. Make interrupted work
   *  inspectable as a failure instead of leaving the UI showing a worker forever. A run still
   *  waiting in the queue had spent nothing, so it fails as one that never started, which its
   *  question can retry. */
  async recoverInterrupted() {
    const interrupted = await this.#store.listInterruptedRuns();
    for (const run of interrupted)
      await this.#fail(
        run.id,
        run.status === "queued"
          ? {
              code: INTERRUPTED_BEFORE_START_CODE,
              message: "The service stopped before this research run started. Nothing was spent.",
            }
          : {
              code: "companion_interrupted",
              message: "The companion stopped before this research run finished.",
            },
      );
  }

  async listEvents(runId, options) {
    if (!(await this.#store.getRun(runId))) return null;
    return this.#store.listEvents(runId, options);
  }

  async getResult(runId) {
    return this.#store.getResult(runId);
  }

  async listSources(runId) {
    return this.#store.listSources(runId);
  }

  /** Intent is persisted before any signal leaves the process. If the companion dies between
   *  the two, the answer to "what did the operator ask for?" survives (architecture §9.4). */
  async cancel(runId) {
    const record = await this.#store.getRun(runId);
    if (!record) return null;
    if (["completed", "failed", "cancelled"].includes(record.status)) return record;
    const now = this.#now();
    const cancelling = await this.#store.updateRun(
      runId,
      (draft) => {
        draft.status = "cancelling";
        draft.cancellationRequestedAt = draft.cancellationRequestedAt ?? now;
      },
      { now },
    );
    await this.#registry.resolve(record.runtimeId).cancel(runId);
    return cancelling;
  }

  /** Resolves once the run's event stream has been consumed and its terminal row written. */
  settled(runId) {
    return this.#inFlight.get(runId) ?? Promise.resolve();
  }

  async shutdown() {
    const running = [...this.#inFlight.keys()];
    await Promise.allSettled(running.map((runId) => this.cancel(runId)));
    await Promise.allSettled(running.map((runId) => this.settled(runId)));
  }

  // --- internals ----------------------------------------------------------------------------

  #validate(input) {
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw badRequest("Provide a research request object.");
    const present = SDLC_ONLY_FIELDS.filter((field) => input[field] !== undefined);
    if (present.length)
      throw badRequest(`A research run is not an SDLC task; remove ${present.join(", ")} from the request.`);
    const objective = String(input.objective ?? "").trim();
    if (!objective) throw badRequest("A research objective is required.");
    if (objective.length > MAX_OBJECTIVE_LENGTH)
      throw badRequest(`A research objective must be ${MAX_OBJECTIVE_LENGTH} characters or fewer.`);
    const profile = input.profile === undefined ? "standard" : String(input.profile);
    if (!isResearchProfile(profile)) throw badRequest("Choose a supported research profile.");
    const context = normalizeContext(input.context);
    const metadata = normalizeMetadata(input.metadata);
    if (input.constraints !== undefined && !isPlainObject(input.constraints))
      throw badRequest("Research constraints must be an object.");
    if (input.outputSchema !== undefined && !isPlainObject(input.outputSchema))
      throw badRequest("A research output schema must be an object.");
    if (input.budget !== undefined && !isPlainObject(input.budget))
      throw badRequest("A research budget override must be an object.");
    return {
      // `id` is stamped by the store so that run identity is Eversor's, assigned once, and
      // never proposed by a caller.
      id: "",
      objective,
      profile,
      context,
      ...(input.constraints === undefined ? {} : { constraints: input.constraints }),
      budget: resolveResearchBudget(profile, input.budget ?? null),
      ...(input.outputSchema === undefined ? {} : { outputSchema: input.outputSchema }),
      ...(metadata ? { metadata } : {}),
    };
  }

  #consume(runId, runtime) {
    const task = (async () => {
      try {
        for await (const event of runtime.events(runId)) {
          await this.#ingest(runId, event);
        }
        await this.#reconcile(runId, runtime);
      } catch (error) {
        await this.#fail(runId, {
          code: "runtime_stream_failed",
          message: error instanceof Error ? error.message : String(error),
        }).catch(() => undefined);
      } finally {
        this.#inFlight.delete(runId);
      }
    })();
    this.#inFlight.set(runId, task);
  }

  async #ingest(runId, event) {
    await this.#store.appendEvent(runId, event);
    if (event.type === "source.retrieved" && event.data?.source?.id) {
      await this.#store.upsertSource(runId, event.data.source);
    }
    if (event.type === "run.started") {
      await this.#store.updateRun(
        runId,
        (draft) => {
          if (draft.status === "queued") draft.status = "running";
        },
        { now: this.#now() },
      );
    }
    // Terminal states are deliberately NOT taken from events. A `run.completed` event arrives
    // before the result rows are written, and a reader who saw `completed` at that moment
    // would find no result behind it. The terminal row is written by #reconcile, last.
  }

  async #reconcile(runId, runtime) {
    const record = await this.#store.getRun(runId);
    if (!record) return null;
    const status = await runtime.status(runId).catch(() => null);
    const result = await runtime.result(runId).catch(() => null);
    if (result) await this.#store.recordResult(runId, result, { now: this.#now() });
    // A research question compares its runs' bands, which only a cost-band runtime reports.
    const outcome = typeof runtime.outcome === "function" ? safely(() => runtime.outcome(runId)) : null;
    if (outcome) await this.#store.recordOutcome(runId, outcome);
    const terminal = status?.status && isTerminal(status.status) ? status.status : "failed";
    const usage = normalizeUsage(status?.usage ?? result?.usage, terminal);
    const overruns = researchSoftOverruns(record.budget, usage);
    return this.#store.updateRun(
      runId,
      (draft) => {
        draft.status = terminal;
        draft.usage = usage;
        draft.budgetState = {
          ...(status?.budgetState ?? {}),
          ...(result?.truncatedBy ? { ceilingHit: result.truncatedBy } : {}),
          ...(overruns.length ? { softOverruns: overruns } : {}),
        };
        draft.error =
          status?.error ??
          (terminal === "failed"
            ? {
                code: "runtime_ended_without_status",
                message: "The runtime ended without reporting a status.",
              }
            : null);
      },
      { now: this.#now() },
    );
  }

  async #fail(runId, error) {
    return this.#store.updateRun(
      runId,
      (draft) => {
        draft.status = "failed";
        // Spend before a failure is still spend. Recording `partial: true` rather than null
        // usage is the difference between an incomplete number and a missing one.
        draft.usage = { ...(draft.usage ?? emptyResearchUsage()), partial: true };
        draft.error = error;
      },
      { now: this.#now() },
    );
  }
}

/** The part of the Settings choice that applies to this runtime, or null for a runtime the
 *  Research section does not configure (the fake, or an engine other than the one selected). */
function snapshotResearchPolicy(runtimeId, policies, named) {
  if (!policies) return null;
  const source = named ? "settings-for-named-runtime" : "settings-default";
  if (runtimeId in RESEARCH_ENGINES && policies.agent.runtime === runtimeId)
    return {
      source,
      runtime: runtimeId,
      provider: policies.agent.provider,
      model: policies.agent.model,
      reasoning: policies.agent.reasoning,
    };
  return null;
}

function safely(read) {
  try {
    return read() ?? null;
  } catch {
    return null;
  }
}

function isTerminal(state) {
  return state === "completed" || state === "failed" || state === "cancelled";
}

function normalizeUsage(usage, terminal) {
  const base = { ...emptyResearchUsage(), ...(usage ?? {}) };
  base.partial = terminal !== "completed" ? true : Boolean(usage?.partial);
  return base;
}

function normalizeContext(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw badRequest("Research context must be an array of references.");
  if (value.length > MAX_CONTEXT_REFS)
    throw badRequest(`Attach no more than ${MAX_CONTEXT_REFS} context references.`);
  return value.map((reference) => {
    const type = String(reference?.type ?? "").trim();
    const id = String(reference?.id ?? "").trim();
    if (!type || !id) throw badRequest("Each research context reference needs a type and an id.");
    return { type, id };
  });
}

function normalizeMetadata(value) {
  if (value == null) return null;
  if (!isPlainObject(value)) throw badRequest("Research metadata must be a flat object of strings.");
  const entries = Object.entries(value);
  if (entries.length > MAX_METADATA_KEYS)
    throw badRequest(`Provide no more than ${MAX_METADATA_KEYS} research metadata keys.`);
  for (const [, item] of entries) {
    if (typeof item !== "string") throw badRequest("Research metadata values must be strings.");
  }
  return Object.fromEntries(entries);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}
