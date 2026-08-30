import {
  ArrowLeft,
  ArrowSquareOut,
  CaretDown,
  CheckCircle,
  CircleNotch,
  FileCode,
  Trash,
  WarningCircle,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import {
  formatApproximateCost,
  formatCacheRate,
  formatTokenCount,
  type RuntimeArtifact,
  type RuntimeFocusedTestEvidence,
  type RuntimeTask,
  type RuntimeWorktreeInventoryRow,
} from "../../domain";
import { Button } from "../Primitives";
import { RuntimeRow } from "./RuntimeInspectorPrimitives";
import { RetryGrantAudit } from "./RetryGrantAudit";

export function RuntimeWorkPackages({ task }: { task: RuntimeTask }) {
  const batches = [...new Set(task.workPackages.map((item) => item.batch))].sort((a, b) => a - b);
  return (
    <section className="runtime-packages" aria-label="Implementation work packages">
      <header>
        <span>
          <small>Dependency-aware implementation</small>
          <strong>
            {task.workPackages.length} package{task.workPackages.length === 1 ? "" : "s"} &middot;{" "}
            {batches.length} batch
            {batches.length === 1 ? "" : "es"}
          </strong>
        </span>
      </header>
      <div className="runtime-package-batches">
        {batches.map((batch, index) => (
          <div className="runtime-package-batch" key={batch}>
            <small>Batch {batch}</small>
            <div>
              {task.workPackages
                .filter((item) => item.batch === batch)
                .map((workPackage) => {
                  const packageArtifact = [...task.artifacts]
                    .reverse()
                    .find((artifact) => artifact.workPackageId === workPackage.id);
                  return (
                    <details
                      key={workPackage.id}
                      className={`runtime-package runtime-package--${workPackage.status}`}
                    >
                      <summary>
                        {workPackage.status === "running" ? (
                          <CircleNotch className="spin" size={17} />
                        ) : workPackage.status === "failed" ? (
                          <WarningCircle size={17} />
                        ) : workPackage.status === "planned" ? (
                          <FileCode size={17} />
                        ) : (
                          <CheckCircle size={17} weight="fill" />
                        )}
                        <span>
                          <small>
                            {workPackage.id} &middot;{" "}
                            {workPackage.status === "ready_for_integration"
                              ? "ready for integration"
                              : workPackage.status.replaceAll("_", " ")}
                          </small>
                          <strong>{workPackage.title}</strong>
                        </span>
                        <CaretDown className="disclosure-caret" size={15} />
                      </summary>
                      <p>{workPackage.description}</p>
                      <RuntimeRow label="Depends on" value={workPackage.dependencies.join(", ") || "None"} />
                      <RuntimeRow
                        label="Owned paths"
                        value={workPackage.ownedPaths.join(", ") || "Plan-defined scope"}
                      />
                      <RuntimeRow
                        label="Focused verification IDs"
                        value={
                          workPackage.verificationCommandIds?.join(" \u00b7 ") ||
                          "No validated manifest command ID recorded"
                        }
                        mono
                      />
                      <RuntimeRow
                        label="Focused executions"
                        value={`${workPackage.verificationRuns?.length ?? 0} bound to package commit`}
                      />
                      <RuntimeRow label="Interfaces" value="Not recorded by the runtime" />
                      <RuntimeRow
                        label="Agent / model"
                        value={
                          packageArtifact
                            ? `${packageArtifact.model} \u00b7 ${packageArtifact.reasoning ?? "reasoning not recorded"}`
                            : "Not run yet"
                        }
                      />
                      <RuntimeRow
                        label="Usage"
                        value={
                          packageArtifact
                            ? `${formatTokenCount(packageArtifact.usage.inputTokens)} in \u00b7 ${formatTokenCount(packageArtifact.usage.outputTokens)} out \u00b7 ${formatCacheRate(packageArtifact.usage)} cached \u00b7 ${formatApproximateCost(packageArtifact.usage.cost)}`
                            : "Not run yet"
                        }
                      />
                      <RuntimeRow label="Attempts" value={String(workPackage.attempts)} />
                      <RuntimeRow label="Branch" value={workPackage.branch ?? "Not created"} mono />
                      <RuntimeRow label="Worktree" value={workPackage.worktreePath ?? "Not created"} mono />
                      <RuntimeRow
                        label="Changed files"
                        value={workPackage.files.join(", ") || "None recorded"}
                      />
                      {workPackage.headRevision ? (
                        <RuntimeRow
                          label="Package commit"
                          value={workPackage.headRevision.slice(0, 8)}
                          mono
                        />
                      ) : null}
                      {workPackage.error ? <small className="text-red">{workPackage.error}</small> : null}
                    </details>
                  );
                })}
            </div>
            {index < batches.length - 1 ? (
              <span className="runtime-package-arrow">&darr; dependencies unlock</span>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

export function RuntimeWorktreeInventory({
  inventory,
  selectedId,
  onSelect,
  onRemove,
}: {
  inventory: RuntimeWorktreeInventoryRow[];
  selectedId: string | null;
  onSelect: (rowId: string | null) => void;
  onRemove: (rowId: string) => Promise<void>;
}) {
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const selectedRow = inventory.find((row) => row.id === selectedId) ?? null;
  if (selectedRow) {
    const removing = removingId === selectedRow.id;
    return (
      <div className="runtime-worktree-inventory runtime-worktree-inventory--detail">
        <button
          type="button"
          className="icon-button"
          onClick={() => onSelect(null)}
          aria-label="Return to inventory list"
        >
          <ArrowLeft size={16} />
        </button>
        <details className="runtime-worktree-inventory__detail" open>
          <summary>
            <span>
              <small>
                {selectedRow.kind} &middot; {selectedRow.lifecycleState}
              </small>
              <strong>{selectedRow.label}</strong>
            </span>
          </summary>
          <div className="runtime-worktree-inventory__detail-grid">
            <RuntimeRow label="Kind" value={selectedRow.kind} />
            <RuntimeRow label="Lifecycle" value={selectedRow.lifecycleState} />
            <RuntimeRow label="Worktree" value={selectedRow.worktreePath} mono />
            <RuntimeRow label="Branch" value={selectedRow.branch} mono />
            <RuntimeRow label="Base" value={selectedRow.baseRevision ?? "n/a"} mono />
            <RuntimeRow label="Head" value={selectedRow.headRevision ?? "n/a"} mono />
            <RuntimeRow label="Task" value={selectedRow.taskId} mono />
            <RuntimeRow label="Work package" value={selectedRow.workPackageId ?? "n/a"} mono />
            <RuntimeRow label="Git exists" value={selectedRow.gitExists ? "present" : "missing"} />
            <RuntimeRow label="Git head" value={selectedRow.gitHeadRevision ?? "n/a"} mono />
            <RuntimeRow
              label="Cleanliness"
              value={selectedRow.gitClean == null ? "unknown" : selectedRow.gitClean ? "clean" : "dirty"}
            />
            <RuntimeRow
              label="Workflow retention"
              value={selectedRow.retainedRequired ? "required" : "releasable"}
            />
            <RuntimeRow label="Cleanup" value={selectedRow.cleanupReady ? "ready" : "not ready"} />
          </div>
        </details>
        <div className="runtime-worktree-inventory__actions">
          <Button
            tone="danger"
            compact
            icon={Trash}
            disabled={!selectedRow.cleanupReady || removing}
            onClick={async () => {
              setRemoveError(null);
              setRemovingId(selectedRow.id);
              try {
                await onRemove(selectedRow.id);
                onSelect(null);
              } catch (error) {
                setRemoveError(error instanceof Error ? error.message : "The worktree could not be removed.");
              } finally {
                setRemovingId(null);
              }
            }}
          >
            {removing ? "Removing…" : "Remove worktree"}
          </Button>
          {!selectedRow.cleanupReady ? (
            <small className="runtime-worktree-inventory__hint">
              {selectedRow.retainedRequired
                ? "This candidate is still required by the unfinished task."
                : "Only a clean, inactive worktree can be removed — the server re-derives that from disk at removal time and refuses one that is still active."}
            </small>
          ) : null}
          {removeError ? <small className="text-red">{removeError}</small> : null}
        </div>
        <p className="runtime-worktree-inventory__return">
          Return to the inventory list to inspect another retained worktree.
        </p>
      </div>
    );
  }

  return (
    <div className="runtime-worktree-inventory">
      {inventory.map((row) => (
        <button
          key={row.id}
          type="button"
          className={`runtime-worktree-row runtime-worktree-row--${row.lifecycleState}`}
          onClick={() => onSelect(row.id)}
        >
          <span className="runtime-worktree-row__identity">
            <small>
              {row.kind} &middot; {row.lifecycleState}
            </small>
            <strong>{row.label}</strong>
          </span>
          <span className="runtime-worktree-row__badges">
            <span className={`badge badge--${row.kind === "candidate" ? "red" : "green"}`}>{row.kind}</span>
            <span
              className={`badge badge--${row.lifecycleState === "active" ? "green" : row.lifecycleState === "retained" ? "yellow" : "red"}`}
            >
              {row.lifecycleState}
            </span>
            <span
              className={`badge badge--${row.cleanupReady ? "green" : "yellow"}`}
              title={
                row.cleanupReady
                  ? "Present, clean, and not in use — safe to remove."
                  : row.retainedRequired
                    ? "Still required by the unfinished task, so removal is refused."
                    : "Still in use or holding uncommitted changes, so removal is refused."
              }
            >
              {row.cleanupReady ? "cleanup ready" : "keep retained"}
            </span>
          </span>
          <span className="runtime-worktree-row__path mono">{row.worktreePath}</span>
        </button>
      ))}
    </div>
  );
}

export function RuntimeContextDisclosure({ artifact }: { artifact: RuntimeArtifact }) {
  const manifest = artifact.contextManifest;
  // Rendered open and static, not a details/summary accordion \u2014 nothing in the right
  // sidebar collapses (see AGENTS.md). This also drives the artifact viewer modal,
  // which inherits the same always-open treatment.
  return (
    <section className="runtime-context-disclosure">
      <header>
        <span>
          <strong>Context supplied</strong>
          <small>
            {manifest
              ? `${manifest.sources.length} sources \u00b7 ~${formatTokenCount(manifest.estimatedPromptTokens)} rendered prompt tokens`
              : "Not recorded for this historical run"}
          </small>
        </span>
      </header>
      {manifest ? (
        <div>
          <p>{manifest.policy}</p>
          {manifest.repositoryRevision ? (
            <p>
              Repository evidence: <code>{manifest.repositoryRevision.slice(0, 12)}</code> at{" "}
              <code>{manifest.repositoryTargetRef ?? "detached commit"}</code>
            </p>
          ) : null}
          <ul>
            {manifest.sources.map((source) => (
              <li key={`${source.kind}-${source.id}`}>
                <span>
                  <strong>{source.label}</strong>
                  <small>
                    {source.kind}
                    {source.stage ? ` \u00b7 ${source.stage}` : ""}
                    {source.truncated ? " \u00b7 truncated" : ""}
                  </small>
                </span>
                <code>
                  {source.includedCharacters == null
                    ? manifest.repositoryAccess
                    : `${source.includedCharacters.toLocaleString()} chars`}
                </code>
              </li>
            ))}
          </ul>
          <small>
            Supplied context records what was included or accessible. It cannot prove which text the model
            relied on.
          </small>
        </div>
      ) : (
        <p>
          Context manifests are recorded for new agent runs. Older artifacts retain usage but cannot
          reconstruct the exact prompt boundary.
        </p>
      )}
    </section>
  );
}

export function RuntimeFocusedTestEvidencePanel({
  evidence,
  candidate,
  selectedResultId,
  onSelectResult,
}: {
  evidence: RuntimeFocusedTestEvidence;
  candidate: RuntimeTask["candidates"][number] | undefined;
  selectedResultId: string | null;
  onSelectResult: (resultId: string | null) => void;
}) {
  const selectedRow = evidence.rows.find((row) => row.id === selectedResultId) ?? null;
  const passed = evidence.rows.filter((row) => row.status === "passed").length;
  const failed = evidence.rows.length - passed;
  useEffect(() => {
    if (selectedResultId && !selectedRow) onSelectResult(null);
  }, [onSelectResult, selectedResultId, selectedRow]);
  useEffect(() => {
    if (!selectedRow) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onSelectResult(null);
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onSelectResult, selectedRow]);
  return (
    <section className="runtime-focused-test" aria-label="Focused test evidence">
      <header>
        <span>
          <small>Candidate-bound structured evidence</small>
          <strong>
            {passed} passed &middot; {failed} failed &middot; {evidence.candidateId} r
            {evidence.candidateRevision}
          </strong>
        </span>
        <span className="mono">{evidence.command}</span>
      </header>
      {selectedRow ? (
        <div className="runtime-focused-test__detail">
          <button type="button" className="detail-back" onClick={() => onSelectResult(null)}>
            <ArrowLeft size={15} /> Back to test list
          </button>
          <div className="runtime-focused-test__detail-title">
            {selectedRow.status === "passed" ? (
              <CheckCircle size={18} weight="fill" />
            ) : (
              <WarningCircle size={18} weight="fill" />
            )}
            <span>
              <small>{selectedRow.status} result details</small>
              <strong>{selectedRow.title}</strong>
            </span>
          </div>
          <RuntimeRow label="Command" value={selectedRow.command} mono />
          <RuntimeRow
            label="Candidate"
            value={`${selectedRow.candidateId} r${selectedRow.candidateRevision}`}
            mono
          />
          <RuntimeRow
            label="Duration"
            value={selectedRow.durationMs == null ? "Not recorded" : `${selectedRow.durationMs}ms`}
          />
          <RuntimeRow
            label="Artifacts"
            value={
              selectedRow.artifactReferences.map((item) => `${item.name} \u00b7 ${item.kind}`).join(", ") ||
              "Markdown test artifact"
            }
          />
          <div className="runtime-test-assertions">
            <small>Assertions</small>
            {selectedRow.assertions.map((assertion) => (
              <div key={assertion.label}>
                <strong>{assertion.label}</strong>
                <span>Expected: {assertion.expected ?? "Not recorded"}</span>
                <span>Actual: {assertion.actual}</span>
              </div>
            ))}
          </div>
          {selectedRow.failureDetails ? (
            <p className="runtime-test-failure">{selectedRow.failureDetails}</p>
          ) : null}
          <Button tone="ghost" compact icon={ArrowLeft} onClick={() => onSelectResult(null)}>
            Back to all tests
          </Button>
        </div>
      ) : (
        <div className="runtime-focused-test__rows">
          {evidence.rows.map((row) => (
            <button type="button" key={row.id} onClick={() => onSelectResult(row.id)}>
              {row.status === "passed" ? (
                <CheckCircle size={18} weight="fill" />
              ) : (
                <WarningCircle size={18} weight="fill" />
              )}
              <span>
                <strong>{row.title}</strong>
                <small>
                  {row.command} &middot;{" "}
                  {row.assertions.map((assertion) => assertion.label).join(" \u00b7 ") ||
                    "No assertions recorded"}
                </small>
              </span>
              <span>
                <strong className={row.status === "failed" ? "text-red" : "text-green"}>{row.status}</strong>
                <small>{row.durationMs == null ? "Duration not recorded" : `${row.durationMs}ms`}</small>
              </span>
              <ArrowSquareOut size={15} />
            </button>
          ))}
        </div>
      )}
      <footer>
        <small>
          {candidate
            ? `Current candidate ${candidate.id} r${candidate.revisionNumber}`
            : "No active candidate"}
        </small>
        <small>
          {evidence.status === "passed" ? "Pass" : "Failure"} evidence retained with Markdown output
        </small>
      </footer>
    </section>
  );
}

export function DecisionFrontier({
  task,
  canRecord,
  onDecision,
}: {
  task: RuntimeTask;
  canRecord: boolean;
  onDecision: (question: string, answer: string) => Promise<void>;
}) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="runtime-decisions">
      {/* This is a durable, task-scoped decision log, not the Grill Me session (that
          Q&A lives in RuntimeGrillPanel, labelled "Grill session" to avoid the name
          collision with this section). It records any human decision or constraint
          against the task, and stays open at every stage until the task stops being
          worked — the same window `canRecord` below tests for. */}
      <p className="runtime-decisions__explainer">
        A durable decision or constraint recorded against the task — not limited to Grill Me. Usable at any
        stage while the task is not running and has not reached approval, merge, or completion.
      </p>
      {task.decisions?.length ? (
        task.decisions.map((decision) => (
          <article className="runtime-decision" key={decision.id}>
            <strong>{decision.question}</strong>
            <p>{decision.answer}</p>
            <RetryGrantAudit audit={decision} />
          </article>
        ))
      ) : (
        <small>
          No human decisions recorded. Recommended assumptions remain visible in the decision brief.
        </small>
      )}
      {canRecord &&
      !task.status.startsWith("running") &&
      !["completed", "merged-to-target", "awaiting-human-approval"].includes(task.status) ? (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setPending(true);
            setError(null);
            try {
              await onDecision(question, answer);
              setQuestion("");
              setAnswer("");
            } catch (reason) {
              setError(reason instanceof Error ? reason.message : "Decision could not be saved.");
            } finally {
              setPending(false);
            }
          }}
        >
          <input
            aria-label="Decision question"
            placeholder="Decision or constraint"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
          />
          <textarea
            aria-label="Decision answer"
            placeholder="Authoritative answer"
            rows={2}
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
          />
          <Button tone="ghost" compact type="submit" disabled={pending || !question.trim() || !answer.trim()}>
            {pending ? "Saving..." : "Record decision"}
          </Button>
          {error ? <small className="text-red">{error}</small> : null}
        </form>
      ) : null}
    </div>
  );
}
