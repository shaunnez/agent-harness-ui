import { projectTaskAttention } from "../../../server/task-attention.mjs";
import type { RuntimeTask } from "../../domain.ts";
import type { FrontierGateway, TaskCore } from "../runtime/contracts.ts";
import { loadFixture } from "./load.ts";
import { fixtureManagement } from "./management.ts";
import { fixtureArtifact, fixtureProjects, fixtureTask, makeFixtureTasks } from "./scenarios.ts";
import { fixtureWorkflow, sampleEligibility } from "./workflow.ts";
import { enrichWorkflowScenarios } from "./workflow-scenarios.ts";
import { stationFixtures } from "./stations.ts";

/** In-memory demonstrations have no import or call path to the live mutation gateway. */
export function createFixtureGateway(
  scale?: "normal" | "stress",
  workflowScenarios = false,
  stationReview = false,
): FrontierGateway & {
  setDisconnected(value: boolean): void;
  appendActivity(id: string, count: number): void;
  setUsageState(id: string, state: "pending" | "zero"): void;
  setDeliveryOutcome(id: string, outcome: "merged" | "closed" | "drift"): void;
} {
  const initial = structuredClone(
    stationReview
      ? stationFixtures()
      : scale
        ? loadFixture(scale)
        : { projects: fixtureProjects, tasks: makeFixtureTasks() },
  );
  const tasks = new Map<string, RuntimeTask>(initial.tasks.map((task) => [task.id, task]));
  if (workflowScenarios && !scale && !stationReview) enrichWorkflowScenarios(initial.tasks);
  let version = 1;
  let disconnected = false;
  const online = () => {
    if (disconnected) throw new Error("Simulated connection lost. Sample records are retained.");
  };
  const management = fixtureManagement(initial.projects, tasks, online, () => {
    version++;
  });
  for (const task of tasks.values()) {
    for (const run of task.runs ?? [])
      task.attemptsByStage[run.stage] = Math.max(task.attemptsByStage[run.stage] ?? 0, run.attempt ?? 1);
    task.agentConfig = {
      ...management.snapshotPolicies({
        title: task.title,
        description: task.description,
        repositoryPath: task.repositoryPath,
        workflow: task.workflow,
        priority: task.priority,
        workflowProfile: task.workflowProfile?.selected,
      }).agentConfig,
      ...task.agentConfig,
    };
  }
  const get = (id: string) => {
    if (disconnected) throw new Error("Simulated connection lost. Sample records are retained.");
    const task = tasks.get(id);
    if (!task) throw new Error("This sample task does not exist.");
    return task;
  };
  const core = (task: RuntimeTask): TaskCore => ({
    ...structuredClone(task),
    attention: projectTaskAttention(task),
    runCount: task.runs?.length ?? 0,
    pollVersion: `fixture-${version}`,
    actionEligibility: sampleEligibility(task),
  });
  const changed = (task: RuntimeTask) => {
    task.updatedAt = new Date().toISOString();
    version++;
  };
  const workflow = fixtureWorkflow(tasks, get, changed);
  return {
    mode: "fixture",
    appendActivity(id, count) {
      const task = get(id);
      const run = task.runs?.find(
        (item) => item.status === "running" && task.activeRunIds?.includes(item.id),
      );
      if (!run) throw new Error("Select a sample task with an active run.");
      const first = task.events.length;
      for (let index = 0; index < Math.min(30, Math.max(1, count)); index++) {
        task.events.push({
          id: `qa-${first + index}`,
          at: new Date(Date.now() + index).toISOString(),
          runId: run.id,
          stage: run.stage,
          category: "activity",
          tone: "info",
          title: `Sample activity ${first + index + 1}`,
          detail:
            "A recorded demonstration event for reading-position checks. No model or repository operation took place.",
        });
      }
      changed(task);
    },
    setUsageState(id, state) {
      const task = get(id);
      const run = task.runs?.find(
        (item) => item.status === "running" && task.activeRunIds?.includes(item.id),
      );
      if (!run) throw new Error("Select a sample task with an active run.");
      run.usage =
        state === "pending"
          ? null
          : { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0 };
      changed(task);
    },
    ...workflow,
    ...management.methods,
    setDisconnected(value) {
      disconnected = value;
    },
    setDeliveryOutcome(id, outcome) {
      const task = get(id),
        intent = task.pullRequestIntent,
        candidate = task.candidates.at(-1);
      if (intent?.status !== "open") throw new Error("Select a sample task with an open PR.");
      const same =
        candidate?.id === intent.candidateId &&
        candidate?.revisionNumber === intent.candidateRevision &&
        candidate?.headRevision === intent.headRevision;
      const at = new Date().toISOString();
      intent.lastCheckedAt = at;
      if (outcome === "merged" && same) {
        candidate.status = "merged";
        candidate.updatedAt = at;
        intent.status = "merged";
        intent.mergedAt = at;
        task.status = "completed";
        task.completedAt = at;
        task.error = null;
        task.blocker = null;
        task.completedStages = [...new Set([...task.completedStages, "approval" as const])];
      } else {
        task.status = "blocked";
        if (outcome === "closed") {
          intent.status = "closed";
          intent.closedAt = at;
        }
        task.blocker = {
          code: outcome === "closed" ? "pull-request-closed" : "pull-request-drift",
          detail:
            outcome === "closed"
              ? "Sample PR was closed without merging. The approved candidate is retained."
              : "Sample PR identity no longer matches the approved candidate. Completion is blocked.",
          detectedAt: at,
        };
        task.error = task.blocker.detail;
      }
      changed(task);
    },
    async status() {
      if (disconnected) throw new Error("Simulated connection lost. Sample records are retained.");
      return {
        ...structuredClone(management.configuration),
        available: false,
        authenticated: false,
        authMethod: null,
        model: "gpt-5.6-luna",
        reasoning: "xhigh",
        binary: null,
        message: "Sample world — no model is executing and no live task is changed.",
        suggestedRepository: fixtureProjects[0]?.repositoryPath ?? "",
      };
    },
    async projects() {
      online();
      return structuredClone(initial.projects);
    },
    async summaries() {
      return [...tasks.values()].map(core);
    },
    async markers() {
      return [...tasks.keys()].map((id) => ({ id, pollVersion: `fixture-${version}` }));
    },
    async core(id) {
      return core(get(id));
    },
    async runs(id) {
      const items = structuredClone(get(id).runs ?? []).sort(
        (a, b) =>
          String(b.startedAt ?? b.completedAt ?? "").localeCompare(
            String(a.startedAt ?? a.completedAt ?? ""),
          ) || b.id.localeCompare(a.id),
      );
      return { items, total: items.length, nextCursor: null };
    },
    async activity(id) {
      const items = structuredClone(get(id).events);
      return { items, total: items.length, nextCursor: null };
    },
    async artifact(id, artifactId) {
      const artifact = get(id).artifacts.find((item) => item.id === artifactId);
      if (!artifact) throw new Error("This sample artifact does not exist.");
      return structuredClone(artifact);
    },
    async create(draft) {
      online();
      if (initial.projects.find((project) => project.repositoryPath === draft.repositoryPath)?.archivedAt)
        throw new Error("Restore the project before creating a task.");
      const task = fixtureTask(`DEMO-${tasks.size + 1}`, draft.title, draft.repositoryPath, {
        description: draft.description,
        workflow: draft.workflow,
        priority: draft.priority,
        attachments: draft.attachments?.map(({ name, type, size }, index) => ({
          id: `sample-attachment-${index + 1}`,
          name,
          type,
          size,
          path: `sample-only/${name}`,
        })),
        ...management.snapshotPolicies(draft),
        designRequest: draft.designRequested
          ? {
              requested: true,
              status: "not-started",
              requestedAt: new Date().toISOString(),
              startedAt: null,
              completedAt: null,
              selectedVariantId: null,
              selectedAt: null,
              selectedBy: null,
              policies: {
                "codex-design": {
                  ...(draft.designPolicies ?? management.configuration.settings.designPolicies)[
                    "codex-design"
                  ],
                  provenance: draft.designPolicies ? "task-selection" : "settings-default",
                },
                "claude-design": {
                  ...(draft.designPolicies ?? management.configuration.settings.designPolicies)[
                    "claude-design"
                  ],
                  provenance: draft.designPolicies ? "task-selection" : "settings-default",
                },
              },
              variants: [],
              error: null,
            }
          : null,
      });
      tasks.set(task.id, task);
      changed(task);
      return core(task);
    },
    async start() {
      throw new Error(
        "Sample tasks cannot launch a model. Switch to your local runtime to dispatch a real task.",
      );
    },
    async answer(id, questionId, answer) {
      const task = get(id);
      if (task.status !== "awaiting-grill")
        throw new Error("This sample task is no longer waiting for answers.");
      const question = task.grillSession?.questions.find((item) => item.id === questionId && !item.answer);
      if (!question) throw new Error("The question was already answered. Refresh the task.");
      question.answer = answer;
      question.answerSource = "operator-answer";
      question.resolvedAt = new Date().toISOString();
      changed(task);
    },
    async finishGrill(id, acceptRemaining = false) {
      const task = get(id);
      if (
        acceptRemaining &&
        task.grillSession?.questions.some(
          (question) => !question.answer && !question.options.some((option) => option.recommended),
        )
      )
        throw new Error("A remaining question has no recommendation.");
      if (acceptRemaining)
        for (const question of task.grillSession?.questions ?? []) {
          if (!question.answer) {
            const recommended = question.options.find((option) => option.recommended);
            if (!recommended) throw new Error("A remaining question has no recommendation.");
            question.answer = recommended.label;
            question.answerSource = "operator-accepted-recommendation";
            question.resolvedAt = new Date().toISOString();
          }
        }
      if (!task.grillSession || task.grillSession.questions.some((question) => !question.answer))
        throw new Error("Answer the remaining questions first.");
      task.grillSession.status = "completed";
      task.grillSession.completedAt = new Date().toISOString();
      task.status = "awaiting-spec-approval";
      task.currentStage = "specification";
      task.artifacts.push(
        fixtureArtifact(
          `${id}-spec`,
          "specification",
          `# ${task.title}\n\n## Recorded sample decisions\n\n${task.grillSession.questions.map((question) => `- ${question.question} ${question.answer}`).join("\n")}\n\nThis sample document was assembled locally from your answers. No model has run.`,
        ),
      );
      changed(task);
    },
    async approveSpecification(id) {
      await workflow.action(id, "approve-spec");
    },
  };
}
