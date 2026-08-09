import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import {
  defaultRuntimeSettings,
  enrichUsage,
  normalizeModelId,
  providerForModelId,
  resolveTaskProvider,
} from "./model-catalog.mjs";
import {
  CANONICAL_RUN_STAGES,
  DEFAULT_STAGE_RUN_LIMIT,
  interruptActiveRuns,
  migrateRunActivityState,
  retainRunActivityEvents,
  TASK_STORE_SCHEMA_VERSION,
} from "./run-activity.mjs";
import { migratedStandardProfile } from "./workflow-profiles.mjs";

const EMPTY_STATE = {
  schemaVersion: TASK_STORE_SCHEMA_VERSION,
  nextId: 1,
  tasks: [],
  settings: defaultRuntimeSettings(),
};

function clone(value) {
  return structuredClone(value);
}

function repriceTaskUsage(task, settings) {
  let inputTokens = 0;
  let cachedInputTokens = 0;
  let cacheWriteTokens = 0;
  let outputTokens = 0;
  let taskCost = 0;
  let hasTaskCost = false;
  let taskCredits = 0;
  let hasTaskCredits = false;
  for (const artifact of task.artifacts ?? []) {
    const artifactModel = artifact.model == null ? null : normalizeModelId(artifact.model);
    artifact.model = artifactModel;
    artifact.usage = artifactModel
      ? enrichUsage(
          artifactModel,
          artifact.usage,
          settings.pricing?.rates,
          settings.pricing?.version,
        )
      : normalizeHarnessUsage(artifact.usage, settings.pricing?.version);
    inputTokens += artifact.usage.inputTokens;
    cachedInputTokens += artifact.usage.cachedInputTokens;
    cacheWriteTokens += artifact.usage.cacheWriteTokens ?? 0;
    outputTokens += artifact.usage.outputTokens;
    if (artifact.usage.cost != null) {
      taskCost += artifact.usage.cost;
      hasTaskCost = true;
    }
    if (artifact.usage.credits != null) {
      taskCredits += artifact.usage.credits;
      hasTaskCredits = true;
    }
  }
  task.usage = {
    inputTokens,
    cachedInputTokens,
    cacheWriteTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    cost: hasTaskCost ? roundUsageTotal(taskCost) : null,
    credits: hasTaskCredits ? roundUsageTotal(taskCredits) : null,
    pricingVersion: settings.pricing?.version ?? null,
  };
}

function normalizeHarnessUsage(usage, pricingVersion) {
  const inputTokens = Number.isFinite(usage?.inputTokens) ? usage.inputTokens : 0;
  const cachedInputTokens = Number.isFinite(usage?.cachedInputTokens) ? usage.cachedInputTokens : 0;
  const cacheWriteTokens = Number.isFinite(usage?.cacheWriteTokens) ? usage.cacheWriteTokens : 0;
  const outputTokens = Number.isFinite(usage?.outputTokens) ? usage.outputTokens : 0;
  return {
    inputTokens,
    cachedInputTokens,
    cacheWriteTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    cost: null,
    credits: null,
    pricingVersion: pricingVersion ?? null,
  };
}

function roundUsageTotal(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export class JsonTaskStore {
  #filePath;
  #queue = Promise.resolve();
  #state = null;

  constructor(filePath) {
    this.#filePath = filePath;
  }

  dataDirectory() {
    return path.dirname(this.#filePath);
  }

  async init() {
    await mkdir(path.dirname(this.#filePath), { recursive: true });
    try {
      this.#state = JSON.parse(await readFile(this.#filePath, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      this.#state = clone(EMPTY_STATE);
      await this.#write(EMPTY_STATE);
    }
    await this.recoverInterrupted();
  }

  async list() {
    return clone(this.#state.tasks).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async get(id) {
    const task = this.#state.tasks.find((item) => item.id === id);
    return task ? clone(task) : null;
  }

  async settings() {
    return clone(this.#state.settings);
  }

  async updateSettings(updater) {
    return this.#mutate((state) => {
      updater(state.settings);
      return state.settings;
    });
  }

  async create(input) {
    return this.#mutate((state) => createTaskRecord(state, input));
  }

  async update(id, updater) {
    return this.#mutate((state) => {
      const task = state.tasks.find((item) => item.id === id);
      if (!task) return null;
      updater(task);
      task.updatedAt = new Date().toISOString();
      task.events = retainRunActivityEvents(task.events);
      return task;
    });
  }

  async transition(id, condition, updater) {
    return this.#mutate((state) => {
      const task = state.tasks.find((item) => item.id === id);
      if (!task) return null;
      if (!condition(task)) {
        const error = new Error("Task state changed before the requested action could be reserved.");
        error.code = "TASK_TRANSITION_CONFLICT";
        error.statusCode = 409;
        throw error;
      }
      updater(task);
      task.updatedAt = new Date().toISOString();
      task.events = retainRunActivityEvents(task.events);
      return task;
    });
  }

  async recoverInterrupted() {
    return this.#mutate(migratePersistedTaskState);
  }

  async #write(state) {
    for (const task of state.tasks ?? []) {
      task.events = retainRunActivityEvents(task.events);
    }
    const temporaryPath = `${this.#filePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await renameWithRetry(temporaryPath, this.#filePath);
  }

  #mutate(operation) {
    const run = async () => {
      const state = clone(this.#state);
      const result = operation(state);
      await this.#write(state);
      this.#state = state;
      return clone(result);
    };
    const pending = this.#queue.then(run, run);
    this.#queue = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }
}

function configuredModels(stagePolicies) {
  const models = [...new Set(Object.values(stagePolicies ?? {}).map((policy) => normalizeModelId(policy?.model)).filter(Boolean))];
  return (models.length ? models : ["gpt-5.6-luna"]).map((model) => ({
    provider: providerForModelId(model) === "claude" ? "anthropic" : "openai",
    model,
  }));
}

export function migratePersistedTaskState(state) {
  const now = new Date().toISOString();
  let changed = migrateRunActivityState(state);
  if (!state.settings) {
    state.settings = defaultRuntimeSettings();
    changed = true;
  } else {
    const defaults = defaultRuntimeSettings();
    for (const [key, value] of Object.entries(defaults)) {
      if (state.settings[key] === undefined) {
        state.settings[key] = clone(value);
        changed = true;
      }
    }
    if (!state.settings.pricing?.creditRates) {
      state.settings.pricing.creditRates = clone(defaults.pricing.creditRates);
      changed = true;
    }
    if (!state.settings.pricing?.creditSourceUrl) {
      state.settings.pricing.creditSourceUrl = defaults.pricing.creditSourceUrl;
      changed = true;
    }
  }
  for (const task of state.tasks) {
    for (const [key, fallback] of [
      ["activeRunKind", null],
      ["activeRunReservationId", null],
      ["activeRunIds", []],
      ["attachments", []],
      ["closure", null],
      ["archive", null],
      ["evaluation", null],
      ["experiment", null],
      ["mergeIntent", null],
      ["blocker", null],
      ["scoutDispatch", null],
      ["stageDispositions", {}],
      ["reviewRetries", []],
      ["automaticRepairCycles", 0],
      ["sameCandidateTestRetries", []],
      ["attemptsByStage", {}],
      ["stageRunReservations", {}],
      ["decisions", []],
      ["grillSession", null],
      ["approvals", []],
      ["workPackages", []],
      ["candidates", []],
      ["runs", []],
    ]) {
      if (task[key] === undefined) {
        task[key] = clone(fallback);
        changed = true;
      }
    }
    if (!task.workflowProfile) {
      task.workflowProfile = migratedStandardProfile();
      changed = true;
    }
    if (task.grillPolicy === undefined) {
      task.grillPolicy = "manual";
      changed = true;
    }
    if (task.grillSession && task.grillSession.policySnapshot === undefined) {
      task.grillSession.policySnapshot = task.grillPolicy;
      task.grillSession.acceptedRecommendationCount = task.grillSession.questions
        .filter((question) => question.answerSource === "accepted-assumption").length;
      task.grillSession.completionSource = task.grillSession.status === "completed"
        ? task.grillSession.questions.length === 0
          ? "no-questions"
          : "legacy-unverified"
        : null;
      changed = true;
    }
    const taskModel = normalizeModelId(task.agentConfig?.model ?? task.models?.[0]?.model ?? state.settings.defaultModel);
    if (!task.agentConfig) {
      task.agentConfig = {
        model: taskModel,
        reasoning: state.settings.defaultReasoning ?? "xhigh",
        stagePolicies: clone(state.settings.stagePolicies),
      };
      changed = true;
    }
    if (![1, 2].includes(task.agentConfig.policySnapshotVersion)) {
      task.agentConfig.stagePolicies = Object.fromEntries(
        Object.keys(state.settings.stagePolicies).map((policyId) => [
          policyId,
          { model: taskModel, reasoning: task.agentConfig.reasoning ?? state.settings.defaultReasoning },
        ]),
      );
      task.agentConfig.policySnapshotVersion = 1;
      changed = true;
    }
    if (!task.agentConfig.profileStagePolicies) {
      task.agentConfig.profileStagePolicies = clone(state.settings.profileStagePolicies);
      task.agentConfig.profileStagePolicies.standard = clone(task.agentConfig.stagePolicies);
      task.agentConfig.policySnapshotVersion = 2;
      changed = true;
    }
    const configured = configuredModels(task.agentConfig.stagePolicies);
    if (JSON.stringify(task.models) !== JSON.stringify(configured)) {
      task.models = configured;
      changed = true;
    }
    for (const artifact of task.artifacts ?? []) {
      if (artifact.reasoning === undefined) {
        artifact.reasoning = null;
        changed = true;
      }
    }
    const usageSnapshot = JSON.stringify({
      usage: task.usage,
      artifacts: task.artifacts?.map((artifact) => ({ model: artifact.model, usage: artifact.usage })),
    });
    repriceTaskUsage(task, state.settings);
    if (JSON.stringify({
      usage: task.usage,
      artifacts: task.artifacts?.map((artifact) => ({ model: artifact.model, usage: artifact.usage })),
    }) !== usageSnapshot) changed = true;
    if (task.status === "awaiting-approval") {
      task.status = "awaiting-spec-approval";
      changed = true;
    }
    if (task.status === "completed") {
      const activeCandidate = task.candidates?.at(-1);
      const explicitlyPromoted = (task.approvals ?? []).some((approval) => approval.stage === "promotion");
      if (activeCandidate?.status === "merged" && !explicitlyPromoted) {
        task.status = "merged-to-target";
        changed = true;
      }
    }
    if (!Object.keys(task.attemptsByStage).length && task.stageRun > 0) {
      task.attemptsByStage[task.currentStage] = task.stageRun;
      changed = true;
    }
    if (task.status !== "running") continue;
    changed = true;
    task.status = "failed";
    task.activeRunKind = null;
    task.activeRunReservationId = null;
    task.error = "The local harness stopped while this task was running. Start it again to retry the stage.";
    interruptActiveRuns(task, now, task.error);
    task.updatedAt = now;
    const interruptedRun = [...task.runs].reverse().find((run) => run.status === "interrupted");
    task.events.push({
      id: crypto.randomUUID(),
      at: now,
      category: "activity",
      tone: "danger",
      stage: task.currentStage,
      title: "Run interrupted",
      detail: task.error,
      ...(interruptedRun
        ? {
            runId: interruptedRun.id,
            runKind: interruptedRun.kind,
            role: interruptedRun.role,
            model: interruptedRun.model,
            reasoning: interruptedRun.reasoning,
            startedAt: interruptedRun.startedAt,
            completedAt: interruptedRun.completedAt,
            durationMs: interruptedRun.durationMs,
          }
        : {}),
    });
  }
  return changed;
}

export function createTaskRecord(state, input) {
  const now = new Date().toISOString();
  const profileStagePolicies = clone(input.profileStagePolicies ?? state.settings.profileStagePolicies);
  const workflowProfile = clone(input.workflowProfile ?? migratedStandardProfile());
  const stagePolicies = clone(
    input.stagePolicies
      ?? profileStagePolicies?.[workflowProfile.selected]
      ?? state.settings.stagePolicies,
  );
  const model = normalizeModelId(input.model ?? state.settings.defaultModel);
  const provider = resolveTaskProvider(stagePolicies, model, input.provider ?? null);
  const continuation = clone(input.continuation ?? null);
  const importedArtifacts = clone(continuation?.artifacts ?? []);
  const importedDecisions = clone(continuation?.decisions ?? []);
  const importedStages = ["triage", "scouts", "grill", "specification"];
  const task = {
    id: `AH-${String(state.nextId).padStart(3, "0")}`,
    title: input.title,
    description: input.description,
    repositoryPath: input.repositoryPath,
    workflow: input.workflow,
    continuedFromTaskId: continuation?.sourceTaskId ?? null,
    continuedByTaskId: null,
    priority: input.priority,
    grillPolicy: input.grillPolicy ?? state.settings.grillPolicy ?? "manual",
    agentConfig: {
      provider,
      model,
      reasoning: input.reasoning ?? state.settings.defaultReasoning,
      stagePolicies,
      profileStagePolicies,
      policySnapshotVersion: 2,
    },
    attachments: clone(continuation?.attachments ?? []),
    closure: null,
    archive: null,
    evaluation: null,
    experiment: clone(input.experiment ?? null),
    mergeIntent: null,
    blocker: null,
    scoutDispatch: clone(continuation?.scoutDispatch ?? null),
    workflowProfile,
    stageDispositions: clone(continuation?.stageDispositions ?? {}),
    reviewRetries: [],
    automaticRepairCycles: 0,
    sameCandidateTestRetries: [],
    status: continuation ? "awaiting-plan-approval" : "queued",
    currentStage: continuation ? "plan" : "triage",
    completedStages: continuation ? importedStages : [],
    stageRun: 0,
    stageRunLimit: DEFAULT_STAGE_RUN_LIMIT,
    stageRunLimits: Object.fromEntries(
      CANONICAL_RUN_STAGES.map((stage) => [stage, DEFAULT_STAGE_RUN_LIMIT]),
    ),
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
    error: null,
    activeRunKind: null,
    activeRunReservationId: null,
    activeRunIds: [],
    attemptsByStage: {},
    stageRunReservations: {},
    models: configuredModels(stagePolicies),
    usage: enrichUsage(model, {}),
    artifacts: importedArtifacts,
    decisions: importedDecisions,
    grillSession: clone(continuation?.grillSession ?? null),
    approvals: continuation
      ? [{
          id: crypto.randomUUID(),
          stage: "specification",
          note: `Imported approved investigation handoff from ${continuation.sourceTaskId}.`,
          createdAt: continuation.sourceApprovedAt,
          sourceTaskId: continuation.sourceTaskId,
          sourceApprovalId: continuation.sourceApprovalId,
        }]
      : [],
    workPackages: [],
    candidates: [],
    runs: [],
    events: [
      {
        id: crypto.randomUUID(),
        at: now,
        category: "activity",
        tone: "info",
        stage: continuation ? "plan" : "triage",
        title: continuation ? "Implementation continuation created" : "Task created",
        detail: continuation
          ? `Approved investigation evidence imported from ${continuation.sourceTaskId}. Read-only planning is ready to start.`
          : "Ready to start with the local Codex runtime.",
      },
    ],
  };
  state.nextId += 1;
  state.tasks.push(task);
  return task;
}

async function renameWithRetry(sourcePath, targetPath) {
  const retryableCodes = new Set(["EPERM", "EACCES", "EBUSY"]);
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await rename(sourcePath, targetPath);
      return;
    } catch (error) {
      if (!retryableCodes.has(error?.code) || attempt === maxAttempts) {
        throw error;
      }
      await delay(25 * attempt);
    }
  }
}
