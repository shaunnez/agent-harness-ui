import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import {
  answerGrillQuestion,
  askCompanionQuestion,
  archiveTask,
  cancelTask,
  closeTask,
  continueTaskToImplementation,
  createTask,
  evaluateTask,
  finishGrill,
  getEvaluationSummary,
  getRuntimeStatus,
  getRuntimeWorktreeInventory,
  getTaskActivity,
  getTaskArtifact,
  getTaskArtifactContents,
  getTaskCore,
  getTaskPollState,
  getTaskRuns,
  listTaskPollStates,
  listTasks,
  type MutationRequestOptions,
  promoteTaskThroughGate,
  RuntimeApiError,
  recordTaskDecision,
  removeRuntimeWorktree,
  retryTaskDesigns,
  runTask,
  runTaskAction,
  selectTaskDesign,
  updateRuntimeSettings,
  updateTaskRolePolicy,
  updateTaskWorkflowProfile,
  verifyRuntimePricing,
} from "./api";
import {
  companionPolicyRoleIds,
  rolePolicyReasoningOptions,
  selectableRolePolicyModels,
  type RolePolicyFormOptions,
  type RolePolicyFormOptionsSource,
} from "./companion/catalog";
import { contextualAnswer, deriveCompanionContext } from "./companion/context";
import {
  type ActionProposal,
  type CompanionGateStage,
  type CompanionIntent,
  confirmActionProposal,
  createActionProposal,
  dismissActionProposal,
  type EligibilityEvidence,
  executeActionProposal,
  type ProposalFailureCode,
  type RolePolicyRequest,
  retainProposalDenial,
} from "./companion/contracts";
import { parseCompanionIntent } from "./companion/intentParser";
import { AgentsScreen } from "./components/AgentsScreen";
import { ChangelogModal } from "./components/ChangelogModal";
import { CommandCentre } from "./components/CommandCentre";
import type { CompanionMessage } from "./components/companion/CompanionPanel";
import { CompanionShell } from "./components/companion/CompanionShell";
import { TasksScreen } from "./components/LibraryScreens";
import { NewTaskDialog } from "./components/NewTaskDialog";
import { isValidNewTaskDraft } from "./components/NewTaskFields";
import { OperatorTaskPrototype } from "./components/operator/OperatorTaskPrototype";
import { RuntimeTaskWorkspace } from "./components/RuntimeTaskWorkspace";
import { SettingsScreen } from "./components/SettingsScreen";
import { Shell } from "./components/Shell";
import {
  type AgentRoleId,
  type AppScreen,
  type NewTaskDraft,
  type RuntimeArtifactMetadata,
  type RuntimeAvailableAction,
  type RuntimeEvaluationSummary,
  type RuntimeSettings,
  type RuntimeStatus,
  type RuntimeTask,
  type RuntimeTaskCore,
  type RuntimeTaskSummary,
  type StageId,
  workflowStages,
} from "./domain";
import {
  hostedAtlasPreviewRequested,
  hostedAtlasPreviewTasks,
  operatorTaskPreviewRequested,
} from "./hostedAtlasPreview";
import { isCurrentRequest } from "./requestIdentity";
import {
  appScreenForRoute,
  changelogRoute as createChangelogRoute,
  type HashRoute,
  type PrimaryRoute,
  parentTaskRoute,
  parseHashRoute,
  serializeHashRoute,
  type TaskRoute,
} from "./routes";

type Theme = "dark" | "light";

const THEME_STORAGE_KEY = "agent-harness.theme";
const SkillsScreen = lazy(() =>
  import("./components/SkillsScreen").then((module) => ({ default: module.SkillsScreen })),
);

const companionGateActions: Record<
  CompanionGateStage,
  Extract<RuntimeAvailableAction, "review" | "test" | "final-review" | "open-pr">
> = {
  "dev-review": "review",
  test: "test",
  "final-review": "final-review",
  approval: "open-pr",
};

function readStoredTheme(): Theme {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function writeStoredTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Unavailable storage falls back to the in-memory React state.
  }
}

async function refreshTaskEvidence(current: RuntimeTask, core: RuntimeTaskCore): Promise<RuntimeTask> {
  const coreChanged = current.pollVersion !== core.pollVersion;
  const { artifacts: _coreArtifacts, ...coreState } = core;
  if (!coreChanged) return { ...current, ...coreState };

  const [activity, runs, artifactPage] = await Promise.all([
    getTaskActivity(core.id, { limit: 200 }),
    getTaskRuns(core.id, { limit: 200 }),
    getTaskArtifactContents(core.id, { limit: 60 }),
  ]);
  const existingArtifacts = new Map(current.artifacts.map((artifact) => [artifact.id, artifact]));
  const newestArtifacts = artifactPage.items.map((artifact) => ({
    ...existingArtifacts.get(artifact.id),
    ...artifact,
  }));
  const artifacts = mergeNewestPage(current.artifacts, newestArtifacts, (item) => item.id).sort(
    (left, right) => left.createdAt.localeCompare(right.createdAt),
  );
  return {
    ...current,
    ...coreState,
    artifacts,
    events: mergeNewestPage(current.events, activity.items, (item) => item.id),
    runs: mergeNewestPage(current.runs ?? [], runs.items, (item) => item.id),
    artifactNextCursor: artifactPage.nextCursor,
  };
}

async function hydrateTask(id: string): Promise<RuntimeTask> {
  const [core, activity, runs, artifactPage] = await Promise.all([
    getTaskCore(id),
    getTaskActivity(id, { limit: 200 }),
    getTaskRuns(id, { limit: 200 }),
    getTaskArtifactContents(id, { limit: 60 }),
  ]);
  const artifacts = artifactPage.items;
  return {
    ...core,
    artifacts: artifacts.sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    events: [...activity.items].sort((left, right) => left.at.localeCompare(right.at)),
    runs: [...runs.items].sort((left, right) =>
      (left.startedAt ?? left.completedAt ?? "").localeCompare(right.startedAt ?? right.completedAt ?? ""),
    ),
    artifactNextCursor: artifactPage.nextCursor,
  };
}

function mergeNewestPage<T>(retained: T[], newest: T[], idFor: (item: T) => string) {
  const byId = new Map(retained.map((item) => [idFor(item), item]));
  for (const item of newest) byId.set(idFor(item), item);
  return [...byId.values()];
}

function taskSummaryFromDetail(task: RuntimeTask): RuntimeTaskSummary {
  const { events, runs, worktreeInventory: _worktreeInventory, artifacts, ...core } = task;
  return {
    ...core,
    artifacts: artifacts.map(artifactMetadata),
    artifactCount: task.artifactCount ?? artifacts.length,
    eventCount: task.eventCount ?? events.length,
    runCount: task.runCount ?? runs?.length ?? 0,
  };
}

function artifactMetadata(artifact: RuntimeTask["artifacts"][number]): RuntimeArtifactMetadata {
  const {
    content: _content,
    contextManifest: _contextManifest,
    focusedTest: _focusedTest,
    gateResult: _gateResult,
    freshness: _freshness,
    ...metadata
  } = artifact;
  return metadata;
}

export function App() {
  const operatorPreviewMode = operatorTaskPreviewRequested();
  const hostedPreviewMode = hostedAtlasPreviewRequested() || operatorPreviewMode;
  const [screen, setScreen] = useState<AppScreen>("command");
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => readStoredTheme());
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [newTaskCaptureProposalId, setNewTaskCaptureProposalId] = useState<string | null>(null);
  const [companionMessages, setCompanionMessages] = useState<CompanionMessage[]>([]);
  const [companionProposals, setCompanionProposals] = useState<ActionProposal[]>([]);
  const [companionPendingProposalId, setCompanionPendingProposalId] = useState<string | null>(null);
  const [companionDraft, setCompanionDraft] = useState("");
  const [companionOpen, setCompanionOpen] = useState(false);
  const [companionSubmitting, setCompanionSubmitting] = useState(false);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null);
  const [runtimeTasks, setRuntimeTasks] = useState<RuntimeTaskSummary[]>(() =>
    hostedPreviewMode ? hostedAtlasPreviewTasks : [],
  );
  const [runtimeLoading, setRuntimeLoading] = useState(!hostedPreviewMode);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [activeRuntimeTask, setActiveRuntimeTask] = useState<RuntimeTask | null>(null);
  const [activeTaskLoading, setActiveTaskLoading] = useState(false);
  const [evaluationSummary, setEvaluationSummary] = useState<RuntimeEvaluationSummary | null>(null);
  const [viewedStageId, setViewedStageId] = useState<StageId | undefined>();
  const [selectedAgentId, setSelectedAgentId] = useState<AgentRoleId | null>(null);
  const [selectedSkillId, setSelectedSkillId] = useState<StageId | null>(null);
  const [taskRouteDetail, setTaskRouteDetail] = useState<TaskRoute["detail"]>();
  const [currentRoute, setCurrentRoute] = useState<HashRoute>(
    () => parseHashRoute(window.location.hash).route,
  );
  const [runtimeRefreshing, setRuntimeRefreshing] = useState(false);
  const [toast, setToast] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const activeTaskIdentityRef = useRef<string | null>(null);
  const activeTaskRequestRef = useRef(0);
  const activeRuntimeTaskRef = useRef<RuntimeTask | null>(null);
  const runtimeTasksRef = useRef<RuntimeTaskSummary[]>(runtimeTasks);
  const companionMessageNumber = useRef(0);
  const companionCandidateHeads = useRef(new Map<string, string | null>());
  const companionTaskIdentityRef = useRef<string | null>(null);

  const toggleTheme = useCallback(() => setTheme((t) => (t === "light" ? "dark" : "light")), []);

  const showToast = useCallback((tone: "success" | "error", message: string) => {
    setToast({ tone, message });
    window.setTimeout(() => setToast(null), 4_000);
  }, []);

  useEffect(() => {
    if (theme === "light") document.documentElement.setAttribute("data-theme", "light");
    else document.documentElement.removeAttribute("data-theme");
    writeStoredTheme(theme);
  }, [theme]);

  const refreshTasks = useCallback(
    async (pollOnly = false) => {
      if (hostedPreviewMode) {
        setRuntimeTasks(hostedAtlasPreviewTasks);
        return hostedAtlasPreviewTasks;
      }
      if (pollOnly) {
        const pollStates = await listTaskPollStates();
        const currentVersions = new Map(runtimeTasksRef.current.map((task) => [task.id, task.pollVersion]));
        if (
          pollStates.length === currentVersions.size &&
          pollStates.every((task) => currentVersions.get(task.id) === task.pollVersion)
        ) {
          setRuntimeError(null);
          return runtimeTasksRef.current;
        }
      }
      const tasks = await listTasks();
      setRuntimeTasks(tasks);
      setRuntimeError(null);
      return tasks;
    },
    [hostedPreviewMode],
  );

  const refreshActiveTask = useCallback(
    async (id: string) => {
      if (hostedPreviewMode) {
        const previewTask = hostedAtlasPreviewTasks.find((task) => task.id === id);
        if (!previewTask) throw new Error(`Preview task ${id} was not found.`);
        activeRuntimeTaskRef.current = previewTask;
        setActiveRuntimeTask(previewTask);
        return previewTask;
      }
      const requestId = activeTaskRequestRef.current + 1;
      activeTaskRequestRef.current = requestId;
      const requested = { identity: id, generation: requestId };
      const currentTask = activeRuntimeTaskRef.current?.id === id ? activeRuntimeTaskRef.current : null;
      let task: RuntimeTask;
      if (currentTask) {
        const pollState = await getTaskPollState(id);
        task =
          pollState.pollVersion === currentTask.pollVersion
            ? currentTask
            : await refreshTaskEvidence(currentTask, await getTaskCore(id));
      } else task = await hydrateTask(id);
      if (
        !isCurrentRequest(requested, {
          identity: activeTaskIdentityRef.current,
          generation: activeTaskRequestRef.current,
        })
      )
        return null;
      activeRuntimeTaskRef.current = task;
      setActiveRuntimeTask((current) => ({
        ...task,
        worktreeInventory: current?.id === id ? current.worktreeInventory : [],
      }));
      setRuntimeTasks((tasks) => [
        taskSummaryFromDetail(task),
        ...tasks.filter((item) => item.id !== task.id),
      ]);
      const shouldRefreshInventory =
        !currentTask || currentTask.pollVersion !== task.pollVersion || currentTask.worktreeInventory == null;
      if (!shouldRefreshInventory) {
        setRuntimeError(null);
        return task;
      }
      const inventory = await getRuntimeWorktreeInventory(id);
      if (
        !isCurrentRequest(requested, {
          identity: activeTaskIdentityRef.current,
          generation: activeTaskRequestRef.current,
        })
      )
        return null;
      const enriched = { ...task, worktreeInventory: inventory.rows };
      activeRuntimeTaskRef.current = enriched;
      setActiveRuntimeTask((current) => (current?.id === id ? enriched : current));
      setRuntimeError(null);
      return enriched;
    },
    [hostedPreviewMode],
  );

  const loadMoreTaskArtifacts = useCallback(async () => {
    const current = activeRuntimeTaskRef.current;
    if (!current?.artifactNextCursor) return;
    const page = await getTaskArtifactContents(current.id, {
      cursor: current.artifactNextCursor,
      limit: 60,
    });
    const artifacts = mergeNewestPage(current.artifacts, page.items, (artifact) => artifact.id).sort(
      (left, right) => left.createdAt.localeCompare(right.createdAt),
    );
    const updated = {
      ...current,
      artifacts,
      artifactCount: page.total,
      artifactNextCursor: page.nextCursor,
    };
    activeRuntimeTaskRef.current = updated;
    setActiveRuntimeTask((task) => (task?.id === updated.id ? updated : task));
  }, []);

  const loadTaskArtifact = useCallback(async (artifactId: string) => {
    const current = activeRuntimeTaskRef.current;
    if (!current) throw new Error("No task is open.");
    const retained = current.artifacts.find((artifact) => artifact.id === artifactId);
    if (retained) return retained;
    const artifact = await getTaskArtifact(current.id, artifactId);
    const updated = {
      ...current,
      artifacts: [...current.artifacts, artifact].sort((left, right) =>
        left.createdAt.localeCompare(right.createdAt),
      ),
    };
    activeRuntimeTaskRef.current = updated;
    setActiveRuntimeTask((task) => (task?.id === updated.id ? updated : task));
    return artifact;
  }, []);

  useEffect(() => {
    activeRuntimeTaskRef.current = activeRuntimeTask;
  }, [activeRuntimeTask]);

  useEffect(() => {
    runtimeTasksRef.current = runtimeTasks;
  }, [runtimeTasks]);

  const navigateToRoute = useCallback((route: HashRoute, replace = false) => {
    const hash = serializeHashRoute(route);
    if (window.location.hash === hash) return;
    if (replace) window.history.replaceState(null, "", hash);
    else window.location.hash = hash;
  }, []);

  useEffect(() => {
    if (hostedPreviewMode) {
      setRuntimeStatus(null);
      setRuntimeTasks(hostedAtlasPreviewTasks);
      setRuntimeError(null);
      setRuntimeLoading(false);
      return;
    }
    let current = true;
    void Promise.allSettled([getRuntimeStatus(), listTasks(), getEvaluationSummary()]).then(
      ([statusResult, tasksResult, evaluationResult]) => {
        if (!current) return;
        if (statusResult.status === "fulfilled") setRuntimeStatus(statusResult.value);
        if (tasksResult.status === "fulfilled") setRuntimeTasks(tasksResult.value);
        if (evaluationResult.status === "fulfilled") setEvaluationSummary(evaluationResult.value);
        const failure =
          statusResult.status === "rejected"
            ? statusResult.reason
            : tasksResult.status === "rejected"
              ? tasksResult.reason
              : null;
        setRuntimeError(
          failure instanceof Error
            ? failure.message
            : failure
              ? "The local Agent Harness runtime is unavailable."
              : null,
        );
        setRuntimeLoading(false);
      },
    );
    return () => {
      current = false;
    };
  }, [hostedPreviewMode]);

  useEffect(() => {
    if (!window.location.hash)
      window.history.replaceState(null, "", serializeHashRoute({ kind: "screen", screen: "command" }));
    const applyRoute = () => {
      const parsed = parseHashRoute(window.location.hash);
      if (!parsed.valid) window.history.replaceState(null, "", serializeHashRoute(parsed.route));
      const route = parsed.route;
      const primaryRoute = route.kind === "changelog" ? route.returnTo : route;
      setCurrentRoute(route);
      setScreen(appScreenForRoute(primaryRoute));
      setSelectedSkillId(primaryRoute.kind === "skill" ? primaryRoute.skillId : null);
      setSelectedAgentId(primaryRoute.kind === "agent" ? primaryRoute.agentId : null);
      if (primaryRoute.kind !== "task") {
        activeTaskIdentityRef.current = null;
        activeTaskRequestRef.current += 1;
        setActiveTaskLoading(false);
        setWorkspaceOpen(false);
        setActiveRuntimeTask(null);
        setViewedStageId(undefined);
        setTaskRouteDetail(undefined);
        return;
      }
      const { taskId, stageId, detail } = primaryRoute;
      if (shouldClearCompanionDraft(companionTaskIdentityRef.current, taskId)) {
        setCompanionDraft("");
      }
      companionTaskIdentityRef.current = taskId;
      activeTaskIdentityRef.current = taskId;
      setViewedStageId(stageId);
      setTaskRouteDetail(detail);
      setWorkspaceOpen(true);
      setActiveTaskLoading(true);
      setActiveRuntimeTask((current) => (current?.id === taskId ? current : null));
      void refreshActiveTask(taskId)
        .catch((error) => {
          if (activeTaskIdentityRef.current !== taskId) return;
          showToast("error", error instanceof Error ? error.message : "The task could not be loaded.");
          navigateToRoute({ kind: "screen", screen: "tasks" });
        })
        .finally(() => setActiveTaskLoading(false));
    };
    applyRoute();
    window.addEventListener("hashchange", applyRoute);
    window.addEventListener("popstate", applyRoute);
    return () => {
      window.removeEventListener("hashchange", applyRoute);
      window.removeEventListener("popstate", applyRoute);
    };
  }, [navigateToRoute, refreshActiveTask, showToast]);

  useEffect(() => {
    const id = activeRuntimeTask?.id;
    if (!id) return;
    let cancelled = false;
    let timeout: number | undefined;
    let failureShown = false;
    const delay = activeRuntimeTask.status === "running" ? 1_250 : 5_000;
    const poll = async () => {
      try {
        await refreshActiveTask(id);
        failureShown = false;
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : "The active task could not be refreshed.";
          setRuntimeError(message);
          if (!failureShown) showToast("error", `${message} Showing the last retained task state.`);
          failureShown = true;
        }
      } finally {
        if (!cancelled) timeout = window.setTimeout(() => void poll(), delay);
      }
    };
    timeout = window.setTimeout(() => void poll(), delay);
    return () => {
      cancelled = true;
      if (timeout != null) window.clearTimeout(timeout);
    };
  }, [activeRuntimeTask?.id, activeRuntimeTask?.status, refreshActiveTask, showToast]);

  // The Command Centre and Tasks screen both read runtimeTasks, which the active-task
  // effect above never touches (it only ever writes activeRuntimeTask). Without this,
  // that list is fetched at boot and after mutations only, so a task advancing on its own
  // never shows up until something else forces a refresh. Poll slower than the open-task
  // effect since this covers every task, not just the one being watched closely.
  const anyTaskRunning = runtimeTasks.some((task) => task.status === "running");
  useEffect(() => {
    if (hostedPreviewMode) return;
    // A hidden tab can't show the update anyway, so skip the network call; catch up with
    // one immediate refresh when the tab becomes visible again instead of waiting out the
    // rest of the interval.
    let cancelled = false;
    let timeout: number | undefined;
    let polling = false;
    const delay = anyTaskRunning ? 5_000 : 15_000;
    const poll = async () => {
      if (document.visibilityState === "hidden" || polling) return;
      polling = true;
      try {
        await refreshTasks(true);
      } catch (error) {
        if (!cancelled)
          setRuntimeError(error instanceof Error ? error.message : "The task list could not be refreshed.");
      } finally {
        polling = false;
      }
    };
    const schedule = async () => {
      await poll();
      if (!cancelled) timeout = window.setTimeout(() => void schedule(), delay);
    };
    timeout = window.setTimeout(() => void schedule(), delay);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      cancelled = true;
      if (timeout != null) window.clearTimeout(timeout);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [anyTaskRunning, hostedPreviewMode, refreshTasks]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (hostedPreviewMode) return;
      if (
        event.key.toLowerCase() === "n" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !(event.target instanceof HTMLInputElement) &&
        !(event.target instanceof HTMLTextAreaElement)
      ) {
        event.preventDefault();
        setNewTaskCaptureProposalId(null);
        setNewTaskOpen(true);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [hostedPreviewMode]);

  const navigate = (nextScreen: AppScreen) => navigateToRoute({ kind: "screen", screen: nextScreen });

  const openWorkspace = (from: "command" | "tasks", taskId?: string, stageId?: StageId) => {
    if (taskId)
      navigateToRoute({
        kind: "task",
        taskId,
        stageId,
        returnTo: from === "command" ? "command" : undefined,
      });
  };

  const startTask = async (draft: NewTaskDraft, requestOptions: MutationRequestOptions = {}) => {
    const task = await createTask(draft, requestOptions);
    await runTask(task.id, requestOptions);
    setNewTaskOpen(false);
    setRuntimeTasks((tasks) => [taskSummaryFromDetail(task), ...tasks.filter((item) => item.id !== task.id)]);
    navigateToRoute({ kind: "task", taskId: task.id, stageId: task.currentStage });
  };

  const refreshRuntime = async () => {
    setRuntimeRefreshing(true);
    try {
      setRuntimeStatus(await getRuntimeStatus());
      setRuntimeError(null);
      showToast("success", "Runtime status refreshed.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Runtime status could not be refreshed.";
      setRuntimeError(message);
      showToast("error", message);
    } finally {
      setRuntimeRefreshing(false);
    }
  };

  const saveRuntimeSettings = async (
    settings: Pick<
      RuntimeSettings,
      "allowedModels" | "defaultModel" | "defaultReasoning" | "stagePolicies" | "profileStagePolicies"
    > &
      Partial<Pick<RuntimeSettings, "grillPolicy" | "gatePolicy" | "designPolicies">>,
  ) => {
    const saved = await updateRuntimeSettings(settings);
    const [status, evaluation] = await Promise.all([getRuntimeStatus(), getEvaluationSummary()]);
    setRuntimeStatus(status);
    setEvaluationSummary(evaluation);
    setRuntimeError(null);
    return saved;
  };

  const primaryRoute: PrimaryRoute = currentRoute.kind === "changelog" ? currentRoute.returnTo : currentRoute;
  const taskRoute = primaryRoute.kind === "task" ? primaryRoute : null;
  const companionContext = deriveCompanionContext({
    route: serializeHashRoute(currentRoute),
    task: activeRuntimeTask,
    viewedStage: activeRuntimeTask ? (viewedStageId ?? activeRuntimeTask.currentStage) : null,
  });
  const companionRolePolicyOptions: RolePolicyFormOptionsSource = (proposal) =>
    rolePolicyOptionsForProposal(
      activeRuntimeTask,
      proposal.target.taskId,
      !activeTaskLoading,
      runtimeStatus,
    );
  const companionThreadMessages: readonly CompanionMessage[] = companionMessages.length
    ? companionMessages
    : [
        {
          id: "companion-app-welcome",
          role: "assistant",
          content: `I’m grounded in the visible Evidence Gate context.\n\n${contextualAnswer(companionContext)}`,
        },
      ];

  const addCompanionMessage = (role: CompanionMessage["role"], content: string) => {
    companionMessageNumber.current += 1;
    setCompanionMessages((current) => [
      ...current,
      { id: `companion-app-message-${companionMessageNumber.current}`, role, content },
    ]);
  };

  const replaceCompanionProposal = (next: ActionProposal) => {
    setCompanionProposals((current) =>
      current.map((proposal) => (proposal.id === next.id ? next : proposal)),
    );
  };

  const handleCompanionIntent = async (intent: CompanionIntent) => {
    if (intent.kind === "context") return;
    if (intent.kind === "navigate") {
      navigateToRoute(
        intent.target === "tasks"
          ? { kind: "screen", screen: "tasks" }
          : { kind: "task", taskId: intent.taskId },
      );
      return;
    }

    if (intent.kind === "create-task") {
      const id = newCompanionProposalId();
      setCompanionProposals((current) => [
        ...current,
        createActionProposal({
          id,
          actionType: "create-task",
          summary: "Prepare a validated task draft for explicit confirmation.",
          eligibility: {
            eligible: false,
            rationale: "A complete NewTaskDraft must be captured and shown before confirmation is available.",
            evidence: [
              "No exact task mutation exists until the draft dialog is submitted.",
              "After capture, confirmation will reuse the existing CSRF-protected /api/tasks boundary.",
            ],
          },
          target: { kind: "new-task", draft: null },
        }),
      ]);
      setNewTaskCaptureProposalId(id);
      setNewTaskOpen(true);
      return;
    }

    if (!activeRuntimeTask) throw new Error("Open a task before proposing a task-scoped action.");

    if (intent.kind === "change-role-model") {
      const policy = suggestedRolePolicy(intent, activeRuntimeTask, runtimeStatus);
      const eligibility = projectRolePolicyEligibility(
        activeRuntimeTask,
        { ...policy, role: intent.role },
        runtimeStatus,
      );
      const id = newCompanionProposalId();
      setCompanionProposals((current) => [
        ...current,
        createActionProposal({
          id,
          actionType: "change-role-model",
          summary: `Use ${policy.model ?? "a discovered model"} for the ${intent.role} agent on ${activeRuntimeTask.id}.`,
          eligibility,
          target: {
            kind: "task-agent-policy",
            scope: "task_snapshot",
            taskId: activeRuntimeTask.id,
            role: intent.role,
            model: policy.model,
            reasoning: policy.reasoning,
          },
        }),
      ]);
      return;
    }

    const candidate = activeRuntimeTask.candidates?.at(-1);
    const action = companionGateActions[intent.nextStage];
    if (!candidate) throw new Error("This task has no persisted integration candidate to promote.");
    const id = newCompanionProposalId();
    companionCandidateHeads.current.set(id, candidate.headRevision);
    const actionEligibility = activeRuntimeTask.actionEligibility?.actions?.[action];
    const candidateReady = Boolean(candidate.headRevision);
    setCompanionProposals((current) => [
      ...current,
      createActionProposal({
        id,
        actionType: "promote-gate",
        summary: `Promote ${activeRuntimeTask.id} to ${stageLabel(intent.nextStage)} using the exact candidate revision.`,
        eligibility: {
          eligible: candidateReady && actionEligibility?.allowed !== false,
          rationale:
            actionEligibility?.allowed === false
              ? (actionEligibility.reason ?? "Canonical task admission currently denies this gate.")
              : "The server will re-read repository authority, candidate identity, and canonical gate eligibility after confirmation.",
          evidence: [
            `Candidate scope: ${candidate.id} · revision ${candidate.revisionNumber}.`,
            candidate.headRevision
              ? `Candidate head: ${candidate.headRevision}.`
              : "The candidate has no persisted head revision.",
            actionEligibility?.reason ?? "No browser-side eligibility is treated as authoritative.",
          ],
        },
        target: {
          kind: "candidate-gate",
          scope: "candidate",
          taskId: activeRuntimeTask.id,
          candidateId: candidate.id,
          candidateRevision: candidate.revisionNumber,
          nextStage: intent.nextStage,
        },
      }),
    ]);
  };

  const handleCompanionText = async (value: string) => {
    addCompanionMessage("user", value);
    const parsed = parseCompanionIntent(value);
    if (parsed.status === "rejected") {
      if (parsed.reasonCode !== "unknown-intent") {
        addCompanionMessage(
          "assistant",
          `${parsed.message}\n\nTry one of these:\n${parsed.examples.join("\n")}`,
        );
        return;
      }
      setCompanionSubmitting(true);
      try {
        const result = await askCompanionQuestion(value, companionContext);
        addCompanionMessage("assistant", result.answer);
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Read-only analysis is unavailable.";
        addCompanionMessage("assistant", `I could not complete the read-only analysis. ${reason}`);
      } finally {
        setCompanionSubmitting(false);
      }
      return;
    }

    const intent = parsed.intent;
    try {
      await handleCompanionIntent(intent);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "The request could not be prepared.";
      addCompanionMessage("assistant", `I could not prepare that request. ${reason}`);
      return;
    }

    if (intent.kind === "context") {
      addCompanionMessage("assistant", contextualAnswer(companionContext));
    } else if (intent.kind === "navigate") {
      addCompanionMessage(
        "assistant",
        intent.target === "tasks"
          ? "Opening Tasks. Navigation is read-only and does not require confirmation."
          : `Opening task ${intent.taskId}. Navigation is read-only and does not require confirmation.`,
      );
    } else {
      const actionLabel =
        intent.kind === "create-task"
          ? "prepare a new task draft"
          : intent.kind === "change-role-model"
            ? "change a task-scoped agent model"
            : `promote this task to ${stageLabel(intent.nextStage)}`;
      addCompanionMessage(
        "assistant",
        `I can ${actionLabel}. Review the governed action card below; no mutation is sent until you confirm it.`,
      );
    }
  };

  const confirmCompanionAction = async (proposal: ActionProposal) => {
    const confirmed = confirmActionProposal(proposal);
    replaceCompanionProposal(confirmed);
    setCompanionPendingProposalId(proposal.id);
    try {
      if (proposal.actionType === "create-task") {
        const draft = proposal.target.draft;
        if (!draft || !isValidNewTaskDraft(draft)) throw new Error("A valid task draft is required.");
        const task = await createTask(draft, { retryOnCsrf: false });
        setNewTaskOpen(false);
        setNewTaskCaptureProposalId(null);
        setRuntimeTasks((tasks) => [
          taskSummaryFromDetail(task),
          ...tasks.filter((item) => item.id !== task.id),
        ]);
        navigateToRoute({ kind: "task", taskId: task.id, stageId: task.currentStage });
      } else if (proposal.actionType === "change-role-model") {
        const { target } = proposal;
        if (!target.model || !target.reasoning) throw new Error("A model and reasoning policy are required.");
        const result = await updateTaskRolePolicy(target.taskId, {
          role: target.role,
          model: target.model,
          reasoning: target.reasoning,
        });
        activeRuntimeTaskRef.current = result.task;
        setActiveRuntimeTask(result.task);
        setRuntimeTasks((tasks) =>
          tasks.map((task) => (task.id === result.task.id ? taskSummaryFromDetail(result.task) : task)),
        );
        await refreshActiveTask(target.taskId);
      } else {
        const { target } = proposal;
        const candidateHeadRevision = companionCandidateHeads.current.get(proposal.id);
        if (!candidateHeadRevision) throw new Error("The exact candidate head revision is unavailable.");
        await promoteTaskThroughGate(target.taskId, companionGateActions[target.nextStage], {
          candidateId: target.candidateId,
          candidateRevision: target.candidateRevision,
          candidateHeadRevision,
        });
        await refreshActiveTask(target.taskId);
        await refreshTasks();
      }
      const executed = executeActionProposal(confirmed);
      replaceCompanionProposal(executed);
      addCompanionMessage("system", `${proposal.summary} Executed after server confirmation.`);
    } catch (error) {
      const failure = companionFailure(error);
      const retained = retainProposalDenial(confirmed, failure);
      replaceCompanionProposal(retained);
      addCompanionMessage("system", `Confirmation failed and remains reviewable: ${failure.reason}`);
      showToast("error", failure.reason);
    } finally {
      setCompanionPendingProposalId(null);
    }
  };

  const dismissCompanionAction = async (proposal: ActionProposal) => {
    const dismissed = dismissActionProposal(proposal, { reason: "Dismissed by the operator." });
    replaceCompanionProposal(dismissed);
    addCompanionMessage("system", `Dismissed: ${proposal.summary}`);
  };

  const captureCompanionTaskDraft = async (draft: NewTaskDraft) => {
    const proposalId = newTaskCaptureProposalId;
    if (!proposalId || !isValidNewTaskDraft(draft))
      throw new Error("Complete the required task fields first.");
    setCompanionProposals((current) =>
      current.map((proposal) =>
        proposal.id === proposalId && proposal.actionType === "create-task"
          ? {
              ...proposal,
              target: { kind: "new-task", draft },
              eligibility: {
                ...proposal.eligibility,
                eligible: true,
                rationale: "The complete NewTaskDraft is ready for explicit confirmation.",
                evidence: [
                  "Every submitted NewTaskDraft field and attachment selection is shown on the card.",
                  "No task API was called while the draft was captured.",
                ],
              },
            }
          : proposal,
      ),
    );
    setNewTaskOpen(false);
    setNewTaskCaptureProposalId(null);
    addCompanionMessage("system", "Task draft captured. Review the exact draft and confirm it when ready.");
  };

  if (operatorPreviewMode) {
    const leavePrototype = (nextScreen: AppScreen = "tasks") => {
      const target = new URL(window.location.href);
      target.searchParams.delete("preview");
      target.hash = `#/${nextScreen}`;
      window.location.assign(target.toString());
    };
    return (
      <div
        className={`app-shell app-shell--operator-preview ${sidebarCollapsed ? "app-shell--collapsed" : ""}`}
      >
        <Shell
          screen="tasks"
          collapsed={sidebarCollapsed}
          onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
          theme={theme}
          onToggleTheme={toggleTheme}
          onNavigate={leavePrototype}
          onNewTask={() => showToast("error", "This is a read-only visual prototype.")}
          onOpenChangelog={() => leavePrototype("tasks")}
          runtimeStatus={null}
        />
        <main className="app-main">
          <OperatorTaskPrototype onExit={() => leavePrototype("tasks")} />
        </main>
        {toast ? <div className={`toast toast--${toast.tone}`}>{toast.message}</div> : null}
      </div>
    );
  }

  return (
    <div
      className={`app-shell ${sidebarCollapsed ? "app-shell--collapsed" : ""} ${companionOpen ? "app-shell--companion-open" : ""}`}
    >
      <Shell
        screen={screen}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
        theme={theme}
        onToggleTheme={toggleTheme}
        onNavigate={navigate}
        onNewTask={() => {
          if (hostedPreviewMode)
            showToast("error", "The hosted atlas is a read-only UI preview. Task execution remains local.");
          else {
            setNewTaskCaptureProposalId(null);
            setNewTaskOpen(true);
          }
        }}
        onOpenChangelog={() => navigateToRoute(createChangelogRoute(primaryRoute))}
        runtimeStatus={runtimeStatus}
      />
      <main className="app-main">
        {workspaceOpen && activeRuntimeTask ? (
          <RuntimeTaskWorkspace
            key={activeRuntimeTask.id}
            task={activeRuntimeTask}
            readOnlyPreview={hostedPreviewMode}
            initialViewMode={taskRouteDetail ? "evidence" : "operator"}
            initialViewedStageId={viewedStageId}
            onViewedStageChange={(stageId) => {
              setViewedStageId(stageId);
              navigateToRoute({
                ...(taskRoute ?? { kind: "task", taskId: activeRuntimeTask.id }),
                stageId,
                detail: undefined,
              });
            }}
            routeDetail={taskRouteDetail}
            onRouteDetailChange={(detail, stageId) => {
              const baseRoute = taskRoute ?? { kind: "task" as const, taskId: activeRuntimeTask.id };
              navigateToRoute({
                ...parentTaskRoute(baseRoute),
                stageId: stageId ?? baseRoute.stageId ?? activeRuntimeTask.currentStage,
                detail: detail ?? undefined,
              });
            }}
            onBack={() => {
              navigateToRoute({ kind: "screen", screen: taskRoute?.returnTo ?? "tasks" });
              void refreshTasks();
            }}
            onRun={async () => {
              await runTask(activeRuntimeTask.id);
              await refreshActiveTask(activeRuntimeTask.id);
              showToast("success", "Task run started.");
            }}
            onCancel={async () => {
              await cancelTask(activeRuntimeTask.id);
              await refreshActiveTask(activeRuntimeTask.id);
              showToast("success", "Active run cancelled.");
            }}
            onCloseTask={async (reason, note, supersededBy) => {
              const result = await closeTask(activeRuntimeTask.id, reason, note, supersededBy);
              setActiveRuntimeTask(result.task);
              await refreshTasks();
              showToast(
                "success",
                reason === "superseded"
                  ? `Task marked superseded${supersededBy ? ` by ${supersededBy}` : ""}.`
                  : "Task closed as not needed.",
              );
            }}
            onArchiveTask={async () => {
              const result = await archiveTask(activeRuntimeTask.id);
              setActiveRuntimeTask(result.task);
              await refreshTasks();
              // The retained count is the part the operator has to act on, so it leads and it
              // is a warning: those worktrees still hold uncommitted work and still take disk.
              showToast(
                result.retainedWorktrees.length ? "error" : "success",
                result.retainedWorktrees.length
                  ? `Task archived. ${result.retainedWorktrees.length} worktree${result.retainedWorktrees.length === 1 ? "" : "s"} kept — uncommitted work.`
                  : `Task archived.${result.removedWorktrees.length ? ` ${result.removedWorktrees.length} worktree${result.removedWorktrees.length === 1 ? "" : "s"} removed.` : ""}`,
              );
            }}
            onEvaluate={async (score, outcome, notes) => {
              const result = await evaluateTask(activeRuntimeTask.id, score, outcome, notes);
              setActiveRuntimeTask(result.task);
              setEvaluationSummary(await getEvaluationSummary());
              showToast("success", "Task outcome added to the model scorecard.");
            }}
            onAction={async (action, note) => {
              try {
                if (action === "continue-implementation") {
                  const result = await continueTaskToImplementation(activeRuntimeTask.id);
                  setActiveRuntimeTask(result.task);
                  await refreshTasks();
                  navigateToRoute({
                    kind: "task",
                    taskId: result.task.id,
                    stageId: result.task.currentStage,
                  });
                  showToast(
                    "success",
                    result.created
                      ? `${result.task.id} created from the approved investigation; planning started.`
                      : `Opened existing implementation task ${result.task.id}.`,
                  );
                  return;
                }
                await runTaskAction(activeRuntimeTask.id, action, note);
                await refreshActiveTask(activeRuntimeTask.id);
                showToast(
                  "success",
                  action === "grant-retry"
                    ? "One repair attempt was granted. The stage limit is updated."
                    : action === "refresh-candidate"
                      ? "Candidate refreshed from the latest target. All candidate-bound gates must run again."
                      : action === "rebuild-candidate"
                        ? "Candidate rebuild authorized from the latest target. The prior candidate remains retained."
                        : action === "restart-implementation"
                          ? "Implementation restart authorized from the latest target. Prior artifacts remain retained."
                          : action === "retry-test"
                            ? "Test retry started against the unchanged candidate revision."
                            : action === "open-pr"
                              ? "GitHub PR opened for the exact approved candidate. The task will complete after GitHub reports it merged."
                              : action === "reconcile-pr"
                                ? "GitHub PR state reconciled."
                                : action === "continue-package"
                                  ? "Retained package continuation started with exact worktree validation."
                                  : action === "revalidate-plan"
                                    ? "Plan revalidation started against the current repository target."
                                    : action === "close-already-satisfied"
                                      ? "Task closed after explicit review of the repository evidence."
                                      : action === "repair"
                                        ? "Repair started. Downstream gates now require fresh evidence."
                                        : action === "complete-merged"
                                          ? "Task marked completed."
                                          : "Task action completed.",
                );
                if (
                  [
                    "repair",
                    "implement",
                    "continue-package",
                    "review",
                    "test",
                    "retry-test",
                    "final-review",
                  ].includes(action)
                ) {
                  window.setTimeout(() => {
                    void getTaskCore(activeRuntimeTask.id)
                      .then((latest) => {
                        if (["failed", "blocked"].includes(latest.status) && latest.error) {
                          showToast("error", `${latest.currentStage} stopped: ${latest.error}`);
                          void refreshActiveTask(latest.id);
                        }
                      })
                      .catch(() => undefined);
                  }, 1_000);
                }
              } catch (error) {
                const message = error instanceof Error ? error.message : "The task action failed.";
                showToast("error", message);
                throw error;
              }
            }}
            onDecision={async (question, answer) => {
              await recordTaskDecision(activeRuntimeTask.id, question, answer);
              await refreshActiveTask(activeRuntimeTask.id);
              showToast("success", "Decision recorded.");
            }}
            onGrillAnswer={async (questionId, answer) => {
              await answerGrillQuestion(activeRuntimeTask.id, questionId, answer);
              await refreshActiveTask(activeRuntimeTask.id);
              showToast("success", "Grill answer recorded.");
            }}
            onFinishGrill={async (acceptRemaining) => {
              await finishGrill(activeRuntimeTask.id, acceptRemaining);
              await refreshActiveTask(activeRuntimeTask.id);
              showToast("success", "Grill completed; specification run started.");
            }}
            onSelectDesign={async (variantId) => {
              await selectTaskDesign(activeRuntimeTask.id, variantId);
              await refreshActiveTask(activeRuntimeTask.id);
              showToast("success", "Design revision selected; Task Spec started.");
            }}
            onRetryDesigns={async () => {
              await retryTaskDesigns(activeRuntimeTask.id);
              await refreshActiveTask(activeRuntimeTask.id);
              showToast("success", "Both design generators restarted.");
            }}
            onRemoveWorktree={async (rowId) => {
              try {
                await removeRuntimeWorktree(activeRuntimeTask.id, rowId);
                await refreshActiveTask(activeRuntimeTask.id);
                showToast("success", "Worktree removed.");
              } catch (error) {
                showToast(
                  "error",
                  error instanceof Error ? error.message : "The worktree could not be removed.",
                );
                throw error;
              }
            }}
            onProfileChange={async (profile, reason) => {
              try {
                const updated = await updateTaskWorkflowProfile(activeRuntimeTask.id, profile, reason);
                setActiveRuntimeTask(updated);
                setRuntimeTasks((tasks) =>
                  tasks.map((task) => (task.id === updated.id ? taskSummaryFromDetail(updated) : task)),
                );
                showToast("success", `Workflow profile changed to ${profile}.`);
              } catch (error) {
                const message =
                  error instanceof Error ? error.message : "The workflow profile could not be changed.";
                showToast("error", message);
                throw error;
              }
            }}
            onLoadMoreArtifacts={loadMoreTaskArtifacts}
            onLoadArtifact={loadTaskArtifact}
          />
        ) : workspaceOpen && activeTaskLoading ? (
          <TaskWorkspaceSkeleton />
        ) : null}
        {!workspaceOpen && screen === "command" ? (
          <CommandCentre
            previewMode={hostedPreviewMode}
            runtimeTasks={runtimeTasks}
            runtimeStatus={runtimeStatus}
            runtimeLoading={runtimeLoading}
            runtimeError={runtimeError}
            onNewTask={() => {
              if (hostedPreviewMode)
                showToast(
                  "error",
                  "The hosted atlas is a read-only UI preview. Task execution remains local.",
                );
              else {
                setNewTaskCaptureProposalId(null);
                setNewTaskOpen(true);
              }
            }}
            onOpenTask={(taskId, stageId) => openWorkspace("command", taskId, stageId)}
            onSeeAllTasks={() => navigate("tasks")}
          />
        ) : null}
        {!workspaceOpen && screen === "tasks" ? (
          <TasksScreen
            runtimeTasks={runtimeTasks}
            onOpenTask={(taskId, stageId) => openWorkspace("tasks", taskId, stageId)}
          />
        ) : null}
        {!workspaceOpen && screen === "skills" ? (
          <Suspense fallback={<div aria-busy="true">Loading Skills…</div>}>
            <SkillsScreen
              runtimeTasks={runtimeTasks}
              selectedId={selectedSkillId}
              onSelect={(skillId) =>
                navigateToRoute(skillId ? { kind: "skill", skillId } : { kind: "screen", screen: "skills" })
              }
            />
          </Suspense>
        ) : null}
        {!workspaceOpen && screen === "agents" ? (
          <AgentsScreen
            runtimeTasks={runtimeTasks}
            runtimeStatus={runtimeStatus}
            selectedId={selectedAgentId}
            onSelect={(agentId) =>
              navigateToRoute(agentId ? { kind: "agent", agentId } : { kind: "screen", screen: "agents" })
            }
            onSave={saveRuntimeSettings}
          />
        ) : null}
        {!workspaceOpen && screen === "settings" ? (
          <SettingsScreen
            runtimeStatus={runtimeStatus}
            evaluationSummary={evaluationSummary}
            onRefresh={refreshRuntime}
            onSave={saveRuntimeSettings}
            onVerifyPricing={async () => {
              const result = await verifyRuntimePricing();
              await refreshRuntime();
              showToast(
                "success",
                `Pricing verified with ${result.usage.totalTokens.toLocaleString()} agent tokens.`,
              );
            }}
            refreshing={runtimeRefreshing}
          />
        ) : null}
      </main>
      <CompanionShell
        open={companionOpen}
        onOpen={() => setCompanionOpen(true)}
        onClose={() => setCompanionOpen(false)}
        context={companionContext}
        messages={companionThreadMessages}
        proposals={companionProposals}
        draft={companionDraft}
        onDraftChange={setCompanionDraft}
        onSubmitText={handleCompanionText}
        onConfirmAction={confirmCompanionAction}
        onDismissAction={dismissCompanionAction}
        pendingProposalId={companionPendingProposalId}
        isSubmitting={companionSubmitting}
        rolePolicyOptions={companionRolePolicyOptions}
      />
      <NewTaskDialog
        open={newTaskOpen}
        defaultRepository={runtimeStatus?.suggestedRepository ?? ""}
        runtimeStatus={runtimeStatus}
        onClose={() => setNewTaskOpen(false)}
        onStart={startTask}
        captureOnly={newTaskCaptureProposalId !== null}
        onCaptureDraft={captureCompanionTaskDraft}
      />
      {currentRoute.kind === "changelog" ? (
        <ChangelogModal
          commitSha={currentRoute.commitSha}
          filePath={currentRoute.filePath}
          onClose={() => navigateToRoute(currentRoute.returnTo)}
          onSelectCommit={(commitSha) =>
            navigateToRoute(createChangelogRoute(currentRoute.returnTo, commitSha))
          }
          onSelectFile={(filePath) =>
            navigateToRoute(createChangelogRoute(currentRoute.returnTo, currentRoute.commitSha, filePath))
          }
        />
      ) : null}
      {toast ? (
        <div className={`app-toast app-toast--${toast.tone}`} role="status">
          {toast.message}
        </div>
      ) : null}
    </div>
  );
}

function TaskWorkspaceSkeleton() {
  return (
    <div className="task-workspace-skeleton" role="status" aria-label="Loading task details" aria-busy="true">
      <header>
        <span />
        <div>
          <i />
          <i />
        </div>
        <span />
      </header>
      <nav>
        {workflowStages.map((stage) => (
          <span key={stage.id} />
        ))}
      </nav>
      <div className="task-workspace-skeleton__grid">
        <main>
          <i />
          <section />
          <section />
        </main>
        <aside>
          <section />
          <section />
          <section />
        </aside>
      </div>
    </div>
  );
}

function newCompanionProposalId() {
  return `companion-${crypto.randomUUID()}`;
}

export function shouldClearCompanionDraft(previousTaskId: string | null, nextTaskId: string | null) {
  return previousTaskId !== null && nextTaskId !== null && previousTaskId !== nextTaskId;
}

export function projectRolePolicyEligibility(
  task: RuntimeTask | null,
  request: RolePolicyRequest,
  runtimeStatus: RuntimeStatus | null,
): EligibilityEvidence {
  const models = selectableRolePolicyModels(
    runtimeStatus?.catalog?.models ?? [],
    runtimeStatus?.settings?.allowedModels ?? [],
  );
  const model = models.find((option) => option.id === request.model) ?? null;
  if (!companionPolicyRoleIds.includes(request.role as (typeof companionPolicyRoleIds)[number])) {
    return ineligibleRolePolicy("Choose a known, mutable workflow role.", [
      `Requested role: ${String(request.role)}.`,
    ]);
  }
  if (!model) {
    return ineligibleRolePolicy("Choose a discovered, editable model allowed by Settings.", [
      `Requested model: ${request.model ?? "none"}.`,
    ]);
  }
  if (!request.reasoning || !rolePolicyReasoningOptions(model).some((level) => level === request.reasoning)) {
    return ineligibleRolePolicy("Choose reasoning supported by the selected model.", [
      `Supported reasoning: ${rolePolicyReasoningOptions(model).join(", ") || "none"}.`,
    ]);
  }
  if (!task?.id) return ineligibleRolePolicy("The selected task is not available for policy review.", []);

  const lockedStatuses = new Set([
    "terminal",
    "completed",
    "closed",
    "archived",
    "cancelled",
    "cancelling",
    "identity-drift",
    "awaiting-pr-merge",
    "awaiting-human-approval",
    "merging",
    "merged-to-target",
  ]);
  if (lockedStatuses.has(task.status)) {
    return ineligibleRolePolicy(`The task is ${task.status}; role policies are no longer mutable.`, [
      `Task status: ${task.status}.`,
    ]);
  }
  if (
    (task as RuntimeTask & { identityDrift?: boolean }).identityDrift === true ||
    task.blocker?.code === "identity-drift" ||
    (task.repositoryAuthorityStatus as string | undefined) === "identity-drift" ||
    task.repositoryAuthorityStatus !== "bound" ||
    !task.repositoryAuthority?.id ||
    !task.repositoryAuthority.selectedRevision ||
    !task.repositoryAuthority.targetRef ||
    !task.repositoryAuthority.capturedAt ||
    (task.repositoryAuthority.upstreamRef !== null &&
      task.repositoryAuthority.upstreamRef !== undefined &&
      task.repositoryAuthority.remoteVerification?.status !== "verified")
  ) {
    return ineligibleRolePolicy("The task repository authority is not currently verified.", [
      "A bound authority with a selected revision, target ref, and capture time is required.",
    ]);
  }

  const activeRunIds = task.activeRunIds ?? [];
  if (activeRunIds.length > 0 && !(task.runs ?? []).some((run) => activeRunIds.includes(run.id))) {
    return ineligibleRolePolicy("A retained or active run prevents policy changes until it is resolved.", [
      `Active run records: ${activeRunIds.length}.`,
    ]);
  }
  const roleRun = (task.runs ?? []).find((run) => run.role === request.role || run.stage === request.role);
  if (roleRun) {
    return ineligibleRolePolicy(`The ${request.role} role has already begun work.`, [
      `Role run: ${roleRun.id}.`,
    ]);
  }
  const activeRole = clientActiveRoleFor(task);
  if (activeRole === request.role) {
    return ineligibleRolePolicy(`The ${request.role} role has already begun work.`, [
      `Active role: ${request.role}.`,
    ]);
  }
  const roleArtifact = task.artifacts.find(
    (artifact) => artifact.agentRole === request.role || artifact.stage === request.role,
  );
  if (roleArtifact) {
    return ineligibleRolePolicy(`The ${request.role} role has retained evidence.`, [
      `Role artifact: ${roleArtifact.id}.`,
    ]);
  }
  if (task.completedStages.includes(request.role as StageId)) {
    return ineligibleRolePolicy(`The ${request.role} stage has already been reached or passed.`, [
      `Completed stage: ${request.role}.`,
    ]);
  }
  if (Object.hasOwn(task.stageDispositions ?? {}, request.role)) {
    return ineligibleRolePolicy(`The ${request.role} stage has a recorded disposition.`, [
      `Stage disposition recorded: ${request.role}.`,
    ]);
  }
  const recordedAttempts = task.attemptsByStage[request.role as StageId] ?? 0;
  if (recordedAttempts > 0) {
    return ineligibleRolePolicy(`The ${request.role} stage has a recorded attempt.`, [
      `Recorded attempts: ${recordedAttempts}.`,
    ]);
  }
  if (request.role === "implement" && task.candidates.length > 0) {
    return ineligibleRolePolicy("Implement is immutable after an integration candidate exists.", [
      `Integration candidates retained: ${task.candidates.length}.`,
    ]);
  }
  if (
    request.role === "implement" &&
    task.workPackages.some((workPackage) =>
      ["running", "failed", "ready_for_integration", "integrated"].includes(workPackage.status),
    )
  ) {
    return ineligibleRolePolicy("Implement has retained implementation work and is no longer mutable.", [
      "An implementation work package is retained on the task.",
    ]);
  }
  if (
    request.role === "repair" &&
    ((task.runs ?? []).some((run) => run.role === "repair" || run.kind === "repair") ||
      (task.automaticRepairCycles !== undefined && task.automaticRepairCycles > 0) ||
      (task.reviewRetries?.length ?? 0) > 0)
  ) {
    return ineligibleRolePolicy("Repair is immutable after repair evidence or lineage exists.", [
      "A repair run, retry, or repair lineage is retained.",
    ]);
  }
  if (request.role === "repair" && task.currentStage === "approval") {
    return ineligibleRolePolicy("The workflow has reached Human Approval; Repair is no longer mutable.", [
      "Current stage: approval.",
    ]);
  }

  const currentIndex = workflowStages.findIndex((stage) => stage.id === task.currentStage);
  const roleIndex = workflowStages.findIndex((stage) => stage.id === request.role);
  if (request.role !== "repair" && (currentIndex < 0 || roleIndex < 0 || roleIndex <= currentIndex)) {
    return ineligibleRolePolicy(`The ${request.role} stage has already been reached or passed.`, [
      `Current stage: ${task.currentStage}.`,
      `Requested role: ${request.role}.`,
    ]);
  }
  return {
    eligible: true,
    rationale: "The selected role remains future and the requested policy is a trusted task-snapshot change.",
    evidence: [
      `Task ${task.id} authority is bound to the current repository revision.`,
      `The ${request.role} role has no retained execution evidence.`,
    ],
  };
}

export function rolePolicyOptionsForProposal(
  activeTask: RuntimeTask | null,
  targetTaskId: string,
  targetTaskLoaded: boolean,
  runtimeStatus: RuntimeStatus | null,
): RolePolicyFormOptions {
  const models = runtimeStatus?.catalog?.models ?? [];
  const allowedModels = runtimeStatus?.settings?.allowedModels ?? [];
  const targetTask = targetTaskLoaded && activeTask?.id === targetTaskId ? activeTask : null;
  if (targetTask) {
    return {
      models,
      allowedModels,
      currentPolicies: targetTask.agentConfig?.stagePolicies,
      resolveEligibility: (request) => projectRolePolicyEligibility(targetTask, request, runtimeStatus),
    };
  }
  return {
    models,
    allowedModels,
    resolveEligibility: () =>
      ineligibleRolePolicy("The proposal target task is not active and freshly loaded.", [
        `Target task: ${targetTaskId}.`,
        `Active task: ${activeTask?.id ?? "none"}.`,
      ]),
  };
}

function ineligibleRolePolicy(rationale: string, evidence: string[]): EligibilityEvidence {
  return { eligible: false, rationale, evidence };
}

function clientActiveRoleFor(task: RuntimeTask): string | null {
  const activeKind = task.activeRunKind;
  if (!activeKind) return null;
  if (activeKind === "repair") return "repair";
  if (activeKind === "implementation") return "implement";
  if (companionPolicyRoleIds.includes(activeKind as (typeof companionPolicyRoleIds)[number]))
    return activeKind;
  return workflowStages.some((stage) => stage.id === task.currentStage) ? task.currentStage : null;
}

function stageLabel(stage: StageId | CompanionGateStage) {
  return workflowStages.find((stageInfo) => stageInfo.id === stage)?.label ?? stage;
}

function suggestedRolePolicy(
  intent: Extract<CompanionIntent, { kind: "change-role-model" }>,
  task: RuntimeTask,
  runtimeStatus: RuntimeStatus | null,
) {
  const current = task.agentConfig?.stagePolicies?.[intent.role];
  const allowedModels = runtimeStatus?.settings?.allowedModels ?? [];
  const catalog = runtimeStatus?.catalog?.models ?? [];
  const editable = catalog.filter((model) => model.editable && allowedModels.includes(model.id));
  const recommended =
    editable.find((model) => model.id !== current?.model && /sol/i.test(model.id)) ??
    editable.find((model) => model.id !== current?.model);
  const model = intent.model ?? recommended?.id ?? null;
  const selected = catalog.find((option) => option.id === model);
  const reasoning =
    intent.reasoning ??
    (selected?.reasoningLevels.includes("high")
      ? "high"
      : (selected?.defaultReasoning ?? (model === current?.model ? current.reasoning : null)));
  return { model, reasoning };
}

function companionFailure(error: unknown): {
  code: ProposalFailureCode;
  reason: string;
} {
  const knownCodes: ProposalFailureCode[] = [
    "stale-csrf",
    "unauthorized",
    "repository-authority",
    "stale-candidate",
    "invalid-policy",
    "ineligible",
    "unknown",
  ];
  const apiError = error instanceof RuntimeApiError ? error : null;
  const code =
    apiError?.code && knownCodes.includes(apiError.code as ProposalFailureCode)
      ? (apiError.code as ProposalFailureCode)
      : apiError?.status === 403
        ? "stale-csrf"
        : "unknown";
  const evidence = apiError?.evidence ?? [];
  const reason = [
    error instanceof Error ? error.message : "The server denied this companion action.",
    ...evidence,
  ]
    .filter((item, index, values) => item && values.indexOf(item) === index)
    .join(" ");
  return { code, reason };
}
