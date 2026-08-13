import {
  ArrowSquareOut,
  CaretDown,
  CircleNotch,
  FileCode,
  ShieldCheck,
  WarningCircle,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { isModelRunArtifact, type resolveScoutUsage } from "../../artifactPresentation";
import {
  formatApproximateCost,
  formatCacheRate,
  formatTokenCount,
  type RuntimeArtifact,
  type RuntimeTask,
} from "../../domain";
import { MarkdownContent } from "../MarkdownContent";
import { Button } from "../Primitives";
import {
  type getMergePromotionDetails,
  type getRuntimeArtifactFreshness,
  isArtifactFresh,
  isCandidateBoundStage,
} from "./workflow";

export function scoutDispatchSummary(task: RuntimeTask, scoutUsage: ReturnType<typeof resolveScoutUsage>) {
  const usage = scoutUsage.aggregate;
  const dispatch = task.scoutDispatch;
  return [
    `${dispatch?.selected.length ?? 0} dispatched`,
    `${dispatch?.skipped.length ?? 0} skipped`,
    `${formatTokenCount(usage.inputTokens)} in / ${formatTokenCount(usage.outputTokens)} out`,
    usage.pricedRuns ? `${formatApproximateCost(usage.cost)} API-rate estimate` : null,
  ]
    .filter(Boolean)
    .join(" \u00b7 ");
}

export function isRepositoryScoutHandoff(artifact: RuntimeArtifact) {
  return artifact.name.replaceAll("\\", "/").split("/").at(-1)?.toLowerCase() === "repository-scout.md";
}

export function RuntimeArtifactHistory({
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
        <span>
          <strong>Stage history</strong>
          <small>Latest retained handoff stays on the stage; open any prior attempt read-only.</small>
        </span>
        <small>{artifacts.length} retained</small>
      </header>
      <div>
        {visibleArtifacts.map((item) => {
          const stageAttempt = artifacts.findIndex((artifact) => artifact.id === item.id) + 1;
          const packageAttempt = item.workPackageId
            ? artifacts.filter(
                (artifact) =>
                  artifact.workPackageId === item.workPackageId && artifact.createdAt <= item.createdAt,
              ).length
            : null;
          const label =
            item.candidateId && item.candidateRevision
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
                {shown ? (
                  <em className="badge badge--blue">Latest shown</em>
                ) : (
                  <em className="badge">Prior</em>
                )}
                <small>
                  {isModelRunArtifact(item)
                    ? `${formatTokenCount(item.usage.inputTokens)} in / ${formatTokenCount(item.usage.outputTokens)} out`
                    : "Harness-generated"}
                </small>
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
              <strong>
                {expanded
                  ? "Show latest attempts only"
                  : `Show ${hiddenCount} earlier attempt${hiddenCount === 1 ? "" : "s"}`}
              </strong>
              <small>Every retained artifact remains read-only and inspectable.</small>
            </span>
            <CaretDown className={expanded ? "is-expanded" : ""} size={15} />
          </button>
        ) : null}
      </div>
    </section>
  );
}

export function RuntimeTaskDecisionSummary({
  task,
  artifact,
}: {
  task: RuntimeTask;
  artifact?: RuntimeArtifact;
}) {
  const suppliedDecisionSource = artifact?.contextManifest?.sources.find(
    (source) => source.kind === "decisions",
  );
  return (
    <section className="runtime-task-decision-summary">
      <header>
        <span>
          <strong>Task decisions on record</strong>
          <small>This is the task-wide log, including decisions recorded after the specification.</small>
        </span>
        <small>
          {suppliedDecisionSource?.label ?? "No decision block was supplied to this specification run"}
        </small>
      </header>
      <div>
        {task.decisions.map((decision) => {
          const recordedLater = artifact ? decision.createdAt > artifact.createdAt : false;
          return (
            <article key={decision.id}>
              <span>
                <strong>{decision.question}</strong>
                <small>
                  {recordedLater ? "Recorded after this specification" : "Available by this specification"}{" "}
                  &middot; {new Date(decision.createdAt).toLocaleString()}
                </small>
              </span>
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

export function RuntimeMergePromotionPanel({
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
          <small>
            The harness fast-forwarded this candidate into the recorded target branch. It does not push,
            promote, or merge any further.
          </small>
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
            void copyToClipboard(promotion.promoteCommand).then((ok) =>
              setCopyStatus(ok ? "copied" : "error"),
            );
          }}
        >
          {copyStatus === "copied" ? "Copied" : copyStatus === "error" ? "Copy failed" : "Copy command"}
        </Button>
      </div>
    </section>
  );
}

export function RuntimeFactGrid({ facts }: { facts: Array<[string, string]> }) {
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

export function RuntimeArtifactCard({
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
  const focusedContent = hideStructuredTestPayload
    ? stripFocusedTestPayload(artifact.content)
    : artifact.content;
  const content = stripEmbeddedCandidatePatch(focusedContent);
  const staleCopy = freshness?.fresh
    ? "This retained handoff is superseded by the authoritative persisted run summary and remains available for audit."
    : (freshness?.reasonCopy ??
      "No authoritative persisted terminal run summary is available for this candidate.");
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
          <strong>{freshness?.fresh ? "Superseded evidence" : "Rerun required"}</strong> {staleCopy} This
          handoff remains for audit only.
        </div>
      ) : null}
      <MarkdownContent
        content={content.trim() || "The structured result list above is the authoritative test evidence."}
      />
      <footer>
        <span>{new Date(artifact.createdAt).toLocaleString()}</span>
        <span>
          {isModelRunArtifact(artifact)
            ? `${artifact.model} · ${formatTokenCount(artifact.usage.inputTokens)} in / ${formatTokenCount(artifact.usage.outputTokens)} out · ${formatCacheRate(artifact.usage)} cached · ${formatApproximateCost(artifact.usage.cost)}`
            : artifact.sourceTaskId
              ? `Imported from ${artifact.sourceTaskId} · no new model call`
              : "Harness-generated · no model call"}
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

export function RuntimeStageEmpty({
  task,
  viewedStageStopped,
}: {
  task: RuntimeTask;
  viewedStageStopped: boolean;
}) {
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
