import { type StageId, workflowStages } from "../../domain";
import { RuntimeRow } from "./RuntimeInspectorPrimitives";

export interface RetryGrantAuditFields {
  grantedStage?: StageId;
  previousLimit?: number;
  newLimit?: number;
  sourceRunId?: string | null;
  candidateId?: string | null;
  candidateRevision?: number | null;
  candidateHeadRevision?: string | null;
  workflowAttempt?: number | null;
  workflowCandidateId?: string | null;
  workflowCandidateRevision?: number | null;
  workflowCandidateHeadRevision?: string | null;
  workflowReservationId?: string | null;
}

export function RetryGrantAudit({ audit }: { audit: RetryGrantAuditFields }) {
  const hasAudit =
    audit.grantedStage !== undefined ||
    audit.previousLimit !== undefined ||
    audit.newLimit !== undefined ||
    audit.sourceRunId !== undefined ||
    audit.candidateId !== undefined ||
    audit.candidateRevision !== undefined ||
    audit.candidateHeadRevision !== undefined ||
    audit.workflowAttempt !== undefined ||
    audit.workflowCandidateId !== undefined ||
    audit.workflowCandidateRevision !== undefined ||
    audit.workflowCandidateHeadRevision !== undefined ||
    audit.workflowReservationId !== undefined;
  if (!hasAudit) return null;

  const stage = audit.grantedStage ? workflowStages.find((item) => item.id === audit.grantedStage) : null;

  return (
    <span className="runtime-retry-grant-audit">
      <small>Retry grant audit</small>
      {audit.grantedStage !== undefined ? (
        <RuntimeRow
          label="Granted stage"
          value={stage ? `${stage.label} (${audit.grantedStage})` : audit.grantedStage}
        />
      ) : null}
      {audit.previousLimit !== undefined && audit.newLimit !== undefined ? (
        <RuntimeRow label="Limit change" value={`${audit.previousLimit} → ${audit.newLimit}`} />
      ) : null}
      {audit.previousLimit !== undefined && audit.newLimit === undefined ? (
        <RuntimeRow label="Previous limit" value={String(audit.previousLimit)} />
      ) : null}
      {audit.newLimit !== undefined && audit.previousLimit === undefined ? (
        <RuntimeRow label="New limit" value={String(audit.newLimit)} />
      ) : null}
      {audit.sourceRunId !== undefined ? (
        <RuntimeRow
          label="Source run ID"
          value={audit.sourceRunId === null ? "No persisted source run" : audit.sourceRunId}
          mono={audit.sourceRunId !== null}
        />
      ) : null}
      {audit.candidateId !== undefined || audit.candidateRevision !== undefined ? (
        <RuntimeRow
          label="Candidate"
          value={audit.candidateId === null
            ? "No candidate binding"
            : `${audit.candidateId ?? "Unknown"} revision ${audit.candidateRevision ?? "?"}`}
          mono={audit.candidateId !== null}
        />
      ) : null}
      {audit.candidateHeadRevision !== undefined ? (
        <RuntimeRow
          label="Candidate head"
          value={audit.candidateHeadRevision ?? "No candidate head"}
          mono={audit.candidateHeadRevision !== null}
        />
      ) : null}
      {audit.workflowAttempt !== undefined ? (
        <RuntimeRow
          label="Workflow attempt"
          value={audit.workflowAttempt === null ? "No workflow attempt" : String(audit.workflowAttempt)}
        />
      ) : null}
      {audit.workflowCandidateId !== undefined || audit.workflowCandidateRevision !== undefined ? (
        <RuntimeRow
          label="Workflow candidate binding"
          value={audit.workflowCandidateId === null
            ? "No candidate binding"
            : `${audit.workflowCandidateId ?? "Unknown"} revision ${audit.workflowCandidateRevision ?? "?"}`}
          mono={audit.workflowCandidateId !== null}
        />
      ) : null}
      {audit.workflowCandidateHeadRevision !== undefined ? (
        <RuntimeRow
          label="Workflow candidate head"
          value={audit.workflowCandidateHeadRevision ?? "No candidate head binding"}
          mono={audit.workflowCandidateHeadRevision !== null}
        />
      ) : null}
      {audit.workflowReservationId !== undefined ? (
        <RuntimeRow
          label="Workflow reservation"
          value={audit.workflowReservationId ?? "No workflow reservation"}
          mono={audit.workflowReservationId !== null}
        />
      ) : null}
    </span>
  );
}
