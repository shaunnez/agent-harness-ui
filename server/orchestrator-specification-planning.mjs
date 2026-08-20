import { renderPlanCritiqueMarkdown } from "./contract-rendering.mjs";
import { throwIfAborted } from "./orchestrator-run-policy.mjs";
import { activity, now } from "./orchestrator-stage-support.mjs";
import { retainedSliceCanBeRequalified } from "./orchestrator-task-helpers.mjs";
import { buildStageRequest } from "./prompts.mjs";
import { parsePlanCritique, parseWorkPackages } from "./structured-output.mjs";
import { recordEdge, recordNodeSkipped } from "./topology-trace.mjs";
import { selectVerificationCommands } from "./verification.mjs";
import { fastEscalation } from "./workflow-profiles.mjs";

/**
 * How many times a plan may be sent back before a human is asked. Two is the point at which a
 * critic and a planner disagreeing stops looking like a correctable oversight and starts looking
 * like a disagreement about the specification, which is not theirs to settle.
 */
export const PLAN_REVISION_LIMIT = 2;

/**
 * The critic is off on fast (a bounded one-package contract has no plan to speak of), on by
 * default on standard, and mandatory on high-risk.
 */
function planCriticRequired(task) {
  return task.workflowProfile?.selected !== "fast";
}

export class SpecificationPlanningOrchestrator {
  constructor({
    store,
    worktrees,
    readVerificationManifest,
    escalateProfile,
    executeAgent,
    retainAgentResult,
  }) {
    this._store = store;
    this._worktrees = worktrees;
    this._readVerificationManifest = readVerificationManifest;
    this._escalateProfile = escalateProfile;
    this._executeAgent = executeAgent;
    this._retainAgentResult = retainAgentResult;
  }
  async _runSpecification(id, signal) {
    const task = await this._store.get(id);
    const result = await this._executeAgent(task, "specification", signal, task.repositoryPath, "read-only");
    throwIfAborted(signal);
    await this._retainAgentResult(id, "specification", result, { replace: true });
    await this._store.update(id, (draft) => {
      draft.status = "awaiting-spec-approval";
      draft.currentStage = "specification";
      draft.activeRunKind = null;
      draft.activeRunReservationId = null;
      draft.events.push(
        activity(
          "specification",
          "Specification ready for approval",
          "Review the evidence and approve or stop.",
          "success",
          "decision",
        ),
      );
    });
  }

  /**
   * Plan, then have a fresh reader try to break it before any code is written.
   *
   * The critique runs inside the planning attempt, while its run reservation is still live —
   * the attempt clears `activeRunKind` when it finalises, so a critic running after that has no
   * reservation to execute under. That ordering is why a REVISE verdict blocks for direction
   * rather than looping automatically: see Q2 in docs/harness-v2/progress.md.
   */
  async _runPlanning(id, signal) {
    await this._planningAttempt(id, signal);
  }

  /**
   * Fresh context, read-only, and a different model from the planner by default. Returns null
   * when the profile does not run a critic at all.
   */
  async _criticisePlan(id, signal) {
    const task = await this._store.get(id);
    if (!planCriticRequired(task)) {
      await this._store.update(id, (draft) => {
        recordNodeSkipped(
          draft,
          "plan-review",
          "The fast profile's bounded change contract defines a single package; there is no plan for a critic to fault.",
        );
        draft.stageDispositions["plan-review"] = {
          status: "not-required",
          reason:
            "The fast profile's bounded change contract defines a single package; there is no plan for a critic to fault.",
          decidedAt: now(),
        };
      });
      return null;
    }
    // Runs at stage "plan" under its own policy id, exactly as the repair agent runs at stage
    // "implement" under policy "repair". That reuses the planning run reservation instead of
    // inventing a reservation stage, so nothing in the run-activity contract changes; the prompt
    // is built for "plan-review" and passed in explicitly.
    const result = await this._executeAgent(
      task,
      "plan",
      signal,
      task.repositoryPath,
      "read-only",
      null,
      buildStageRequest(task, "plan-review"),
      "Plan critique",
      "plan-review",
    );
    throwIfAborted(signal);
    const critique = parsePlanCritique(result.finalText);
    const revision = task.attemptsByStage?.plan ?? 1;
    await this._retainAgentResult(
      id,
      "plan",
      { ...result, finalText: renderPlanCritiqueMarkdown(critique) },
      {
        replace: false,
        complete: critique.verdict === "PASS",
        name: revision === 1 ? "plan-critique.md" : `plan-critique-r${revision}.md`,
        artifactTitle:
          critique.verdict === "PASS"
            ? "Plan critique passed"
            : `Plan critique found ${critique.blocking.length} blocking issue${critique.blocking.length === 1 ? "" : "s"}`,
        agentRole: "plan-review",
        topologyNode: "plan-review",
      },
    );
    await this._store.update(id, (draft) => {
      recordEdge(draft, "plan", "plan-review");
      draft.planCritique = critique;
      if (critique.verdict === "PASS") {
        draft.events.push(
          activity(
            "plan-review",
            "Plan critique passed",
            critique.advisory.length
              ? `No blocking findings. ${critique.advisory.length} advisory note${critique.advisory.length === 1 ? "" : "s"} retained without gating.`
              : "No blocking findings.",
            "success",
            "decision",
          ),
        );
      }
    });
    return critique;
  }

  async _planningAttempt(id, signal) {
    const task = await this._store.get(id);
    const planAttempt = task.attemptsByStage?.plan ?? 1;
    const result = await this._executeAgent(task, "plan", signal, task.repositoryPath, "read-only");
    throwIfAborted(signal);
    const artifactOptions = {
      replace: planAttempt === 1,
      name: planAttempt === 1 ? undefined : `implementation-plan-r${planAttempt}.md`,
    };
    let workPackages;
    try {
      workPackages = parseWorkPackages(result.finalText, task.repositoryPath);
      const verificationManifest = await this._readVerificationManifest(task.repositoryPath);
      for (const workPackage of workPackages) {
        selectVerificationCommands(verificationManifest, workPackage.verificationCommandIds);
      }
    } catch (error) {
      await this._retainAgentResult(id, "plan", result, {
        ...artifactOptions,
        complete: false,
        name:
          planAttempt === 1
            ? "implementation-plan-invalid.md"
            : `implementation-plan-r${planAttempt}-invalid.md`,
        artifactTitle: "Unparseable implementation plan retained",
        artifactTone: "warning",
      });
      throw error;
    }
    const profileEscalation = fastEscalation({
      profile: task.workflowProfile?.selected,
      kind: "plan",
      packageCount: workPackages.length,
      dependencyCount: workPackages.reduce(
        (total, workPackage) => total + workPackage.dependencies.length,
        0,
      ),
    });
    if (profileEscalation) await this._escalateProfile(id, profileEscalation, "plan");
    const retainedDispositions = new Map();
    if (typeof this._worktrees.retainedPatchDisposition === "function") {
      try {
        const targetRevision = (await this._worktrees.base(task, { allowDirty: true })).baseRevision;
        for (const workPackage of workPackages) {
          const prior = task.workPackages?.find((item) => item.id === workPackage.id);
          if (!retainedSliceCanBeRequalified(prior, workPackage)) continue;
          try {
            retainedDispositions.set(
              workPackage.id,
              await this._worktrees.retainedPatchDisposition(
                { ...prior, repositoryRoot: task.repositoryPath },
                targetRevision,
              ),
            );
          } catch {
            retainedDispositions.set(workPackage.id, "conflicts");
          }
        }
      } catch {
        /* Test seams without a repository retain the conservative requalification path. */
      }
    }
    await this._retainAgentResult(id, "plan", result, artifactOptions);
    const critique = await this._criticisePlan(id, signal);
    await this._store.update(id, (draft) => {
      for (const workPackage of workPackages) {
        const prior = draft.workPackages?.find((item) => item.id === workPackage.id);
        if (!prior) continue;
        workPackage.attempts = Math.max(workPackage.attempts, prior.attempts ?? 0);
        if (retainedSliceCanBeRequalified(prior, workPackage)) {
          workPackage.branch = prior.branch;
          workPackage.worktreePath = prior.worktreePath;
          workPackage.baseRevision = prior.baseRevision;
          workPackage.headRevision = prior.headRevision;
          workPackage.files = [...prior.files];
          const disposition = retainedDispositions.get(workPackage.id) ?? "pending";
          const qualificationRepair = /did not qualify/i.test(prior.error ?? "");
          workPackage.retainedForRequalification = disposition === "pending" && !qualificationRepair;
          workPackage.retainedReplacementReason = disposition === "pending" ? null : disposition;
          if (disposition === "pending" && qualificationRepair) {
            workPackage.retainedContinuation = {
              requestedAt: now(),
              files: [...prior.files],
              outsideOwnership: [],
              qualificationFailure: prior.error,
            };
          }
        }
      }
      draft.workPackages = workPackages;
      draft.currentStage = "plan";
      draft.activeRunKind = null;
      draft.activeRunReservationId = null;
      const batches = Math.max(...workPackages.map((item) => item.batch));
      if (critique?.verdict === "REVISE") {
        // A plan with a cited, in-dimension defect must not be approvable: approving it would
        // spend implementation tokens building something the critic already showed is wrong.
        draft.status = "blocked";
        draft.error = `The plan critic raised ${critique.blocking.length} blocking finding${critique.blocking.length === 1 ? "" : "s"}: ${critique.blocking.map((finding) => `${finding.dimension} — ${finding.claim}`).join("; ")}`;
        draft.events.push(
          activity(
            "plan",
            `Plan critique blocked the plan`,
            `${draft.error} Grant a plan retry to revise, or override the critique deliberately.`,
            "danger",
            "decision",
          ),
        );
        return;
      }
      draft.status = "awaiting-plan-approval";
      draft.events.push(
        activity(
          "plan",
          "Implementation plan ready",
          `${workPackages.length} work package${workPackages.length === 1 ? "" : "s"} across ${batches} dependency batch${batches === 1 ? "" : "es"}.${critique ? " Plan critique passed." : ""}`,
          "success",
          "decision",
        ),
      );
    });
  }
}
