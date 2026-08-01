import { buildStagePrompt, getStageMetadata, REAL_PIPELINE } from "./prompts.mjs";
import { getCodexStatus, runCodex } from "./codex-runtime.mjs";

function now() {
  return new Date().toISOString();
}

function activity(stage, title, detail, tone = "info", category = "activity") {
  return { id: crypto.randomUUID(), at: now(), category, tone, stage, title, detail };
}

export class TaskOrchestrator {
  #store;
  #active = new Map();
  #runCodex;
  #getStatus;

  constructor(store, options = {}) {
    this.#store = store;
    this.#runCodex = options.runCodex ?? runCodex;
    this.#getStatus = options.getStatus ?? getCodexStatus;
  }

  status() {
    return this.#getStatus();
  }

  isRunning(id) {
    return this.#active.has(id);
  }

  start(id) {
    if (this.#active.has(id)) return false;
    const controller = new AbortController();
    const promise = this.#run(id, controller.signal).finally(() => this.#active.delete(id));
    this.#active.set(id, { controller, promise });
    return true;
  }

  cancel(id) {
    const active = this.#active.get(id);
    if (!active) return false;
    active.controller.abort();
    return true;
  }

  async #run(id, signal) {
    let task = await this.#store.get(id);
    if (!task) return;
    const resumeIndex = Math.max(0, REAL_PIPELINE.indexOf(task.currentStage));
    const stages = task.status === "failed" ? REAL_PIPELINE.slice(resumeIndex) : REAL_PIPELINE;

    await this.#store.update(id, (draft) => {
      draft.status = "running";
      draft.error = null;
      draft.startedAt ??= now();
      draft.stageRun += 1;
      draft.events.push(activity(draft.currentStage, "Workflow started", "Using the local ChatGPT-authenticated Codex CLI.", "info", "agent"));
    });

    try {
      for (const stageId of stages) {
        if (signal.aborted) throw new Error("Codex run cancelled.");
        task = await this.#store.get(id);
        const metadata = getStageMetadata(stageId);
        await this.#store.update(id, (draft) => {
          draft.currentStage = stageId;
          draft.events.push(activity(stageId, `${metadata.label} agent started`, `Reading ${draft.repositoryPath}`, "info", "agent"));
        });

        const runtimeEvents = [];
        const result = await this.#runCodex({
          cwd: task.repositoryPath,
          prompt: buildStagePrompt(task, stageId),
          signal,
          onEvent(event) {
            if (event.type === "activity") runtimeEvents.push(event);
          },
        });

        await this.#store.update(id, (draft) => {
          for (const event of runtimeEvents.slice(-30)) {
            draft.events.push(activity(stageId, event.title, event.detail, event.tone, "agent"));
          }
          draft.artifacts = draft.artifacts.filter((artifact) => artifact.stage !== stageId);
          draft.artifacts.push({
            id: crypto.randomUUID(),
            stage: stageId,
            name: metadata.artifactName,
            kind: "markdown",
            content: result.finalText,
            createdAt: now(),
            model: task.models[0]?.model ?? "GPT-5.4-mini · ChatGPT plan",
            usage: result.usage,
          });
          if (!draft.completedStages.includes(stageId)) draft.completedStages.push(stageId);
          for (const key of ["inputTokens", "cachedInputTokens", "outputTokens", "totalTokens"]) {
            draft.usage[key] += result.usage[key] ?? 0;
          }
          draft.events.push(activity(stageId, `${metadata.label} artifact ready`, metadata.artifactName, "success", "artifact"));
        });
      }

      await this.#store.update(id, (draft) => {
        draft.status = "awaiting-approval";
        draft.currentStage = "specification";
        draft.completedAt = now();
        draft.events.push(activity("specification", "Investigation slice complete", "Review the living artifacts before implementation planning.", "success", "decision"));
      });
    } catch (error) {
      await this.#store.update(id, (draft) => {
        draft.status = signal.aborted ? "cancelled" : draft.stageRun >= draft.stageRunLimit ? "blocked" : "failed";
        draft.error = error.message;
        draft.events.push(activity(draft.currentStage, signal.aborted ? "Run cancelled" : "Stage failed", error.message, "danger"));
      });
    }
  }
}
