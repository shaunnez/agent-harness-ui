import assert from "node:assert/strict";
import test from "node:test";
import { RuntimeBoundariesOrchestrator } from "../server/orchestrator-runtime-boundaries.mjs";

function failedQualification(headRevision) {
  return {
    status: "failed",
    headRevision,
    rows: [{ id: "quality", status: "failed", failureDetails: "quality failed" }],
  };
}

test("classifies a command that also fails before the package change as a baseline failure", async () => {
  const calls = [];
  const removed = [];
  const boundaries = new RuntimeBoundariesOrchestrator({
    store: {},
    worktrees: {
      prepareEvidence: async (_task, authority) => ({
        repositoryRoot: "/repo",
        worktreePath: "/baseline",
        revision: authority.selectedRevision,
      }),
      removeEvidence: async (workspace) => removed.push(workspace.worktreePath),
    },
    runPackageVerification: async (input) => {
      calls.push(input);
      return failedQualification(input.headRevision);
    },
    packageVerificationQueue: Promise.resolve(),
  });

  const result = await boundaries._qualifyPackage({
    task: { id: "AH-BASELINE", repositoryPath: "/repo" },
    workPackage: { id: "S1", verificationCommandIds: ["quality", "test"] },
    workPackageId: "S1",
    attempt: 2,
    worktreePath: "/candidate",
    headRevision: "b".repeat(40),
    baselineRevision: "a".repeat(40),
    signal: new AbortController().signal,
  });

  assert.equal(result.failureKind, "repository-baseline");
  assert.deepEqual(result.baselineVerification.commandIds, ["quality"]);
  assert.deepEqual(calls[1].workPackage.verificationCommandIds, ["quality"]);
  assert.deepEqual(removed, ["/baseline"]);
});

test("retains candidate attribution when the failed command passes on the baseline", async () => {
  let call = 0;
  const boundaries = new RuntimeBoundariesOrchestrator({
    store: {},
    worktrees: {
      prepareEvidence: async () => ({ repositoryRoot: "/repo", worktreePath: "/baseline" }),
      removeEvidence: async () => {},
    },
    runPackageVerification: async (input) => {
      call += 1;
      return call === 1
        ? failedQualification(input.headRevision)
        : { status: "passed", rows: [{ id: "quality", status: "passed" }] };
    },
    packageVerificationQueue: Promise.resolve(),
  });

  const result = await boundaries._qualifyPackage({
    task: { id: "AH-CANDIDATE", repositoryPath: "/repo" },
    workPackage: { id: "S1", verificationCommandIds: ["quality"] },
    workPackageId: "S1",
    attempt: 1,
    worktreePath: "/candidate",
    headRevision: "b".repeat(40),
    baselineRevision: "a".repeat(40),
    signal: new AbortController().signal,
  });

  assert.equal(result.failureKind, undefined);
});
