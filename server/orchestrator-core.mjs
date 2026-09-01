import { OrchestratorRuntimeContext } from "./orchestrator-runtime-base.mjs";
import { RuntimeBoundariesOrchestrator } from "./orchestrator-runtime-boundaries.mjs";
import { TaskControlOrchestrator } from "./orchestrator-task-control.mjs";
import { PullRequestOrchestrator } from "./orchestrator-pr-lifecycle.mjs";
import { MergeRecoveryOrchestrator } from "./orchestrator-merge-recovery.mjs";
import { CandidateOperationsOrchestrator } from "./orchestrator-candidate-operations.mjs";
import { InvestigationProgressionOrchestrator } from "./orchestrator-investigation.mjs";
import { SpecificationPlanningOrchestrator } from "./orchestrator-specification-planning.mjs";
import { WorkPackageOrchestrator } from "./orchestrator-work-packages.mjs";
import { CandidateGateOrchestrator } from "./orchestrator-gates.mjs";
import { GateEvaluationOrchestrator } from "./orchestrator-gate-evaluation.mjs";
import { RepairExecutionOrchestrator } from "./orchestrator-repair-execution.mjs";
import { RetentionOrchestrator } from "./orchestrator-retention.mjs";
import { OrchestratorRunCoordinator } from "./orchestrator-run-coordinator.mjs";
import { RetainedPackageOrchestrator } from "./orchestrator-retained-package.mjs";
import { PlanAuthorityOrchestrator } from "./orchestrator-plan-authority.mjs";
import { PrototypeDesignOrchestrator } from "./orchestrator-prototype-design.mjs";

export class TaskOrchestratorCore {
  constructor(store, options = {}) {
    const runtime = new OrchestratorRuntimeContext(store, options);
    const boundaries = new RuntimeBoundariesOrchestrator({
      store: runtime._store,
      runCodex: runtime._runCodex,
      getStatus: runtime._getStatus,
      worktrees: runtime._worktrees,
      runVerification: runtime._runVerification,
      runPackageVerification: runtime._runPackageVerification,
      packageVerificationQueue: runtime._packageVerificationQueue,
      packageConcurrency: runtime._packageConcurrency,
    });
    const retention = new RetentionOrchestrator({ store: runtime._store });
    const repair = new RepairExecutionOrchestrator({
      store: runtime._store,
      worktrees: runtime._worktrees,
      assertProviderConfinement: (...args) => boundaries._assertProviderConfinement(...args),
      runAgent: (...args) => boundaries._runAgent(...args),
      snapshotSource: (...args) => boundaries._snapshotSource(...args),
      finishAgentRun: (...args) => retention._finishAgentRun(...args),
      retainAgentResult: (...args) => retention._retainAgentResult(...args),
    });
    const gates = new CandidateGateOrchestrator({ store: runtime._store });
    const evaluation = new GateEvaluationOrchestrator({
      store: runtime._store,
      worktrees: runtime._worktrees,
      runVerification: runtime._runVerification,
      completeDeterministicFastGates: (...args) => gates._completeDeterministicFastGates(...args),
      executeAgent: (...args) => repair._executeAgent(...args),
      retainAgentResult: (...args) => retention._retainAgentResult(...args),
      runRepair: (...args) => repair._runRepair(...args),
    });
    const planning = new SpecificationPlanningOrchestrator({
      store: runtime._store,
      worktrees: runtime._worktrees,
      readVerificationManifest: runtime._readVerificationManifest,
      escalateProfile: (...args) => gates._escalateProfile(...args),
      executeAgent: (...args) => repair._executeAgent(...args),
      retainAgentResult: (...args) => retention._retainAgentResult(...args),
      repositoryAuthority: runtime._repositoryAuthority,
    });
    let taskControl;
    const retainedPackages = new RetainedPackageOrchestrator({
      store: runtime._store,
      worktrees: runtime._worktrees,
      readVerificationManifestAtRevision: runtime._readVerificationManifestAtRevision,
      qualifyPackage: (...args) => boundaries._qualifyPackage(...args),
      retainAgentResult: (...args) => retention._retainAgentResult(...args),
    });
    const workPackages = new WorkPackageOrchestrator({
      store: runtime._store,
      worktrees: runtime._worktrees,
      packageConcurrency: runtime._packageConcurrency,
      runPackageVerification: runtime._runPackageVerification,
      readVerificationManifestAtRevision: runtime._readVerificationManifestAtRevision,
      assertExecutablePlan: (...args) => taskControl._assertExecutablePlan(...args),
      qualifyPackage: (...args) => boundaries._qualifyPackage(...args),
      requalifyRetainedPackage: (...args) => retainedPackages.requalify(...args),
      cleanupSliceWorktree: (...args) => retainedPackages.cleanup(...args),
      escalateProfile: (...args) => gates._escalateProfile(...args),
      executeAgent: (...args) => repair._executeAgent(...args),
      retainAgentResult: (...args) => retention._retainAgentResult(...args),
    });
    let designs;
    const investigation = new InvestigationProgressionOrchestrator({
      store: runtime._store,
      worktrees: runtime._worktrees,
      repositoryAuthority: runtime._repositoryAuthority,
      escalateProfile: (...args) => gates._escalateProfile(...args),
      executeAgent: (...args) => repair._executeAgent(...args),
      retainAgentResult: (...args) => retention._retainAgentResult(...args),
      runSpecification: (...args) => planning._runSpecification(...args),
      runDesigns: (...args) => designs.runWithinInvestigation(...args),
    });
    const runCoordinator = new OrchestratorRunCoordinator({
      store: runtime._store,
      worktrees: runtime._worktrees,
      runInvestigation: (...args) => investigation._runInvestigation(...args),
      runEvaluation: (...args) => evaluation._runEvaluation(...args),
      runImplementation: (...args) => workPackages._runImplementation(...args),
      runPlanning: (...args) => planning._runPlanning(...args),
      runRepair: (...args) => repair._runRepair(...args),
      runReviewWithFastRepair: (...args) => evaluation._runReviewWithFastRepair(...args),
      runSpecification: (...args) => planning._runSpecification(...args),
    });
    const planAuthority = new PlanAuthorityOrchestrator({
      store: runtime._store,
      repositoryAuthority: runtime._repositoryAuthority,
      start: (...args) => taskControl.start(...args),
    });
    taskControl = new TaskControlOrchestrator({
      store: runtime._store,
      active: runtime._active,
      worktrees: runtime._worktrees,
      runCodex: runtime._runCodex,
      readVerificationManifest: runtime._readVerificationManifest,
      readVerificationManifestAtRevision: runtime._readVerificationManifestAtRevision,
      readVerificationManifestInjected: runtime._readVerificationManifestInjected,
      planAuthority,
      run: (...args) => runCoordinator.run(...args),
      startDesigns: (...args) => designs.startAfterGrill(...args),
    });
    designs = new PrototypeDesignOrchestrator({
      store: runtime._store,
      active: runtime._active,
      generatePrototype: runtime._generatePrototype,
      startSpecification: (id, options) => taskControl.start(id, "specification", options),
    });
    const pullRequests = new PullRequestOrchestrator({
      store: runtime._store,
      github: runtime._github,
      mergeActive: runtime._mergeActive,
      worktrees: runtime._worktrees,
    });
    const candidates = new CandidateOperationsOrchestrator({
      store: runtime._store,
      github: runtime._github,
      mergeActive: runtime._mergeActive,
      refreshActive: runtime._refreshActive,
      worktrees: runtime._worktrees,
      start: (...args) => taskControl.start(...args),
    });
    const mergeRecovery = new MergeRecoveryOrchestrator({
      store: runtime._store,
      mergeActive: runtime._mergeActive,
      worktrees: runtime._worktrees,
      finalizeMerge: (...args) => candidates._finalizeMerge(...args),
    });

    this.runtime = boundaries;
    this.tasks = taskControl;
    this.pullRequests = pullRequests;
    this.mergeRecovery = mergeRecovery;
    this.candidates = candidates;
    this.designs = designs;
  }
}
