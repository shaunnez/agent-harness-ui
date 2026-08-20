/**
 * The read-only step between a failed gate and any repair.
 *
 * Before this existed, "retry" meant "run the coder again": every accepted candidate defect
 * resolved to `repair-required`, and a write-enabled agent was handed the candidate. That is
 * the right answer when the candidate is the thing that is wrong, and it remains the default
 * here — an `IMPLEMENTATION_DEFECT` diagnosis returns control to the untouched repair path.
 *
 * What is new is the other seven answers. When the failure belongs to an upstream assumption,
 * the graph rewinds to the stage that owns it instead of polishing an implementation of a wrong
 * plan. The agent classifies; `server/failure-routing.mjs` alone decides the destination.
 *
 * Deliberately unchanged by this module: candidate lineage, gate freshness rules, repair
 * authority, and the automatic repair budget. A rewind spends a separate, independently bounded
 * backjump budget, so no existing limit is loosened and no new way to loop is introduced.
 */

import { renderFailureDiagnosisMarkdown } from "./contract-rendering.mjs";
import { admitBackjump, routeFailure } from "./failure-routing.mjs";
import { currentCandidate } from "./orchestrator-run-policy.mjs";
import { activity, now } from "./orchestrator-stage-support.mjs";
import { buildFailureDiagnosisRequest } from "./prompts.mjs";
import { refreshGateFreshness, stageRunLimitFor } from "./run-activity.mjs";
import { parseFailureDiagnosis } from "./structured-output.mjs";
import { recordEdge, recordNodeSkipped, recordRoutingDecision } from "./topology-trace.mjs";

/** Where each rewind target puts the task, using only statuses the harness already had. */
const REWIND_STATES = Object.freeze({
  scouts: { status: "queued", currentStage: "triage", runKind: "investigation" },
  synthesis: { status: "queued", currentStage: "triage", runKind: "investigation" },
  specification: { status: "queued", currentStage: "specification", runKind: "specification" },
  plan: { status: "awaiting-spec-approval", currentStage: "plan", runKind: "planning" },
  implement: { status: "ready-for-implementation", currentStage: "implement", runKind: "implementation" },
  test: { status: "ready-for-test", currentStage: "test", runKind: "test" },
});

export class FailureDiagnosisOrchestrator {
  constructor({ store, executeAgent, retainAgentResult }) {
    this._store = store;
    this._executeAgent = executeAgent;
    this._retainAgentResult = retainAgentResult;
  }

  /**
   * @returns {Promise<boolean>} true when the caller should run the ordinary repair path.
   */
  async _diagnoseFailure(id, signal) {
    const task = await this._store.get(id);
    const candidate = currentCandidate(task);
    // Only an accepted candidate defect reaches here. Anything else is left exactly as found:
    // this step adds a decision, it never invents one.
    if (candidate?.status !== "repair_required") return true;
    // The fast profile buys one bounded automatic repair and nothing else. Spending a model
    // call to attribute the failure would double its cost to change a decision it is not
    // allowed to act on: a fast run cannot rewind, it escalates to standard instead.
    if (task.workflowProfile?.selected === "fast") {
      await this._store.update(id, (draft) => {
        recordNodeSkipped(
          draft,
          "failure-diagnosis",
          "Fast profile routes its single automatic repair directly, without paying for attribution.",
        );
      });
      return true;
    }

    const request = buildFailureDiagnosisRequest(task, candidate);
    const result = await this._executeAgent(
      task,
      "implement",
      signal,
      candidate.worktreePath,
      "read-only",
      candidate,
      request,
      "Failure diagnosis",
      "repair",
    );
    const diagnosis = parseFailureDiagnosis(result.finalText);
    const route = routeFailure(diagnosis.classification);
    const admission = admitBackjump(task, route);

    await this._retainAgentResult(
      id,
      "implement",
      {
        ...result,
        finalText: renderFailureDiagnosisMarkdown(diagnosis, {
          routedTo: admission.admitted ? route.rewindTo : null,
        }),
      },
      {
        replace: false,
        complete: false,
        name: "failure-diagnosis.md",
        artifactTitle: `Failure attributed to ${diagnosis.classification}`,
        agentRole: "failure-diagnosis",
      },
    );

    if (!admission.admitted) {
      await this._store.update(id, (draft) => {
        recordRoutingDecision(draft, {
          at: draft.currentStage,
          classification: diagnosis.classification,
          rewindTo: route.rewindTo ?? "",
          rationale: `Refused: ${admission.reason}`,
        });
        draft.status = "blocked";
        draft.error = admission.reason;
        draft.events.push(
          activity(draft.currentStage, "Backjump budget exhausted", admission.reason, "danger", "decision"),
        );
      });
      return false;
    }

    if (route.action === "repair-candidate") {
      await this._store.update(id, (draft) => {
        recordRoutingDecision(draft, {
          at: draft.currentStage,
          classification: diagnosis.classification,
          rewindTo: "implement",
          rationale: route.rationale,
        });
        draft.events.push(
          activity(
            draft.currentStage,
            "Failure attributed to the candidate",
            `${route.rationale} Proceeding with the ordinary candidate repair.`,
            "warning",
            "decision",
          ),
        );
      });
      return true;
    }

    if (route.requiresHuman || !route.rewindTo) {
      await this._store.update(id, (draft) => {
        recordRoutingDecision(draft, {
          at: draft.currentStage,
          classification: diagnosis.classification,
          rewindTo: "",
          rationale: route.rationale,
        });
        draft.status = "blocked";
        draft.error = `${diagnosis.classification}: ${route.rationale}`;
        draft.events.push(
          activity(
            draft.currentStage,
            `${diagnosis.classification} needs a human`,
            route.rationale,
            "danger",
            "decision",
          ),
        );
      });
      return false;
    }

    await this._applyRewind(id, diagnosis, route);
    return false;
  }

  /**
   * Mirrors the existing target-refresh rebuild in `orchestrator-candidate-operations.mjs`:
   * supersede the candidate, return its packages to planned, grant the rewind target enough
   * stage-run headroom to actually run again, drop the invalidated completed stages, and let
   * `refreshGateFreshness` recompute what evidence still counts. Nothing here reaches into gate
   * or repair authority; it restates the task at an earlier point using the same primitives.
   */
  async _applyRewind(id, diagnosis, route) {
    const target = REWIND_STATES[route.rewindTo];
    if (!target) throw new Error(`No rewind state is defined for ${route.rewindTo}.`);
    await this._store.update(id, (draft) => {
      const from = draft.currentStage;
      const activeCandidate = currentCandidate(draft);
      if (route.discardsCandidate && activeCandidate) {
        activeCandidate.status = "superseded";
        activeCandidate.updatedAt = now();
        for (const workPackage of draft.workPackages ?? []) {
          workPackage.status = "planned";
          workPackage.error = null;
          workPackage.retainedContinuation = null;
          workPackage.retainedForRequalification = false;
          workPackage.retainedReplacementReason = null;
          workPackage.verificationRuns = [];
        }
      }
      const attempts = draft.attemptsByStage?.[route.rewindTo] ?? 0;
      draft.stageRunLimits ??= {};
      draft.stageRunLimits[route.rewindTo] = Math.max(stageRunLimitFor(draft, route.rewindTo), attempts + 1);
      draft.completedStages = draft.completedStages.filter(
        (stage) => !route.invalidates.includes(stage) && stage !== "approval",
      );
      draft.status = target.status;
      draft.currentStage = target.currentStage;
      draft.activeRunKind = null;
      draft.activeRunReservationId = null;
      draft.error = null;
      draft.blocker = null;
      draft.mergeIntent = null;
      refreshGateFreshness(draft);

      recordRoutingDecision(draft, {
        at: from,
        classification: diagnosis.classification,
        rewindTo: route.rewindTo,
        rationale: route.rationale,
      });
      recordEdge(draft, from, route.rewindTo, "backjump");
      draft.events.push(
        activity(
          route.rewindTo,
          `Rewound to ${route.rewindTo} after ${diagnosis.classification}`,
          `${route.rationale} ${diagnosis.rationale}`,
          "warning",
          "decision",
        ),
      );
    });
  }
}
