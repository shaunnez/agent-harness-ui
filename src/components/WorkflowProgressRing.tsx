import type { CSSProperties } from "react";

export function WorkflowProgressRing({ completed, total }: { completed: number; total: number }) {
  const safeTotal = Math.max(total, 1);
  const completeStages = Math.max(0, Math.min(completed, safeTotal));
  const percentage = Math.round((completeStages / safeTotal) * 100);
  const style = { "--workflow-progress": `${percentage}%` } as CSSProperties;

  return (
    <div
      className="progress-ring"
      style={style}
      role="progressbar"
      aria-label="Workflow progress"
      aria-valuemin={0}
      aria-valuemax={safeTotal}
      aria-valuenow={completeStages}
      aria-valuetext={`${percentage}% complete — ${completeStages} of ${safeTotal} stages complete`}
    >
      <span>
        <strong>{completeStages}</strong>/{safeTotal}
      </span>
    </div>
  );
}
