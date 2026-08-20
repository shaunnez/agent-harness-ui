export const stageIds = [
  "triage",
  "scouts",
  "synthesis",
  "grill",
  "specification",
  "plan",
  "plan-review",
  "implement",
  "dev-review",
  "test",
  "final-review",
  "approval",
] as const;

export type StageId = (typeof stageIds)[number];
export const scoutRoleIds = [
  "scout-code-path",
  "scout-dependency",
  "scout-pattern",
  "scout-schema",
  "scout-test-inventory",
  "scout-user-journey",
] as const;
export type ScoutRoleId = (typeof scoutRoleIds)[number];
export type AgentRoleId = StageId | "repair" | ScoutRoleId;
export const agentRoleIds: AgentRoleId[] = [...stageIds.slice(0, -1), "repair", ...scoutRoleIds, "approval"];
export type Provider = "codex" | "claude" | "harness";
export type { RuntimeEvent, RuntimeRun, RuntimeToolCall } from "./runtime-activity";
export type TaskRunState =
  | "running"
  | "paused"
  | "needs-input"
  | "failed"
  | "repairing"
  | "blocked"
  | "awaiting-approval"
  | "merged-to-target"
  | "completed"
  | "closed"
  | "continued"
  | "archived";
export type AppScreen = "command" | "tasks" | "skills" | "agents" | "settings";

export interface WorkflowStage {
  id: StageId;
  label: string;
  shortLabel: string;
  provider: Provider;
  skill: string;
}

export interface RecentTask {
  id: string;
  title: string;
  status: "Running" | "Blocked" | "Completed" | "Needs input" | "Closed" | "Continued" | "Archived";
  stage: string;
  stageIndex: number;
  duration: string;
  stageRun: number;
  stageRunLimit: number;
  stageRunLabel?: string;
  tokens: string;
  cost: string;
  inputTokens?: string;
  uncachedInputTokens?: string;
  outputTokens?: string;
  cachedTokens?: string;
  cacheRate?: string;
  models: Array<{ provider: Exclude<Provider, "harness">; model: string }>;
  priority: "Low" | "Medium" | "High";
  startedAt?: string;
  endedAt?: string;
  updatedAt?: string;
}

export interface NewTaskDraft {
  title: string;
  description: string;
  repositoryPath: string;
  workflow: "investigate" | "implement";
  priority: "low" | "medium" | "high";
  workflowProfile?: "auto" | "fast" | "standard" | "high-risk";
  model?: string;
  reasoning?: string;
  experiment?: {
    groupId: string;
    variantId: string;
    frozenBaseSha: string;
    acceptanceCriteria: string[];
    verificationCommands: string[];
  } | null;
  attachments?: Array<{ name: string; type: string; size: number; data: string }>;
}

import type { RuntimeTask, RuntimeTaskSummary, RuntimeUsage } from "./domain/runtime.ts";
import {
  getEffectiveRunStage,
  getEffectiveStageRunAttempts,
  getEffectiveStageRunLimit,
} from "./runtime-stage-limits.ts";

export * from "./domain/runtime.ts";

export const EXAMPLE_TITLE = "Add task priority";
export const EXAMPLE_DESCRIPTION =
  "Add task priority (`low | medium | high`). Default new tasks to `medium`, expose it through the API, show a coloured badge in the UI, and add tests.";

export function runtimeTaskToRecentTask(task: RuntimeTask | RuntimeTaskSummary): RecentTask {
  const stageIndex = Math.max(
    0,
    workflowStages.findIndex((stage) => stage.id === task.currentStage),
  );
  const status: RecentTask["status"] =
    task.status === "archived"
      ? "Archived"
      : task.workflow === "investigate" && task.continuedByTaskId
        ? "Continued"
        : task.status === "closed"
          ? "Closed"
          : task.status === "completed"
            ? "Completed"
            : task.status === "merged-to-target"
              ? "Needs input"
              : task.status === "merging"
                ? "Needs input"
                : task.status === "queued" ||
                    task.status.startsWith("awaiting-") ||
                    task.status.startsWith("ready-for-")
                  ? "Needs input"
                  : task.status === "failed" ||
                      task.status === "blocked" ||
                      task.status === "cancelled" ||
                      task.status === "repair-required"
                    ? "Blocked"
                    : task.status === "running" || task.status === "cancelling"
                      ? "Running"
                      : "Needs input";
  const effectiveStage = getEffectiveRunStage(task);
  const effectiveStageLabel =
    workflowStages.find((stage) => stage.id === effectiveStage)?.shortLabel ?? effectiveStage;
  return {
    id: task.id,
    title: task.title,
    status,
    stage: workflowStages[stageIndex]?.shortLabel ?? "Triage",
    stageIndex,
    duration: formatRuntimeDuration(
      task.startedAt,
      task.status === "running" ? null : (task.completedAt ?? task.updatedAt),
    ),
    stageRun: getEffectiveStageRunAttempts(task),
    stageRunLimit: getEffectiveStageRunLimit(task),
    stageRunLabel:
      effectiveStage === task.currentStage
        ? `${effectiveStageLabel} run`
        : `${effectiveStageLabel} repair budget run`,
    tokens: formatTokenCount(task.usage.totalTokens),
    cost: formatApproximateCost(task.usage.cost),
    inputTokens: formatTokenCount(task.usage.inputTokens),
    uncachedInputTokens: formatTokenCount(
      Math.max(0, task.usage.inputTokens - task.usage.cachedInputTokens - (task.usage.cacheWriteTokens ?? 0)),
    ),
    outputTokens: formatTokenCount(task.usage.outputTokens),
    cachedTokens: formatTokenCount(task.usage.cachedInputTokens),
    cacheRate: formatCacheRate(task.usage),
    models: (task.models?.length
      ? task.models
      : [{ provider: "openai" as const, model: task.agentConfig?.model ?? "gpt-5.6-luna" }]
    ).map((item) => ({
      provider:
        item.provider === "anthropic" || item.model.startsWith("claude-")
          ? ("claude" as const)
          : ("codex" as const),
      model: item.model,
    })),
    priority: `${task.priority[0]?.toUpperCase()}${task.priority.slice(1)}` as RecentTask["priority"],
    startedAt: formatTaskDate(task.startedAt),
    endedAt: formatTaskDate(
      task.archive?.archivedAt ??
        task.closure?.closedAt ??
        task.completedAt ??
        (task.status === "running" ? null : task.updatedAt),
    ),
    updatedAt: formatTaskDate(task.updatedAt),
  };
}

export function formatApproximateCost(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "Unavailable";
  if (value === 0) return "$0.00";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

export function formatCacheRate(usage: Pick<RuntimeUsage, "inputTokens" | "cachedInputTokens">) {
  if (!usage.inputTokens) return "\u2014";
  return `${Math.round((usage.cachedInputTokens / usage.inputTokens) * 100)}%`;
}

export function formatTaskDate(value: string | null) {
  if (!value) return "\u2014";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "\u2014";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${day}/${month} ${hour}:${minute}`;
}

export function formatTokenCount(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function formatRuntimeDuration(startedAt: string | null, completedAt: string | null) {
  if (!startedAt) return "Not started";
  const elapsed = Math.max(0, new Date(completedAt ?? Date.now()).getTime() - new Date(startedAt).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  const seconds = Math.floor((elapsed % 60_000) / 1_000);
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

export const workflowStages: WorkflowStage[] = [
  { id: "triage", label: "Triage", shortLabel: "Triage", provider: "codex", skill: "classify-task" },
  {
    id: "scouts",
    label: "Repository scouts",
    shortLabel: "Repo scouts",
    provider: "codex",
    skill: "scout-repository",
  },
  {
    id: "synthesis",
    label: "Investigation synthesis",
    shortLabel: "Synthesis",
    provider: "codex",
    skill: "synthesize-investigation",
  },
  {
    id: "grill",
    label: "Grill with docs",
    shortLabel: "Grill",
    provider: "codex",
    skill: "grill-with-docs",
  },
  {
    id: "specification",
    label: "Task specification",
    shortLabel: "Task spec",
    provider: "codex",
    skill: "to-spec",
  },
  {
    id: "plan",
    label: "Implementation plan",
    shortLabel: "Impl plan",
    provider: "codex",
    skill: "to-tickets",
  },
  {
    id: "plan-review",
    label: "Plan critique",
    shortLabel: "Plan critic",
    provider: "codex",
    skill: "critique-plan",
  },
  {
    id: "implement",
    label: "Implement",
    shortLabel: "Implement",
    provider: "codex",
    skill: "implement",
  },
  {
    id: "dev-review",
    label: "Dev review",
    shortLabel: "Dev review",
    provider: "codex",
    skill: "code-review",
  },
  { id: "test", label: "Test", shortLabel: "Test", provider: "codex", skill: "verify-acceptance" },
  {
    id: "final-review",
    label: "Final review",
    shortLabel: "Final review",
    provider: "codex",
    skill: "holdout-review",
  },
  {
    id: "approval",
    label: "Human approval",
    shortLabel: "Human approval",
    provider: "harness",
    skill: "request-approval",
  },
];
