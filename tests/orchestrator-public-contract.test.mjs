import assert from "node:assert/strict";
import test from "node:test";

import { TaskOrchestrator } from "../server/orchestrator.mjs";

test("preserves the TaskOrchestrator public method signatures", () => {
  const expected = {
    status: [0, true],
    proposeOnboarding: [1, true],
    approveOnboarding: [2, true],
    verifyPricing: [0, true],
    isRunning: [1, false],
    start: [1, true],
    cancel: [1, true],
    shutdown: [0, true],
    recordDecision: [2, true],
    overrideWorkflowProfile: [2, true],
    answerGrillQuestion: [2, true],
    finishGrill: [1, true],
    approveSpecification: [1, true],
    approvePlan: [1, true],
    correctInvalidPlan: [1, true],
    continueRetainedPackage: [1, true],
    approvePullRequest: [1, true],
    reconcilePullRequest: [1, true],
    pollPullRequests: [0, true],
    approveMerge: [1, true],
    reconcileMerge: [1, true],
    recoverMergeIntents: [0, true],
    refreshCandidate: [1, true],
    rebuildCandidateFromTarget: [1, true],
    restartImplementationFromTarget: [1, true],
    retryTestOnSameCandidate: [1, true],
    completeMergedTask: [1, true],
  };

  for (const [name, [arity, asynchronous]] of Object.entries(expected)) {
    const method = TaskOrchestrator.prototype[name];
    assert.equal(method.length, arity, `${name} arity`);
    assert.equal(method.constructor.name === "AsyncFunction", asynchronous, `${name} async identity`);
  }
});
