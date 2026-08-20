import { PROJECTED_ACTIONS, runActionAdmission } from "./action-policy.mjs";
import {
  retainQualificationFailuresForImplementationRetry,
  retryGrantContext,
  sameRetryGrantContext,
  withActionEligibility,
} from "./retry-admission-policy.mjs";
import { stageRunLimitFor } from "./run-activity.mjs";

const ROUTED_TASK_ACTIONS = new Set([
  ...PROJECTED_ACTIONS.filter((action) => action !== "continue-implementation"),
  "cancel",
]);

export function createTaskActionRoutes({ store, orchestrator, send, readJson }) {
  return async function handleTaskActionRoute(request, response, url) {
    const actionMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/([^/]+)$/);
    if (request.method === "POST" && actionMatch && ROUTED_TASK_ACTIONS.has(actionMatch[2])) {
      const id = decodeURIComponent(actionMatch[1]);
      const task = await store.get(id);
      if (!task) {
        send(response, 404, { error: "Task not found." });
        return true;
      }
      const action = actionMatch[2];
      if (action === "cancel") {
        const cancelled = await orchestrator.cancel(id);
        send(
          response,
          cancelled ? 202 : 409,
          cancelled ? { cancelled: true } : { error: "Task is not running." },
        );
        return true;
      }

      const notes = ["approve-spec", "approve-plan", "approve-merge", "open-pr", "complete-merged"].includes(
        action,
      )
        ? await readJson(request)
        : {};
      if (action === "approve-spec") {
        const result = await orchestrator.approveSpecification(id, notes.note ?? "");
        send(response, result.started ? 202 : 200, result);
        return true;
      }
      if (action === "approve-plan") {
        await orchestrator.approvePlan(id, notes.note ?? "");
        send(response, 200, { approved: true });
        return true;
      }
      if (action === "approve-merge") {
        await orchestrator.approvePullRequest(id, notes.note ?? "");
        send(response, 200, { pullRequestOpened: true });
        return true;
      }
      if (action === "open-pr") {
        await orchestrator.approvePullRequest(id, notes.note ?? "");
        send(response, 200, { pullRequestOpened: true });
        return true;
      }
      if (action === "reconcile-merge") {
        const reconciled = await orchestrator.reconcileMerge(id);
        send(response, 200, { reconciled: true, task: withActionEligibility(reconciled) });
        return true;
      }
      if (action === "reconcile-pr") {
        const reconciled = await orchestrator.reconcilePullRequest(id);
        send(response, 200, { reconciled: true, task: withActionEligibility(reconciled) });
        return true;
      }
      if (action === "complete-merged") {
        await orchestrator.completeMergedTask(id, notes.note ?? "");
        send(response, 200, { completed: true });
        return true;
      }
      if (action === "refresh-candidate") {
        const refreshed = await orchestrator.refreshCandidate(id);
        send(response, 200, { refreshed: true, task: refreshed });
        return true;
      }
      if (action === "rebuild-candidate") {
        const rebuilt = await orchestrator.rebuildCandidateFromTarget(id);
        send(response, 200, { rebuilt: true, task: rebuilt });
        return true;
      }
      if (action === "restart-implementation") {
        const restarted = await orchestrator.restartImplementationFromTarget(id);
        send(response, 200, { restarted: true, task: restarted });
        return true;
      }
      if (action === "retry-test") {
        const result = await orchestrator.retryTestOnSameCandidate(id);
        send(response, 202, result);
        return true;
      }
      if (action === "continue-package") {
        const result = await orchestrator.continueRetainedPackage(id);
        send(response, 202, result);
        return true;
      }
      if (
        action === "plan" &&
        ["failed", "blocked"].includes(task.status) &&
        task.currentStage === "implement"
      ) {
        const result = await orchestrator.correctInvalidPlan(id);
        send(response, 202, result);
        return true;
      }
      if (action === "grant-retry") {
        const grant = retryGrantContext(task);
        if (grant.error) {
          send(response, 409, { error: grant.error });
          return true;
        }
        let reservedGrant = null;
        await store.transition(
          id,
          (draft) => {
            const currentGrant = retryGrantContext(draft);
            if (!sameRetryGrantContext(grant, currentGrant)) return false;
            reservedGrant = currentGrant;
            return true;
          },
          (draft) => {
            const {
              candidate,
              candidateHeadRevision,
              candidateId,
              candidateRevision,
              authorizingGateCandidateHeadRevision,
              authorizingGateCandidateId,
              authorizingGateCandidateRevision,
              authorizingGateArtifactId,
              authorizingGateKind,
              authorizingGateReservedAt,
              authorizingGateReservationId,
              authorizingGateRunId,
              authorizingGateStage,
              authorizingGateWorkflowAttempt,
              candidateAuthorizerArtifactIds,
              candidateAuthorizerReservationIds,
              candidateAuthorizerRunIds,
              candidateProducerArtifactIds,
              candidateProducerRunIds,
              grantedStage,
              currentLimit,
              retrySource,
              sourceRunIds,
              workflowAttempt,
              workflowCandidateHeadRevision,
              workflowCandidateId,
              workflowCandidateRevision,
              workflowReservationId,
            } = reservedGrant;
            const nextStageLimit = currentLimit + 1;
            draft.stageRunLimits ??= {};
            draft.stageRunLimits[grantedStage] = nextStageLimit;
            draft.status = "failed";
            draft.error = null;
            retainQualificationFailuresForImplementationRetry(draft, grantedStage);
            const decision = {
              id: crypto.randomUUID(),
              question:
                candidate?.status === "repair_required"
                  ? "Grant another repair attempt?"
                  : "Grant another stage attempt?",
              answer: `Human override increased the ${grantedStage} allowance to ${nextStageLimit}.`,
              grantedStage,
              previousLimit: currentLimit,
              newLimit: nextStageLimit,
              sourceRunId: retrySource?.id ?? null,
              sourceRunIds,
              candidateId,
              candidateRevision,
              candidateHeadRevision,
              authorizingGateCandidateId,
              authorizingGateCandidateRevision,
              authorizingGateArtifactId,
              authorizingGateCandidateHeadRevision,
              authorizingGateKind,
              authorizingGateReservedAt,
              authorizingGateReservationId,
              authorizingGateRunId,
              authorizingGateStage,
              authorizingGateWorkflowAttempt,
              candidateAuthorizerArtifactIds,
              candidateAuthorizerReservationIds,
              candidateAuthorizerRunIds,
              candidateProducerArtifactIds,
              candidateProducerRunIds,
              workflowAttempt,
              workflowCandidateId,
              workflowCandidateRevision,
              workflowCandidateHeadRevision,
              workflowReservationId,
              createdAt: new Date().toISOString(),
            };
            draft.decisions ??= [];
            draft.decisions.push(decision);
            draft.events.push({
              id: crypto.randomUUID(),
              at: decision.createdAt,
              category: "decision",
              tone: "warning",
              stage: draft.currentStage,
              title:
                candidate?.status === "repair_required"
                  ? "One repair attempt granted"
                  : "One stage attempt granted",
              detail: decision.answer,
              decisionId: decision.id,
              grantedStage,
              previousLimit: currentLimit,
              newLimit: nextStageLimit,
              sourceRunId: retrySource?.id ?? null,
              sourceRunIds,
              candidateId,
              candidateRevision,
              candidateHeadRevision,
              authorizingGateCandidateId,
              authorizingGateCandidateRevision,
              authorizingGateArtifactId,
              authorizingGateCandidateHeadRevision,
              authorizingGateKind,
              authorizingGateReservedAt,
              authorizingGateReservationId,
              authorizingGateRunId,
              authorizingGateStage,
              authorizingGateWorkflowAttempt,
              candidateAuthorizerArtifactIds,
              candidateAuthorizerReservationIds,
              candidateAuthorizerRunIds,
              candidateProducerArtifactIds,
              candidateProducerRunIds,
              workflowAttempt,
              workflowCandidateId,
              workflowCandidateRevision,
              workflowCandidateHeadRevision,
              workflowReservationId,
              retryOfRunId: retrySource?.id ?? null,
            });
          },
        );
        send(response, 200, { granted: true });
        return true;
      }

      const admission = runActionAdmission(task, action);
      if (!admission?.allowed) {
        send(response, 409, {
          error:
            admission?.code === "retry-exhausted"
              ? "The current stage has exhausted its retry allowance."
              : (admission?.reason ?? `Task cannot run ${action} while it is ${task.status}.`),
        });
        return true;
      }
      const runConfiguration = admission.configuration;
      if (action === "plan" && task.status === "awaiting-plan-approval") {
        const latestPlanArtifact = task.artifacts?.filter((artifact) => artifact.stage === "plan").at(-1);
        const latestDecision = task.decisions?.at(-1);
        if (
          !latestPlanArtifact ||
          !latestDecision ||
          latestDecision.createdAt <= latestPlanArtifact.createdAt
        ) {
          send(response, 409, {
            error: "Record the required plan correction as a task decision before revising the plan.",
          });
          return true;
        }
      }
      const started = await orchestrator.start(
        id,
        runConfiguration.kind,
        action === "plan" && task.currentStage === "implement"
          ? {
              onReserve: (draft) => {
                draft.currentStage = "plan";
                draft.events.push({
                  id: crypto.randomUUID(),
                  at: new Date().toISOString(),
                  category: "decision",
                  tone: "warning",
                  stage: "plan",
                  title: "Invalid approved plan returned for correction",
                  detail:
                    "Implementation did not have a valid focused verification contract. Planning must produce a corrected work-package manifest before writes resume.",
                });
              },
            }
          : {},
      );
      if (started) {
        send(response, 202, { started: true });
        return true;
      }
      const latest = await store.get(id);
      const latestStage = runConfiguration.kind === "repair" ? "implement" : latest.currentStage;
      const actuallyRunning =
        orchestrator.isRunning?.(id) === true ||
        Boolean(
          latest.activeRunKind || latest.activeRunReservationId || (latest.activeRunIds?.length ?? 0) > 0,
        );
      const exhausted = (latest.attemptsByStage?.[latestStage] ?? 0) >= stageRunLimitFor(latest, latestStage);
      send(response, 409, {
        error: actuallyRunning
          ? "Task is already running."
          : exhausted
            ? "The current stage has exhausted its retry allowance."
            : `Task cannot run ${action} while it is ${latest.status}.`,
      });
      return true;
    }

    return false;
  };
}
