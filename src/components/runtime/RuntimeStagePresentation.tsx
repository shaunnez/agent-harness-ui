import { ArrowSquareOut, CheckCircle, FileCode, Robot, ShieldCheck } from "@phosphor-icons/react";
import { resolveScoutUsage } from "../../artifactPresentation";
import {
  formatApproximateCost,
  formatCacheRate,
  formatTokenCount,
  type RuntimeArtifact,
  type RuntimeTask,
  type StageId,
} from "../../domain";
import { RuntimeGrillPanel } from "./RuntimeGrillPanel";
import { RuntimeFocusedTestEvidencePanel, RuntimeWorkPackages } from "./RuntimeEvidencePanels";
import {
  RuntimeCandidateDesk,
  RuntimeFinalReviewSummary,
  RuntimePullRequestPanel,
} from "./RuntimeCandidatePanels";
import {
  isRepositoryScoutHandoff,
  RuntimeArtifactCard,
  RuntimeArtifactHistory,
  RuntimeFactGrid,
  RuntimeMergePromotionPanel,
  RuntimeStageEmpty,
  RuntimeTaskDecisionSummary,
  scoutDispatchSummary,
} from "./RuntimeStageArtifactPanels";
import { getMergePromotionDetails, getRuntimeArtifactFreshness, getRuntimeFocusedTest } from "./workflow";

export function RuntimeStagePresentation({
  task,
  viewedStageId,
  artifact,
  candidate,
  completedApprovalWithoutArtifact,
  viewedStageStopped,
  readOnlyPreview = false,
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
  readOnlyPreview?: boolean;
  onAnswer: (questionId: string, answer: string) => Promise<void>;
  onOpenArtifact: (artifact: RuntimeArtifact) => void;
  onOpenCandidateDiff: (target?: RuntimeTask["candidates"][number]) => void;
  candidateDiffLoading: boolean;
  selectedTestResultId: string | null;
  onSelectTestResult: (resultId: string | null) => void;
}) {
  const focusedTest = getRuntimeFocusedTest(task);
  const stageArtifacts = task.artifacts.filter((item) => item.stage === viewedStageId);
  const artifactHistory =
    stageArtifacts.length > 1 && viewedStageId !== "scouts" ? (
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
  const empty =
    !artifact && !completedApprovalWithoutArtifact ? (
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
    case "scouts": {
      const scoutUsage = resolveScoutUsage(task);
      const dispatch = task.scoutDispatch;
      const handoffArtifact = [...task.artifacts]
        .reverse()
        .find((item) => item.stage === "scouts" && isRepositoryScoutHandoff(item));
      const scoutsArtifact = handoffArtifact ?? artifact;
      const scoutsArtifactCard = scoutsArtifact ? (
        <RuntimeArtifactCard
          artifact={scoutsArtifact}
          candidate={candidate}
          freshness={
            scoutsArtifact.id === artifact?.id
              ? artifactFreshness
              : getRuntimeArtifactFreshness(task, scoutsArtifact)
          }
          onOpen={() => onOpenArtifact(scoutsArtifact)}
        />
      ) : null;
      const rationale = dispatch?.rationale ?? "No dispatch rationale was retained for this historical task.";
      return (
        <div className="runtime-stage-stack">
          {dispatch ? (
            dispatch.selected.length === 0 ? (
              <section className="scout-dispatch-panel">
                <header>
                  <span>
                    <Robot size={18} />
                    <strong>No scouts dispatched</strong>
                  </span>
                </header>
                <p>{rationale}</p>
              </section>
            ) : (
              <section className="scout-dispatch-panel">
                <header>
                  <span>
                    <Robot size={18} />
                    <strong>Selective scout dispatch</strong>
                  </span>
                  <small>{scoutDispatchSummary(task, scoutUsage)}</small>
                </header>
                <p>{rationale}</p>
                <div>
                  {scoutUsage.perScout.map((match) => {
                    const scoutArtifact = match.representativeArtifact;
                    const usageCopy = `${formatTokenCount(match.usage.inputTokens)} in · ${formatTokenCount(match.usage.outputTokens)} out`;
                    return (
                      <article key={match.scout.name}>
                        <span
                          className={`scout-dispatch-state scout-dispatch-state--${match.scout.status}`}
                        />
                        <span>
                          <strong>{match.scout.name}</strong>
                          <small>{match.scout.focus}</small>
                          <p>{match.scout.reason}</p>
                          {scoutArtifact ? (
                            <button
                              type="button"
                              className="scout-dispatch-usage"
                              onClick={() => onOpenArtifact(scoutArtifact)}
                            >
                              <span>{usageCopy}</span>
                              <span>
                                {formatCacheRate(match.usage)} cached ·{" "}
                                {formatApproximateCost(match.usage.cost)}
                              </span>
                              <ArrowSquareOut size={14} />
                            </button>
                          ) : (
                            <small>{usageCopy} · No recorded child scout run</small>
                          )}
                          {match.scout.error ? <p className="text-red">{match.scout.error}</p> : null}
                        </span>
                      </article>
                    );
                  })}
                </div>
              </section>
            )
          ) : null}
          <section className="runtime-evidence-source">
            <CheckCircle size={18} weight="fill" />
            <span>
              <small>Downstream handoff · deterministic aggregation</small>
              <strong>{handoffArtifact?.name ?? "No scout handoff yet"}</strong>
              <p>
                {handoffArtifact
                  ? `Inputs: ${dispatch?.selected.length ? `child scout reports (${scoutUsage.matchedArtifacts.length} retained)` : "none dispatched"}; no additional model call · ${new Date(handoffArtifact.createdAt).toLocaleString()}`
                  : "The deterministic downstream handoff has not been produced yet."}
              </p>
            </span>
          </section>
          {scoutsArtifactCard ?? empty}
        </div>
      );
    }
    case "grill":
      return (
        <div className="runtime-stage-stack">
          {artifactHistory}
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
          {task.grillSession ? (
            <RuntimeGrillPanel task={task} readOnly={readOnlyPreview} onAnswer={onAnswer} />
          ) : (
            empty
          )}
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
              [
                "Approval",
                task.approvals.some((item) => item.stage === "specification")
                  ? "Approved"
                  : "Awaiting approval",
              ],
              ["Task decision log", `${task.decisions.length} recorded across the workflow`],
              [
                "Provenance",
                artifact?.model ??
                  (artifact?.sourceTaskId ? `Imported from ${artifact.sourceTaskId}` : "Not recorded"),
              ],
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
      const pullRequest = task.pullRequestIntent;
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
          {pullRequest ? <RuntimePullRequestPanel pullRequest={pullRequest} /> : null}
          {artifactCard}
          {completedApprovalWithoutArtifact ? (
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
}
