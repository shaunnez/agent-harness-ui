import {
  type RuntimeArtifact,
  type RuntimeTask,
  type RuntimeTaskStatus,
  type RuntimeUsage,
  type RuntimeWorkPackage,
  type StageId,
  stageIds,
} from "./domain";

const previewUsage: RuntimeUsage = {
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  cost: null,
  credits: null,
};

const artifactNames: Record<StageId, string> = {
  triage: "Triage classification",
  scouts: "Repository scout synthesis",
  grill: "Recorded decisions",
  specification: "Task specification",
  plan: "Implementation plan",
  implement: "Integration candidate",
  "dev-review": "Development review",
  test: "Focused test evidence",
  "final-review": "Final review",
  approval: "Human approval",
};

function queryParameter(name: string, search?: string) {
  const source = search ?? (typeof window === "undefined" ? "" : window.location.search);
  return new URLSearchParams(source).get(name);
}

export function hostedAtlasPreviewRequested(search?: string) {
  return queryParameter("preview", search) === "atlas";
}

export function hostedAtlasMapRequested(search?: string) {
  return queryParameter("view", search) === "map";
}

function previewPackage(
  id: string,
  title: string,
  status: RuntimeWorkPackage["status"],
  batch: number,
  dependencies: string[] = [],
  error: string | null = null,
): RuntimeWorkPackage {
  return {
    id,
    title,
    description: `Illustrative ${title.toLowerCase()} package for the hosted atlas preview.`,
    dependencies,
    batch,
    ownedPaths: [`src/${id.toLowerCase()}/**`],
    verification: ["npm run typecheck", "npm test"],
    status,
    attempts: status === "planned" ? 0 : 1,
    branch: status === "planned" ? null : `preview/${id.toLowerCase()}`,
    worktreePath: null,
    baseRevision: null,
    headRevision: status === "planned" ? null : "0".repeat(40),
    files: [],
    error,
  };
}

function integratedPackages(count: number) {
  return Array.from({ length: count }, (_, index) =>
    previewPackage(
      `S${index + 1}`,
      count === 1 ? "Delivery slice" : `Delivery slice ${index + 1}`,
      "integrated",
      index === 0 ? 1 : 2,
      index === 0 ? [] : ["S1"],
    ),
  );
}

const activeBuildPackages: RuntimeWorkPackage[] = [
  previewPackage("S1", "Shared contracts", "running", 1),
  previewPackage("S2", "Runtime adapter", "running", 1),
  previewPackage("S3", "Command centre UI", "failed", 1, [], "Tool policy violation"),
  previewPackage("S4", "Task inspector", "planned", 2, ["S1"]),
  previewPackage("S5", "Evidence viewer", "planned", 2, ["S1"]),
  previewPackage("S6", "Focused tests", "planned", 3, ["S2", "S4"]),
  previewPackage("S7", "Candidate assembly", "planned", 4, ["S3", "S5", "S6"]),
];

function artifactsFor(taskId: string, completedStages: StageId[], createdAt: string) {
  const started = Date.parse(createdAt);
  return completedStages.map<RuntimeArtifact>((stage, index) => {
    const completedAt = new Date(started + (index + 1) * 12 * 60_000).toISOString();
    return {
      id: `${taskId.toLowerCase()}-${stage}`,
      stage,
      name: artifactNames[stage],
      kind: "markdown",
      content: `# ${artifactNames[stage]}\n\nIllustrative evidence for the hosted Courier Rooms preview.`,
      createdAt: completedAt,
      startedAt: new Date(Date.parse(completedAt) - 8 * 60_000).toISOString(),
      completedAt,
      durationMs: 8 * 60_000,
      model:
        stage === "plan" || stage === "dev-review" || stage === "final-review"
          ? "gpt-5.6-sol"
          : "gpt-5.6-luna",
      reasoning: stage === "plan" || stage === "dev-review" || stage === "final-review" ? "high" : "xhigh",
      usage: previewUsage,
    };
  });
}

function previewTask({
  id,
  title,
  priority,
  currentStage,
  status,
  updatedAt,
  error = null,
  workPackages = [],
}: {
  id: string;
  title: string;
  priority: RuntimeTask["priority"];
  currentStage: StageId;
  status: RuntimeTaskStatus;
  updatedAt: string;
  error?: string | null;
  workPackages?: RuntimeWorkPackage[];
}): RuntimeTask {
  const currentStageIndex = stageIds.indexOf(currentStage);
  const completedStages = stageIds.slice(0, currentStageIndex);
  const createdAt = new Date(
    Date.parse(updatedAt) - Math.max(1, currentStageIndex) * 14 * 60_000,
  ).toISOString();
  const hasCandidate = currentStageIndex >= stageIds.indexOf("implement");
  const candidateId = `C${(Number(id.split("-")[1] ?? 1) % 3) + 1}`;

  return {
    id,
    title,
    description: "Illustrative task state used only to demonstrate the hosted Courier Rooms interface.",
    repositoryPath: "Hosted UI preview",
    workflow: "implement",
    priority,
    status,
    currentStage,
    completedStages,
    stageRun: status === "queued" ? 0 : 1,
    stageRunLimit: 3,
    createdAt,
    updatedAt,
    startedAt: status === "queued" ? null : createdAt,
    completedAt: null,
    error,
    activeRunKind: status === "running" ? currentStage : null,
    attemptsByStage: status === "queued" ? {} : { [currentStage]: 1 },
    models: [{ provider: "openai", model: "gpt-5.6-luna" }],
    usage: previewUsage,
    artifacts: artifactsFor(id, [...completedStages], createdAt),
    decisions: [],
    grillSession: null,
    approvals: [],
    workPackages,
    candidates: hasCandidate
      ? [
          {
            id: candidateId,
            revisionNumber: 1,
            baseRevision: "0".repeat(40),
            baseBranch: "main",
            headRevision: "1".repeat(40),
            branch: `preview/${id.toLowerCase()}`,
            repositoryRoot: "Hosted UI preview",
            worktreePath: "Hosted UI preview",
            status: "assembled",
            createdAt,
            updatedAt,
            revisions: [
              {
                number: 1,
                headRevision: "1".repeat(40),
                reason: "Illustrative preview candidate",
                createdAt,
              },
            ],
          },
        ]
      : [],
    events: [],
  };
}

export const hostedAtlasPreviewTasks: RuntimeTask[] = [
  previewTask({
    id: "AH-008",
    title: "Surface support references from frontend API failures",
    priority: "high",
    currentStage: "final-review",
    status: "ready-for-final-review",
    updatedAt: "2026-08-08T22:34:00+12:00",
    workPackages: integratedPackages(4),
  }),
  previewTask({
    id: "AH-006",
    title: "Make the shared Mailbox Queue modal keyboard-safe",
    priority: "medium",
    currentStage: "dev-review",
    status: "awaiting-grill",
    updatedAt: "2026-08-08T21:25:00+12:00",
    workPackages: integratedPackages(1),
  }),
  previewTask({
    id: "AH-007",
    title: "Make infrastructure failures recoverable",
    priority: "medium",
    currentStage: "approval",
    status: "awaiting-human-approval",
    updatedAt: "2026-08-08T21:04:00+12:00",
    workPackages: integratedPackages(1),
  }),
  previewTask({
    id: "AH-005",
    title: "Queue the shared Mailbox integration follow-up",
    priority: "medium",
    currentStage: "triage",
    status: "queued",
    updatedAt: "2026-08-08T18:10:00+12:00",
  }),
  previewTask({
    id: "AH-003",
    title: "Add a JSON reporter to the implementation harness",
    priority: "medium",
    currentStage: "implement",
    status: "blocked",
    updatedAt: "2026-08-08T17:42:00+12:00",
    error: "One implementation package is blocked pending repair.",
    workPackages: activeBuildPackages,
  }),
  previewTask({
    id: "AH-004",
    title: "Enforce read-only development review tools",
    priority: "medium",
    currentStage: "dev-review",
    status: "blocked",
    updatedAt: "2026-08-08T16:58:00+12:00",
    error: "Tool policy violation",
    workPackages: integratedPackages(2),
  }),
];
