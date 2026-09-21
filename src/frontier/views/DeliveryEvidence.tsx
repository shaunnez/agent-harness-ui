import {
  ArrowRight,
  CheckCircle,
  Clock,
  GitPullRequest,
  ShieldCheck,
  WarningCircle,
} from "@phosphor-icons/react";
import type { RuntimeCandidate } from "../../domain";
import type { TaskCore } from "../runtime/contracts";

export function DeliveryEvidence({
  task,
  onDiff,
}: {
  task: TaskCore;
  onDiff?(candidate: RuntimeCandidate): void;
}) {
  const pr = task.pullRequestIntent;
  const candidate = task.candidates.at(-1);
  if (!pr)
    return (
      <section className="workflow-card approval-brief">
        <header className="panel-heading">
          <span>
            <ShieldCheck size={18} />
            <h3>{task.workflow === "investigate" ? "Investigation delivery" : "Human approval"}</h3>
          </span>
        </header>
        <div className="panel-content">
          <h3>
            {task.workflow === "investigate"
              ? "Approve the retained specification"
              : "Review the exact candidate before publication"}
          </h3>
          <p>
            {task.workflow === "investigate"
              ? "This investigation ends with an approved specification."
              : "Approve & raise PR publishes only the reviewed candidate. Completion follows confirmation that the matching pull request merged."}
          </p>
          {candidate && (
            <dl>
              <dt>Exact head</dt>
              <dd>
                <code>{candidate.headRevision ?? "Unavailable"}</code>
              </dd>
              <dt>Target branch</dt>
              <dd>{candidate.baseBranch}</dd>
              <dt>Integrated slices</dt>
              <dd>{candidate.members?.map((item) => item.packageId).join(", ") || "Unavailable"}</dd>
            </dl>
          )}
          <small>
            Use the eligible action in the command bar. Proceed with reason lets you record an approval note
            before submission.
          </small>
        </div>
      </section>
    );
  const matches = Boolean(
    candidate &&
      pr.candidateId === candidate.id &&
      pr.candidateRevision === candidate.revisionNumber &&
      pr.headRevision === candidate.headRevision &&
      pr.targetBranch === candidate.baseBranch,
  );
  const blocked = task.status === "blocked" || pr.status === "closed" || !matches;
  const completed =
    !blocked && pr.status === "merged" && task.status === "completed" && Boolean(task.completedAt);
  const title = blocked
    ? "Delivery blocked"
    : completed
      ? "Delivery completed"
      : pr.status === "open"
        ? "Awaiting PR merge"
        : pr.status === "merged"
          ? "Merge recorded · completion pending"
          : `PR ${pr.status}`;
  return (
    <section className="workflow-card delivery-evidence">
      <header className="panel-heading">
        <span>
          <GitPullRequest size={18} />
          <h3>{title}</h3>
        </span>
        {blocked ? <WarningCircle size={20} /> : completed ? <CheckCircle size={20} /> : <Clock size={20} />}
      </header>
      <div className="panel-content">
        <h3>
          {pr.repository} {pr.number ? `#${pr.number}` : "· Identity pending"}
        </h3>
        <dl>
          <dt>Exact approved head</dt>
          <dd>
            <code>{pr.headRevision}</code>
          </dd>
          <dt>Candidate</dt>
          <dd>
            {pr.candidateId} r{pr.candidateRevision}
          </dd>
          <dt>Target</dt>
          <dd>{pr.targetBranch}</dd>
          <dt>Last GitHub check</dt>
          <dd>{pr.lastCheckedAt ? new Date(pr.lastCheckedAt).toLocaleString() : "Not yet checked"}</dd>
          <dt>Completion</dt>
          <dd>
            {completed
              ? new Date(task.completedAt as string).toLocaleString()
              : blocked
                ? "Blocked; approved candidate retained"
                : "Pending exact merge confirmation"}
          </dd>
        </dl>
        {!matches && (
          <p className="form-error">
            The recorded PR identity does not match the current candidate. This delivery is not complete.
          </p>
        )}
        {pr.lastError && <p className="form-error">{pr.lastError}</p>}
        {pr.url && /^https:\/\//.test(pr.url) && (
          <a className="button primary" href={pr.url} target="_blank" rel="noreferrer">
            Open pull request <ArrowRight size={17} />
          </a>
        )}
      </div>
      {candidate && onDiff && (
        <div className="panel-content">
          <button type="button" disabled={!candidate.headRevision} onClick={() => onDiff(candidate)}>
            Open exact diff
          </button>
        </div>
      )}
      <ol className="delivery-timeline">
        {[
          { label: "Publication requested", at: pr.startedAt },
          { label: "PR opened", at: pr.openedAt },
          {
            label: completed ? "Delivery completed" : "Exact merge confirmation",
            at: completed ? task.completedAt : null,
          },
        ].map((item) => (
          <li key={item.label} data-recorded={Boolean(item.at)}>
            {item.at ? <CheckCircle size={23} /> : <Clock size={23} />}
            <strong>{item.label}</strong>
            <small>{item.at ? new Date(item.at).toLocaleString() : blocked ? "Blocked" : "Pending"}</small>
          </li>
        ))}
      </ol>
      <p className="panel-content quiet">
        The runtime tracks this exact PR, repository, target and approved head. Opening a PR does not complete
        the task.
      </p>
    </section>
  );
}
