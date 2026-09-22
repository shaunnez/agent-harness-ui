// Provider-neutral research contracts (RESEARCH-RUNTIME-ARCHITECTURE.md §4.2).
//
// Nothing runtime-specific may appear in this file: no graph or session identifier, no
// saved-state handle, no model message, no runtime tool payload. A managed research API, a
// locally hosted agent framework and a hand-rolled runtime must all be able to satisfy these
// types without knowing what the others are, and none of their vocabularies may be named
// here — not even in a comment. `tests/research-contracts.test.mjs` checks that mechanically,
// so a leak fails a test rather than a review.

export type ResearchProfile = "quick" | "standard" | "deep";

export type ResearchRunState =
  | "queued"
  | "running"
  | "awaiting_approval"
  | "cancelling"
  | "cancelled"
  | "failed"
  | "completed";

export type ResearchEventType =
  | "run.started"
  | "run.completed"
  | "run.failed"
  | "run.cancelled"
  | "phase.started"
  | "phase.completed"
  | "worker.started"
  | "worker.completed"
  | "worker.failed"
  | "tool.called"
  | "source.retrieved"
  | "finding.created"
  | "budget.ceiling_hit"
  | "usage.updated"
  | "artifact.created"
  | "log";

/** Conceptual role, never a model id and never a runtime agent handle. */
export type ResearchRole = "planner" | "researcher" | "verifier" | "synthesiser";

export interface ResearchBudget {
  // Hard-enforceable ceilings (architecture §9.1). Slice 1 carries them to the runtime and
  // persists them unchanged; enforcement inside a real runtime lands with that runtime.
  maxResearchers: number;
  maxConcurrentResearchers: number;
  maxDepth: number;
  maxRuntimeMs: number;
  maxModelCalls: number;
  maxToolCalls: number;
  maxSearchCalls: number;
  // Soft — post-hoc, may overshoot by at most one model call per in-flight branch (§9.2).
  maxUsd?: number;
  maxTokens?: number;
}

/** Ceilings that a run can be truncated by. Soft limits are excluded on purpose: they can be
 *  exceeded before they are noticed, so they are reported as overruns, not as truncation. */
export type ResearchHardCeiling =
  | "maxResearchers"
  | "maxConcurrentResearchers"
  | "maxDepth"
  | "maxRuntimeMs"
  | "maxModelCalls"
  | "maxToolCalls"
  | "maxSearchCalls";

export interface ResearchContextRef {
  type: string;
  id: string;
}

export interface ResearchRequest {
  id: string;
  objective: string;
  profile: ResearchProfile;
  context: ResearchContextRef[];
  constraints?: Record<string, unknown>;
  budget: ResearchBudget;
  outputSchema?: Record<string, unknown>;
  /** Opaque operator-supplied labels. Passed to the runtime untouched; a runtime that does
   *  not recognise a key must ignore it. Not a place for Eversor semantics. */
  metadata?: Record<string, string>;
}

export interface ResearchUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  modelCalls?: number;
  toolCalls?: number;
  searchCalls?: number;
  estimatedCostUsd?: number;
  /** True when a failure or cancellation means some spend is unaccounted for. Research never
   *  records `usage: null` on a failed run the way the SDLC plane does today (audit §12). */
  partial: boolean;
  byModel?: Record<
    string,
    {
      inputTokens?: number;
      outputTokens?: number;
      modelCalls?: number;
      estimatedCostUsd?: number;
      /** False when no rate card exists for this model id. */
      priced: boolean;
    }
  >;
}

/** Observed consumption measured against the configured ceilings. Separate from
 *  `ResearchUsage`, which is a spend ledger: this is the ceiling ledger. */
export interface ResearchBudgetState {
  modelCallsUsed: number;
  toolCallsUsed: number;
  searchCallsUsed: number;
  researchersStarted: number;
  elapsedMs: number;
  ceilingHit?: ResearchHardCeiling;
  /** Soft ceilings the run went past. Reported after the fact, never enforced (§9.2), and
   *  kept separate from `ceilingHit` so an overrun is never read as a hard stop. */
  softOverruns?: Array<"maxUsd" | "maxTokens">;
}

/** Which model actually answered a run, reported by the adapter that started it.
 *
 *  This is an identity, not a selection: no credential, no endpoint, no constructor option,
 *  and nothing a runtime needs in order to be driven. It is here because an operator reading
 *  a finding has to be able to tell what produced it — in particular whether a deterministic
 *  stand-in produced it — and a runtime is the only thing that knows. `provider` is a coarse
 *  family (`anthropic`, `openai-compatible`, `claude-cli`, `fake`); `model` is whatever that
 *  provider calls the model, reported verbatim rather than mapped onto a house vocabulary.
 *
 *  `live: false` marks a run answered by a deterministic stand-in rather than a model, so a
 *  reader never has to recognise a particular provider name to know a finding is not real. */
export interface ResearchModelIdentity {
  provider: string;
  model: string;
  live: boolean;
}

export interface ResearchRunHandle {
  runId: string;
  runtimeId: string;
  status: ResearchRunState;
  startedAt: string;
  /** What answered this run. Absent only from a runtime that calls no model at all. */
  model?: ResearchModelIdentity;
  /** Opaque adapter-owned identifiers. Eversor persists this and never interprets it: it is
   *  the one place a runtime may keep correlation data, and it is a flat string map so that
   *  nothing structured can be smuggled into a neutral contract. */
  runtimeMetadata?: Readonly<Record<string, string>>;
}

export interface ResearchRunError {
  code?: string;
  message: string;
}

export interface ResearchRunProgress {
  phase?: string;
  completedWorkers?: number;
  activeWorkers?: number;
  totalWorkers?: number;
}

export interface ResearchRunStatus {
  runId: string;
  status: ResearchRunState;
  usage: ResearchUsage;
  progress?: ResearchRunProgress;
  budgetState?: ResearchBudgetState;
  error?: ResearchRunError;
}

export interface ResearchEvent {
  id: string;
  /** Monotonic within a run. Drives the polling cursor, like the task poll version. */
  ordinal: number;
  runId: string;
  timestamp: string;
  type: ResearchEventType;
  data: unknown;
}

export interface EvidenceLocator {
  page?: number;
  section?: string;
  lineStart?: number;
  lineEnd?: number;
  selector?: string;
  charStart?: number;
  charEnd?: number;
}

export type EvidenceSourceType = "web" | "project_document" | "internal_record" | "other";

export interface EvidenceRef {
  sourceId: string;
  sourceType: EvidenceSourceType;
  url?: string;
  title?: string;
  retrievedAt: string;
  locator?: EvidenceLocator;
  excerpt?: string;
  /** Content-addressed reference to a retained snapshot. Without it a citation is an assertion
   *  rather than host-verifiable evidence (architecture §7.4). */
  snapshotRef?: string;
  /** Set by the host after checking `excerpt` against the snapshot (§10.3). Never supplied by
   *  a model, and false whenever no snapshot exists to check against. */
  quoteVerified: boolean;
  authority?: "primary" | "secondary" | "unknown";
}

export interface ResearchFinding {
  id: string;
  claim: string;
  evidence: EvidenceRef[];
  assumptions?: string[];
  contradictions?: string[];
  confidence?: number;
  producedBy: ResearchRole;
  verification?: {
    status: "unverified" | "supported" | "weakened" | "rejected";
    notes?: string;
  };
}

export interface ResearchArtifact {
  id: string;
  kind: string;
  name: string;
  contentRef: string;
}

export interface ResearchResult {
  runId: string;
  /** Carried onto the result so a finding read on its own still says what answered it. */
  model?: ResearchModelIdentity;
  summary?: string;
  findings: ResearchFinding[];
  artifacts: ResearchArtifact[];
  usage: ResearchUsage;
  unresolvedQuestions?: string[];
  /** Set when the run stopped because a ceiling was reached, so a bounded result is never
   *  mistaken for an exhaustive one (§9.1, `exitBehavior: "continue"`). */
  truncatedBy?: ResearchHardCeiling;
}

/** A research runtime. Implementations are resolved by `id` through the registry, and this
 *  interface — nothing else — is the seam the first real adapter attaches to.
 *
 *  Resumption is deliberately absent from this interface. It is added only once a runtime
 *  demonstrates genuine mid-execution continuation rather than a re-run (§4.1(a), risk R6). */
export interface ResearchRuntime {
  readonly id: string;
  start(request: ResearchRequest, signal?: AbortSignal): Promise<ResearchRunHandle>;
  status(runId: string): Promise<ResearchRunStatus>;
  cancel(runId: string): Promise<void>;
  events(runId: string, cursor?: string): AsyncIterable<ResearchEvent>;
  result(runId: string): Promise<ResearchResult>;
}

/** What the API returns for a run: the Eversor-owned record, not the runtime's view of it. */
export interface ResearchRunRecord {
  id: string;
  runtimeId: string;
  /** Null until the runtime has started and reported one, and for a runtime that calls no
   *  model. Never inferred by the host: an unreported identity stays unknown. */
  model: ResearchModelIdentity | null;
  profile: ResearchProfile;
  status: ResearchRunState;
  createdAt: string;
  updatedAt: string;
  revision: number;
  objective: string;
  request: ResearchRequest;
  budget: ResearchBudget;
  usage: ResearchUsage | null;
  budgetState: ResearchBudgetState | null;
  error: ResearchRunError | null;
  cancellationRequestedAt: string | null;
}
