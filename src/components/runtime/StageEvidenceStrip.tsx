import { FileCode, GitCommit, Package } from "@phosphor-icons/react";
import type { RuntimeArtifact, RuntimeCandidate, RuntimeWorkPackage, StageId } from "../../domain";

function formatRecordedAt(value: string | undefined) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

export function StageEvidenceStrip({
  stageId,
  artifact,
  candidate,
  workPackages,
}: {
  stageId: StageId;
  artifact: RuntimeArtifact | undefined;
  candidate: RuntimeCandidate | undefined;
  workPackages: RuntimeWorkPackage[];
}) {
  const packageBatches = new Set(workPackages.map((workPackage) => workPackage.batch));
  const packageStage = stageId === "plan" || stageId === "implement";
  const contractValue =
    packageStage && workPackages.length
      ? `${workPackages.length} package${workPackages.length === 1 ? "" : "s"} · ${packageBatches.size} dependency batch${packageBatches.size === 1 ? "" : "es"}`
      : artifact?.model
        ? `${artifact.model} · ${artifact.reasoning ?? "default reasoning"}`
        : "No model-owned execution recorded";

  return (
    <section className="stage-evidence-strip" aria-label="Stage evidence">
      <span>
        <FileCode size={17} aria-hidden />
        <span>
          <small>Authoritative handoff</small>
          <strong>{artifact?.name ?? "No stage artifact recorded"}</strong>
          <em>{formatRecordedAt(artifact?.createdAt)}</em>
        </span>
      </span>
      <span>
        <Package size={17} aria-hidden />
        <span>
          <small>Execution contract</small>
          <strong>{contractValue}</strong>
          <em>
            {artifact
              ? `${artifact.usage.totalTokens.toLocaleString()} recorded tokens`
              : "Awaiting persisted evidence"}
          </em>
        </span>
      </span>
      <span>
        <GitCommit size={17} aria-hidden />
        <span>
          <small>Candidate binding</small>
          <strong>
            {candidate ? `${candidate.id} · revision ${candidate.revisionNumber}` : "No candidate assembled"}
          </strong>
          <em>
            {candidate
              ? `${candidate.status.replaceAll("-", " ")} · ${candidate.headRevision?.slice(0, 10) ?? "no head revision"}`
              : "Required from Implement onward"}
          </em>
        </span>
      </span>
    </section>
  );
}
