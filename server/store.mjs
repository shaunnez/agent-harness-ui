import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { defaultRuntimeSettings, enrichUsage, normalizeModelId, resolveTaskProvider } from "./model-catalog.mjs";
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
  const taskModel = normalizeModelId(task.agentConfig?.model ?? task.models?.[0]?.model ?? settings.defaultModel);
  let taskCost = 0;
  let hasTaskCost = false;
  for (const artifact of task.artifacts ?? []) {
    const artifactModel = normalizeModelId(artifact.model ?? taskModel);
    artifact.usage = enrichUsage(
      artifactModel,
      artifact.usage,
      settings.pricing?.rates,
      settings.pricing?.version,
    );
    if (artifact.usage.cost != null) {
      taskCost += artifact.usage.cost;
      hasTaskCost = true;
    }
  }
  const taskUsage = enrichUsage(
    taskModel,
    task.usage,
    settings.pricing?.rates,
    settings.pricing?.version,
  );
  taskUsage.cost = hasTaskCost ? Math.round(taskCost * 1_000_000) / 1_000_000 : taskUsage.cost;
  task.usage = taskUsage;
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
    return this.#mutate((state) => {
      const now = new Date().toISOString();
      const profileStagePolicies = clone(input.profileStagePolicies ?? this.#state.settings.profileStagePolicies);
      const workflowProfile = clone(input.workflowProfile ?? migratedStandardProfile());
      const stagePolicies = clone(
        input.stagePolicies
          ?? profileStagePolicies?.[workflowProfile.selected]
          ?? this.#state.settings.stagePolicies,
      );
      const model = normalizeModelId(input.model ?? this.#state.settings.defaultModel);
      const provider = resolveTaskProvider(stagePolicies, model, input.provider ?? null);
      const task = {
        id: `AH-${String(state.nextId).padStart(3, "0")}`,
        title: input.title,
        description: input.description,
        repositoryPath: input.repositoryPath,
        workflow: input.workflow,
        priority: input.priority,
        agentConfig: {
          provider,
          model,
          reasoning: input.reasoning ?? this.#state.settings.defaultReasoning,
          stagePolicies,
          profileStagePolicies,
          policySnapshotVersion: 2,
        },
        attachments: [],
        closure: null,
        archive: null,
        evaluation: null,
        experiment: clone(input.experiment ?? null),
        mergeIntent: null,
        scoutDispatch: null,
        workflowProfile,
        stageDispositions: {},
        reviewRetries: [],
        automaticRepairCycles: 0,
        status: "queued",
        currentStage: "triage",
        completedStages: [],
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
        usage: enrichUsage(normalizeModelId(input.model ?? this.#state.settings.defaultModel), {}),
        artifacts: [],
        decisions: [],
        grillSession: null,
        approvals: [],
        workPackages: [],
        candidates: [],
        runs: [],
        events: [
          {
            id: crypto.randomUUID(),
            at: now,
            category: "activity",
            tone: "info",
            stage: "triage",
            title: "Task created",
            detail: "Ready to start with the local Codex runtime.",
          },
        ],
      };
      state.nextId += 1;
      state.tasks.push(task);
      return task;
    });
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
    return this.#mutate((state) => {
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
          ["scoutDispatch", null],
          ["stageDispositions", {}],
          ["reviewRetries", []],
          ["automaticRepairCycles", 0],
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
        let taskCost = 0;
        let hasTaskCost = false;
        for (const artifact of task.artifacts ?? []) {
          const artifactModel = normalizeModelId(artifact.model ?? taskModel);
          if (artifact.model !== artifactModel) {
            artifact.model = artifactModel;
            changed = true;
          }
          if (artifact.reasoning === undefined) {
            artifact.reasoning = null;
            changed = true;
          }
          const enriched = enrichUsage(
            artifactModel,
            artifact.usage,
            state.settings.pricing?.rates,
            state.settings.pricing?.version,
          );
          if (JSON.stringify(artifact.usage) !== JSON.stringify(enriched)) {
            artifact.usage = enriched;
            changed = true;
          }
          if (enriched.cost != null) {
            taskCost += enriched.cost;
            hasTaskCost = true;
          }
        }
        const enrichedTaskUsage = enrichUsage(
          taskModel,
          { ...task.usage, cost: hasTaskCost ? taskCost : null },
          state.settings.pricing?.rates,
          state.settings.pricing?.version,
        );
        enrichedTaskUsage.cost = hasTaskCost ? Math.round(taskCost * 1_000_000) / 1_000_000 : enrichedTaskUsage.cost;
        if (JSON.stringify(task.usage) !== JSON.stringify(enrichedTaskUsage)) {
          task.usage = enrichedTaskUsage;
          changed = true;
        }
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
    });
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
  return (models.length ? models : ["gpt-5.6-luna"]).map((model) => ({ provider: "openai", model }));
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
