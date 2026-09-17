// Runtime-checkable companions to the research contracts, plus the compile-time assertions
// that keep those contracts neutral. `npm run typecheck` is the test: if a runtime concept is
// added to `src/domain/research.ts`, or a state is added without being listed here, this file
// stops compiling.

import type {
  EvidenceRef,
  ResearchArtifact,
  ResearchBudget,
  ResearchBudgetState,
  ResearchEvent,
  ResearchEventType,
  ResearchFinding,
  ResearchProfile,
  ResearchRequest,
  ResearchResult,
  ResearchRunHandle,
  ResearchRunRecord,
  ResearchRunState,
  ResearchRunStatus,
  ResearchRuntime,
  ResearchUsage,
} from "./domain/research";

export const RESEARCH_PROFILES = ["quick", "standard", "deep"] as const satisfies readonly ResearchProfile[];

export const RESEARCH_RUN_STATES = [
  "queued",
  "running",
  "awaiting_approval",
  "cancelling",
  "cancelled",
  "failed",
  "completed",
] as const satisfies readonly ResearchRunState[];

/** A run in one of these states will never change again, so the service stops consuming. */
export const TERMINAL_RESEARCH_RUN_STATES = [
  "completed",
  "failed",
  "cancelled",
] as const satisfies readonly ResearchRunState[];

export const RESEARCH_EVENT_TYPES = [
  "run.started",
  "run.completed",
  "run.failed",
  "run.cancelled",
  "phase.started",
  "phase.completed",
  "worker.started",
  "worker.completed",
  "worker.failed",
  "tool.called",
  "source.retrieved",
  "finding.created",
  "budget.ceiling_hit",
  "usage.updated",
  "artifact.created",
  "log",
] as const satisfies readonly ResearchEventType[];

export function isResearchProfile(value: unknown): value is ResearchProfile {
  return RESEARCH_PROFILES.includes(value as ResearchProfile);
}

export function isResearchRunState(value: unknown): value is ResearchRunState {
  return RESEARCH_RUN_STATES.includes(value as ResearchRunState);
}

export function isTerminalResearchRunState(value: unknown): value is ResearchRunState {
  return TERMINAL_RESEARCH_RUN_STATES.includes(value as (typeof TERMINAL_RESEARCH_RUN_STATES)[number]);
}

export function isResearchEventType(value: unknown): value is ResearchEventType {
  return RESEARCH_EVENT_TYPES.includes(value as ResearchEventType);
}

// --- Compile-time contract tests -------------------------------------------------------
// These types are never constructed. They exist so that `tsc --noEmit` fails on drift.

type Assert<Condition extends true> = Condition;
type Exhaustive<Union, Listed> = [Exclude<Union, Listed>] extends [never] ? true : false;

/** Every member of each union is listed above, not merely every listed value valid. */
export type ResearchUnionsAreExhaustive = [
  Assert<Exhaustive<ResearchProfile, (typeof RESEARCH_PROFILES)[number]>>,
  Assert<Exhaustive<ResearchRunState, (typeof RESEARCH_RUN_STATES)[number]>>,
  Assert<Exhaustive<ResearchEventType, (typeof RESEARCH_EVENT_TYPES)[number]>>,
];

/** Vocabulary that belongs to some particular runtime and must never surface in a neutral
 *  type: graph and session identifiers, saved-state handles, agent-composition machinery, and
 *  model-shaped message payloads. Deliberately absent: `toolCalls`, which `ResearchUsage`
 *  legitimately owns as a *count* of tool invocations — a neutral measure every runtime can
 *  report, unlike a model's raw `tool_calls` payload. */
type RuntimeSpecificKey =
  | "thread"
  | "threadId"
  | "thread_id"
  | "runtimeThreadId"
  | "checkpoint"
  | "checkpointer"
  | "checkpointId"
  | "graph"
  | "graphState"
  | "langsmith"
  | "messages"
  | "tool_calls"
  | "subagent"
  | "subagents"
  | "middleware"
  | "backend";

type NeutralKeys<T> = [Extract<keyof T, RuntimeSpecificKey>] extends [never] ? true : false;

export type ResearchContractsAreRuntimeNeutral = [
  Assert<NeutralKeys<ResearchRequest>>,
  Assert<NeutralKeys<ResearchBudget>>,
  Assert<NeutralKeys<ResearchBudgetState>>,
  Assert<NeutralKeys<ResearchRunHandle>>,
  Assert<NeutralKeys<ResearchRunStatus>>,
  Assert<NeutralKeys<ResearchRunRecord>>,
  Assert<NeutralKeys<ResearchUsage>>,
  Assert<NeutralKeys<ResearchEvent>>,
  Assert<NeutralKeys<ResearchResult>>,
  Assert<NeutralKeys<ResearchFinding>>,
  Assert<NeutralKeys<EvidenceRef>>,
  Assert<NeutralKeys<ResearchArtifact>>,
  Assert<NeutralKeys<ResearchRuntime>>,
];

/** Resumption stays out of the interface until a runtime proves continuation (§4.1(a)). */
export type ResearchRuntimeHasNoResume = Assert<["resume"] extends [keyof ResearchRuntime] ? false : true>;
