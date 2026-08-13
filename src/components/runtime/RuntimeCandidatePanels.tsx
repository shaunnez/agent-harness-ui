import { ArrowSquareOut, CaretDown, GitDiff, ShieldCheck, Wrench } from "@phosphor-icons/react";
import { formatApproximateCost, formatTokenCount, type RuntimeTask, workflowStages } from "../../domain";
import { Button } from "../Primitives";
import { RuntimeFactGrid } from "./RuntimeStageArtifactPanels";
import {
  candidateGateStages,
  getRuntimeGateFreshness,
  isGateUnattempted,
  isStageComplete,
  isStageRunning,
} from "./workflow";

export function RuntimePullRequestPanel({
  pullRequest,
}: {
  pullRequest: NonNullable<RuntimeTask["pullRequestIntent"]>;
}) {
  const stateCopy =
    pullRequest.status === "merged"
      ? "Merged on GitHub · task completed"
      : pullRequest.status === "open"
        ? "Awaiting GitHub merge"
        : pullRequest.status === "publishing"
          ? "Publishing GitHub PR"
          : pullRequest.status === "closed"
            ? "Closed without merge"
            : "GitHub PR needs attention";
  return (
    <section className="runtime-merge-promotion" aria-label="GitHub pull request">
      <header>
        <ShieldCheck size={18} weight="fill" />
        <span>
          <strong>{stateCopy}</strong>
          <small>
            The Harness tracks this exact candidate head and completes the task only when GitHub reports this
            PR merged.
          </small>
        </span>
      </header>
      <RuntimeFactGrid
        facts={[
          ["Pull request", pullRequest.number ? `#${pullRequest.number}` : "Pending"],
          ["Exact head SHA", pullRequest.headRevision],
          ["Target branch", pullRequest.targetBranch],
          [
            "Last checked",
            pullRequest.lastCheckedAt
              ? new Date(pullRequest.lastCheckedAt).toLocaleString()
              : "Not yet checked",
          ],
        ]}
      />
      {pullRequest.url ? (
        <a className="button button--secondary" href={pullRequest.url} target="_blank" rel="noreferrer">
          Open PR on GitHub <ArrowSquareOut size={15} />
        </a>
      ) : null}
      {pullRequest.lastError ? (
        <p className="field-error">Last GitHub check: {pullRequest.lastError}</p>
      ) : null}
    </section>
  );
}

export function RuntimeCandidateDesk({
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
            : (freshness?.reasonCopy ??
              "No authoritative persisted terminal run summary is available for this candidate."),
    };
  });
  const facts: Array<[string, string]> = approval
    ? [
        ["Repository", task.repositoryPath],
        ["Candidate revision", `${candidate.id} r${candidate.revisionNumber}`],
        ["Target branch", candidate.baseBranch],
        ["Delivery method", "GitHub pull request"],
        ["Required gates", "Dev Review \u00b7 Test \u00b7 Final Review"],
        [
          "Gate freshness",
          `${freshGates.length} of ${candidateGateStages.length} candidate-bound gates fresh`,
        ],
        [
          "Residual risks",
          task.artifacts.some((artifact) => artifact.stage === "final-review")
            ? "See retained Final Review"
            : "Not yet recorded",
        ],
      ]
    : [
        ["Candidate revision", `${candidate.id} r${candidate.revisionNumber}`],
        ["Target branch", candidate.baseBranch],
        ["Merge method", "Fast-forward only"],
        [
          "Qualified slices",
          candidate.members?.map((item) => item.packageId).join(" \u2192 ") || "Pending assembly",
        ],
        [
          "Gate freshness",
          `${freshGates.length} of ${candidateGateStages.length} candidate-bound gates fresh`,
        ],
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
      {candidate.revisions.length ? (
        <details className="runtime-repair-lineage" open={candidate.revisions.length > 1}>
          <summary>
            <Wrench size={15} /> Candidate revision lineage &middot; {candidate.revisions.length} revision
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
              <button
                type="button"
                onClick={() =>
                  onOpenDiff({
                    ...candidate,
                    revisionNumber: revision.number,
                    headRevision: revision.headRevision,
                    status: revision.number === candidate.revisionNumber ? candidate.status : "superseded",
                  })
                }
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
            <em
              className={
                gate.state === "Fresh"
                  ? "text-green"
                  : gate.state === "Running"
                    ? "text-blue"
                    : gate.state === "Pending"
                      ? "text-muted"
                      : "text-amber"
              }
            >
              {gate.state}
            </em>
          </div>
        ))}
      </section>
      <div className="runtime-candidate-desk__actions">
        {/* onOpenDiff takes no arguments; wiring it directly to onClick would pass the click
            SyntheticEvent through as its (defaulted) target parameter, which serialized as
            "candidates/undefined/rundefined/diff" \u2014 a shape the hash parser rejects, dropping
            the operator onto the default Command Centre route instead of the diff viewer. */}
        <Button
          tone={approval ? "secondary" : "primary"}
          compact
          icon={GitDiff}
          disabled={!candidate.headRevision || diffLoading}
          onClick={() => onOpenDiff()}
        >
          {diffLoading ? "Loading exact diff\u2026" : "Inspect exact candidate diff"}
        </Button>
        {approval ? <small>Primary merge action remains in the command bar above.</small> : null}
      </div>
    </section>
  );
}

export function RuntimeFinalReviewSummary({
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
          const freshness =
            stage.id === "dev-review" || stage.id === "test" || stage.id === "final-review"
              ? getRuntimeGateFreshness(task, stage.id)
              : null;
          const unattempted = isGateUnattempted(freshness);
          const stale = freshness ? !freshness.fresh && !unattempted : false;
          const state =
            freshness && !unattempted
              ? freshness.fresh
                ? "Fresh"
                : "Rerun required"
              : isStageComplete(task, stage.id)
                ? "Passed"
                : "Pending";
          return (
            <div className="runtime-final-review__row" key={stage.id}>
              <strong>{stage.shortLabel}</strong>
              <span
                className={stale ? "text-amber" : state === "Fresh" || state === "Passed" ? "text-green" : ""}
              >
                {state}
              </span>
              <span className="mono">{formatTokenCount(tokens)}</span>
              <span>{hasCost ? formatApproximateCost(cost) : "Unavailable"}</span>
              <span>
                {freshness && !freshness.fresh
                  ? freshness.reasonCopy
                  : (latest?.name ?? "No artifact retained")}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
