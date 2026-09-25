import type { WorkspaceChange, WorkspaceHead, WorkspaceHistoryPage } from "../../domain/workspace-history.ts";
import type { TaskSummary } from "./contracts.ts";
import { stageLabels } from "./presentation.ts";

export interface WorldFeedback {
  id: string;
  fact: WorkspaceChange;
  kind: NonNullable<WorkspaceChange["transition"]> | "artifact-arrived";
  receivedAt: number;
  expiresAt: number;
  title: string;
  detail: string;
}
export const feedbackLifetime = 14_000;
export function feedbackFor(fact: WorkspaceChange, sourceId: string, now: number): WorldFeedback | null {
  const kind = fact.kind === "artifact-arrived" ? "artifact-arrived" : fact.transition;
  if (!kind || now - Date.parse(fact.observedAt) > 5000 || !Number.isFinite(Date.parse(fact.observedAt)))
    return null;
  const title =
    kind === "task-created"
      ? "Task arrived"
      : kind === "task-completed"
        ? "Task completed"
        : kind === "repair-started"
          ? "Repair started"
          : kind === "artifact-arrived"
            ? "Artifact ready"
            : kind === "attention"
              ? fact.label
              : `Moved to ${stageLabels[fact.stage]}`;
  const detail =
    kind === "stage-advanced" && fact.fromStage
      ? `${stageLabels[fact.fromStage]} → ${stageLabels[fact.stage]}`
      : kind === "repair-started"
        ? "Returning to Implement"
        : kind === "artifact-arrived"
          ? fact.label
          : (fact.reason ?? fact.taskTitle);
  return {
    id: `${sourceId}:${fact.sequence}`,
    fact,
    kind,
    title,
    detail,
    receivedAt: now,
    expiresAt: now + feedbackLifetime,
  };
}

export function currentFeedback(effect: WorldFeedback, tasks: TaskSummary[], now: number) {
  const task = tasks.find((item) => item.id === effect.fact.taskId);
  if (!task || effect.expiresAt <= now) return false;
  if (
    effect.fact.candidateId &&
    (task.candidates?.at(-1)?.id !== effect.fact.candidateId ||
      task.candidates?.at(-1)?.revisionNumber !== effect.fact.candidateRevision)
  )
    return false;
  if (effect.kind === "artifact-arrived") return true;
  if (
    effect.kind === "repair-started" &&
    (task.activeRunKind !== "repair" || task.activeRunReservationId !== effect.fact.reservationId)
  )
    return false;
  return task.currentStage === effect.fact.stage && task.status === effect.fact.status;
}

/** Cursor belongs to this viewing session, independently of briefing pagination. */
export class WorldFeedbackCursor {
  private source: string | null = null;
  private after = 0;
  private ready = false;
  reset() {
    this.ready = false;
  }
  request(head: WorkspaceHead, baseline: boolean) {
    if (
      baseline ||
      !this.ready ||
      this.source !== head.sourceId ||
      head.upper < this.after ||
      this.after < head.floor ||
      head.upper - this.after > 100 ||
      !head.available
    ) {
      this.source = head.sourceId;
      this.after = head.upper;
      this.ready = head.available;
      return null;
    }
    if (!head.sourceId || head.upper === this.after) return null;
    return { sourceId: head.sourceId, after: this.after, through: head.upper, limit: 100 };
  }
  accept(page: WorkspaceHistoryPage, now: number) {
    if (!this.ready || page.sourceId !== this.source || page.after !== this.after) return [];
    this.after = page.through;
    if (!page.coverage.complete || page.nextCursor) return [];
    const byTask = new Map<string, WorldFeedback>();
    for (const fact of [...page.items].sort((a, b) => a.sequence - b.sequence)) {
      if (fact.sequence <= page.after || fact.sequence > page.through) continue;
      const effect = feedbackFor(fact, page.sourceId, now);
      if (effect) {
        const previous = byTask.get(fact.taskId);
        // A handoff often creates an artifact in the same commit: preserve the journey.
        if (effect.kind === "artifact-arrived" && previous && previous.kind !== "artifact-arrived") continue;
        byTask.set(fact.taskId, effect);
      }
    }
    return [...byTask.values()].slice(-8);
  }
}
