import { FileCode, Robot, X } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  formatApproximateCost,
  formatCacheRate,
  formatTokenCount,
  type RuntimeArtifact,
  type RuntimeEvent,
  type RuntimeTask,
  workflowStages,
} from "../../domain";
import { MarkdownContent } from "../MarkdownContent";
import { Button } from "../Primitives";
import { RuntimeContextDisclosure } from "./RuntimeEvidencePanels";
import { stripEmbeddedCandidatePatch } from "./RuntimeStagePresentation";

export function TaskEvaluation({
  evaluation,
  disabled,
  onEvaluate,
}: {
  evaluation: RuntimeTask["evaluation"];
  disabled: boolean;
  onEvaluate: (score: number, outcome: "accepted" | "rejected" | "mixed", notes: string) => Promise<void>;
}) {
  const [score, setScore] = useState(evaluation?.score ?? 0);
  const [outcome, setOutcome] = useState<"accepted" | "rejected" | "mixed">(evaluation?.outcome ?? "mixed");
  const [notes, setNotes] = useState(evaluation?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="task-evaluation">
      <fieldset className="task-evaluation__scores">
        <legend className="sr-only">Outcome quality score</legend>
        {[1, 2, 3, 4, 5].map((value) => <button type="button" key={value} className={score === value ? "is-selected" : ""} onClick={() => setScore(value)} aria-label={`${value} out of 5`}>{value}</button>)}
      </fieldset>
      <label>Outcome<select value={outcome} onChange={(event) => setOutcome(event.target.value as typeof outcome)}><option value="accepted">Accepted</option><option value="mixed">Mixed</option><option value="rejected">Rejected</option></select></label>
      <label>Evaluator notes<textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="What made the output good or poor?" /></label>
      <Button tone="secondary" compact disabled={disabled || !score || saving} onClick={async () => { setSaving(true); setError(null); try { await onEvaluate(score, outcome, notes); } catch (reason) { setError(reason instanceof Error ? reason.message : "The evaluation could not be saved."); } finally { setSaving(false); } }}>{saving ? "Saving\u2026" : evaluation ? "Update evaluation" : "Add to scorecard"}</Button>
      {error ? <small className="text-red">{error}</small> : null}
    </div>
  );
}

export function RuntimeActivity({ events }: { events: RuntimeEvent[] }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<"activity" | "agent" | "test" | "decision">("activity");
  const visibleEvents = useMemo(
    () =>
      [...events]
        .reverse()
        .filter((event) =>
          filter === "activity"
            ? true
            : filter === "agent"
              ? event.category === "agent"
              : filter === "test"
                ? event.stage === "test"
                : event.category === "decision",
        )
        .slice(0, 40),
    [events, filter],
  );
  return (
    <details className="runtime-activity" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <span>
          <Robot size={16} />
          <strong>Run activity</strong>
          <small>Agent sessions, repository commands, artifacts, and decisions &middot; {events.length} events</small>
        </span>
        <span>
          <span className="connection-dot" />
          {events.at(-1)?.title ?? "Waiting to start"}
        </span>
      </summary>
      <div className="runtime-activity-filters" role="tablist" aria-label="Run activity filters">
        {([
          ["activity", "Activity"],
          ["agent", "Agent runs"],
          ["test", "Test runs"],
          ["decision", "Decisions"],
        ] as const).map(([id, label]) => (
          <button
            type="button"
            role="tab"
            aria-selected={filter === id}
            className={filter === id ? "selected" : ""}
            key={id}
            onClick={() => setFilter(id)}
          >
            {label}
          </button>
        ))}
        <small>These are persisted runtime events. Model, token, duration, and artifact linkage appear only when the Codex event stream records them.</small>
      </div>
      <div className="runtime-activity-list">
        {visibleEvents.length ? visibleEvents.map((event) => (
            <div className={`runtime-activity-row runtime-activity-row--${runtimeEventPresentation(event).tone}`} key={event.id}>
              <time className="mono">
                {new Date(event.at).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </time>
              <span>
                <strong>{runtimeEventPresentation(event).title}</strong>
                <small>{runtimeEventPresentation(event).detail}</small>
              </span>
              <em>{workflowStages.find((stage) => stage.id === event.stage)?.shortLabel ?? event.stage}</em>
            </div>
          )) : (
            <div className="runtime-activity-empty">No recorded events match this filter.</div>
          )}
      </div>
    </details>
  );
}

export function runtimeEventPresentation(event: RuntimeEvent) {
  const freshness = event.freshness;
  if (!freshness || freshness.fresh) {
    return { tone: event.tone, title: event.title, detail: event.detail, stale: false };
  }
  return {
    tone: "warning" as const,
    title: `${event.title} · Rerun required`,
    detail: `${event.detail} · ${freshness.reasonCopy}`,
    stale: true,
  };
}

export async function copyArtifactContent(
  content: string,
  clipboard: Pick<Clipboard, "writeText"> | null | undefined = globalThis.navigator?.clipboard,
) {
  if (!clipboard?.writeText) {
    return { ok: false as const, message: "Clipboard access failed. Your browser did not expose clipboard write support." };
  }
  try {
    await clipboard.writeText(content);
    return { ok: true as const };
  } catch {
    return { ok: false as const, message: "Clipboard access failed. The browser blocked copying this artifact." };
  }
}

export function shouldApplyArtifactCopyFeedback(requestedArtifactId: string, activeArtifactId: string) {
  return requestedArtifactId === activeArtifactId;
}

export function RuntimeArtifactViewer({ artifact, onClose }: { artifact: RuntimeArtifact; onClose: () => void }) {
  const [copyStatus, setCopyStatus] = useState<"copied" | "error" | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const activeArtifactIdRef = useRef(artifact.id);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    activeArtifactIdRef.current = artifact.id;
    setCopyStatus(null);
    setCopyError(null);
  }, [artifact.id]);
  useEffect(() => {
    if (copyStatus !== "copied") return;
    const timer = window.setTimeout(() => setCopyStatus(null), 1800);
    return () => window.clearTimeout(timer);
  }, [copyStatus]);
  useEffect(() => {
    closeButtonRef.current?.focus();
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onClose]);
  const handleCopy = async () => {
    const requestedArtifactId = artifact.id;
    const result = await copyArtifactContent(artifact.content);
    if (!shouldApplyArtifactCopyFeedback(requestedArtifactId, activeArtifactIdRef.current)) {
      return;
    }
    if (result.ok) {
      setCopyError(null);
      setCopyStatus("copied");
      return;
    }
    setCopyStatus("error");
    setCopyError(result.message);
  };
  return (
    <div
      className="artifact-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`${artifact.name} artifact`}
    >
      <button
        type="button"
        className="artifact-overlay__backdrop"
        onClick={onClose}
        aria-label="Close artifact"
      />
      <section className="artifact-viewer">
        <header>
          <span>
            <FileCode size={18} />
            <span>
              <small>
                {artifact.stage} &middot; {artifact.kind}
              </small>
              <strong>{artifact.name}</strong>
            </span>
          </span>
          <div className="artifact-viewer__actions">
            <Button tone="ghost" compact onClick={handleCopy}>
              Copy artifact
            </Button>
            <button
              ref={closeButtonRef}
              type="button"
              className="icon-button"
              onClick={onClose}
              aria-label="Close artifact viewer"
            >
              <X size={18} />
            </button>
          </div>
        </header>
        <div className="artifact-viewer__summary">
          <span>Real agent output &middot; read-only</span>
          <p>Produced by {artifact.model}{artifact.reasoning ? ` at ${artifact.reasoning} reasoning` : ""}; retained as the handoff to downstream stages.</p>
          {copyStatus === "copied" ? <small className="text-green">Copied</small> : null}
          {copyError ? <small className="text-red">{copyError}</small> : null}
        </div>
        <div className="artifact-viewer__usage">
          <span><small>Input</small><strong>{formatTokenCount(artifact.usage.inputTokens)}</strong></span>
          <span><small>Output</small><strong>{formatTokenCount(artifact.usage.outputTokens)}</strong></span>
          <span><small>Cached input</small><strong className="text-green">{formatCacheRate(artifact.usage)} &middot; {formatTokenCount(artifact.usage.cachedInputTokens)}</strong></span>
          <span><small>Approx. cost</small><strong>{formatApproximateCost(artifact.usage.cost)}</strong></span>
        </div>
        <MarkdownContent content={stripEmbeddedCandidatePatch(artifact.content)} className="artifact-viewer__markdown" />
        <RuntimeContextDisclosure artifact={artifact} />
        <details className="artifact-viewer__raw">
          <summary>View raw Markdown source</summary>
          <pre>{artifact.content}</pre>
        </details>
        <footer>
          <small>{new Date(artifact.createdAt).toLocaleString()}</small>
          <span className="mono">API-rate estimate &middot; ChatGPT plan session</span>
        </footer>
      </section>
    </div>
  );
}
