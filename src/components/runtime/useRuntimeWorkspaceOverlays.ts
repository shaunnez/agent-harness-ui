import { useCallback, useEffect, useRef, useState } from "react";
import { getCandidateDiff, type CandidateDiffResponse } from "../../api";
import { matchesCandidateDiffResponse } from "../../requestIdentity";
import type { RuntimeArtifact, StageId } from "../../domain";
import type { RuntimeTaskWorkspaceProps } from "./contracts";

type Candidate = RuntimeTaskWorkspaceProps["task"]["candidates"][number];

interface RuntimeWorkspaceOverlayOptions {
  task: RuntimeTaskWorkspaceProps["task"];
  candidate: Candidate | undefined;
  viewedStageId: StageId;
  routeDetail: RuntimeTaskWorkspaceProps["routeDetail"];
  onRouteDetailChange: RuntimeTaskWorkspaceProps["onRouteDetailChange"];
  onLoadArtifact: RuntimeTaskWorkspaceProps["onLoadArtifact"];
}

export function useRuntimeWorkspaceOverlays({
  task,
  candidate,
  viewedStageId,
  routeDetail,
  onRouteDetailChange,
  onLoadArtifact,
}: RuntimeWorkspaceOverlayOptions) {
  const [openArtifact, setOpenArtifact] = useState<RuntimeArtifact | null>(null);
  const [candidateDiff, setCandidateDiff] = useState<CandidateDiffResponse | null>(null);
  const [candidateDiffError, setCandidateDiffError] = useState<string | null>(null);
  const [candidateDiffLoading, setCandidateDiffLoading] = useState(false);
  const [candidateDiffTarget, setCandidateDiffTarget] = useState<Candidate | null>(null);
  const artifactReturnFocusRef = useRef<HTMLElement | null>(null);
  const candidateDiffReturnFocusRef = useRef<HTMLElement | null>(null);
  const candidateDiffRequestRef = useRef(0);

  const openRuntimeArtifact = (artifact: RuntimeArtifact) => {
    artifactReturnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (onRouteDetailChange) {
      onRouteDetailChange({ kind: "artifact", artifactId: artifact.id }, artifact.stage);
      return;
    }
    setOpenArtifact(artifact);
  };

  const closeRuntimeArtifact = () => {
    setOpenArtifact(null);
    onRouteDetailChange?.(null);
    window.requestAnimationFrame(() => artifactReturnFocusRef.current?.focus({ preventScroll: true }));
  };

  const closeCandidateDiff = () => {
    candidateDiffRequestRef.current += 1;
    setCandidateDiff(null);
    setCandidateDiffError(null);
    setCandidateDiffTarget(null);
    onRouteDetailChange?.(null);
    window.requestAnimationFrame(() => candidateDiffReturnFocusRef.current?.focus({ preventScroll: true }));
  };

  const openCandidateDiff = useCallback(
    async (target = candidate) => {
      if (!target?.headRevision) return;
      const requestId = candidateDiffRequestRef.current + 1;
      candidateDiffRequestRef.current = requestId;
      candidateDiffReturnFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setCandidateDiffLoading(true);
      setCandidateDiffError(null);
      setCandidateDiffTarget(target);
      try {
        const diff = await getCandidateDiff(task.id, target.id, target.headRevision);
        if (!matchesCandidateDiffResponse(target, diff)) {
          throw new Error("The candidate diff response did not match the requested candidate revision.");
        }
        if (candidateDiffRequestRef.current === requestId) setCandidateDiff(diff);
      } catch (error) {
        if (candidateDiffRequestRef.current === requestId) {
          setCandidateDiff(null);
          setCandidateDiffError(
            error instanceof Error ? error.message : "The exact candidate diff could not be loaded.",
          );
        }
      } finally {
        if (candidateDiffRequestRef.current === requestId) setCandidateDiffLoading(false);
      }
    },
    [candidate, task.id],
  );

  const requestCandidateDiff = (target = candidate) => {
    if (!target) return;
    candidateDiffReturnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (onRouteDetailChange) {
      onRouteDetailChange(
        { kind: "candidate-diff", candidateId: target.id, revision: target.revisionNumber },
        viewedStageId,
      );
      return;
    }
    void openCandidateDiff(target);
  };

  useEffect(() => {
    if (!routeDetail) {
      setOpenArtifact(null);
      return;
    }
    if (routeDetail.kind === "artifact") {
      const artifact = task.artifacts.find((item) => item.id === routeDetail.artifactId);
      if (artifact) {
        setOpenArtifact(artifact);
      } else if (onLoadArtifact) {
        let current = true;
        void onLoadArtifact(routeDetail.artifactId)
          .then((loaded) => {
            if (current) setOpenArtifact(loaded);
          })
          .catch(() => {
            if (current) onRouteDetailChange?.(null);
          });
        return () => {
          current = false;
        };
      } else onRouteDetailChange?.(null);
      return;
    }
    setOpenArtifact(null);
    if (routeDetail.kind !== "candidate-diff") return;
    const recordedCandidate = task.candidates.find((item) => item.id === routeDetail.candidateId);
    const recordedRevision = recordedCandidate?.revisions.find(
      (item) => item.number === routeDetail.revision,
    );
    const target =
      recordedCandidate &&
      (recordedCandidate.revisionNumber === routeDetail.revision
        ? recordedCandidate
        : recordedRevision
          ? {
              ...recordedCandidate,
              revisionNumber: recordedRevision.number,
              headRevision: recordedRevision.headRevision,
              status: "superseded" as const,
            }
          : null);
    if (!target) {
      onRouteDetailChange?.(null);
      return;
    }
    const alreadyRequested =
      candidateDiffTarget?.id === target.id &&
      candidateDiffTarget.revisionNumber === target.revisionNumber &&
      (candidateDiffLoading || candidateDiff != null || candidateDiffError != null);
    if (!alreadyRequested) void openCandidateDiff(target);
  }, [
    candidateDiff,
    candidateDiffError,
    candidateDiffLoading,
    candidateDiffTarget,
    onRouteDetailChange,
    onLoadArtifact,
    openCandidateDiff,
    routeDetail,
    task.artifacts,
    task.candidates,
  ]);

  return {
    openArtifact,
    candidateDiff,
    candidateDiffError,
    candidateDiffLoading,
    candidateDiffTarget,
    openRuntimeArtifact,
    closeRuntimeArtifact,
    requestCandidateDiff,
    closeCandidateDiff,
    retryCandidateDiff: () => candidateDiffTarget && void openCandidateDiff(candidateDiffTarget),
  };
}
