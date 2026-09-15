import { ArrowLeft, ArrowRight, GlobeHemisphereWest } from "@phosphor-icons/react";
import type { RuntimeProject } from "../../domain.ts";
import type { TaskSummary } from "../runtime/contracts.ts";
import { decisionSessionView, type DecisionSession } from "../runtime/decision-session.ts";
import { attentionFor, splitRecordedDetail, stageLabels } from "../runtime/presentation.ts";

export function DecisionNavigation({
  session,
  tasks,
  projects,
  busy,
  onMove,
  onInclude,
  onReturn,
}: {
  session: DecisionSession;
  tasks: TaskSummary[];
  projects: RuntimeProject[];
  busy: boolean;
  onMove(id: string): void;
  onInclude(ids: string[]): void;
  onReturn(): void;
}) {
  const view = decisionSessionView(session, tasks),
    task = tasks.find((item) => item.id === session.selectedId);
  const project = projects.find((item) => item.repositoryPath === task?.repositoryPath);
  const attention = task ? attentionFor(task) : null;
  return (
    <section className="decision-navigation" aria-label="Decision navigation">
      <div className="decision-context">
        <strong>
          {project?.name ?? "Project unavailable"} · {task?.id ?? session.selectedId}
          {task && ` · ${stageLabels[task.currentStage]}`}
        </strong>
        <span>
          {view.state === "missing"
            ? "This task is no longer available. Your other decisions remain accessible."
            : view.state === "resolved"
              ? "This task no longer needs a decision. Review its current state or move to the next item."
              : `${splitRecordedDetail(attention?.reason).headline || attention?.label} · Next: ${attention?.nextActor ?? "Not recorded"}`}
        </span>
        <small>
          {attention?.since
            ? `Waiting since ${new Date(attention.since).toLocaleString()}`
            : "Waiting age not recorded"}{" "}
          · {view.remaining} waiting across projects
        </small>
      </div>
      <nav aria-label="Move between decisions">
        <button
          type="button"
          disabled={busy || !view.previous}
          onClick={() => view.previous && onMove(view.previous)}
        >
          <ArrowLeft size={16} />
          Previous decision
        </button>
        <button type="button" disabled={busy || !view.next} onClick={() => view.next && onMove(view.next)}>
          Next decision
          <ArrowRight size={16} />
        </button>
        {view.fresh.length > 0 && (
          <button
            type="button"
            onClick={() => onInclude([...view.ids, ...view.fresh.map((item) => item.id)])}
          >
            Include {view.fresh.length} new {view.fresh.length === 1 ? "decision" : "decisions"}
          </button>
        )}
        <button type="button" onClick={onReturn}>
          <GlobeHemisphereWest size={16} />
          Return to world
        </button>
      </nav>
    </section>
  );
}
