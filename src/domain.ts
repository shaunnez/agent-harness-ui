import type { RuntimeEvent, RuntimeRun } from "./runtime-activity";

export type { RuntimeEvent, RuntimeRun, RuntimeToolCall } from "./runtime-activity";

export const stageIds = [
  "triage",
  "scouts",
  "grill",
  "specification",
  "plan",
  "implement",
  "dev-review",
  "test",
  "final-review",
  "approval",
] as const;

export type StageId = (typeof stageIds)[number];
export const scoutRoleIds = ["scout-code-path", "scout-dependency", "scout-pattern", "scout-schema", "scout-test-inventory", "scout-user-journey"] as const;
export type ScoutRoleId = (typeof scoutRoleIds)[number];
export type AgentRoleId = StageId | "repair" | ScoutRoleId;
export const agentRoleIds: AgentRoleId[] = [...stageIds.slice(0, -1), "repair", ...scoutRoleIds, "approval"];
export type Provider = "codex" | "claude" | "harness";
export type TaskRunState =
  | "running"
  | "paused"
  | "needs-input"
  | "failed"
  | "repairing"
  | "blocked"
  | "awaiting-approval"
  | "completed"
  | "closed";
export type EventCategory = "events" | "agents" | "tests" | "decisions";
export type AppScreen = "command" | "tasks" | "skills" | "agents" | "settings";

export interface WorkflowStage {
  id: StageId;
  label: string;
  shortLabel: string;
  provider: Provider;
  skill: string;
}

export interface HarnessEvent {
  id: string;
  time: string;
  category: EventCategory;
  title: string;
  detail: string;
  component: string;
  scope: string;
  provider: Provider;
  model: string;
  tokens: string;
  cost: string;
  cache: string;
  duration: string;
  artifact: string;
  tone: "success" | "info" | "warning" | "danger" | "muted";
}

export interface RecentTask {
  id: string;
  title: string;
  status: "Running" | "Blocked" | "Completed" | "Needs input" | "Closed";
  stage: string;
  stageIndex: number;
  duration: string;
  stageRun: number;
  stageRunLimit: number;
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

export type RuntimeTaskStatus =
  | "queued"
  | "running"
  | "failed"
  | "blocked"
  | "cancelled"
  | "awaiting-grill"
  | "awaiting-spec-approval"
  | "awaiting-plan-approval"
  | "ready-for-implementation"
  | "ready-for-review"
  | "ready-for-test"
  | "ready-for-final-review"
  | "repair-required"
  | "awaiting-human-approval"
  | "merging"
  | "completed"
  | "closed";

export interface RuntimeUsage {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens?: number;
  outputTokens: number;
  totalTokens: number;
  cost?: number | null;
  credits?: number | null;
  pricingVersion?: string | null;
}

export interface RuntimeContextSource {
  kind: "task" | "decisions" | "attachments" | "artifact" | "repository";
  id: string;
  label: string;
  stage?: StageId;
  includedCharacters: number | null;
  originalCharacters: number | null;
  truncated: boolean;
}

export interface RuntimeContextManifest {
  stage: StageId;
  promptCharacters: number;
  estimatedPromptTokens: number;
  repositoryAccess: "read-only" | "workspace-write";
  policy: string;
  candidateId?: string | null;
  candidateRevision?: number | null;
  workPackageId?: string | null;
  scoutName?: string | null;
  scoutFocus?: string | null;
  sources: RuntimeContextSource[];
}

export interface RuntimeArtifact {
  id: string;
  runId?: string | null;
  stage: StageId;
  name: string;
  kind: "markdown";
  content: string;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  durationMs?: number | null;
  model: string;
  reasoning?: string | null;
  agentRole?: string | null;
  usage: RuntimeUsage;
  contextManifest?: RuntimeContextManifest | null;
  candidateId?: string | null;
  candidateRevision?: number | null;
  workPackageId?: string | null;
  focusedTest?: RuntimeFocusedTestEvidence | null;
  gateResult?: {
    verdict: "PASS" | "REPAIR";
    candidateId: string;
    candidateRevision: number;
    evaluatedAt: string;
    blockingReasons: string[];
  } | null;
}

export interface RuntimeFocusedTestArtifactReference {
  name: string;
  path?: string | null;
  kind: string;
}

export interface RuntimeFocusedTestAssertion {
  label: string;
  actual: string;
  expected?: string | null;
}

export interface RuntimeFocusedTestRow {
  id: string;
  candidateId: string;
  candidateRevision: number;
  command: string;
  status: "passed" | "failed";
  durationMs: number | null;
  title: string;
  artifactReferences: RuntimeFocusedTestArtifactReference[];
  assertions: RuntimeFocusedTestAssertion[];
  failureDetails: string | null;
}

export interface RuntimeFocusedTestEvidence {
  candidateId: string;
  candidateRevision: number;
  command: string;
  status: "passed" | "failed";
  startedAt?: string | null;
  completedAt?: string | null;
  durationMs: number | null;
  rows: RuntimeFocusedTestRow[];
}

export interface RuntimeDecision {
  id: string;
  grillQuestionId?: string;
  question: string;
  answer: string;
  createdAt: string;
}

export interface RuntimeScoutDispatch {
  selected: Array<{ name: string; focus: string; reason: string; status: "queued" | "complete" | "failed"; error?: string }>;
  skipped: string[];
  createdAt: string;
  completedAt: string | null;
}

export interface RuntimeGrillOption {
  id: string;
  label: string;
  description: string;
  recommended: boolean;
}

export interface RuntimeGrillQuestion {
  id: string;
  question: string;
  whyItMatters: string;
  options: RuntimeGrillOption[];
  allowCustom: boolean;
  answer: string | null;
  answerSource: "user" | "accepted-assumption" | null;
  resolvedAt: string | null;
}

export interface RuntimeGrillSession {
  status: "open" | "completed";
  questions: RuntimeGrillQuestion[];
  createdAt: string;
  completedAt: string | null;
  completionReason: string | null;
}

export interface RuntimeWorkPackage {
  id: string;
  title: string;
  description: string;
  dependencies: string[];
  batch: number;
  ownedPaths: string[];
  verification: string[];
  status: "planned" | "running" | "ready_for_integration" | "failed" | "integrated";
  attempts: number;
  branch: string | null;
  worktreePath: string | null;
  baseRevision: string | null;
  headRevision: string | null;
  files: string[];
  error: string | null;
}

export interface RuntimeWorktreeInventoryRow {
  id: string;
  kind: "slice" | "candidate";
  label: string;
  worktreePath: string;
  branch: string;
  baseRevision: string | null;
  headRevision: string | null;
  taskId: string;
  workPackageId: string | null;
  lifecycleState: "retained" | "active" | "stale";
  gitExists: boolean;
  gitHeadRevision: string | null;
  gitClean: boolean | null;
  cleanupReady: boolean;
}

export interface RuntimeApproval {
  id: string;
  stage: StageId;
  note: string;
  createdAt: string;
}

export interface RuntimeCandidate {
  id: string;
  revisionNumber: number;
  baseRevision: string;
  baseBranch: string;
  baseRef?: string | null;
  headRevision: string | null;
  branch: string;
  repositoryRoot: string;
  worktreePath: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  revisions: Array<{ number: number; headRevision: string; reason: string; createdAt: string }>;
  members?: Array<{ packageId: string; headRevision: string; order: number }>;
}

export interface RuntimeTask {
  id: string;
  title: string;
  description: string;
  repositoryPath: string;
  workflow: "investigate" | "implement";
  priority: "low" | "medium" | "high";
  agentConfig?: {
    model: string;
    reasoning: string;
    stagePolicies?: Record<string, RuntimeAgentPolicy>;
    policySnapshotVersion?: number;
  };
  attachments?: Array<{ id: string; name: string; type: string; size: number; path: string }>;
  status: RuntimeTaskStatus;
  closure?: { reason: "not-needed" | "superseded" | "duplicate"; supersededBy: string | null; note: string; closedAt: string } | null;
  evaluation?: RuntimeTaskEvaluation | null;
  experiment?: RuntimeExperimentSnapshot | null;
  mergeIntent?: {
    candidateId: string;
    candidateRevision: number;
    baseRevision: string;
    headRevision: string;
    targetRef: string;
    note: string;
    status: "pending" | "completed" | "failed";
    startedAt: string;
    completedAt: string | null;
    error: string | null;
  } | null;
  scoutDispatch?: RuntimeScoutDispatch | null;
  currentStage: StageId;
  completedStages: StageId[];
  stageRun: number;
  stageRunLimit: number;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  activeRunKind: string | null;
  activeRunIds?: string[];
  attemptsByStage: Partial<Record<StageId, number>>;
  models: Array<{ provider: "openai"; model: string }>;
  usage: RuntimeUsage;
  artifacts: RuntimeArtifact[];
  decisions: RuntimeDecision[];
  grillSession: RuntimeGrillSession | null;
  approvals: RuntimeApproval[];
  workPackages: RuntimeWorkPackage[];
  candidates: RuntimeCandidate[];
  runs?: RuntimeRun[];
  worktreeInventory?: RuntimeWorktreeInventoryRow[];
  events: RuntimeEvent[];
}

export interface RuntimeStatus {
  available: boolean;
  authenticated: boolean;
  authMethod: string | null;
  model: string;
  reasoning: string;
  binary: string | null;
  message: string;
  suggestedRepository: string;
  csrfToken?: string;
  catalog?: RuntimeModelCatalog;
  settings?: RuntimeSettings;
  providers?: Array<{
    id: "codex" | "claude" | "local";
    label: string;
    available: boolean;
    authenticated: boolean;
    executionEnabled: boolean;
    detail: string;
  }>;
  scouts?: Array<{ id: string; label: string; instruction: string; limits: string }>;
}

export interface RuntimeAgentPolicy {
  model: string;
  reasoning: string;
}

export interface RuntimeExperimentSnapshot {
  groupId: string;
  variantId: string;
  frozenBaseSha: string;
  taskBriefHash: string;
  policyMatrix: Record<string, RuntimeAgentPolicy>;
  acceptanceCriteria: string[];
  verificationCommands: string[];
  createdAt: string;
}

export interface RuntimeQualityScore {
  score: number;
  outcome: "accepted" | "rejected" | "mixed";
  rubric: Record<string, number>;
  notes: string;
  evaluator: string | null;
  evaluatedAt: string;
}

export interface RuntimeTaskEvaluation {
  score?: number;
  outcome?: "accepted" | "rejected" | "mixed";
  rubric?: Record<string, number>;
  notes?: string;
  evaluator?: string | null;
  suiteId: string | null;
  caseId: string | null;
  evaluatedAt?: string;
  scores?: Partial<Record<"human" | "blind", RuntimeQualityScore>>;
}

export interface RuntimeModelPriceBand {
  input: number;
  cachedInput: number;
  cacheWrite: number | null;
  output: number;
}

export interface RuntimeModelPricing {
  short: RuntimeModelPriceBand;
  long: RuntimeModelPriceBand | null;
}

export interface RuntimeModelOption {
  id: string;
  label: string;
  description: string;
  defaultReasoning: string;
  reasoningLevels: string[];
  pricing: RuntimeModelPricing | null;
}

export interface RuntimeModelCatalog {
  models: RuntimeModelOption[];
  fetchedAt: string | null;
  source: string;
}

export interface RuntimeSettings {
  allowedModels: string[];
  defaultModel: string;
  defaultReasoning: string;
  stagePolicies: Record<string, RuntimeAgentPolicy>;
  pricing: {
    version: string;
    sourceUrl: string;
    verifiedAt: string;
    verifiedBy: string;
    rates: Record<string, RuntimeModelPricing>;
    creditRates?: Record<string, { input: number; cachedInput: number; output: number }>;
    creditSourceUrl?: string;
  };
}

export interface RuntimeEvaluationVariant {
  role: string;
  model: string;
  reasoning: string;
  runs: number;
  tasks: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  cacheRate: number | null;
  cost: number | null;
  credits: number | null;
  gatePasses: number;
  gateRepairs: number;
  averageHumanScore: number | null;
}

export interface RuntimeEvaluationSummary {
  generatedAt: string;
  methodology: string;
  evaluatedTasks: number;
  variants: RuntimeEvaluationVariant[];
  observations: {
    methodology: string;
    evaluatedTasks: number;
    variants: RuntimeEvaluationVariant[];
  };
  experiments: {
    methodology: string;
    taskCount: number;
    variants: RuntimeExperimentVariant[];
  };
}

export interface RuntimeExperimentVariant {
  groupId: string;
  variantId: string;
  frozenBaseSha: string;
  taskIds: string[];
  sampleCount: number;
  taskBriefHashes: string[];
  policyMatrices: Array<Record<string, RuntimeAgentPolicy>>;
  acceptanceDefinitions: string[][];
  verificationDefinitions: string[][];
  gateAttempts: number;
  firstPassGateSuccesses: number;
  firstPassGateSuccessRate: number | null;
  eventualGateSuccesses: number;
  eventualGateSuccessRate: number | null;
  repairCount: number;
  retryCount: number;
  wallTimeMs: number | null;
  averageWallTimeMs: number | null;
  roleDurations: Record<string, number>;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  cacheRate: number | null;
  credits: number | null;
  apiEstimate: number | null;
  contextCharacters: number;
  estimatedContextTokens: number;
  averageHumanScore: number | null;
  averageBlindScore: number | null;
}

export interface RuntimeChangelogCommit {
  sha: string;
  shortSha: string;
  author: string;
  authoredAt: string;
  subject: string;
}

export interface RuntimeChangelogFile {
  status: string;
  path: string;
  previousPath: string | null;
}

export interface RuntimeChangelogDetail extends RuntimeChangelogCommit {
  body: string;
  files: RuntimeChangelogFile[];
}

export interface RuntimeChangelogDiff {
  sha: string;
  path: string;
  diff: string;
  truncated: boolean;
}

export const EXAMPLE_TITLE = "Add task priority";
export const EXAMPLE_DESCRIPTION =
  "Add task priority (`low | medium | high`). Default new tasks to `medium`, expose it through the API, show a coloured badge in the UI, and add tests.";

export function runtimeTaskToRecentTask(task: RuntimeTask): RecentTask {
  const stageIndex = Math.max(
    0,
    workflowStages.findIndex((stage) => stage.id === task.currentStage),
  );
  const status: RecentTask["status"] =
    task.status === "closed"
      ? "Closed"
      : task.status === "completed"
      ? "Completed"
      : task.status === "queued" ||
          task.status.startsWith("awaiting-") ||
          task.status.startsWith("ready-for-")
        ? "Needs input"
        : task.status === "failed" ||
            task.status === "blocked" ||
            task.status === "cancelled" ||
            task.status === "repair-required"
          ? "Blocked"
          : "Running";
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
    stageRun: task.attemptsByStage?.[task.currentStage] ?? 0,
    stageRunLimit: task.stageRunLimit,
    tokens: formatTokenCount(task.usage.totalTokens),
    cost: formatApproximateCost(task.usage.cost),
    inputTokens: formatTokenCount(task.usage.inputTokens),
    uncachedInputTokens: formatTokenCount(
      Math.max(
        0,
        task.usage.inputTokens - task.usage.cachedInputTokens - (task.usage.cacheWriteTokens ?? 0),
      ),
    ),
    outputTokens: formatTokenCount(task.usage.outputTokens),
    cachedTokens: formatTokenCount(task.usage.cachedInputTokens),
    cacheRate: formatCacheRate(task.usage),
    models: (task.models?.length ? task.models : [{ provider: "openai" as const, model: task.agentConfig?.model ?? "gpt-5.6-luna" }]).map((item) => ({ provider: "codex" as const, model: item.model })),
    priority: `${task.priority[0]?.toUpperCase()}${task.priority.slice(1)}` as RecentTask["priority"],
    startedAt: formatTaskDate(task.startedAt),
    endedAt: formatTaskDate(task.closure?.closedAt ?? task.completedAt ?? (task.status === "running" ? null : task.updatedAt)),
    updatedAt: formatTaskDate(task.updatedAt),
  };
}

export function formatApproximateCost(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "Unavailable";
  if (value === 0) return "$0.00";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

export function formatCacheRate(
  usage: Pick<RuntimeUsage, "inputTokens" | "cachedInputTokens">,
) {
  if (!usage.inputTokens) return "—";
  return `${Math.round((usage.cachedInputTokens / usage.inputTokens) * 100)}%`;
}

export function formatTaskDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
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

export const recentTasks: RecentTask[] = [
  {
    id: "GH-241",
    title: "Add task priority and expose it through the API",
    status: "Running",
    stage: "Implement",
    stageIndex: 5,
    duration: "12m 44s",
    stageRun: 1,
    stageRunLimit: 3,
    tokens: "44.2k",
    cost: "$1.18",
    models: [
      { provider: "codex", model: "Codex 1.2" },
      { provider: "claude", model: "Claude 3.7 Sonnet" },
    ],
    priority: "Medium",
  },
  {
    id: "GH-238",
    title: "Guard worktree cleanup when review artifacts remain",
    status: "Blocked",
    stage: "Test",
    stageIndex: 7,
    duration: "31m 08s",
    stageRun: 3,
    stageRunLimit: 3,
    tokens: "91.8k",
    cost: "$3.84",
    models: [
      { provider: "codex", model: "Codex 1.2" },
      { provider: "claude", model: "Claude 3.7 Sonnet" },
    ],
    priority: "High",
  },
  {
    id: "GH-237",
    title: "Surface cache efficiency in run summaries",
    status: "Completed",
    stage: "Human approval",
    stageIndex: 9,
    duration: "18m 22s",
    stageRun: 1,
    stageRunLimit: 3,
    tokens: "38.6k",
    cost: "$0.94",
    models: [{ provider: "claude", model: "Claude 3.7 Sonnet" }],
    priority: "Low",
  },
  {
    id: "GH-235",
    title: "Clarify retry ownership for review failures",
    status: "Needs input",
    stage: "Grill",
    stageIndex: 2,
    duration: "4m 02s",
    stageRun: 1,
    stageRunLimit: 3,
    tokens: "12.8k",
    cost: "$0.31",
    models: [
      { provider: "claude", model: "Claude 3.7 Sonnet" },
      { provider: "codex", model: "Codex 1.2 Mini" },
    ],
    priority: "Medium",
  },
];

export const baseEvents: HarnessEvent[] = [
  {
    id: "evt-01",
    time: "12:22:18",
    category: "events",
    title: "Slice worktree created",
    detail: "Isolated schema branch created from main@9b6c0fa",
    component: "Orchestrator",
    scope: "S1 / wt-schema",
    provider: "harness",
    model: "Deterministic",
    tokens: "—",
    cost: "$0.00",
    cache: "—",
    duration: "2s",
    artifact: "worktree.json",
    tone: "success",
  },
  {
    id: "evt-02",
    time: "12:22:24",
    category: "agents",
    title: "Schema agent started",
    detail: "Owned scope: schema and priority migration",
    component: "Implement slice",
    scope: "S1 / wt-schema",
    provider: "codex",
    model: "Codex 1.2",
    tokens: "4.7k / 3.1k",
    cost: "$0.12",
    cache: "71%",
    duration: "1m 52s",
    artifact: "session.json",
    tone: "info",
  },
  {
    id: "evt-03",
    time: "12:23:02",
    category: "events",
    title: "Slice qualified",
    detail: "Owned tests and type checks passed; commit 81ac09f ready",
    component: "Slice gate",
    scope: "S1 / 81ac09f",
    provider: "harness",
    model: "Deterministic",
    tokens: "—",
    cost: "$0.00",
    cache: "—",
    duration: "11s",
    artifact: "slice-gate.json",
    tone: "success",
  },
  {
    id: "evt-04",
    time: "12:23:48",
    category: "agents",
    title: "Parallel slice agents completed",
    detail: "API and UI commits passed their owned qualification gates",
    component: "Implement slice",
    scope: "S2 + S3",
    provider: "codex",
    model: "Codex 1.2 + Mini",
    tokens: "12.1k",
    cost: "$0.30",
    cache: "74%",
    duration: "3m 08s",
    artifact: "slice-summary.json",
    tone: "success",
  },
  {
    id: "evt-05",
    time: "12:24:01",
    category: "events",
    title: "Integration candidate assembling",
    detail: "Applying S1 → S2 → S3 into the dedicated integration worktree",
    component: "Integration orchestrator",
    scope: "Candidate C1",
    provider: "harness",
    model: "Deterministic",
    tokens: "—",
    cost: "$0.00",
    cache: "—",
    duration: "18s",
    artifact: "merge-queue.json",
    tone: "warning",
  },
  {
    id: "evt-06",
    time: "12:25:02",
    category: "tests",
    title: "Historical candidate test retained",
    detail: "C1 API result remains inspectable after repair invalidation",
    component: "Test harness",
    scope: "Candidate C1",
    provider: "harness",
    model: "Deterministic",
    tokens: "—",
    cost: "$0.04",
    cache: "—",
    duration: "8.2s",
    artifact: "junit.xml",
    tone: "muted",
  },
  {
    id: "evt-07",
    time: "12:25:11",
    category: "decisions",
    title: "Human decision recorded",
    detail: "API create requests may omit priority",
    component: "Clarifier",
    scope: "Task context",
    provider: "claude",
    model: "Claude 3.7 Sonnet",
    tokens: "380 / 420",
    cost: "$0.02",
    cache: "91%",
    duration: "18s",
    artifact: "decision-002.json",
    tone: "warning",
  },
];

export const acceptanceCriteria = [
  "Persist priority as low | medium | high",
  "Default new tasks to medium",
  "Expose priority through API responses",
  "Render a coloured priority badge",
  "Cover defaulting and validation with tests",
] as const;
