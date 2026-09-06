import { projectTaskAttention } from "../../../server/task-attention.mjs";
import type {
  RuntimeArtifact,
  RuntimeProject,
  RuntimeRun,
  RuntimeTask,
  RuntimeWorkPackage,
  StageId,
} from "../../domain.ts";

const fixtureEpoch = Date.now();
export const fixtureTime = new Date(fixtureEpoch).toISOString();
const minutesAgo = (minutes: number) => new Date(fixtureEpoch - minutes * 60_000).toISOString();
export const fixtureProjects: RuntimeProject[] = [
  {
    id: "plancheck",
    name: "PlanCheck",
    repositoryPath: "/demo/eversor-plancheck",
    createdAt: "2026-09-01T00:00:00Z",
  },
  {
    id: "harness",
    name: "Agent Harness",
    repositoryPath: "/demo/agent-harness-ui",
    createdAt: "2026-09-02T00:00:00Z",
  },
  {
    id: "mystrata",
    name: "MyStrataAssist",
    repositoryPath: "/demo/eversor-mystrataassist",
    createdAt: "2026-09-03T00:00:00Z",
  },
];
export const noUsage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0 };
export function fixtureArtifact(id: string, stage: StageId, content: string): RuntimeArtifact {
  return {
    id,
    stage,
    name: `${stage}.md`,
    kind: "markdown",
    content,
    createdAt: fixtureTime,
    model: "gpt-5.6-luna",
    reasoning: "xhigh",
    usage: noUsage,
  };
}
export function fixtureTask(
  id: string,
  title: string,
  repositoryPath: string,
  overrides: Partial<RuntimeTask> = {},
): RuntimeTask {
  return {
    id,
    title,
    description: title,
    repositoryPath,
    workflow: "investigate",
    priority: "medium",
    status: "queued",
    currentStage: "triage",
    completedStages: [],
    stageRun: 0,
    stageRunLimit: 3,
    createdAt: fixtureTime,
    updatedAt: fixtureTime,
    startedAt: null,
    completedAt: null,
    error: null,
    activeRunKind: null,
    activeRunIds: [],
    attemptsByStage: {},
    models: [],
    artifacts: [],
    decisions: [],
    grillSession: null,
    approvals: [],
    workPackages: [],
    candidates: [],
    runs: [],
    events: [],
    agentConfig: { model: "gpt-5.6-luna", reasoning: "xhigh" },
    ...overrides,
    usage:
      overrides.usage ??
      (overrides.runs ?? []).reduce(
        (sum, run) => ({
          inputTokens: sum.inputTokens + (run.usage?.inputTokens ?? 0),
          outputTokens: sum.outputTokens + (run.usage?.outputTokens ?? 0),
          cachedInputTokens: sum.cachedInputTokens + (run.usage?.cachedInputTokens ?? 0),
          totalTokens: sum.totalTokens + (run.usage?.totalTokens ?? 0),
        }),
        { ...noUsage },
      ),
  };
}
function workPackage(
  id: string,
  status: RuntimeWorkPackage["status"],
  dependencies: string[] = [],
): RuntimeWorkPackage {
  return {
    id,
    title: id === "S2" ? "Revision comparison" : "History integration",
    description: "Fixture work package",
    dependencies,
    batch: dependencies.length + 1,
    ownedPaths: [`src/${id}.ts`],
    verification: ["npm test"],
    status,
    attempts: status === "planned" ? 0 : 1,
    branch: null,
    worktreePath: null,
    baseRevision: null,
    headRevision: null,
    files: [],
    error: null,
  };
}
export function fixtureRun(taskId: string, stage: StageId, status: RuntimeRun["status"]): RuntimeRun {
  return {
    id: `R-${taskId}-${stage}-1`,
    kind: stage,
    status,
    stage,
    role: stage,
    model: ["dev-review", "plan", "final-review"].includes(stage) ? "gpt-5.6-sol" : "gpt-5.6-luna",
    reasoning: ["dev-review", "plan", "final-review"].includes(stage) ? "high" : "xhigh",
    startedAt: minutesAgo(15),
    completedAt: status === "running" ? null : minutesAgo(9),
    durationMs: status === "running" ? null : 360_000,
    artifactId: null,
    usage: { inputTokens: 62000, cachedInputTokens: 31000, outputTokens: 10000, totalTokens: 72000 },
    credits: null,
    apiEstimate: null,
    candidateId: null,
    candidateRevision: null,
    workPackageId: stage === "implement" ? "S2" : null,
    attempt: 1,
    retryOfRunId: null,
    repairOfRunId: null,
    toolCalls: [],
    test: null,
    evidenceError: null,
    freshness: null,
    gateResult: null,
    error: null,
    source: "codex-jsonl",
  };
}
export function makeFixtureTasks() {
  const plan = fixtureProjects[0]?.repositoryPath ?? "";
  const harness = fixtureProjects[1]?.repositoryPath ?? "";
  const strata = fixtureProjects[2]?.repositoryPath ?? "";
  const questionTask = fixtureTask("PC-153", "Normalise revision labels", plan, {
    status: "awaiting-grill",
    currentStage: "grill",
    completedStages: ["triage", "scouts"],
    grillSession: {
      status: "open",
      createdAt: minutesAgo(5),
      completedAt: null,
      completionReason: null,
      questions: [
        {
          id: "Q1",
          question: "Preserve the current API?",
          whyItMatters: "Existing clients rely on the current response.",
          options: [],
          allowCustom: true,
          answer: "Preserve it",
          answerSource: "operator-answer",
          resolvedAt: minutesAgo(4),
        },
        {
          id: "Q2",
          question: "Should revision labels be normalised before comparison?",
          whyItMatters:
            "Your answer defines the comparison rules. The current parser compares raw revision strings.",
          options: [
            {
              id: "normalise",
              label: "Normalise labels",
              description:
                "Trim spaces and compare without letter case; retain the original label for display.",
              recommended: true,
            },
            {
              id: "exact",
              label: "Use exact labels",
              description: "Treat different casing and spacing as distinct revisions.",
              recommended: false,
            },
          ],
          allowCustom: true,
          answer: null,
          answerSource: null,
          resolvedAt: null,
        },
      ],
    },
    runs: [fixtureRun("PC-153", "grill", "completed")],
    artifacts: [
      fixtureArtifact(
        "PC-153-research",
        "scouts",
        "# Repository evidence\n\n`src/revisions/compare.ts` compares the source labels directly. Existing tests cover exact matches and missing revisions.\n\n## Decision needed\n\nChoose whether whitespace and case differences should affect comparison. This is deterministic sample evidence.",
      ),
    ],
  });
  const tasks = [
    fixtureTask("PC-142", "Build revision checks", plan, {
      status: "running",
      currentStage: "implement",
      workflow: "implement",
      activeRunKind: "implement",
      activeRunIds: ["R-PC-142-implement-1"],
      runs: [fixtureRun("PC-142", "implement", "running"), fixtureRun("PC-142", "plan", "completed")],
      events: [
        {
          id: "PC-142-batch",
          at: minutesAgo(15),
          category: "activity",
          tone: "info",
          stage: "implement",
          runId: "R-PC-142-implement-1",
          title: "S2 began in its isolated worktree",
          detail: "Sample activity: S1 is integrated. Revision comparison owns src/revisions/compare.ts.",
        },
        {
          id: "PC-142-inspect",
          at: minutesAgo(12),
          category: "tool",
          tone: "info",
          stage: "implement",
          runId: "R-PC-142-implement-1",
          title: "Reading the comparison boundary",
          detail: "Sample activity: the worker is updating revision checks. S3 waits for S2 to qualify.",
        },
      ],
      workPackages: [
        workPackage("S1", "integrated"),
        workPackage("S2", "running", ["S1"]),
        workPackage("S3", "planned", ["S2"]),
      ],
      completedStages: ["triage", "scouts", "grill", "specification", "plan"],
    }),
    questionTask,
    fixtureTask("PC-148", "Retain revision history", plan, {
      status: "repair-required",
      currentStage: "dev-review",
      workflow: "implement",
      error: "Revision history can fail when no revision exists.",
      blocker: {
        code: "repair-required",
        detail: "Revision history can fail when no revision exists.",
        detectedAt: minutesAgo(9),
      },
      runs: [fixtureRun("PC-148", "dev-review", "completed")],
      artifacts: [
        fixtureArtifact(
          "PC-148-findings",
          "dev-review",
          "# Development review\n\n## P1 · Empty revision history\n\n`src/revisions/history.ts:42` reads the first revision without checking whether it exists. A new project can fail to load its history.\n\nCheck for an empty result before reading the revision.\n\n## P2 · Missing regression coverage\n\nAdd coverage for a project without previous revisions.\n\nThis is a deterministic fixture, with no live candidate to repair.",
        ),
      ],
      completedStages: ["triage", "scouts", "grill", "specification", "plan", "implement"],
    }),
    fixtureTask("PC-131", "Document input conventions", plan, {
      status: "completed",
      currentStage: "specification",
      completedStages: ["triage", "scouts", "grill", "specification"],
      completedAt: fixtureTime,
    }),
    fixtureTask("AH-051", "Verify worktree isolation", harness, {
      status: "failed",
      currentStage: "test",
      error: "The verification command could not start in its isolated worktree.",
      runs: [fixtureRun("AH-051", "test", "failed")],
    }),
    fixtureTask("AH-052", "Review cached token reporting", harness, {
      status: "running",
      currentStage: "scouts",
      activeRunKind: "investigate",
      activeRunIds: ["R-AH-052-scouts-1"],
      runs: [fixtureRun("AH-052", "scouts", "running")],
    }),
    fixtureTask("AH-053", "Review source navigation", harness),
    fixtureTask("AH-054", "Qualify dependency batches", harness, {
      status: "running",
      currentStage: "implement",
      activeRunKind: "implement",
      activeRunIds: ["R-AH-054-implement-1"],
      runs: [
        { ...fixtureRun("AH-054", "implement", "running"), workPackageId: "S1" },
        {
          ...fixtureRun("AH-054", "implement", "failed"),
          id: "R-AH-054-S2-failed",
          workPackageId: "S2",
          error: "A verification assertion failed.",
        },
      ],
      workPackages: [
        workPackage("S1", "running"),
        { ...workPackage("S2", "failed"), error: "A verification assertion failed." },
      ],
    }),
    fixtureTask("MS-086", "Clarify notice delivery", strata, {
      ...questionTask,
      id: "MS-086",
      title: "Clarify notice delivery",
      repositoryPath: strata,
      runs: [fixtureRun("MS-086", "grill", "completed")],
      grillSession: {
        status: "open",
        createdAt: minutesAgo(5),
        completedAt: null,
        completionReason: null,
        questions: [
          {
            id: "Q1",
            question: "Which channel should receive a meeting notice first?",
            whyItMatters: "The recorded notice must identify the delivery channel before dispatch.",
            options: [
              {
                id: "email",
                label: "Email first",
                description: "Send the notice to the approved email channel.",
                recommended: true,
              },
              {
                id: "portal",
                label: "Portal first",
                description: "Publish to the resident portal before email.",
                recommended: false,
              },
            ],
            allowCustom: true,
            answer: null,
            answerSource: null,
            resolvedAt: null,
          },
        ],
      },
      artifacts: [
        fixtureArtifact(
          "MS-086-research",
          "scouts",
          "# Notice delivery evidence\n\nThe notice record supports email and portal delivery. Choose the first channel. This is sample evidence.",
        ),
      ],
    }),
    fixtureTask("MS-090", "Map levy evidence", strata, {
      status: "awaiting-spec-approval",
      currentStage: "specification",
      artifacts: [
        fixtureArtifact(
          "MS-090-spec",
          "specification",
          "# Levy evidence specification\n\n## Acceptance criteria\n\n- Preserve exact amount and currency.\n- Link each amount to its recorded source.\n\nSample specification for first-playable review.",
        ),
      ],
      runs: [fixtureRun("MS-090", "specification", "completed")],
    }),
    fixtureTask("MS-091", "Track approved delivery", strata, {
      status: "awaiting-pr-merge",
      currentStage: "approval",
    }),
    fixtureTask("MS-092", "Investigate meeting records", strata, {
      status: "queued",
      currentStage: "triage",
    }),
  ];
  return tasks.map((task) => ({
    ...structuredClone(task),
    attention: projectTaskAttention(task),
    pollVersion: "fixture-1",
  }));
}
