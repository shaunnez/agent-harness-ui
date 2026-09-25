/**
 * Was this command already failing before the candidate existed?
 *
 * A verification failure is only evidence against a candidate if the same command
 * passed without it. When a repository arrives with a broken command — an end-to-end
 * suite that needs a browser the harness host does not have, a test that depends on a
 * service nobody started — every candidate inherits that failure, and the harness has
 * no way to tell inherited breakage from work the candidate actually broke.
 *
 * It blames the candidate. AH-087 is what that costs: `playwright-e2e` failed
 * identically on all three Test attempts, every Dev Review passed, and the task spent
 * its whole Test allowance and both repair cycles before the circuit breaker opened.
 * No repair could ever have fixed it, because there was nothing wrong with the code.
 *
 * The check already existed for the Implement stage's per-package qualification and
 * not for the Test stage's full-manifest run, so the two stages disagreed about what a
 * failure meant. This module is that one rule, in one place, for both.
 *
 * The rule is deliberately strict: the baseline explains the failure only when *every*
 * failed command also fails at the base revision. One command the candidate genuinely
 * broke makes the whole result the candidate's to answer for, because a candidate that
 * breaks something must not be excused by an unrelated inherited failure sitting next
 * to it.
 */

/** Command ids that did not pass, in the order the manifest ran them. */
export function failedCommandIds(verification) {
  return (verification?.rows ?? []).filter((row) => row.status !== "passed").map((row) => row.id);
}

/** Re-run only the recorded failed commands at the same pinned baseline revision. */
export async function recheckRepositoryBaseline({
  task,
  baselineVerification,
  worktrees,
  runVerification,
  signal,
}) {
  const revision = baselineVerification?.revision;
  const commandIds = baselineVerification?.commandIds;
  if (!revision || !Array.isArray(commandIds) || !commandIds.length) {
    throw new Error("The recorded repository baseline has no revision-bound failed commands to recheck.");
  }
  const workspace = await worktrees.prepareEvidence(
    task,
    { selectedRevision: revision, provisionDependencies: true },
    `baseline-recheck-${task.id}-${crypto.randomUUID()}`.slice(0, 64),
  );
  try {
    return await runVerification({
      worktreePath: workspace.worktreePath,
      candidate: { id: `${task.id}-baseline`, revisionNumber: 1, headRevision: revision },
      commandIds,
      executionKind: "baseline-recheck",
      signal,
    });
  } finally {
    await worktrees.removeEvidence(workspace);
  }
}

/**
 * Re-runs the failed commands at `baselineRevision` in a throwaway worktree.
 *
 * Returns a `baselineVerification` record when the baseline explains the failure, and
 * `null` when it does not — including every case where the question could not be
 * answered. Failing to answer is not evidence of innocence: an unreachable base
 * revision or a worktree that could not be prepared leaves the candidate accountable,
 * which is the same direction the gates already fail in.
 */
export async function classifyAgainstBaseline({
  verification,
  task,
  candidate,
  baselineRevision,
  worktrees,
  runVerification,
  signal,
  runId = crypto.randomUUID(),
}) {
  const failedIds = failedCommandIds(verification);
  if (
    !failedIds.length ||
    !task ||
    !baselineRevision ||
    baselineRevision === verification?.headRevision ||
    typeof worktrees?.prepareEvidence !== "function" ||
    typeof worktrees?.removeEvidence !== "function"
  ) {
    return null;
  }

  let workspace = null;
  try {
    workspace = await worktrees.prepareEvidence(
      task,
      { selectedRevision: baselineRevision, provisionDependencies: true },
      `baseline-${candidate?.id ?? "candidate"}-${runId}`.slice(0, 64),
    );
    const baseline = await runVerification({
      worktreePath: workspace.worktreePath,
      // The baseline is not a revision of the candidate and must never be mistaken for
      // one, so it is identified as its own thing. `runRepositoryVerification` pins
      // evidence to the head it reads, and that head is the base commit here.
      candidate: {
        id: `${candidate?.id ?? "candidate"}-baseline`,
        revisionNumber: candidate?.revisionNumber ?? 1,
        headRevision: baselineRevision,
      },
      commandIds: failedIds,
      executionKind: "baseline-manifest",
      signal,
    });
    const baselineFailed = new Set(failedCommandIds(baseline));
    if (!failedIds.every((commandId) => baselineFailed.has(commandId))) return null;
    return {
      revision: baselineRevision,
      commandIds: failedIds,
      rows: baseline.rows ?? [],
    };
  } catch {
    // Deliberately swallowed. The caller's next step is to hold the candidate
    // responsible, which is what it would have done without this check at all.
    return null;
  } finally {
    if (workspace) await worktrees.removeEvidence(workspace).catch(() => {});
  }
}

/** The operator-facing explanation for a failure the base revision already had. */
export function baselineBlocker(baselineVerification, stageLabel) {
  const commands = baselineVerification.commandIds.join(", ");
  const revision = String(baselineVerification.revision).slice(0, 12);
  return {
    code: "repository-baseline-verification",
    detail: `${commands} also fails at ${revision}, the revision this candidate was built from, so ${stageLabel} is not reporting a defect in this candidate. Repairing it cannot make an inherited failure pass.`,
    requiredAction:
      "Fix or advance the repository baseline, then rerun this gate against the unchanged candidate. Do not repair the candidate for a failure it did not introduce.",
    baselineVerification,
  };
}
