import { ArrowRight, CheckCircle, ClockCounterClockwise } from "@phosphor-icons/react";
import { useState } from "react";
import { useCommandWorkspace } from "../app/command-context.tsx";
import type { Overlay } from "../app/routes.ts";
import { summarizeBriefing } from "../runtime/briefing.ts";
import { orderedDecisions } from "../runtime/decision-session.ts";
import { attentionFor, formatCount, splitRecordedDetail, stageLabels } from "../runtime/presentation.ts";

const date = (value: string) => new Date(value).toLocaleString();
export function ReturnBriefing({
  onOpen,
  onWatch,
  onDecision,
  onClose,
}: {
  onOpen(overlay: Overlay): void;
  onWatch(taskId: string, runId: string): void;
  onDecision(taskId: string): void;
  onClose(): void;
}) {
  const context = useCommandWorkspace();
  const [acceptGap, setAcceptGap] = useState(false);
  if (!context) return null;
  const { memory, snapshot, briefing } = context,
    state = briefing.state,
    head = snapshot.workspace;
  const decisions = orderedDecisions(snapshot.tasks);
  const summary = state
    ? summarizeBriefing(state.items, state.from.at, state.through.at, snapshot.tasks, snapshot.projects)
    : null;
  const healthy = snapshot.connection === "connected" && !snapshot.workspaceError;
  const ready = state?.loaded && !state.loading && !state.cursor && !state.error;
  async function review() {
    if (!state || !ready || !healthy || (!state.completeCoverage && !acceptGap)) return;
    if (await memory.review(state.through)) {
      briefing.clear();
      onClose();
    }
  }
  return (
    <>
      <div className="overlay-body return-briefing">
        <header className="briefing-heading">
          <ClockCounterClockwise size={26} />
          <div>
            <h2>While you were away</h2>
            <p>
              {state
                ? `${date(state.from.at)} → ${date(state.through.at)}`
                : memory.checkpoint
                  ? `Reviewed through ${date(memory.checkpoint.at)}`
                  : "A baseline is recorded on your first visit to this workspace."}
            </p>
          </div>
        </header>
        {!head?.available || snapshot.workspaceError ? (
          <p role="status" className="form-error">
            {snapshot.workspaceError ?? head?.reason ?? "Connecting to retained workspace history…"}
          </p>
        ) : !state ? (
          <section>
            <p>Read the recorded changes since your last review. Closing this window keeps them unread.</p>
            <button type="button" onClick={() => briefing.begin()}>
              Load briefing
            </button>
            {memory.checkpoint && head.upper < memory.checkpoint.sequence && (
              <p role="alert">
                The workspace is behind this browser’s reviewed boundary. Refresh or reconnect before
                reviewing history.
              </p>
            )}
          </section>
        ) : (
          <>
            <p className="briefing-coverage">
              {state.completeCoverage
                ? state.cursor || !state.loaded
                  ? "Loading retained history. More pages may remain."
                  : "All retained changes in this captured interval are loaded."
                : state.coverageReason}{" "}
              Newer arrivals stay unread.
            </p>
            {summary && (
              <section className="briefing-usage">
                <h3>Recorded usage from runs completed in this interval</h3>
                <dl>
                  <div>
                    <dt>Completed runs with records</dt>
                    <dd>{summary.completedRuns}</dd>
                  </div>
                  <div>
                    <dt>Input / output tokens</dt>
                    <dd>
                      {summary.totals.input.value == null
                        ? "Not reported"
                        : formatCount(summary.totals.input.value)}{" "}
                      /{" "}
                      {summary.totals.output.value == null
                        ? "Not reported"
                        : formatCount(summary.totals.output.value)}
                    </dd>
                  </div>
                  <div>
                    <dt>Cached input / cache rate</dt>
                    <dd>
                      {summary.totals.cached.value == null
                        ? "Not reported"
                        : formatCount(summary.totals.cached.value)}{" "}
                      /{" "}
                      {summary.totals.cacheRate == null
                        ? "Unavailable"
                        : `${Math.round(summary.totals.cacheRate * 100)}%`}
                    </dd>
                  </div>
                  <div>
                    <dt>Approx. cost · API-rate estimate</dt>
                    <dd>
                      {summary.totals.cost.value == null
                        ? "Unavailable"
                        : `$${summary.totals.cost.value.toFixed(3)}`}
                    </dd>
                  </div>
                </dl>
                <p>
                  These are completed-run totals, not spending measured during your absence.{" "}
                  {summary.totals.input.known} of {summary.completedRuns} runs report input usage;{" "}
                  {summary.totals.cost.known} report a supported estimate.
                  {summary.lateRuns > 0 &&
                    ` ${summary.lateRuns} late or undated run records are listed below and excluded from these interval totals.`}
                </p>
              </section>
            )}
            {summary?.groups.map((group) => (
              <section className="catchup-project" key={group.id}>
                <h3>{group.project}</h3>
                {group.tasks.map((task) => (
                  <section className="briefing-task" key={task.id}>
                    <h4>
                      {task.id} · {task.title}
                    </h4>
                    {!task.available && (
                      <p className="quiet">
                        The task is no longer available. Retained observations remain visible.
                      </p>
                    )}
                    <ol>
                      {task.items.map((item) => (
                        <li key={item.sequence}>
                          <div>
                            <strong>{item.label}</strong>
                            <small>
                              {stageLabels[item.stage]} · Recorded {date(item.observedAt)}
                            </small>
                            {item.reason && <p>{item.reason}</p>}
                            {item.candidateId && (
                              <small>
                                Bound to {item.candidateId} r{item.candidateRevision} ·{" "}
                                {item.candidateHeadRevision?.slice(0, 10) ?? "Revision unavailable"}
                              </small>
                            )}
                          </div>
                          <button
                            type="button"
                            disabled={!task.available}
                            onClick={() =>
                              item.run
                                ? onWatch(item.taskId, item.run.id)
                                : onOpen(
                                    item.artifactId
                                      ? { kind: "artifact", taskId: item.taskId, artifactId: item.artifactId }
                                      : { kind: "task", taskId: item.taskId, stage: item.stage },
                                  )
                            }
                          >
                            Open {item.run ? "run" : item.artifactId ? "artifact" : "task"}
                            <ArrowRight size={16} />
                          </button>
                        </li>
                      ))}
                    </ol>
                  </section>
                ))}
              </section>
            ))}
            {state.loaded && !state.items.length && (
              <p>
                No retained changes were found in this interval.
                {!state.completeCoverage && " Missing history means this is not proof that nothing happened."}
              </p>
            )}
            {state.loading && <p role="status">Loading recorded changes…</p>}
            {state.error && (
              <p role="alert" className="form-error">
                {state.error}
              </p>
            )}
            {(state.cursor || state.error) && (
              <button type="button" disabled={state.loading || !healthy} onClick={briefing.more}>
                {state.error ? "Retry history page" : "Load more changes"}
              </button>
            )}
          </>
        )}
        <section className="briefing-decisions">
          <h3>Still needs you · {decisions.length}</h3>
          <p>
            {healthy
              ? "Decisions waiting now, including those from before this interval."
              : "Last known decisions; reconnect to confirm their current state."}
          </p>
          {decisions.map((task) => (
            <button type="button" className="text-row" key={task.id} onClick={() => onDecision(task.id)}>
              <span>
                <strong>
                  {snapshot.projects.find((project) => project.repositoryPath === task.repositoryPath)
                    ?.name ?? "Project unavailable"}{" "}
                  · {task.id}
                </strong>
                <small>
                  {splitRecordedDetail(attentionFor(task).reason).headline || attentionFor(task).label}
                </small>
              </span>
              <ArrowRight size={18} />
            </button>
          ))}
          {!decisions.length && (
            <p>
              {healthy
                ? "No decisions are currently waiting."
                : "Last known decision state; reconnect to confirm."}
            </p>
          )}
        </section>
        {ready && !state?.completeCoverage && (
          <label className="briefing-gap">
            <input
              type="checkbox"
              checked={acceptGap}
              onChange={(event) => setAcceptGap(event.target.checked)}
            />
            I understand some history is missing. Mark only this captured retained interval reviewed.
          </label>
        )}
        {memory.error && (
          <p role="alert" className="form-error">
            {memory.error}
          </p>
        )}
      </div>
      <footer className="overlay-footer">
        <button type="button" onClick={onClose}>
          Close · keep unread
        </button>
        <button
          type="button"
          className="primary"
          disabled={!ready || !healthy || (!state?.completeCoverage && !acceptGap)}
          onClick={() => void review()}
        >
          <CheckCircle size={18} />
          {state?.completeCoverage ? "Mark reviewed" : "Mark retained changes reviewed"}
        </button>
      </footer>
    </>
  );
}
