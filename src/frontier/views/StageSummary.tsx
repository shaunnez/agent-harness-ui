import type { RuntimeRun, StageId } from "../../domain";
import type { TaskCore } from "../runtime/contracts";
import { modelLabel, reasoningLabel, stageLabels } from "../runtime/presentation";
import { stageState } from "../runtime/workflow";

export function StageSummary({ task, stage, run }: { task: TaskCore; stage: StageId; run?: RuntimeRun }) {
  const title =
    stage === "test"
      ? "Candidate verification"
      : stage === "final-review"
        ? "Review the recorded journey"
        : task.pullRequestIntent
          ? "Track the approved delivery"
          : task.workflow === "investigate"
            ? "Approve the retained specification"
            : "Approve this exact candidate";
  const detail =
    stage === "test"
      ? "Inspect recorded checks and attempts. A stopped command is distinct from a candidate defect."
      : stage === "final-review"
        ? "Review prior-stage outcomes and the evidence bound to this candidate."
        : task.pullRequestIntent
          ? "Completion follows confirmation of the matching pull request merge."
          : task.workflow === "investigate"
            ? "This investigation completes with an approved specification."
            : "Your approval publishes the reviewed revision to a task-specific branch and opens its pull request.";
  return (
    <section className="workflow-card review-intro stage-summary">
      <img src="/assets/mf.worker.standard.portrait.r1.png" alt="Task worker" />
      <div>
        <small>
          {stageLabels[stage]} ·{" "}
          {run
            ? `${modelLabel(run.model)} ${reasoningLabel(run.reasoning)} · ${run.status}`
            : stage === "approval"
              ? "Human operator"
              : stageState(task, stage)}
        </small>
        <h3>{title}</h3>
        <p>{detail}</p>
      </div>
    </section>
  );
}
