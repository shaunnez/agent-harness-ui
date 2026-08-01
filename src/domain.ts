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
export type Provider = "codex" | "claude" | "harness";
export type TaskRunState =
  | "running"
  | "paused"
  | "needs-input"
  | "failed"
  | "repairing"
  | "blocked"
  | "awaiting-approval"
  | "completed";
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
  status: "Running" | "Blocked" | "Completed" | "Needs input";
  stage: string;
  stageIndex: number;
  duration: string;
  stageRun: number;
  stageRunLimit: number;
  tokens: string;
  cost: string;
  models: Array<{ provider: Exclude<Provider, "harness">; model: string }>;
  priority: "Low" | "Medium" | "High";
}

export interface NewTaskDraft {
  title: string;
  description: string;
  workflow: "investigate" | "implement";
  priority: "low" | "medium" | "high";
}

export const EXAMPLE_TITLE = "Add task priority";
export const EXAMPLE_DESCRIPTION =
  "Add task priority (`low | medium | high`). Default new tasks to `medium`, expose it through the API, show a coloured badge in the UI, and add tests.";

export const workflowStages: WorkflowStage[] = [
  { id: "triage", label: "Triage", shortLabel: "Triage", provider: "harness", skill: "classify-task" },
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
    provider: "claude",
    skill: "grill-with-docs",
  },
  {
    id: "specification",
    label: "Task specification",
    shortLabel: "Task spec",
    provider: "claude",
    skill: "to-spec",
  },
  {
    id: "plan",
    label: "Implementation plan",
    shortLabel: "Impl plan",
    provider: "claude",
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
  { id: "test", label: "Test", shortLabel: "Test", provider: "harness", skill: "verify-acceptance" },
  {
    id: "final-review",
    label: "Final review",
    shortLabel: "Final review",
    provider: "claude",
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
