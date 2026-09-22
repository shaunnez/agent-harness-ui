import {
  ArrowRight,
  Binoculars,
  Cube,
  FileMagnifyingGlass,
  FileText,
  MinusCircle,
  Scan,
  Target,
  WarningCircle,
} from "@phosphor-icons/react";
import type { TaskEvidence } from "../runtime/contracts";
import { latestRun } from "../runtime/presentation";
import { CollapsibleText } from "../ui/CollapsibleText";

const scoutLabel = (name: string) =>
  `${name.replaceAll("-", " ").replace(/^./, (letter) => letter.toUpperCase())} scout`;

const scoutPurposes: Record<string, string> = {
  "scout-code-path": "Trace the relevant entry point, callers, branches, and terminal outcome.",
  "scout-dependency": "Map direct and first-tier transitive imports for the relevant module.",
  "scout-pattern": "Find representative existing usages and meaningful gaps in the relevant pattern.",
  "scout-schema": "Locate persistence, validation, event, and TypeScript boundary schemas.",
  "scout-test-inventory": "Catalog representative tests covering the task surface or a confirmed gap.",
  "scout-user-journey": "Trace the implicated UI, API, or CLI journey to its user-visible outcome.",
};

const artifactBasename = (name: string) => name.replaceAll("\\", "/").split("/").at(-1) ?? name;

/** Dispatch selection and individual execution remain separate recorded facts. */
export function InvestigationEvidence({
  evidence,
  stage,
  onWatch,
  onArtifact,
}: {
  evidence: TaskEvidence;
  stage: "triage" | "scouts";
  onWatch(id: string): void;
  onArtifact(id: string): void;
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
          <CollapsibleText text={task.description} label="assessment" />
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
  ) : dispatch ? (
    <>
      {task.workflowProfile && (
        <p className="history-notice scout-risk-banner">
          <WarningCircle size={18} />
          <span>
            <strong>Scope &amp; risk: {task.workflowProfile.selected}</strong>
            {task.workflowProfile.reason}
          </span>
        </p>
      )}
      {task.artifacts
        .filter(
          (artifact) =>
            artifact.stage === "scouts" &&
            artifactBasename(artifact.name).toLowerCase() === "repository-scout.md",
        )
        .slice(-1)
        .map((artifact) => (
          <section className="workflow-card workspace-scouts workspace-repository-scout" key={artifact.id}>
            <header className="panel-heading">
              <span>
                <FileMagnifyingGlass size={18} />
                <h3>Repository scout</h3>
              </span>
              <small>Retained handoff</small>
            </header>
            <div className="workspace-panel-body">
              <article className="workspace-scout">
                <div className="workspace-scout-body">
                  <div className="workspace-scout-portrait">
                    <img src="/assets/mf.worker.standard.portrait.r1.png" alt="" />
                  </div>
                  <div>
                    <h3>Repository scout</h3>
                    <span className="workspace-status" data-status="complete">
                      complete
                    </span>
                    <small className="scout-field-label">Goal</small>
                    <p>Create one retained handoff from the selected repository evidence.</p>
                    <small className="scout-field-label">Output</small>
                    <p>
                      Combined {dispatch.selected.filter((scout) => scout.status === "complete").length} of{" "}
                      {dispatch.selected.length} selected scout reports for downstream stages.
                    </p>
                  </div>
                </div>
                <footer className="workspace-scout-activity">
                  <button
                    type="button"
                    className="scout-artifact-link"
                    onClick={() => onArtifact(artifact.id)}
                  >
                    <FileText size={18} />
                    <span>
                      <strong>Open repository output</strong>
                      <small>{artifactBasename(artifact.name)}</small>
                    </span>
                    <ArrowRight size={17} />
                  </button>
                </footer>
              </article>
            </div>
          </section>
        ))}
      <section className="workflow-card workspace-scouts">
        <header className="panel-heading">
          <span>
            <Scan size={18} />
            <h3>Selected scouts</h3>
          </span>
          <small>{dispatch.selected.length} selected</small>
        </header>
        <div className="workspace-panel-body">
          <div className="workspace-scout-grid">
            {dispatch.selected.map((scout) => {
              const run = latestRun(
                evidence.runs.items.filter((item) => item.stage === "scouts" && item.role === scout.name),
                task.activeRunIds,
              );
              const activity = run
                ? evidence.activity.items.filter((item) => item.runId === run.id).at(-1)
                : undefined;
              const artifact =
                (run?.artifactId ? task.artifacts.find((item) => item.id === run.artifactId) : undefined) ??
                task.artifacts.find(
                  (item) =>
                    item.stage === "scouts" &&
                    (item.agentRole === scout.name || artifactBasename(item.name) === `${scout.name}.md`),
                );
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
                    {artifact ? (
                      <button
                        type="button"
                        className="scout-artifact-link"
                        onClick={() => onArtifact(artifact.id)}
                      >
                        <FileText size={18} />
                        <span>
                          <strong>Open scout output</strong>
                          <small>{artifactBasename(artifact.name)}</small>
                        </span>
                        <ArrowRight size={17} />
                      </button>
                    ) : (
                      <>
                        <FileMagnifyingGlass size={18} />
                        <small>
                          {activity?.title ?? (run ? `Recorded run · ${run.status}` : "Output not loaded")}
                        </small>
                      </>
                    )}
                    {run && !artifact && (
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
          {dispatch.rationale && <p className="quiet">{dispatch.rationale}</p>}
        </div>
      </section>
      {dispatch.skipped.length > 0 && (
        <section className="workflow-card workspace-scouts workspace-unused-scouts">
          <header className="panel-heading">
            <span>
              <MinusCircle size={18} />
              <h3>Not used for this task</h3>
            </span>
            <small>{dispatch.skipped.length} not used</small>
          </header>
          <div className="workspace-panel-body">
            <div className="workspace-scout-grid">
              {dispatch.skipped.map((name) => (
                <article className="workspace-scout is-unused" key={name}>
                  <div className="workspace-scout-body">
                    <div className="workspace-scout-portrait">
                      <img src="/assets/mf.worker.standard.portrait.r1.png" alt="" />
                    </div>
                    <div>
                      <h3>{scoutLabel(name)}</h3>
                      <span className="workspace-status" data-status="not-used">
                        not used
                      </span>
                      <small className="scout-field-label">Goal</small>
                      <p>
                        {scoutPurposes[name] ?? "Inspect this repository concern when the task requires it."}
                      </p>
                      <small className="scout-field-label">Selection</small>
                      <p>Not selected for this task.</p>
                    </div>
                  </div>
                  <footer className="workspace-scout-activity">
                    <MinusCircle size={18} />
                    <small>Not dispatched</small>
                  </footer>
                </article>
              ))}
            </div>
          </div>
        </section>
      )}
    </>
  ) : (
    <section className="workflow-card workspace-scouts">
      <header className="panel-heading">
        <span>
          <Scan size={18} />
          <h3>Repository scouts</h3>
        </span>
      </header>
      <div className="workspace-panel-body">
        <p>The selected and skipped scout set has not been recorded.</p>
      </div>
    </section>
  );
}
