import type { TaskEvidence } from "./contracts.ts";

export function testAttempts(evidence: TaskEvidence) {
  const runs = evidence.runs.items.filter((run) => run.stage === "test");
  const attempts = runs.map((run) => ({
    id: run.id,
    label: `Attempt ${run.attempt ?? "—"} · ${run.status}`,
    candidateId: run.test?.candidateId ?? run.candidateId,
    candidateRevision: run.test?.candidateRevision ?? run.candidateRevision,
    rows: run.test?.rows ?? [],
    rowCount: run.test?.rowCount ?? 0,
    error: run.error ?? run.evidenceError?.copy ?? null,
    headRevision: null as string | null,
  }));
  for (const candidate of evidence.core.candidates) {
    for (const [index, verification] of (candidate.verificationRuns ?? []).entries()) {
      // Run-backed duplicates stay in their original attempt; never combine attempts into one pass count.
      if (
        runs.some(
          (run) =>
            run.test?.candidateId === verification.candidateId &&
            run.test?.candidateRevision === verification.candidateRevision &&
            JSON.stringify(run.test.rows) === JSON.stringify(verification.rows),
        )
      )
        continue;
      attempts.push({
        id: `${candidate.id}:verification:${index}`,
        label: `Candidate verification ${index + 1} · ${verification.status}`,
        candidateId: verification.candidateId,
        candidateRevision: verification.candidateRevision,
        rows: verification.rows,
        rowCount: verification.rows.length,
        error: null,
        headRevision: verification.headRevision ?? null,
      });
    }
  }
  return attempts;
}
