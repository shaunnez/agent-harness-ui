import {
  ArrowSquareOut,
  CaretDown,
  CheckCircle,
  CircleNotch,
  FileCode,
  GitDiff,
  Robot,
  ShieldCheck,
  WarningCircle,
  Wrench,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import {
  formatApproximateCost,
  formatCacheRate,
  formatTokenCount,
  type RuntimeArtifact,
  type RuntimeTask,
  type StageId,
  workflowStages,
} from "../../domain";
import { isModelRunArtifact, sumArtifactUsage } from "../../artifactPresentation";
import { MarkdownContent } from "../MarkdownContent";
import { Button } from "../Primitives";
import { RuntimeGrillPanel } from "./RuntimeGrillPanel";
import {
  RuntimeFocusedTestEvidencePanel,
  RuntimeWorkPackages,
} from "./RuntimeEvidencePanels";
import {
  candidateGateStages,
  getMergePromotionDetails,
  getRuntimeArtifactFreshness,
  getRuntimeFocusedTest,
  getRuntimeGateFreshness,
  isCandidateBoundStage,
  isArtifactFresh,
  isGateUnattempted,
  isStageComplete,
  isStageRunning,
} from "./workflow";

export function RuntimeStagePresentation({
  task,
  viewedStageId,
  artifact,
  candidate,
  completedApprovalWithoutArtifact,
  viewedStageStopped,
  onAnswer,
  onOpenArtifact,
  onOpenCandidateDiff,
  candidateDiffLoading,
  selectedTestResultId,
  onSelectTestResult,
}: {
  task: RuntimeTask;
  viewedStageId: StageId;
  artifact?: RuntimeArtifact;
  candidate: RuntimeTask["candidates"][number] | undefined;
  completedApprovalWithoutArtifact: boolean;
  viewedStageStopped: boolean;
  onAnswer: (questionId: string, answer: string) => Promise<void>;
  onOpenArtifact: (artifact: RuntimeArtifact) => void;
  onOpenCandidateDiff: (target?: RuntimeTask["candidates"][number]) => void;
  candidateDiffLoading: boolean;
  selectedTestResultId: string | null;
  onSelectTestResult: (resultId: string | null) => void;
}) {
  const focusedTest = getRuntimeFocusedTest(task);
  const stageArtifacts = task.artifacts.filter((item) => item.stage === viewedStageId);
  const artifactHistory = stageArtifacts.length > 1 && viewedStageId !== "scouts" ? (
    <RuntimeArtifactHistory
      artifacts={stageArtifacts}
      currentArtifact={artifact}
      onOpenArtifact={onOpenArtifact}
    />
  ) : null;
  const disposition = task.stageDispositions?.[viewedStageId];
  const artifactFreshness = artifact ? getRuntimeArtifactFreshness(task, artifact) : null;
  const artifactCard = artifact ? (
    <RuntimeArtifactCard
      artifact={artifact}
      candidate={candidate}
      freshness={artifactFreshness}
      hideStructuredTestPayload={viewedStageId === "test"}
      onOpen={() => onOpenArtifact(artifact)}
    />
  ) : null;
  const empty = !artifact && !completedApprovalWithoutArtifact ? (
    <RuntimeStageEmpty task={task} viewedStageStopped={viewedStageStopped} />
  ) : null;

  if (disposition?.status === "not-required") {
    return (
      <div className="runtime-stage-stack">
        {viewedStageId === "plan" && task.workPackages.length ? <RuntimeWorkPackages task={task} /> : null}
        <section className="runtime-contract-note">
          <CheckCircle size={18} weight="fill" />
          <span>
            <strong>Stage not required for this candidate path</strong>
            <p>{disposition.reason}</p>
          </span>
        </section>
      </div>
    );
  }

  switch (viewedStageId) {
    case "triage":
      return (
        <div className="runtime-stage-stack">
          {artifactHistory}
          <RuntimeFactGrid
            facts={[
              ["Classification", `${task.workflow} task`],
              ["Priority", task.priority],
              ["Risk", artifact ? "Retained in triage artifact" : "Not recorded"],
              ["Repository", task.repositoryPath],
            ]}
          />
          {artifactCard ?? empty}
        </div>
      );
    case "scouts":
      return (
        <div className="runtime-stage-stack">
          {task.scoutDispatch ? (
            <section className="scout-dispatch-panel">
              <header>
                <span><Robot size={18} /><strong>Selective scout dispatch</strong></span>
                <small>{scoutDispatchSummary(task)}</small>
              </header>
              <p>{task.scoutDispatch.rationale ?? "No dispatch rationale was retained for this historical task."}</p>
              <div>
                {task.scoutDispatch.selected.map((scout) => {
                  const scoutArtifact = task.artifacts.find((item) => item.agentRole === scout.name && isModelRunArtifact(item));
                  return (
                    <article key={scout.name}>
                      <span className={`scout-dispatch-state scout-dispatch-state--${scout.status}`} />
                      <span>
                        <strong>{scout.name}</strong>
                        <small>{scout.focus}</small>
                        <p>{scout.reason}</p>
                        {scoutArtifact ? (
                          <button type="button" className="scout-dispatch-usage" onClick={() => onOpenArtifact(scoutArtifact)}>
                            <span>{formatTokenCount(scoutArtifact.usage.inputTokens)} in &middot; {formatTokenCount(scoutArtifact.usage.outputTokens)} out</span>
                            <span>{formatCacheRate(scoutArtifact.usage)} cached &middot; {formatApproximateCost(scoutArtifact.usage.cost)}</span>
                            <ArrowSquareOut size={14} />
                          </button>
                        ) : <small>{scout.status === "complete" ? "Usage was not retained for this historical scout." : "Usage will appear when this scout completes."}</small>}
                        {scout.error ? <p className="text-red">{scout.error}</p> : null}
                      </span>
                    </article>
                  );
                })}
                {task.scoutDispatch.selected.length === 0 ? <p>No scouts were dispatched; triage explicitly determined that no additional repository evidence was needed.</p> : null}
              </div>
            </section>
          ) : null}
          <section className="runtime-evidence-source">
            <CheckCircle size={18} weight="fill" />
            <span>
              <small>Repository evidence &middot; deterministic handoff</small>
              <strong>{artifact?.name ?? "No scout artifact yet"}</strong>
              <p>{artifact ? `Mechanically combined from ${task.scoutDispatch?.selected.filter((scout) => scout.status === "complete").length ?? 0} retained scout reports; no extra model call \u00b7 ${new Date(artifact.createdAt).toLocaleString()}` : "The scout stage has not produced an artifact."}</p>
            </span>
          </section>
          {artifactCard ?? empty}
        </div>
      );
    case "grill":
      return (
        <div className="runtime-stage-stack">
          {artifactHistory}
          <section className="runtime-evidence-source">
            <FileCode size={18} />
            <span>
              <small>Repository evidence</small>
              <strong>{task.artifacts.find((item) => item.stage === "scouts")?.name ?? "Scout handoff unavailable"}</strong>
              <p>Open the retained scout artifact from Living artifacts for the exact repository claims behind this decision.</p>
            </span>
          </section>
          {task.grillSession ? <RuntimeGrillPanel task={task} onAnswer={onAnswer} /> : empty}
          {artifactCard}
        </div>
      );
    case "specification":
      return (
        <div className="runtime-stage-stack">
          {artifactHistory}
          <RuntimeFactGrid
            facts={[
              ["Artifact", artifact?.name ?? "Pending"],
              ["Approval", task.approvals.some((item) => item.stage === "specification") ? "Approved" : "Awaiting approval"],
              ["Task decision log", `${task.decisions.length} recorded across the workflow`],
              ["Provenance", artifact?.model ?? "Not recorded"],
            ]}
          />
          {task.decisions.length ? <RuntimeTaskDecisionSummary task={task} artifact={artifact} /> : null}
          {artifactCard ?? empty}
        </div>
      );
    case "plan":
      return (
        <div className="runtime-stage-stack">
          {artifactHistory}
          {task.workPackages.length ? <RuntimeWorkPackages task={task} /> : null}
          {artifactCard ?? empty}
        </div>
      );
    case "implement":
      return (
        <div className="runtime-stage-stack">
          {artifactHistory}
          {candidate ? (
            <RuntimeCandidateDesk
              task={task}
              candidate={candidate}
              onOpenDiff={onOpenCandidateDiff}
              diffLoading={candidateDiffLoading}
            />
          ) : null}
          {task.workPackages.length ? <RuntimeWorkPackages task={task} /> : null}
          {artifactCard ?? empty}
        </div>
      );
    case "dev-review":
      return (
        <div className="runtime-stage-stack">
          {artifactHistory}
          {candidate ? (
            <RuntimeCandidateDesk
              task={task}
              candidate={candidate}
              onOpenDiff={onOpenCandidateDiff}
              diffLoading={candidateDiffLoading}
              compact
            />
          ) : null}
          <section className="runtime-contract-note">
            <ShieldCheck size={18} />
            <span>
              <strong>Fresh-context review boundary</strong>
              <p>
                Typed P0&ndash;P3 findings are persisted for gate evaluation; the retained artifact remains
                the full prose review record.
              </p>
            </span>
          </section>
          {artifactCard ?? empty}
        </div>
      );
    case "test":
      return (
        <div className="runtime-stage-stack">
          {artifactHistory}
          {focusedTest ? (
            <RuntimeFocusedTestEvidencePanel
              evidence={focusedTest}
              candidate={candidate}
              selectedResultId={selectedTestResultId}
              onSelectResult={onSelectTestResult}
            />
          ) : null}
          {artifactCard ?? empty}
        </div>
      );
    case "final-review":
      return (
        <div className="runtime-stage-stack">
          {artifactHistory}
          {candidate ? (
            <RuntimeCandidateDesk
              task={task}
              candidate={candidate}
              onOpenDiff={onOpenCandidateDiff}
              diffLoading={candidateDiffLoading}
              compact
            />
          ) : null}
          <RuntimeFinalReviewSummary task={task} candidate={candidate} />
          {artifactCard ?? empty}
        </div>
      );
    case "approval": {
      const promotion = getMergePromotionDetails(task, candidate);
      return (
        <div className="runtime-stage-stack">
          {candidate ? (
            <RuntimeCandidateDesk
              task={task}
              candidate={candidate}
              onOpenDiff={onOpenCandidateDiff}
              diffLoading={candidateDiffLoading}
              approval
            />
          ) : null}
          {promotion ? <RuntimeMergePromotionPanel promotion={promotion} /> : null}
          {artifactCard}
          {completedApprovalWithoutArtifact ? (
            <div className="runtime-stage-empty runtime-stage-empty--success">
              <CheckCircle size={22} weight="fill" />
              <strong>{candidate?.id} revision {candidate?.revisionNumber} merged</strong>
              <span>Reviewed commit <span className="mono">{candidate?.headRevision?.slice(0, 8)}</span> is now on {candidate?.baseBranch}.</span>
            </div>
          ) : null}
          {!artifact && !completedApprovalWithoutArtifact ? empty : null}
        </div>
      );
    }
  }
}

function scoutDispatchSummary(task: RuntimeTask) {
  const scoutArtifacts = task.artifacts.filter(
    (artifact) => artifact.stage === "scouts" && artifact.agentRole?.startsWith("scout-") && isModelRunArtifact(artifact),
  );
  const usage = sumArtifactUsage(scoutArtifacts);
  const dispatch = task.scoutDispatch;
  return [
    `${dispatch?.selected.length ?? 0} dispatched`,
    `${dispatch?.skipped.length ?? 0} skipped`,
    scoutArtifacts.length ? `${formatTokenCount(usage.inputTokens)} in / ${formatTokenCount(usage.outputTokens)} out` : null,
    usage.pricedRuns ? `${formatApproximateCost(usage.cost)} API-rate estimate` : null,
  ].filter(Boolean).join(" \u00b7 ");
}

function RuntimeArtifactHistory({
  artifacts,
  currentArtifact,
  onOpenArtifact,
}: {
  artifacts: RuntimeArtifact[];
  currentArtifact?: RuntimeArtifact;
  onOpenArtifact: (artifact: RuntimeArtifact) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const orderedArtifacts = [...artifacts].reverse();
  const visibleArtifacts = expanded ? orderedArtifacts : orderedArtifacts.slice(0, 2);
  const hiddenCount = orderedArtifacts.length - visibleArtifacts.length;
  return (
    <section className="runtime-artifact-history" aria-label="Stage artifact history">
      <header>
        <span><strong>Stage history</strong><small>Latest retained handoff stays on the stage; open any prior attempt read-only.</small></span>
        <small>{artifacts.length} retained</small>
      </header>
      <div>
        {visibleArtifacts.map((item) => {
          const stageAttempt = artifacts.findIndex((artifact) => artifact.id === item.id) + 1;
          const packageAttempt = item.workPackageId
            ? artifacts.filter((artifact) => artifact.workPackageId === item.workPackageId && artifact.createdAt <= item.createdAt).length
            : null;
          const label = item.candidateId && item.candidateRevision
            ? `${item.candidateId} r${item.candidateRevision} \u00b7 attempt ${stageAttempt}`
            : item.workPackageId
              ? `${item.workPackageId} \u00b7 slice attempt ${packageAttempt}`
              : `Attempt ${stageAttempt}`;
          const shown = item.id === currentArtifact?.id;
          return (
            <button type="button" key={item.id} onClick={() => onOpenArtifact(item)}>
              <span>
                <small>{label}</small>
                <strong>{item.name}</strong>
              </span>
              <span>
                {shown ? <em className="badge badge--blue">Latest shown</em> : <em className="badge">Prior</em>}
                <small>{isModelRunArtifact(item) ? `${formatTokenCount(item.usage.inputTokens)} in / ${formatTokenCount(item.usage.outputTokens)} out` : "Harness-generated"}</small>
                <time>{new Date(item.createdAt).toLocaleString()}</time>
              </span>
              <ArrowSquareOut size={15} />
            </button>
          );
        })}
        {orderedArtifacts.length > 2 ? (
          <button
            type="button"
            className="runtime-artifact-history__more"
            onClick={() => setExpanded((current) => !current)}
          >
            <span>
              <strong>{expanded ? "Show latest attempts only" : `Show ${hiddenCount} earlier attempt${hiddenCount === 1 ? "" : "s"}`}</strong>
              <small>Every retained artifact remains read-only and inspectable.</small>
            </span>
            <CaretDown className={expanded ? "is-expanded" : ""} size={15} />
          </button>
        ) : null}
      </div>
    </section>
  );
}

function RuntimeTaskDecisionSummary({ task, artifact }: { task: RuntimeTask; artifact?: RuntimeArtifact }) {
  const suppliedDecisionSource = artifact?.contextManifest?.sources.find((source) => source.kind === "decisions");
  return (
    <section className="runtime-task-decision-summary">
      <header>
        <span><strong>Task decisions on record</strong><small>This is the task-wide log, including decisions recorded after the specification.</small></span>
        <small>{suppliedDecisionSource?.label ?? "No decision block was supplied to this specification run"}</small>
      </header>
      <div>
        {task.decisions.map((decision) => {
          const recordedLater = artifact ? decision.createdAt > artifact.createdAt : false;
          return (
            <article key={decision.id}>
              <span><strong>{decision.question}</strong><small>{recordedLater ? "Recorded after this specification" : "Available by this specification"} &middot; {new Date(decision.createdAt).toLocaleString()}</small></span>
              <p>{decision.answer}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}

async function copyToClipboard(content: string) {
  const clipboard = globalThis.navigator?.clipboard;
  if (!clipboard?.writeText) return false;
  try {
    await clipboard.writeText(content);
    return true;
  } catch {
    return false;
  }
}

function RuntimeMergePromotionPanel({
  promotion,
}: {
  promotion: NonNullable<ReturnType<typeof getMergePromotionDetails>>;
}) {
  const [copyStatus, setCopyStatus] = useState<"copied" | "error" | null>(null);
  useEffect(() => {
    if (copyStatus !== "copied") return;
    const timer = window.setTimeout(() => setCopyStatus(null), 1_800);
    return () => window.clearTimeout(timer);
  }, [copyStatus]);
  return (
    <section className="runtime-merge-promotion" aria-label="Merge promotion">
      <header>
        <ShieldCheck size={18} weight="fill" />
        <span>
          <strong>Merged to target &middot; promotion is a manual step</strong>
          <small>The harness fast-forwarded this candidate into the recorded target branch. It does not push, promote, or merge any further.</small>
        </span>
      </header>
      <RuntimeFactGrid
        facts={[
          ["Candidate", `${promotion.candidateId} r${promotion.candidateRevision}`],
          ["Merged head SHA", promotion.headRevision],
          ["Target ref", promotion.targetRef],
        ]}
      />
      <div className="runtime-merge-promotion__command">
        <small>Promote onward &middot; copy only, not executed by the harness</small>
        <code className="mono">{promotion.promoteCommand}</code>
        <Button
          tone="ghost"
          compact
          onClick={() => {
            void copyToClipboard(promotion.promoteCommand).then((ok) => setCopyStatus(ok ? "copied" : "error"));
          }}
        >
          {copyStatus === "copied" ? "Copied" : copyStatus === "error" ? "Copy failed" : "Copy command"}
        </Button>
      </div>
    </section>
  );
}

function RuntimeFactGrid({ facts }: { facts: Array<[string, string]> }) {
  return (
    <section className="runtime-fact-grid" aria-label="Stage facts">
      {facts.map(([label, value]) => (
        <div key={label}>
          <small>{label}</small>
          <strong className={label === "Repository" ? "mono" : ""}>{value}</strong>
        </div>
      ))}
    </section>
  );
}

function RuntimeArtifactCard({
  artifact,
  candidate,
  freshness,
  hideStructuredTestPayload = false,
  onOpen,
}: {
  artifact: RuntimeArtifact;
  candidate: RuntimeTask["candidates"][number] | undefined;
  freshness: ReturnType<typeof getRuntimeArtifactFreshness>;
  hideStructuredTestPayload?: boolean;
  onOpen: () => void;
}) {
  const fresh = isCandidateBoundStage(artifact.stage)
    ? isArtifactFresh(artifact, candidate, freshness)
    : true;
  const focusedContent = hideStructuredTestPayload ? stripFocusedTestPayload(artifact.content) : artifact.content;
  const content = stripEmbeddedCandidatePatch(focusedContent);
  const staleCopy = freshness?.fresh
    ? "This retained handoff is superseded by the authoritative persisted run summary and remains available for audit."
    : freshness?.reasonCopy ?? "No authoritative persisted terminal run summary is available for this candidate.";
  return (
    <article className={`runtime-artifact-card ${fresh ? "" : "runtime-artifact-card--stale"}`}>
      <header>
        <span>
          <FileCode size={17} />
          <strong>{artifact.name}</strong>
          <small>{fresh ? "Current evidence" : "Superseded evidence"}</small>
        </span>
        <Button tone="ghost" compact icon={ArrowSquareOut} onClick={onOpen}>
          Open artifact
        </Button>
      </header>
      {!fresh ? (
        <div className="runtime-stale-banner">
          <strong>{freshness?.fresh ? "Superseded evidence" : "Rerun required"}</strong> {staleCopy} This handoff remains for audit only.
        </div>
      ) : null}
      <MarkdownContent content={content.trim() || "The structured result list above is the authoritative test evidence."} />
      <footer>
        <span>{new Date(artifact.createdAt).toLocaleString()}</span>
        <span>{isModelRunArtifact(artifact) ? `${artifact.model} · ${formatTokenCount(artifact.usage.inputTokens)} in / ${formatTokenCount(artifact.usage.outputTokens)} out · ${formatCacheRate(artifact.usage)} cached · ${formatApproximateCost(artifact.usage.cost)}` : "Harness-generated · no model call"}</span>
      </footer>
    </article>
  );
}

function stripFocusedTestPayload(content: string) {
  const start = content.indexOf("<focused-test-evidence>");
  const endTag = "</focused-test-evidence>";
  const end = content.indexOf(endTag);
  if (start < 0 || end < start) return content;
  return `${content.slice(0, start)}${content.slice(end + endTag.length)}`;
}

export function stripEmbeddedCandidatePatch(content: string) {
  const withoutPatch = content.replace(
    /\n?<details><summary>(?:Patch|Candidate patch[^<]*)<\/summary>[\s\S]*?<\/details>/gi,
    "\n\n> The full candidate diff is loaded on demand from Inspect diff.\n",
  );
  return withoutPatch.replace(/```([\w-]*)\n([\s\S]*?)```/g, (block, language, body) => {
    if (body.length <= 8_000) return block;
    return `\`\`\`${language}\nLarge generated/stat output omitted from this view. Open Inspect diff for the exact candidate changes.\n\`\`\``;
  });
}

function RuntimeStageEmpty({ task, viewedStageStopped }: { task: RuntimeTask; viewedStageStopped: boolean }) {
  return (
    <div className={`runtime-stage-empty ${viewedStageStopped ? "runtime-stage-empty--failed" : ""}`}>
      {task.status === "running" ? (
        <CircleNotch className="spin" size={22} />
      ) : viewedStageStopped ? (
        <WarningCircle size={22} />
      ) : (
        <FileCode size={22} />
      )}
      <strong>{viewedStageStopped ? "The stage stopped before producing an artifact" : "No artifact for this stage yet"}</strong>
      <span>{viewedStageStopped ? task.error : "The durable handoff will appear here when the stage completes."}</span>
    </div>
  );
}

function RuntimeCandidateDesk({
  task,
  candidate,
  onOpenDiff,
  diffLoading,
  compact = false,
  approval = false,
}: {
  task: RuntimeTask;
  candidate: RuntimeTask["candidates"][number];
  onOpenDiff: (target?: RuntimeTask["candidates"][number]) => void;
  diffLoading: boolean;
  compact?: boolean;
  approval?: boolean;
}) {
  const freshGates = candidateGateStages.filter((stage) => getRuntimeGateFreshness(task, stage)?.fresh);
  const gateSummaries = candidateGateStages.map((stage) => {
    const freshness = getRuntimeGateFreshness(task, stage);
    // A gate whose rerun is already in flight is neither "Fresh" nor genuinely "Rerun
    // required" — the freshness projection is stale-by-definition until that run finishes,
    // so surfacing "Rerun required" here would ask the operator to do something already
    // happening.
    const running = isStageRunning(task, stage);
    const unattempted = isGateUnattempted(freshness);
    return {
      label: workflowStages.find((item) => item.id === stage)?.shortLabel ?? stage,
      state: running ? "Running" : freshness?.fresh ? "Fresh" : unattempted ? "Pending" : "Rerun required",
      reason: running
        ? "A rerun for this stage is in progress."
        : freshness?.fresh
          ? "Latest terminal run is authoritative for this candidate."
          : unattempted
            ? "This gate has not run yet for the active candidate."
            : freshness?.reasonCopy ?? "No authoritative persisted terminal run summary is available for this candidate.",
    };
  });
  const facts: Array<[string, string]> = approval
    ? [
        ["Repository", task.repositoryPath],
        ["Candidate revision", `${candidate.id} r${candidate.revisionNumber}`],
        ["Target branch", candidate.baseBranch],
        ["Merge method", "Fast-forward only"],
        ["Required gates", "Dev Review \u00b7 Test \u00b7 Final Review"],
        ["Gate freshness", `${freshGates.length} of ${candidateGateStages.length} candidate-bound gates fresh`],
        ["Residual risks", task.artifacts.some((artifact) => artifact.stage === "final-review") ? "See retained Final Review" : "Not yet recorded"],
      ]
    : [
        ["Candidate revision", `${candidate.id} r${candidate.revisionNumber}`],
        ["Target branch", candidate.baseBranch],
        ["Merge method", "Fast-forward only"],
        ["Qualified slices", candidate.members?.map((item) => item.packageId).join(" \u2192 ") || "Pending assembly"],
        ["Gate freshness", `${freshGates.length} of ${candidateGateStages.length} candidate-bound gates fresh`],
        ["Conflict status", "Not recorded by the runtime"],
      ];
  return (
    <section className={`runtime-candidate-desk ${compact ? "runtime-candidate-desk--compact" : ""}`}>
      <header>
        <span className="candidate-badge">
          <GitDiff size={16} />
          <span>
            <small>Integration candidate</small>
            <strong>{candidate.id} r{candidate.revisionNumber}</strong>
          </span>
          <code>{candidate.headRevision?.slice(0, 8) ?? "pending"}</code>
        </span>
        <span className={`badge badge--${candidate.status === "merged" ? "green" : candidate.status === "repair_required" ? "red" : "blue"}`}>
          {candidate.status.replaceAll("_", " ")}
        </span>
      </header>
      <RuntimeFactGrid facts={facts} />
      {candidate.revisions.length ? (
        <details className="runtime-repair-lineage" open={candidate.revisions.length > 1}>
          <summary>
            <Wrench size={15} /> Repair lineage &middot; {candidate.revisions.length} revision{candidate.revisions.length === 1 ? "" : "s"}
            <CaretDown className="disclosure-caret" size={15} />
          </summary>
          {candidate.revisions.map((revision) => (
            <div key={revision.number}>
              <strong>r{revision.number} &middot; {revision.headRevision.slice(0, 8)}</strong>
              <span>{revision.reason}</span>
              <small>{new Date(revision.createdAt).toLocaleString()}</small>
              <button
                type="button"
                onClick={() => onOpenDiff({
                  ...candidate,
                  revisionNumber: revision.number,
                  headRevision: revision.headRevision,
                  status: revision.number === candidate.revisionNumber ? candidate.status : "superseded",
                })}
              >
                Inspect r{revision.number} diff <GitDiff size={13} />
              </button>
            </div>
          ))}
        </details>
      ) : null}
      <section className="runtime-gate-summary" aria-label="Candidate-bound gate freshness">
        {gateSummaries.map((gate) => (
          <div key={gate.label}>
            <span>
              <strong>{gate.label}</strong>
              <small>{gate.reason}</small>
            </span>
            <em className={gate.state === "Fresh" ? "text-green" : gate.state === "Running" ? "text-blue" : gate.state === "Pending" ? "text-muted" : "text-amber"}>{gate.state}</em>
          </div>
        ))}
      </section>
      <div className="runtime-candidate-desk__actions">
        {/* onOpenDiff takes no arguments; wiring it directly to onClick would pass the click
            SyntheticEvent through as its (defaulted) target parameter, which serialized as
            "candidates/undefined/rundefined/diff" \u2014 a shape the hash parser rejects, dropping
            the operator onto the default Command Centre route instead of the diff viewer. */}
        <Button tone={approval ? "secondary" : "primary"} compact icon={GitDiff} disabled={!candidate.headRevision || diffLoading} onClick={() => onOpenDiff()}>
          {diffLoading ? "Loading exact diff\u2026" : "Inspect exact candidate diff"}
        </Button>
        {approval ? <small>Primary merge action remains in the command bar above.</small> : null}
      </div>
    </section>
  );
}

function RuntimeFinalReviewSummary({
  task,
  candidate,
}: {
  task: RuntimeTask;
  candidate: RuntimeTask["candidates"][number] | undefined;
}) {
  const stages = workflowStages.slice(0, 8);
  return (
    <section className="runtime-final-review">
      <header>
        <span>
          <small>Workflow record</small>
          <strong>What was done</strong>
        </span>
        <small>{candidate ? `${candidate.id} r${candidate.revisionNumber}` : "No candidate assembled"}</small>
      </header>
      <div className="runtime-final-review__table">
        <div className="runtime-final-review__row runtime-final-review__row--head">
          <span>Stage</span><span>State</span><span>Tokens</span><span>Cost</span><span>Durable outcome</span>
        </div>
        {stages.map((stage) => {
          const artifacts = task.artifacts.filter((artifact) => artifact.stage === stage.id);
          const latest = artifacts.at(-1);
          const tokens = artifacts.reduce((total, item) => total + item.usage.totalTokens, 0);
          const cost = artifacts.reduce((total, item) => total + (item.usage.cost ?? 0), 0);
          const hasCost = artifacts.some((item) => item.usage.cost != null);
          const freshness = stage.id === "dev-review" || stage.id === "test" || stage.id === "final-review"
            ? getRuntimeGateFreshness(task, stage.id)
            : null;
          const unattempted = isGateUnattempted(freshness);
          const stale = freshness ? !freshness.fresh && !unattempted : false;
          const state = freshness && !unattempted
            ? freshness.fresh ? "Fresh" : "Rerun required"
            : isStageComplete(task, stage.id) ? "Passed" : "Pending";
          return (
            <div className="runtime-final-review__row" key={stage.id}>
              <strong>{stage.shortLabel}</strong>
              <span className={stale ? "text-amber" : state === "Fresh" || state === "Passed" ? "text-green" : ""}>
                {state}
              </span>
              <span className="mono">{formatTokenCount(tokens)}</span>
              <span>{hasCost ? formatApproximateCost(cost) : "Unavailable"}</span>
              <span>{freshness && !freshness.fresh ? freshness.reasonCopy : latest?.name ?? "No artifact retained"}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
