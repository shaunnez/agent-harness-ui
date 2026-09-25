import { ArrowRight, CheckCircle, Cube, Path, WarningCircle, X } from "@phosphor-icons/react";
import { useState } from "react";
import type { WorldFeedback } from "../runtime/world-feedback";
import "../ui/world-notices.css";

export function WorldNotices({
  effects,
  projectId,
  onOpen,
  motion,
}: {
  motion: boolean;
  effects: WorldFeedback[];
  projectId?: string;
  onOpen(effect: WorldFeedback): void;
}) {
  const [dismissed, setDismissed] = useState<string[]>([]);
  const visible = effects
    .filter((effect) => !dismissed.includes(effect.id) && (!projectId || effect.fact.projectId === projectId))
    .slice(-2);
  return (
    <aside
      className={`world-notices${motion ? "" : " world-notices--still"}`}
      aria-label="World updates"
      aria-live="polite"
      aria-relevant="additions"
    >
      {visible.map((effect) => {
        const Icon =
          effect.kind === "attention"
            ? WarningCircle
            : effect.kind === "artifact-arrived"
              ? Cube
              : effect.kind === "task-completed"
                ? CheckCircle
                : Path;
        return (
          <div className={`world-notice panel world-notice--${effect.kind}`} key={effect.id}>
            <Icon size={24} weight="duotone" aria-hidden="true" />
            <button type="button" className="world-notice-open" onClick={() => onOpen(effect)}>
              <span className="world-notice-context">
                {effect.fact.projectName ?? "Project"} · {effect.fact.taskId}
              </span>
              <strong>{effect.title}</strong>
              <span className="world-notice-detail">{effect.detail}</span>
              <ArrowRight size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="world-notice-dismiss"
              aria-label={`Dismiss ${effect.title}`}
              onClick={() => setDismissed((ids) => [...ids.slice(-15), effect.id])}
            >
              <X size={16} />
            </button>
          </div>
        );
      })}
    </aside>
  );
}
