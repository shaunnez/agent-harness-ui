import path from "node:path";
import { activity, completeGrillSession, now, zeroUsage } from "./orchestrator-stage-support.mjs";

const DIRECTIONS = [
  { generator: "claude-design", provider: "claude", title: "Claude Design direction" },
  { generator: "codex-design", provider: "codex", title: "Codex Design direction" },
];

function publicPreviewUrl(taskId, variant) {
  return (
    variant.externalUrl ??
    `/api/tasks/${encodeURIComponent(taskId)}/designs/${encodeURIComponent(variant.id)}/preview`
  );
}

function variantRecord(direction, revision) {
  return {
    id: crypto.randomUUID(),
    revision,
    generator: direction.generator,
    provider: direction.provider,
    status: "queued",
    title: direction.title,
    summary: "",
    designContract: "",
    previewUrl: null,
    externalUrl: null,
    bundlePath: null,
    bundleHash: null,
    model: null,
    reasoning: null,
    createdAt: now(),
    completedAt: null,
    error: null,
    usage: zeroUsage(),
    contextManifest: null,
  };
}

function newestRevision(variants) {
  return Math.max(0, ...(variants ?? []).map((item) => item.revision));
}

function activeVariants(designRequest) {
  const variants = designRequest?.variants ?? [];
  return DIRECTIONS.map(
    (direction) =>
      variants
        .filter((item) => item.generator === direction.generator)
        .sort((left, right) => right.revision - left.revision)[0],
  ).filter(Boolean);
}

function accumulateUsage(task, usage) {
  task.usage ??= zeroUsage();
  for (const key of ["inputTokens", "cachedInputTokens", "cacheWriteTokens", "outputTokens", "totalTokens"]) {
    task.usage[key] = (task.usage[key] ?? 0) + (usage?.[key] ?? 0);
  }
  if (usage?.cost != null) task.usage.cost = (task.usage.cost ?? 0) + usage.cost;
  if (usage?.credits != null) task.usage.credits = (task.usage.credits ?? 0) + usage.credits;
}

export class PrototypeDesignOrchestrator {
  constructor({ store, active, generatePrototype, startSpecification }) {
    this._store = store;
    this._active = active;
    this._generatePrototype = generatePrototype;
    this._startSpecification = startSpecification;
  }

  async startAfterGrill(id, { acceptRemaining = false, source = null } = {}) {
    if (source !== "operator") throw new Error("Finishing Grill requires an explicit operator action.");
    if (this._active.has(id)) throw new Error("Task is already running.");
    const controller = new AbortController();
    const reservation = { controller, kind: "design", promise: null };
    this._active.set(id, reservation);
    try {
      const reserved = await this._store.transition(
        id,
        (draft) => {
          if (draft.status !== "awaiting-grill" || draft.grillSession?.status !== "open") {
            throw new Error("This task does not have an open Grill Me session.");
          }
          if (draft.grillSession.questions.some((question) => !question.answer) && !acceptRemaining) {
            throw new Error("Answer every Grill question or explicitly accept the recommended assumptions.");
          }
          return draft.designRequest?.requested === true;
        },
        (draft) => {
          completeGrillSession(draft, { source: "operator", acceptRemaining });
          this._reserve(draft);
        },
      );
      if (!reserved) throw new Error("Task does not request design prototypes.");
    } catch (error) {
      this._active.delete(id);
      throw error;
    }
    const promise = this.run(id, controller.signal).finally(() => {
      if (this._active.get(id) === reservation) this._active.delete(id);
    });
    reservation.promise = promise;
    return { started: true, designStarted: true };
  }

  async runWithinInvestigation(id, signal) {
    await this._store.update(id, (draft) => this._reserve(draft));
    return this.run(id, signal);
  }

  _reserve(draft) {
    const revision = Math.max(0, ...(draft.designRequest?.variants ?? []).map((item) => item.revision)) + 1;
    draft.designRequest.status = "generating";
    draft.designRequest.startedAt = now();
    draft.designRequest.completedAt = null;
    draft.designRequest.selectedVariantId = null;
    draft.designRequest.selectedAt = null;
    draft.designRequest.selectedBy = null;
    draft.designRequest.error = null;
    draft.designRequest.variants.push(...DIRECTIONS.map((direction) => variantRecord(direction, revision)));
    draft.status = "generating-designs";
    draft.currentStage = "specification";
    draft.activeRunKind = "design";
    draft.activeRunReservationId = null;
    draft.error = null;
    draft.events.push(
      activity(
        "specification",
        "Design exploration started",
        "Claude Design and Codex Design are generating two independent prototype revisions.",
        "info",
        "agent",
      ),
    );
  }

  async run(id, signal) {
    const task = await this._store.get(id);
    const variants = activeVariants(task.designRequest).filter((variant) => variant.status === "queued");
    const outcomes = await Promise.allSettled(
      variants.map(async (variant) => {
        await this._store.update(id, (draft) => {
          const target = draft.designRequest.variants.find((item) => item.id === variant.id);
          if (target) target.status = "generating";
        });
        const bundlePath = path.join(this._store.dataDirectory(), "prototypes", id, variant.id);
        const result = await this._generatePrototype({ task, variant, bundlePath, signal });
        await this._store.update(id, (draft) => {
          const target = draft.designRequest.variants.find((item) => item.id === variant.id);
          if (!target) return;
          Object.assign(target, result, {
            status: "ready",
            bundlePath,
            completedAt: now(),
          });
          accumulateUsage(draft, target.usage);
          target.previewUrl = publicPreviewUrl(id, target);
        });
        return variant.id;
      }),
    );
    await this._store.update(id, (draft) => {
      outcomes.forEach((outcome, index) => {
        if (outcome.status === "fulfilled") return;
        const target = draft.designRequest.variants.find((item) => item.id === variants[index].id);
        if (!target) return;
        target.status = "failed";
        target.error = outcome.reason?.message ?? String(outcome.reason);
        target.completedAt = now();
      });
      const currentVariants = activeVariants(draft.designRequest);
      const ready = currentVariants.filter((variant) => variant.status === "ready");
      draft.activeRunKind = null;
      draft.activeRunReservationId = null;
      draft.designRequest.completedAt = now();
      if (signal.aborted) {
        draft.designRequest.status = "failed";
        draft.designRequest.error = "Design generation was cancelled by the operator.";
        draft.status = "cancelled";
        draft.error = draft.designRequest.error;
        draft.events.push(
          activity("specification", "Design exploration cancelled", draft.error, "warning", "decision"),
        );
      } else if (ready.length === DIRECTIONS.length) {
        draft.designRequest.status = "awaiting-selection";
        draft.status = "awaiting-design-selection";
        draft.error = null;
        draft.events.push(
          activity(
            "specification",
            "Two design prototypes ready",
            "Compare both retained revisions and select one before Task Spec starts.",
            "success",
            "artifact",
          ),
        );
      } else {
        const detail = currentVariants
          .filter((variant) => variant.error)
          .map((variant) => `${variant.generator}: ${variant.error}`)
          .join(" ");
        draft.designRequest.status = "failed";
        draft.designRequest.error = detail || "Both prototype variants are required before selection.";
        draft.status = "failed";
        draft.error = draft.designRequest.error;
        draft.events.push(
          activity("specification", "Design exploration failed", draft.error, "danger", "agent"),
        );
      }
    });
  }

  async retry(id, { source = null } = {}) {
    if (source !== "operator") throw new Error("Retrying design requires an explicit operator action.");
    if (this._active.has(id)) throw new Error("Task is already running.");
    const task = await this._store.get(id);
    if (task?.designRequest?.status !== "failed") throw new Error("Design generation is not awaiting retry.");
    const controller = new AbortController();
    const reservation = { controller, kind: "design", promise: null };
    this._active.set(id, reservation);
    try {
      await this._store.update(id, (draft) => {
        const failedDirections = activeVariants(draft.designRequest)
          .filter((variant) => variant.status === "failed")
          .map((variant) => DIRECTIONS.find((direction) => direction.generator === variant.generator))
          .filter(Boolean);
        if (failedDirections.length === 0)
          throw new Error("No failed design direction is available to retry.");
        const nextRevision = newestRevision(draft.designRequest.variants) + 1;
        draft.designRequest.status = "generating";
        draft.designRequest.startedAt = now();
        draft.designRequest.completedAt = null;
        draft.designRequest.selectedVariantId = null;
        draft.designRequest.selectedAt = null;
        draft.designRequest.selectedBy = null;
        draft.designRequest.error = null;
        draft.designRequest.variants.push(
          ...failedDirections.map((direction) => variantRecord(direction, nextRevision)),
        );
        draft.status = "generating-designs";
        draft.currentStage = "specification";
        draft.activeRunKind = "design";
        draft.activeRunReservationId = null;
        draft.error = null;
        draft.events.push(
          activity(
            "specification",
            "Failed design direction retry started",
            `${failedDirections.map((direction) => direction.title).join(" and ")} will run again; completed provider evidence is retained.`,
            "info",
            "agent",
          ),
        );
      });
    } catch (error) {
      this._active.delete(id);
      throw error;
    }
    const promise = this.run(id, controller.signal).finally(() => {
      if (this._active.get(id) === reservation) this._active.delete(id);
    });
    reservation.promise = promise;
    return { started: true };
  }

  async select(id, variantId, { source = null } = {}) {
    if (source !== "operator") throw new Error("Selecting a design requires an explicit operator action.");
    const started = await this._startSpecification(id, {
      canStart: (draft) => {
        const currentVariants = activeVariants(draft.designRequest);
        const variant = currentVariants.find((item) => item.id === variantId);
        if (
          draft.status !== "awaiting-design-selection" ||
          draft.designRequest?.status !== "awaiting-selection"
        ) {
          throw new Error("This task is not awaiting a design selection.");
        }
        if (variant?.status !== "ready") throw new Error("Select a completed prototype revision.");
        return true;
      },
      onReserve: (draft) => {
        const selected = draft.designRequest.variants.find((item) => item.id === variantId);
        draft.designRequest.status = "selected";
        draft.designRequest.selectedVariantId = selected.id;
        draft.designRequest.selectedAt = now();
        draft.designRequest.selectedBy = "operator";
        draft.events.push(
          activity(
            "specification",
            "Design prototype selected",
            `${selected.title} revision ${selected.revision} is now an exact downstream input.`,
            "success",
            "decision",
            { prototypeVariantId: selected.id },
          ),
        );
      },
    });
    if (!started) throw new Error("Task is already running.");
    return { started: true };
  }
}
