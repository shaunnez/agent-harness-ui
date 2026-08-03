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
import {
  formatApproximateCost,
  formatCacheRate,
  formatTokenCount,
  type RuntimeArtifact,
  type RuntimeTask,
  type StageId,
  workflowStages,
} from "../../domain";
import { MarkdownContent } from "../MarkdownContent";
import { Button } from "../Primitives";
import { RuntimeGrillPanel } from "./RuntimeGrillPanel";
import { RuntimeFocusedTestEvidencePanel, RuntimeWorkPackages } from "./RuntimeEvidencePanels";
import {
  getCandidateStageFreshness,
  getFreshnessLabel,
  getFreshnessMessage,
  isCandidateBoundStage,
  isStageComplete,
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
  onOpenCandidateDiff: () => void;
  candidateDiffLoading: boolean;
  selectedTestResultId: string | null;
  onSelectTestResult: (resultId: string | null) => void;
}) {
  const stageArtifacts = task.artifacts.filter((item) => item.stage === viewedStageId);
  const focusedProjection = task.candidateFreshness?.currentFocusedTest;
  const projectedFocusedArtifact = focusedProjection
    ? task.artifacts.find((item) => item.id === focusedProjection.artifactId && item.stage === "test")
    : undefined;
  const focusedArtifact =
    projectedFocusedArtifact ?? [...stageArtifacts].reverse().find((item) => item.focusedTest);
  const focusedEvidence = focusedProjection?.evidence ?? focusedArtifact?.focusedTest;
  const focusedEvidenceFreshness = focusedProjection?.freshness ?? null;
  const artifactCard = artifact ? (
    <RuntimeArtifactCard
      artifact={artifact}
      hideStructuredTestPayload={viewedStageId === "test"}
      onOpen={() => onOpenArtifact(artifact)}
    />
  ) : null;
  const empty =
    !artifact && !completedApprovalWithoutArtifact ? (
      <RuntimeStageEmpty task={task} viewedStageStopped={viewedStageStopped} />
    ) : null;

  switch (viewedStageId) {
    case "triage":
      return (
        <div className="runtime-stage-stack">
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
                <span>
                  <Robot size={18} />
                  <strong>Selective scout dispatch</strong>
                </span>
                <small>
                  {task.scoutDispatch.selected.length} dispatched &middot; {task.scoutDispatch.skipped.length}{" "}
                  skipped
                </small>
              </header>
              <p>
                {task.scoutDispatch.rationale ??
                  "No dispatch rationale was retained for this historical task."}
              </p>
              <div>
                {task.scoutDispatch.selected.map((scout) => (
                  <article key={scout.name}>
                    <span className={`scout-dispatch-state scout-dispatch-state--${scout.status}`} />
                    <span>
                      <strong>{scout.name}</strong>
                      <small>{scout.focus}</small>
                      <p>{scout.reason}</p>
                      {scout.error ? <p className="text-red">{scout.error}</p> : null}
                    </span>
                  </article>
                ))}
                {task.scoutDispatch.selected.length === 0 ? (
                  <p>
                    No scouts were dispatched; triage explicitly determined that no additional repository
                    evidence was needed.
                  </p>
                ) : null}
              </div>
            </section>
          ) : null}
          <section className="runtime-evidence-source">
            <CheckCircle size={18} weight="fill" />
            <span>
              <small>Repository evidence &middot; real agent handoff</small>
              <strong>{artifact?.name ?? "No scout artifact yet"}</strong>
              <p>
                {artifact
                  ? `${artifact.model} \u00b7 ${formatTokenCount(artifact.usage.totalTokens)} tokens \u00b7 ${new Date(artifact.createdAt).toLocaleString()}`
                  : "The scout stage has not produced an artifact."}
              </p>
            </span>
          </section>
          {artifactCard ?? empty}
        </div>
      );
    case "grill":
      return (
        <div className="runtime-stage-stack">
          <section className="runtime-evidence-source">
            <FileCode size={18} />
            <span>
              <small>Repository evidence</small>
              <strong>
                {task.artifacts.find((item) => item.stage === "scouts")?.name ?? "Scout handoff unavailable"}
              </strong>
              <p>
                Open the retained scout artifact from Living artifacts for the exact repository claims behind
                this decision.
              </p>
            </span>
          </section>
          {task.grillSession ? <RuntimeGrillPanel task={task} onAnswer={onAnswer} /> : empty}
          {artifactCard}
        </div>
      );
    case "specification":
      return (
        <div className="runtime-stage-stack">
          <RuntimeFactGrid
            facts={[
              ["Artifact", artifact?.name ?? "Pending"],
              [
                "Approval",
                task.approvals.some((item) => item.stage === "specification")
                  ? "Approved"
                  : "Awaiting approval",
              ],
              ["Decisions", `${task.decisions.length} retained`],
              ["Provenance", artifact?.model ?? "Not recorded"],
            ]}
          />
          {artifactCard ?? empty}
        </div>
      );
    case "plan":
      return (
        <div className="runtime-stage-stack">
          {task.workPackages.length ? <RuntimeWorkPackages task={task} /> : null}
          {artifactCard ?? empty}
        </div>
      );
    case "implement":
      return (
        <div className="runtime-stage-stack">
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
                Review findings remain authoritative inside the retained artifact because the runtime does not
                persist typed P0&ndash;P3 finding records.
              </p>
            </span>
          </section>
          {artifactCard ?? empty}
        </div>
      );
    case "test":
      return (
        <div className="runtime-stage-stack">
          {focusedEvidence ? (
            <RuntimeFocusedTestEvidencePanel
              evidence={focusedEvidence}
              freshness={focusedEvidenceFreshness}
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
    case "approval":
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
          {artifactCard}
          {completedApprovalWithoutArtifact && isStageComplete(task, "approval") ? (
            <div className="runtime-stage-empty runtime-stage-empty--success">
              <CheckCircle size={22} weight="fill" />
              <strong>
                {candidate?.id} revision {candidate?.revisionNumber} merged
              </strong>
              <span>
                Reviewed commit <span className="mono">{candidate?.headRevision?.slice(0, 8)}</span> is now on{" "}
                {candidate?.baseBranch}.
              </span>
            </div>
          ) : null}
          {!artifact && !completedApprovalWithoutArtifact ? empty : null}
        </div>
      );
  }
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
  hideStructuredTestPayload = false,
  onOpen,
}: {
  artifact: RuntimeArtifact;
  hideStructuredTestPayload?: boolean;
  onOpen: () => void;
}) {
  const freshness = artifact.freshness;
  const fresh = freshness?.state === "fresh";
  const focusedContent = hideStructuredTestPayload
    ? stripFocusedTestPayload(artifact.content)
    : artifact.content;
  const content = stripEmbeddedCandidatePatch(focusedContent);
  return (
    <article className={`runtime-artifact-card ${fresh ? "" : "runtime-artifact-card--stale"}`}>
      <header>
        <span>
          <FileCode size={17} />
          <strong>{artifact.name}</strong>
          <small>{getFreshnessLabel(freshness)}</small>
        </span>
        <Button tone="ghost" compact icon={ArrowSquareOut} onClick={onOpen}>
          Open artifact
        </Button>
      </header>
      {!fresh ? (
        <div className="runtime-stale-banner">
          <strong>{getFreshnessLabel(freshness)}</strong> &middot; {getFreshnessMessage(freshness)} This
          handoff remains available for audit only.
        </div>
      ) : null}
      <MarkdownContent
        content={content.trim() || "The structured result list above is the authoritative test evidence."}
      />
      <footer>
        <span>{new Date(artifact.createdAt).toLocaleString()}</span>
        <span>
          {artifact.model} &middot; {formatTokenCount(artifact.usage.inputTokens)} in /{" "}
          {formatTokenCount(artifact.usage.outputTokens)} out &middot; {formatCacheRate(artifact.usage)}{" "}
          cached &middot; {formatApproximateCost(artifact.usage.cost)}
        </span>
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
      <strong>
        {viewedStageStopped
          ? "The stage stopped before producing an artifact"
          : "No artifact for this stage yet"}
      </strong>
      <span>
        {viewedStageStopped ? task.error : "The durable handoff will appear here when the stage completes."}
      </span>
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
  onOpenDiff: () => void;
  diffLoading: boolean;
  compact?: boolean;
  approval?: boolean;
}) {
  const gateStages: StageId[] = ["dev-review", "test", "final-review"];
  const freshGates = gateStages.filter((stage) => getCandidateStageFreshness(task, stage)?.state === "fresh");
  const staleGateReasons = gateStages
    .map((stage) => ({ stage, freshness: getCandidateStageFreshness(task, stage) }))
    .filter((item) => item.freshness?.state === "stale");
  const freshnessUnavailable = !task.candidateFreshness;
  const facts: Array<[string, string]> = approval
    ? [
        ["Repository", task.repositoryPath],
        ["Target branch", candidate.baseBranch],
        ["Merge method", "Fast-forward only"],
        ["Required gates", "Dev Review \u00b7 Test \u00b7 Final Review"],
        ["Gate freshness", `${freshGates.length} of ${gateStages.length} candidate-bound gates fresh`],
        [
          "Residual risks",
          task.artifacts.some((artifact) => artifact.stage === "final-review")
            ? "See retained Final Review"
            : "Not yet recorded",
        ],
      ]
    : [
        ["Target branch", candidate.baseBranch],
        ["Merge method", "Fast-forward only"],
        [
          "Qualified slices",
          candidate.members?.map((item) => item.packageId).join(" \u2192 ") || "Pending assembly",
        ],
        ["Gate freshness", `${freshGates.length} of ${gateStages.length} candidate-bound gates fresh`],
        ["Conflict status", "Not recorded by the runtime"],
      ];
  return (
    <section className={`runtime-candidate-desk ${compact ? "runtime-candidate-desk--compact" : ""}`}>
      <header>
        <span className="candidate-badge">
          <GitDiff size={16} />
          <span>
            <small>Integration candidate</small>
            <strong>
              {candidate.id} r{candidate.revisionNumber}
            </strong>
          </span>
          <code>{candidate.headRevision?.slice(0, 8) ?? "pending"}</code>
        </span>
        <span
          className={`badge badge--${candidate.status === "merged" ? "green" : candidate.status === "repair_required" ? "red" : "blue"}`}
        >
          {candidate.status.replaceAll("_", " ")}
        </span>
      </header>
      <RuntimeFactGrid facts={facts} />
      {freshnessUnavailable || staleGateReasons.length ? (
        <div className="runtime-stale-banner" role="status">
          <strong>{freshnessUnavailable ? "Rerun required" : "Candidate gates require rerun"}</strong>
          {freshnessUnavailable ? (
            <span>
              Freshness projection is unavailable; reload the task before treating any candidate gate as
              current.
            </span>
          ) : (
            <span>
              {staleGateReasons.map(({ stage, freshness }) => (
                <span key={stage}>
                  {workflowStages.find((entry) => entry.id === stage)?.shortLabel ?? stage}:{" "}
                  {getFreshnessMessage(freshness)}{" "}
                </span>
              ))}
            </span>
          )}
        </div>
      ) : null}
      {candidate.revisions.length ? (
        <details className="runtime-repair-lineage" open={candidate.revisions.length > 1}>
          <summary>
            <Wrench size={15} /> Repair lineage &middot; {candidate.revisions.length} revision
            {candidate.revisions.length === 1 ? "" : "s"}
            <CaretDown className="disclosure-caret" size={15} />
          </summary>
          {candidate.revisions.map((revision) => (
            <div key={revision.number}>
              <strong>
                r{revision.number} &middot; {revision.headRevision.slice(0, 8)}
              </strong>
              <span>{revision.reason}</span>
              <small>{new Date(revision.createdAt).toLocaleString()}</small>
            </div>
          ))}
        </details>
      ) : null}
      <div className="runtime-candidate-desk__actions">
        <Button
          tone={approval ? "secondary" : "primary"}
          compact
          icon={GitDiff}
          disabled={!candidate.headRevision || diffLoading}
          onClick={onOpenDiff}
        >
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
          <span>Stage</span>
          <span>State</span>
          <span>Tokens</span>
          <span>Cost</span>
          <span>Durable outcome</span>
        </div>
        {stages.map((stage) => {
          const artifacts = task.artifacts.filter((artifact) => artifact.stage === stage.id);
          const latest = artifacts.at(-1);
          const tokens = artifacts.reduce((total, item) => total + item.usage.totalTokens, 0);
          const cost = artifacts.reduce((total, item) => total + (item.usage.cost ?? 0), 0);
          const hasCost = artifacts.some((item) => item.usage.cost != null);
          const stageFreshness = getCandidateStageFreshness(task, stage.id);
          const freshness = stageFreshness ?? latest?.freshness;
          const unavailable = isCandidateBoundStage(stage.id) && !freshness;
          const stale = freshness?.state === "stale" || unavailable;
          const stateLabel = stale
            ? getFreshnessLabel(freshness)
            : isStageComplete(task, stage.id)
              ? "Passed"
              : "Pending";
          const stateMessage = unavailable
            ? "Freshness projection is unavailable; this candidate stage cannot be treated as current."
            : getFreshnessMessage(freshness);
          return (
            <div className="runtime-final-review__row" key={stage.id}>
              <strong>{stage.shortLabel}</strong>
              <span
                className={stale ? "text-amber" : stateLabel === "Passed" ? "text-green" : ""}
                title={stale ? stateMessage : undefined}
              >
                {stateLabel}
              </span>
              <span className="mono">{formatTokenCount(tokens)}</span>
              <span>{hasCost ? formatApproximateCost(cost) : "Unavailable"}</span>
              <span>{stale ? stateMessage : (latest?.name ?? "No artifact retained")}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
