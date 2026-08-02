import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";

const EMPTY_STATE = { nextId: 1, tasks: [] };

function clone(value) {
  return structuredClone(value);
}

export class JsonTaskStore {
  #filePath;
  #queue = Promise.resolve();
  #state = null;

  constructor(filePath) {
    this.#filePath = filePath;
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

  async create(input) {
    return this.#mutate((state) => {
      const now = new Date().toISOString();
      const task = {
        id: `AH-${String(state.nextId).padStart(3, "0")}`,
        title: input.title,
        description: input.description,
        repositoryPath: input.repositoryPath,
        workflow: input.workflow,
        priority: input.priority,
        status: "queued",
        currentStage: "triage",
        completedStages: [],
        stageRun: 0,
        stageRunLimit: 3,
        createdAt: now,
        updatedAt: now,
        startedAt: null,
        completedAt: null,
        error: null,
        activeRunKind: null,
        attemptsByStage: {},
        models: [
          {
            provider: "openai",
            model: `${process.env.AGENT_HARNESS_MODEL ?? "GPT-5.4-mini"} · ChatGPT plan`,
          },
        ],
        usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0, cost: null },
        artifacts: [],
        decisions: [],
        grillSession: null,
        approvals: [],
        workPackages: [],
        candidates: [],
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
      task.events = task.events.slice(-250);
      return task;
    });
  }

  async recoverInterrupted() {
    return this.#mutate((state) => {
      const now = new Date().toISOString();
      let changed = false;
      for (const task of state.tasks) {
        for (const [key, fallback] of [
          ["activeRunKind", null],
          ["attemptsByStage", {}],
          ["decisions", []],
          ["grillSession", null],
          ["approvals", []],
          ["workPackages", []],
          ["candidates", []],
        ]) {
          if (task[key] === undefined) {
            task[key] = clone(fallback);
            changed = true;
          }
        }
        if (task.status === "awaiting-approval") {
          task.status = "awaiting-spec-approval";
          changed = true;
        }
        if (!Object.keys(task.attemptsByStage).length && task.stageRun > 0) {
          task.attemptsByStage[task.currentStage] = task.stageRun;
          changed = true;
        }
        if (task.models?.[0]?.model === "Codex CLI · ChatGPT plan") {
          task.models = [{ provider: "openai", model: "GPT-5.4 · ChatGPT plan" }];
          changed = true;
        }
        if (task.status !== "running") continue;
        changed = true;
        task.status = "failed";
        task.activeRunKind = null;
        task.error = "The local harness stopped while this task was running. Start it again to retry the stage.";
        task.updatedAt = now;
        task.events.push({
          id: crypto.randomUUID(),
          at: now,
          category: "activity",
          tone: "danger",
          stage: task.currentStage,
          title: "Run interrupted",
          detail: task.error,
        });
      }
      return changed;
    });
  }

  async #write(state) {
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
