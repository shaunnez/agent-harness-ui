import { TaskOrchestratorCore } from "./orchestrator-core.mjs";

export { evaluationVerdict, structuredEvidenceError } from "./orchestrator-run-policy.mjs";

export class TaskOrchestrator {
  #core;

  constructor(store, options = {}) {
    this.#core = new TaskOrchestratorCore(store, options);
  }

  async status() {
    return this.#core.runtime.status();
  }

  async proposeOnboarding(repositoryPath) {
    return this.#core.runtime.proposeOnboarding(repositoryPath);
  }

  async approveOnboarding(repositoryPath, proposal, options = {}) {
    return this.#core.runtime.approveOnboarding(repositoryPath, proposal, options);
  }

  async verifyPricing() {
    return this.#core.runtime.verifyPricing();
  }

  isRunning(id) {
    return this.#core.tasks.isRunning(id);
  }

  async start(id, kind = "investigation", options = {}) {
    return this.#core.tasks.start(id, kind, options);
  }

  async cancel(id) {
    return this.#core.tasks.cancel(id);
  }

  async recordDecision(id, input) {
    return this.#core.tasks.recordDecision(id, input);
  }

  async overrideWorkflowProfile(id, profile, reason = "") {
    return this.#core.tasks.overrideWorkflowProfile(id, profile, reason);
  }

  async answerGrillQuestion(id, input) {
    return this.#core.tasks.answerGrillQuestion(id, input);
  }

  async finishGrill(id, { acceptRemaining = false, source = null } = {}) {
    return this.#core.tasks.finishGrill(id, { acceptRemaining, source });
  }

  async approveSpecification(id, note = "") {
    return this.#core.tasks.approveSpecification(id, note);
  }

  async approvePlan(id, note = "") {
    return this.#core.tasks.approvePlan(id, note);
  }

  async correctInvalidPlan(id) {
    return this.#core.tasks.correctInvalidPlan(id);
  }

  async continueRetainedPackage(id) {
    return this.#core.tasks.continueRetainedPackage(id);
  }

  async approvePullRequest(id, note = "") {
    return this.#core.pullRequests.approvePullRequest(id, note);
  }

  async reconcilePullRequest(id) {
    return this.#core.pullRequests.reconcilePullRequest(id);
  }

  async pollPullRequests() {
    return this.#core.pullRequests.pollPullRequests();
  }

  async approveMerge(id, note = "") {
    return this.#core.mergeRecovery.approveMerge(id, note);
  }

  async reconcileMerge(id) {
    return this.#core.mergeRecovery.reconcileMerge(id);
  }

  async recoverMergeIntents() {
    return this.#core.mergeRecovery.recoverMergeIntents();
  }

  async refreshCandidate(id) {
    return this.#core.candidates.refreshCandidate(id);
  }

  async rebuildCandidateFromTarget(id) {
    return this.#core.candidates.rebuildCandidateFromTarget(id);
  }

  async restartImplementationFromTarget(id) {
    return this.#core.candidates.restartImplementationFromTarget(id);
  }

  async retryTestOnSameCandidate(id) {
    return this.#core.candidates.retryTestOnSameCandidate(id);
  }

  async completeMergedTask(id, note = "") {
    return this.#core.candidates.completeMergedTask(id, note);
  }
}
