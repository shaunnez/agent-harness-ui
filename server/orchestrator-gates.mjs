import {
  attachRunArtifact,
  beginAgentRun,
  completeAgentRun,
  readExecutionProvider,
  runEventMetadata,
} from "./run-activity.mjs";
import { fastEscalation, recordWorkflowProfile } from "./workflow-profiles.mjs";

import { WorkPackageOrchestrator } from "./orchestrator-work-packages.mjs";
import {
  now,
  zeroUsage,
  deterministicGateResult,
  deterministicTestMarkdown,
  deterministicFinalReviewMarkdown,
  activity,
} from "./orchestrator-stage-support.mjs";
import { currentCandidate, createStageRunReservation } from "./orchestrator-run-policy.mjs";
import { applyStageRunReservation, requireActiveRunReservation } from "./orchestrator-task-helpers.mjs";

export class CandidateGateOrchestrator extends WorkPackageOrchestrator {
  async _escalateProfile(id, escalation, stage) {
    await this._store.update(id, (draft) => {
      const prior = draft.workflowProfile?.selected ?? "standard";
      if (!recordWorkflowProfile(draft, escalation.target, escalation.reason, "automatic-escalation")) return;
      draft.models = [
        ...new Set(Object.values(draft.agentConfig.stagePolicies ?? {}).map((policy) => policy.model)),
      ].map((model) => ({ provider: "openai", model }));
      draft.events.push(
        activity(
          stage,
          "Workflow profile escalated",
          `${prior} → ${escalation.target}. ${escalation.reason}`,
          "warning",
          "decision",
          { workflowProfile: escalation.target, priorWorkflowProfile: prior },
        ),
      );
    });
  }

  async _completeDeterministicFastGates(id, candidate, verification) {
    await this._store.update(id, (draft) => {
      const activeCandidate = currentCandidate(draft);
      if (
        activeCandidate.id !== candidate.id ||
        activeCandidate.revisionNumber !== candidate.revisionNumber ||
        activeCandidate.headRevision !== candidate.headRevision
      ) {
        throw new Error("The candidate changed before deterministic fast-path gates could be persisted.");
      }
      const testReservation = requireActiveRunReservation(draft, "test", "test");
      const testStartedAt = now();
      const testRun = beginAgentRun(draft, {
        id: crypto.randomUUID(),
        kind: "test",
        provider: readExecutionProvider(testReservation),
        stage: "test",
        role: "test",
        model: null,
        reasoning: null,
        startedAt: testStartedAt,
        candidateId: candidate.id,
        candidateRevision: candidate.revisionNumber,
        candidateHeadRevision: candidate.headRevision,
        workflowAttempt: testReservation.workflowAttempt,
        workflowReservationId: testReservation.id,
      });
      const testCompletedAt = now();
      completeAgentRun(draft, testRun.id, {
        status: "completed",
        completedAt: testCompletedAt,
        durationMs: 0,
        usage: zeroUsage(),
        runtimeEvents: [],
      });
      const testPassed = verification.status === "passed";
      const testGateResult = deterministicGateResult(
        "test",
        candidate,
        testPassed,
        testPassed ? [] : ["The full repository verification manifest contains a failed command."],
      );
      const testArtifact = {
        id: crypto.randomUUID(),
        runId: testRun.id,
        stage: "test",
        name: `test-${candidate.id.toLowerCase()}-r${candidate.revisionNumber}.md`,
        kind: "markdown",
        content: deterministicTestMarkdown(candidate, verification),
        createdAt: testCompletedAt,
        startedAt: testStartedAt,
        completedAt: testCompletedAt,
        durationMs: verification.durationMs,
        model: null,
        reasoning: null,
        agentRole: "harness-verification",
        usage: zeroUsage(),
        candidateId: candidate.id,
        candidateRevision: candidate.revisionNumber,
        workPackageId: null,
        focusedTest: structuredClone(verification),
        evidenceError: null,
        gateResult: testGateResult,
        contextManifest: null,
      };
      draft.artifacts.push(testArtifact);
      const attachedTestRun = attachRunArtifact(draft, testRun.id, testArtifact);
      draft.activeRunKind = null;
      draft.activeRunReservationId = null;
      if (!testPassed) {
        const escalation = fastEscalation({ profile: "fast", kind: "verification-failure" });
        if (
          escalation &&
          recordWorkflowProfile(draft, escalation.target, escalation.reason, "automatic-escalation")
        ) {
          draft.models = [
            ...new Set(Object.values(draft.agentConfig.stagePolicies ?? {}).map((policy) => policy.model)),
          ].map((model) => ({ provider: "openai", model }));
        }
        activeCandidate.status = "repair_required";
        draft.status = "repair-required";
        draft.currentStage = "test";
        draft.events.push(
          activity(
            "test",
            "Candidate requires repair",
            "The exact candidate failed the recorded full repository manifest.",
            "danger",
            "decision",
            runEventMetadata(attachedTestRun, { artifactId: testArtifact.id }),
          ),
        );
        return;
      }
      if (!draft.completedStages.includes("test")) draft.completedStages.push("test");
      draft.events.push(
        activity(
          "test",
          "Focused Test passed",
          "The harness accepted the recorded full-manifest result without a model interpretation call.",
          "success",
          "decision",
          runEventMetadata(attachedTestRun, { artifactId: testArtifact.id }),
        ),
      );

      const finalReservation = createStageRunReservation(draft, "final-review", "final-review");
      applyStageRunReservation(draft, finalReservation);
      draft.activeRunKind = "final-review";
      const finalStartedAt = now();
      const finalRun = beginAgentRun(draft, {
        id: crypto.randomUUID(),
        kind: "final-review",
        provider: readExecutionProvider(finalReservation),
        stage: "final-review",
        role: "final-review",
        model: null,
        reasoning: null,
        startedAt: finalStartedAt,
        candidateId: candidate.id,
        candidateRevision: candidate.revisionNumber,
        candidateHeadRevision: candidate.headRevision,
        workflowAttempt: finalReservation.workflowAttempt,
        workflowReservationId: finalReservation.id,
      });
      const finalCompletedAt = now();
      completeAgentRun(draft, finalRun.id, {
        status: "completed",
        completedAt: finalCompletedAt,
        durationMs: 0,
        usage: zeroUsage(),
        runtimeEvents: [],
      });
      const finalGateResult = deterministicGateResult("final-review", candidate, true, []);
      const finalArtifact = {
        id: crypto.randomUUID(),
        runId: finalRun.id,
        stage: "final-review",
        name: `final-review-${candidate.id.toLowerCase()}-r${candidate.revisionNumber}.md`,
        kind: "markdown",
        content: deterministicFinalReviewMarkdown(draft, candidate, verification),
        createdAt: finalCompletedAt,
        startedAt: finalStartedAt,
        completedAt: finalCompletedAt,
        durationMs: 0,
        model: null,
        reasoning: null,
        agentRole: "deterministic-final-review",
        usage: zeroUsage(),
        candidateId: candidate.id,
        candidateRevision: candidate.revisionNumber,
        workPackageId: null,
        focusedTest: null,
        evidenceError: null,
        gateResult: finalGateResult,
        contextManifest: null,
      };
      draft.artifacts.push(finalArtifact);
      const attachedFinalRun = attachRunArtifact(draft, finalRun.id, finalArtifact);
      if (!draft.completedStages.includes("final-review")) draft.completedStages.push("final-review");
      draft.stageDispositions["final-review"] = {
        status: "deterministic",
        reason:
          "Generated mechanically from the exact candidate, independent Dev Review, and recorded full-manifest result because no unresolved blocking risk remained.",
        decidedAt: finalCompletedAt,
      };
      activeCandidate.status = "awaiting_human_approval";
      activeCandidate.updatedAt = finalCompletedAt;
      draft.status = "awaiting-human-approval";
      draft.currentStage = "approval";
      draft.activeRunKind = null;
      draft.activeRunReservationId = null;
      draft.events.push(
        activity(
          "final-review",
          "Deterministic Final Review passed",
          `${candidate.id} revision ${candidate.revisionNumber} advanced without another model call.`,
          "success",
          "decision",
          runEventMetadata(attachedFinalRun, { artifactId: finalArtifact.id }),
        ),
      );
    });
  }
}
