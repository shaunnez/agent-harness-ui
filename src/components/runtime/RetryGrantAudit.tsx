import { type StageId, workflowStages } from "../../domain";
import { RuntimeRow } from "./RuntimeInspectorPrimitives";

export interface RetryGrantAuditFields {
  grantedStage?: StageId;
  previousLimit?: number;
  newLimit?: number;
  sourceRunId?: string | null;
  sourceRunIds?: string[];
  candidateId?: string | null;
  candidateRevision?: number | null;
  candidateHeadRevision?: string | null;
  authorizingGateArtifactId?: string | null;
  authorizingGateCandidateId?: string | null;
  authorizingGateCandidateRevision?: number | null;
  authorizingGateCandidateHeadRevision?: string | null;
  authorizingGateKind?: string | null;
  authorizingGateReservedAt?: string | null;
  authorizingGateReservationId?: string | null;
  authorizingGateRunId?: string | null;
  authorizingGateStage?: StageId | null;
  authorizingGateWorkflowAttempt?: number | null;
  candidateAuthorizerArtifactIds?: string[];
  candidateAuthorizerReservationIds?: string[];
  candidateAuthorizerRunIds?: string[];
  candidateProducerArtifactIds?: string[];
  candidateProducerRunIds?: string[];
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
    audit.sourceRunIds !== undefined ||
    audit.candidateId !== undefined ||
    audit.candidateRevision !== undefined ||
    audit.candidateHeadRevision !== undefined ||
    audit.authorizingGateReservationId !== undefined ||
    audit.candidateAuthorizerArtifactIds !== undefined ||
    audit.candidateAuthorizerReservationIds !== undefined ||
    audit.candidateAuthorizerRunIds !== undefined ||
    audit.candidateProducerArtifactIds !== undefined ||
    audit.candidateProducerRunIds !== undefined ||
    audit.workflowAttempt !== undefined ||
    audit.workflowCandidateId !== undefined ||
    audit.workflowCandidateRevision !== undefined ||
    audit.workflowCandidateHeadRevision !== undefined ||
    audit.workflowReservationId !== undefined;
  if (!hasAudit) return null;

  const stage = audit.grantedStage ? workflowStages.find((item) => item.id === audit.grantedStage) : null;
  const authorizingGateStage = audit.authorizingGateStage
    ? workflowStages.find((item) => item.id === audit.authorizingGateStage)
    : null;

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
      {audit.sourceRunIds !== undefined ? (
        <RuntimeRow
          label="Source run IDs"
          value={audit.sourceRunIds.length ? audit.sourceRunIds.join(", ") : "No persisted source runs"}
          mono={audit.sourceRunIds.length > 0}
        />
      ) : audit.sourceRunId !== undefined ? (
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
      {audit.authorizingGateReservationId ? (
        <>
          <RuntimeRow
            label="Authorizing gate"
            value={`${authorizingGateStage?.label ?? audit.authorizingGateStage ?? "Unknown stage"} · ${audit.authorizingGateKind ?? "unknown kind"} · attempt ${audit.authorizingGateWorkflowAttempt ?? "?"}`}
          />
          <RuntimeRow
            label="Authorizing gate candidate"
            value={`${audit.authorizingGateCandidateId ?? "Unknown"} revision ${audit.authorizingGateCandidateRevision ?? "?"}`}
            mono
          />
          <RuntimeRow
            label="Authorizing gate head"
            value={audit.authorizingGateCandidateHeadRevision ?? "No candidate head"}
            mono={audit.authorizingGateCandidateHeadRevision !== null}
          />
          <RuntimeRow label="Authorizing gate reservation" value={audit.authorizingGateReservationId} mono />
          <RuntimeRow
            label="Authorizing gate run"
            value={audit.authorizingGateRunId ?? "No authoritative gate run"}
            mono={audit.authorizingGateRunId !== null}
          />
          <RuntimeRow
            label="Authorizing gate artifact"
            value={audit.authorizingGateArtifactId ?? "No authoritative gate artifact"}
            mono={audit.authorizingGateArtifactId !== null}
          />
          <RuntimeRow
            label="Authorizing gate reserved"
            value={audit.authorizingGateReservedAt ?? "Unknown reservation time"}
            mono={audit.authorizingGateReservedAt !== null}
          />
        </>
      ) : null}
      {audit.candidateAuthorizerReservationIds !== undefined ? (
        <RuntimeRow
          label="Candidate repair authorizers"
          value={audit.candidateAuthorizerReservationIds.length
            ? audit.candidateAuthorizerReservationIds.join(", ")
            : "No repair revisions"}
          mono={audit.candidateAuthorizerReservationIds.length > 0}
        />
      ) : null}
      {audit.candidateAuthorizerRunIds !== undefined ? (
        <RuntimeRow
          label="Candidate authorizer runs"
          value={audit.candidateAuthorizerRunIds.length
            ? audit.candidateAuthorizerRunIds.join(", ")
            : "No repair authorizer runs"}
          mono={audit.candidateAuthorizerRunIds.length > 0}
        />
      ) : null}
      {audit.candidateAuthorizerArtifactIds !== undefined ? (
        <RuntimeRow
          label="Candidate authorizer artifacts"
          value={audit.candidateAuthorizerArtifactIds.length
            ? audit.candidateAuthorizerArtifactIds.join(", ")
            : "No repair authorizer artifacts"}
          mono={audit.candidateAuthorizerArtifactIds.length > 0}
        />
      ) : null}
      {audit.candidateProducerRunIds !== undefined ? (
        <RuntimeRow
          label="Candidate producer runs"
          value={audit.candidateProducerRunIds.length
            ? audit.candidateProducerRunIds.join(", ")
            : "Assembly-only producer; no agent run"}
          mono={audit.candidateProducerRunIds.length > 0}
        />
      ) : null}
      {audit.candidateProducerArtifactIds !== undefined ? (
        <RuntimeRow
          label="Candidate producer artifacts"
          value={audit.candidateProducerArtifactIds.length
            ? audit.candidateProducerArtifactIds.join(", ")
            : "No producer artifacts"}
          mono={audit.candidateProducerArtifactIds.length > 0}
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
