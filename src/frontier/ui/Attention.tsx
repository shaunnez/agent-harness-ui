import { ArrowRight, CheckCircle, Clock, Info, Question, WarningCircle } from "@phosphor-icons/react";
import type { TaskCore, TaskSummary } from "../runtime/contracts";
import { attentionAction, attentionFor, splitRecordedDetail, stageLabels } from "../runtime/presentation";
import { ScrollArea } from "./ScrollArea";

export function AttentionIcon({ kind, size = 22 }: { kind: string; size?: number }) {
  return kind === "answer" || kind === "approval" ? (
    <Question size={size} />
  ) : ["repair", "failed", "blocked"].includes(kind) ? (
    <WarningCircle size={size} />
  ) : kind === "completed" ? (
    <CheckCircle size={size} />
  ) : kind === "running" || kind === "dependency" || kind === "external" ? (
    <Clock size={size} />
  ) : (
    <Info size={size} />
  );
}
export function Attention({
  task,
  onAction,
  connected = true,
}: {
  task: TaskSummary | TaskCore;
  onAction?: () => void;
  connected?: boolean;
}) {
  const attention = attentionFor(task);
  return (
    <section
      className={`attention-block tone-${connected ? attention.kind : "unavailable"}`}
      aria-label="Task attention"
    >
      <div className="attention-heading">
        <AttentionIcon kind={connected ? attention.kind : "unavailable"} size={27} />
        <div>
          <h2>{connected ? attention.label : "Current state unavailable"}</h2>
          <p>
            {stageLabels[attention.stage]} · {task.id}
          </p>
        </div>
      </div>
      <p className="attention-reason">
        {connected
          ? (splitRecordedDetail(attention.reason).headline ||
            (attention.kind === "completed"
              ? "The recorded workflow is complete."
              : attention.kind === "idle"
                ? "Review the task brief before starting execution."
                : attention.kind === "running"
                  ? "Follow the recorded worker activity below."
                  : "Reason not recorded. Inspect the retained task evidence."))
          : "Connection lost. The scene shows the last known task state."}
      </p>
      {connected && splitRecordedDetail(attention.reason).body && (
        <ScrollArea className="recorded-detail-output" label="Recorded detail">
          <pre>{splitRecordedDetail(attention.reason).body}</pre>
        </ScrollArea>
      )}
      <div className="attention-meta">
        <span>Next: {connected ? (attention.nextActor ?? "No action pending") : "Reconnect"}</span>
        {attention.since && (
          <span>
            Waiting since{" "}
            {new Date(attention.since).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
      </div>
      {onAction && (
        <button type="button" className="primary" onClick={onAction}>
          {attentionAction(task)}
          <ArrowRight size={19} />
        </button>
      )}
    </section>
  );
}
