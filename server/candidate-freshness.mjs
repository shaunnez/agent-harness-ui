export const CANDIDATE_BOUND_STAGES = Object.freeze([
  "dev-review",
  "test",
  "final-review",
  "approval",
]);

export const CANDIDATE_FRESHNESS_REASONS = Object.freeze({
  FRESH: "matched-active-candidate",
  NOT_CANDIDATE_BOUND: "not-candidate-bound",
  MISSING_ACTIVE_CANDIDATE: "missing-active-candidate",
  MISSING_CANDIDATE_BINDING: "missing-candidate-binding",
  CANDIDATE_ID_MISMATCH: "candidate-id-mismatch",
  CANDIDATE_REVISION_MISMATCH: "candidate-revision-mismatch",
  MISSING_STAGE_EVIDENCE: "missing-stage-evidence",
  MISSING_GATE_RESULT: "missing-gate-result",
  MISSING_FOCUSED_TEST: "missing-focused-test-evidence",
  MISSING_RUN_SUMMARY: "missing-run-summary",
  GATE_NOT_PASSED: "gate-not-passed",
});

const candidateBoundStages = new Set(CANDIDATE_BOUND_STAGES);

export function projectRuntimeTask(task) {
  if (!task) return task;
  const projected = structuredClone(task);
  const activeCandidate = projected.candidates?.at(-1) ?? null;
  const activeBinding = candidateBinding(activeCandidate);
  const artifacts = (projected.artifacts ?? []).map((artifact) => projectArtifact(artifact, activeCandidate));
  const runs = (projected.runs ?? []).map((run) => projectRun(run, activeCandidate));
  const stages = Object.fromEntries(
    CANDIDATE_BOUND_STAGES.map((stage) => [stage, projectStageFreshness(stage, artifacts, runs, activeCandidate)]),
  );
  const currentFocusedTest = selectCurrentFocusedTest(artifacts, runs, activeCandidate);

  projected.artifacts = artifacts;
  projected.runs = runs;
  projected.candidateFreshness = {
    activeCandidate: activeCandidate && activeBinding
      ? {
          id: activeCandidate.id,
          revisionNumber: activeCandidate.revisionNumber,
          headRevision: activeCandidate.headRevision ?? null,
        }
      : null,
    stages,
    currentFocusedTest,
  };
  projected.completedStages = projectCompletedStages(projected.completedStages ?? [], stages);
  return projected;
}

export function projectRuntimeTasks(tasks) {
  return (tasks ?? []).map(projectRuntimeTask);
}

export function projectCandidateFreshness(value, activeCandidate, options = {}) {
  return freshnessForBinding(value, activeCandidate, options.candidateBound !== false);
}

function projectArtifact(artifact, activeCandidate) {
  const candidateBound = isCandidateBoundArtifact(artifact);
  const projected = {
    ...artifact,
    freshness: freshnessForBinding(artifact, activeCandidate, candidateBound),
  };
  if (artifact.gateResult) projected.gateResult = projectGateResult(artifact.gateResult, activeCandidate);
  if (artifact.focusedTest) projected.focusedTest = projectFocusedTest(artifact.focusedTest, activeCandidate);
  return projected;
}

function projectFocusedTest(evidence, activeCandidate) {
  return {
    ...evidence,
    freshness: freshnessForBinding(evidence, activeCandidate, true),
    rows: (evidence.rows ?? []).map((row) => ({
      ...row,
      freshness: freshnessForBinding(row, activeCandidate, true),
    })),
  };
}

function projectGateResult(gateResult, activeCandidate) {
  return {
    ...gateResult,
    freshness: freshnessForBinding(gateResult, activeCandidate, true),
    findings: (gateResult.findings ?? []).map((finding) => ({
      ...finding,
      freshness: freshnessForBinding(finding, activeCandidate, true),
    })),
  };
}

function projectRun(run, activeCandidate) {
  const candidateBound = isCandidateBoundRun(run);
  const projected = {
    ...run,
    freshness: freshnessForBinding(run, activeCandidate, candidateBound),
  };
  if (run.test) {
    projected.test = {
      ...run.test,
      freshness: freshnessForBinding(run.test, activeCandidate, true),
    };
  }
  if (run.gateResult) projected.gateResult = projectGateResult(run.gateResult, activeCandidate);
  return projected;
}

function projectStageFreshness(stage, artifacts, runs, activeCandidate) {
  if (!candidateBinding(activeCandidate)) {
    return stageFreshness(
      freshnessForBinding(null, activeCandidate, true),
      null,
      null,
    );
  }

  const stageArtifacts = artifacts.filter((artifact) => artifact.stage === stage);
  const artifact = stageArtifacts.at(-1) ?? null;
  if (!artifact) {
    return stageFreshness(
      stale(CANDIDATE_FRESHNESS_REASONS.MISSING_STAGE_EVIDENCE, "No persisted evidence exists for this candidate stage."),
      null,
      null,
    );
  }
  if (artifact.freshness.state === "stale") return stageFreshness(artifact.freshness, artifact, null);

  if (stage === "approval") return stageFreshness(artifact.freshness, artifact, null);

  if (!artifact.gateResult) {
    return stageFreshness(
      stale(CANDIDATE_FRESHNESS_REASONS.MISSING_GATE_RESULT, "The stage artifact has no persisted gate result; rerun the stage."),
      artifact,
      null,
    );
  }
  if (artifact.gateResult.freshness.state === "stale") {
    return stageFreshness(artifact.gateResult.freshness, artifact, null);
  }
  if (artifact.gateResult.verdict !== "PASS" || (artifact.gateResult.blockingReasons?.length ?? 0) > 0) {
    return stageFreshness(
      stale(CANDIDATE_FRESHNESS_REASONS.GATE_NOT_PASSED, "The persisted gate did not pass this candidate; rerun is required after repair."),
      artifact,
      null,
    );
  }

  if (stage === "test") {
    if (!artifact.focusedTest) {
      return stageFreshness(
        stale(CANDIDATE_FRESHNESS_REASONS.MISSING_FOCUSED_TEST, "The Test artifact has no focused-Test evidence; rerun Test."),
        artifact,
        null,
      );
    }
    if (artifact.focusedTest.freshness.state === "stale") {
      return stageFreshness(artifact.focusedTest.freshness, artifact, null);
    }
    const staleRow = artifact.focusedTest.rows.find((row) => row.freshness.state === "stale");
    if (staleRow) return stageFreshness(staleRow.freshness, artifact, null);
  }

  const run = artifact.runId ? runs.find((item) => item.id === artifact.runId) ?? null : null;
  if (run) {
    if (run.freshness.state === "stale") return stageFreshness(run.freshness, artifact, run);
    if (stage === "test") {
      if (!run.test) {
        return stageFreshness(
          stale(CANDIDATE_FRESHNESS_REASONS.MISSING_RUN_SUMMARY, "The Test run has no persisted candidate summary; rerun Test."),
          artifact,
          run,
        );
      }
      if (run.test.freshness.state === "stale") return stageFreshness(run.test.freshness, artifact, run);
    }
  }
  return stageFreshness(freshnessForBinding(artifact, activeCandidate, true), artifact, run);
}

function selectCurrentFocusedTest(artifacts, runs, activeCandidate) {
  const artifact = [...artifacts].reverse().find((item) => {
    if (item.stage !== "test" || item.freshness.state !== "fresh" || !item.focusedTest) return false;
    if (item.focusedTest.freshness.state !== "fresh") return false;
    if (item.focusedTest.rows.some((row) => row.freshness.state !== "fresh")) return false;
    const run = item.runId ? runs.find((candidate) => candidate.id === item.runId) : null;
    return !run || (run.freshness.state === "fresh" && run.test?.freshness.state === "fresh");
  });
  if (!artifact) return null;
  return {
    artifactId: artifact.id,
    runId: artifact.runId ?? null,
    evidence: artifact.focusedTest,
    freshness: freshnessForBinding(artifact.focusedTest, activeCandidate, true),
  };
}

function projectCompletedStages(completedStages, stages) {
  return completedStages.filter((stage) => {
    if (!candidateBoundStages.has(stage)) return true;
    return stages[stage]?.state === "fresh";
  });
}

function stageFreshness(freshness, artifact, run) {
  return {
    ...freshness,
    artifactId: artifact?.id ?? null,
    runId: run?.id ?? artifact?.runId ?? null,
  };
}

function freshnessForBinding(value, activeCandidate, candidateBound = true) {
  if (!candidateBound) {
    return fresh(CANDIDATE_FRESHNESS_REASONS.NOT_CANDIDATE_BOUND, "This evidence is not bound to an integration candidate.");
  }
  const expected = candidateBinding(activeCandidate);
  if (!expected) {
    return stale(CANDIDATE_FRESHNESS_REASONS.MISSING_ACTIVE_CANDIDATE, "No active candidate with an authoritative ID and revision exists.");
  }
  const actual = candidateBinding(value);
  if (!actual) {
    return stale(CANDIDATE_FRESHNESS_REASONS.MISSING_CANDIDATE_BINDING, `Evidence must be bound to ${expected.candidateId} revision ${expected.candidateRevision}.`);
  }
  if (actual.candidateId !== expected.candidateId) {
    return stale(CANDIDATE_FRESHNESS_REASONS.CANDIDATE_ID_MISMATCH, `Evidence is bound to ${actual.candidateId}, not active candidate ${expected.candidateId}.`);
  }
  if (actual.candidateRevision !== expected.candidateRevision) {
    return stale(CANDIDATE_FRESHNESS_REASONS.CANDIDATE_REVISION_MISMATCH, `Evidence is bound to ${actual.candidateId} revision ${actual.candidateRevision}, not revision ${expected.candidateRevision}.`);
  }
  return fresh(CANDIDATE_FRESHNESS_REASONS.FRESH, `Evidence matches active candidate ${expected.candidateId} revision ${expected.candidateRevision}.`);
}

function candidateBinding(value) {
  const usesCandidateRecordShape = typeof value?.candidateId !== "string" && Number.isInteger(value?.revisionNumber);
  const candidateId = typeof value?.candidateId === "string"
    ? value.candidateId.trim()
    : usesCandidateRecordShape && typeof value?.id === "string"
      ? value.id.trim()
      : "";
  const candidateRevision = value?.candidateRevision ?? (usesCandidateRecordShape ? value?.revisionNumber : undefined);
  if (!candidateId || !Number.isInteger(candidateRevision) || candidateRevision < 1) return null;
  return { candidateId, candidateRevision };
}

function isCandidateBoundArtifact(artifact) {
  return candidateBoundStages.has(artifact?.stage) || Boolean(artifact?.candidateId || artifact?.candidateRevision || artifact?.gateResult || artifact?.focusedTest);
}

function isCandidateBoundRun(run) {
  return candidateBoundStages.has(run?.stage) || Boolean(run?.candidateId || run?.candidateRevision || run?.test || run?.gateResult);
}

function fresh(reason, message) {
  return { state: "fresh", reason, message };
}

function stale(reason, message) {
  return { state: "stale", reason, message };
}
