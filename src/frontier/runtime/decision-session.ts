import type { TaskSummary } from "./contracts.ts";
import { attentionFor, needsYou } from "./presentation.ts";

export function orderedDecisions(tasks: TaskSummary[]) {
  const severity = (task: TaskSummary) =>
    ["repair", "failed", "blocked"].includes(attentionFor(task).kind) ? 0 : 1;
  return tasks
    .filter(needsYou)
    .sort(
      (a, b) =>
        severity(a) - severity(b) ||
        (attentionFor(a).since ?? a.createdAt).localeCompare(attentionFor(b).since ?? b.createdAt) ||
        a.id.localeCompare(b.id),
    );
}
export interface DecisionSession {
  sourceId: string | null;
  ids: string[];
  selectedId: string;
  originSelectedId: string | null;
}
export function createDecisionSession(
  tasks: TaskSummary[],
  selectedId: string,
  originSelectedId: string | null,
  sourceId: string | null = null,
): DecisionSession {
  return { sourceId, ids: orderedDecisions(tasks).map((task) => task.id), selectedId, originSelectedId };
}
export function decisionSessionView(session: DecisionSession, tasks: TaskSummary[]) {
  const current = orderedDecisions(tasks),
    eligible = new Set(current.map((task) => task.id));
  const fresh = current.filter((task) => !session.ids.includes(task.id));
  // Preserve the selected item even after resolution, deletion or archival. It never jumps underneath a draft.
  const ids = session.ids.filter((id) => id === session.selectedId || eligible.has(id));
  const index = ids.indexOf(session.selectedId);
  const task = tasks.find((item) => item.id === session.selectedId);
  return {
    ids,
    index,
    previous: ids[index - 1] ?? null,
    next: ids[index + 1] ?? null,
    fresh,
    state: !task
      ? ("missing" as const)
      : eligible.has(task.id)
        ? ("waiting" as const)
        : ("resolved" as const),
    remaining: current.length,
  };
}
