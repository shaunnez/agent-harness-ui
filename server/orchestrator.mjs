import { RetentionOrchestrator } from "./orchestrator-retention.mjs";

export { evaluationVerdict, structuredEvidenceError } from "./orchestrator-run-policy.mjs";

export class TaskOrchestrator {
  #core;

  constructor(store, options = {}) {
    this.#core = new RetentionOrchestrator(store, options);
  }

  status(...args) { return this.#core.status(...args); }
  proposeOnboarding(...args) { return this.#core.proposeOnboarding(...args); }
  approveOnboarding(...args) { return this.#core.approveOnboarding(...args); }
  verifyPricing(...args) { return this.#core.verifyPricing(...args); }
  isRunning(...args) { return this.#core.isRunning(...args); }
  start(...args) { return this.#core.start(...args); }
  cancel(...args) { return this.#core.cancel(...args); }
  recordDecision(...args) { return this.#core.recordDecision(...args); }
  overrideWorkflowProfile(...args) { return this.#core.overrideWorkflowProfile(...args); }
  answerGrillQuestion(...args) { return this.#core.answerGrillQuestion(...args); }
  finishGrill(...args) { return this.#core.finishGrill(...args); }
  approveSpecification(...args) { return this.#core.approveSpecification(...args); }
  approvePlan(...args) { return this.#core.approvePlan(...args); }
  correctInvalidPlan(...args) { return this.#core.correctInvalidPlan(...args); }
  continueRetainedPackage(...args) { return this.#core.continueRetainedPackage(...args); }
  approvePullRequest(...args) { return this.#core.approvePullRequest(...args); }
  reconcilePullRequest(...args) { return this.#core.reconcilePullRequest(...args); }
  pollPullRequests(...args) { return this.#core.pollPullRequests(...args); }
  approveMerge(...args) { return this.#core.approveMerge(...args); }
  reconcileMerge(...args) { return this.#core.reconcileMerge(...args); }
  recoverMergeIntents(...args) { return this.#core.recoverMergeIntents(...args); }
  refreshCandidate(...args) { return this.#core.refreshCandidate(...args); }
  rebuildCandidateFromTarget(...args) { return this.#core.rebuildCandidateFromTarget(...args); }
  restartImplementationFromTarget(...args) { return this.#core.restartImplementationFromTarget(...args); }
  retryTestOnSameCandidate(...args) { return this.#core.retryTestOnSameCandidate(...args); }
  completeMergedTask(...args) { return this.#core.completeMergedTask(...args); }
}
