import { Binoculars, CheckCircle, Cube, FileMagnifyingGlass, Scan, Target } from "@phosphor-icons/react";
import type { TaskEvidence } from "../runtime/contracts";
import { latestRun } from "../runtime/presentation";

const scoutLabel = (name: string) =>
  `${name.replaceAll("-", " ").replace(/^./, (letter) => letter.toUpperCase())} scout`;

/** Dispatch selection and individual execution remain separate recorded facts. */
export function InvestigationEvidence({
  evidence,
  stage,
  onWatch,
}: {
  evidence: TaskEvidence;
  stage: "triage" | "scouts";
  onWatch(id: string): void;
}) {
  const task = evidence.core;
  const dispatch = task.scoutDispatch;
  return stage === "triage" ? (
    <section className="workflow-card investigation-assessment">
      <header className="panel-heading">
        <span>
          <Scan size={18} />
          <h3>Task assessment</h3>
        </span>
      </header>
      <div className="workspace-panel-body assessment-sections">
        <section>
          <h3>
            <Target size={18} /> Requested outcome
          </h3>
          <p>{task.description}</p>
        </section>
        <section>
          <h3>
            <Cube size={18} /> Scope & risk
          </h3>
          <p>
            {task.workflowProfile
              ? `${task.workflowProfile.selected} · ${task.workflowProfile.reason}`
              : "No risk profile is recorded yet."}
          </p>
        </section>
        <section>
          <h3>
            <Binoculars size={18} /> Recommended investigation
          </h3>
          <p>
            {dispatch
              ? (dispatch.rationale ?? "Selected investigations are listed below.")
              : "The selected and skipped scout set has not been recorded."}
          </p>
          {dispatch && (
            <dl>
              {dispatch.selected.map((scout) => (
                <div key={scout.name}>
                  <dt>{scoutLabel(scout.name)}</dt>
                  <dd>
                    {scout.focus}
                    <small>{scout.reason}</small>
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      </div>
    </section>
  ) : (
    <section className="workflow-card workspace-scouts">
      <header className="panel-heading">
        <span>
          <Scan size={18} />
          <h3>Selected scouts</h3>
        </span>
        <small>{dispatch?.selected.length ?? 0} selected</small>
      </header>
      <div className="workspace-panel-body">
        {dispatch ? (
          <>
            <div className="workspace-scout-grid">
              {dispatch.selected.map((scout) => {
                const run = latestRun(
                  evidence.runs.items.filter(
                    (item) => item.stage === "scouts" && item.role === `${scout.name} scout`,
                  ),
                  task.activeRunIds,
                );
                const activity = run
                  ? evidence.activity.items.filter((item) => item.runId === run.id).at(-1)
                  : undefined;
                return (
                  <article className="workspace-scout" key={scout.name}>
                    <div className="workspace-scout-body">
                      <div className="workspace-scout-portrait">
                        <img src="/assets/mf.worker.standard.portrait.r1.png" alt="" />
                      </div>
                      <div>
                        <h3>{scoutLabel(scout.name)}</h3>
                        <span className="workspace-status" data-status={run?.status ?? scout.status}>
                          {run?.status ?? scout.status}
                        </span>
                        <small className="scout-field-label">Goal</small>
                        <p>{scout.reason}</p>
                        <small className="scout-field-label">Focus</small>
                        <p>{scout.focus}</p>
                        {scout.error && <p className="form-error">{scout.error}</p>}
                        {run?.error && run.error !== scout.error && <p className="form-error">{run.error}</p>}
                      </div>
                    </div>
                    <footer className="workspace-scout-activity">
                      <FileMagnifyingGlass size={18} />
                      <small>
                        {activity?.title ??
                          (run ? `Recorded run · ${run.status}` : "No individual run loaded")}
                      </small>
                      {run && (
                        <button type="button" onClick={() => onWatch(run.id)}>
                          <Binoculars size={17} />
                          Inspect
                        </button>
                      )}
                    </footer>
                  </article>
                );
              })}
            </div>
            {!dispatch.selected.length && <p>No scouts selected.</p>}
            <p className="scout-coverage">
              <CheckCircle size={16} />
              Selected: {dispatch.selected.map((scout) => scoutLabel(scout.name)).join(", ") || "None"}
              <br />
              Skipped: {dispatch.skipped.join(", ") || "None recorded"}
            </p>
            {dispatch.rationale && <p className="quiet">{dispatch.rationale}</p>}
            {task.workflowProfile && (
              <p className="quiet">
                Scope & risk: {task.workflowProfile.selected} · {task.workflowProfile.reason}
              </p>
            )}
          </>
        ) : (
          <p>The selected and skipped scout set has not been recorded.</p>
        )}
      </div>
    </section>
  );
}
