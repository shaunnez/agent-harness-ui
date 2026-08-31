import { PROJECTED_ACTIONS, runActionAdmission } from "./action-policy.mjs";
import {
  companionActionResponse,
  resolveGatePromotionEligibility,
  updateTaskRolePolicy,
} from "./companion-actions.mjs";
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

export function createTaskActionRoutes({ store, orchestrator, send, readJson, readModelCatalog }) {
  return async function handleTaskActionRoute(request, response, url) {
    const rolePolicyMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/(?:agent-policy|role-policy)$/);
    if (rolePolicyMatch && ["PUT", "POST"].includes(request.method)) {
      const id = decodeURIComponent(rolePolicyMatch[1]);
      const result = await updateTaskRolePolicy({
        store,
        taskId: id,
        input: await readJson(request),
        catalog: readModelCatalog ? await readModelCatalog() : undefined,
      });
      if (!result.ok) {
        send(response, result.status, companionActionResponse(result));
        return true;
      }
      send(response, 200, {
        task: result.task,
        scope: "task_snapshot",
        role: result.role,
        policy: result.policy,
      });
      return true;
    }

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

      const notes =
        [
          "approve-spec",
          "approve-plan",
          "approve-merge",
          "open-pr",
          "complete-merged",
          "close-already-satisfied",
        ].includes(action) || CANDIDATE_BOUND_ACTIONS.has(action)
          ? await readJson(request)
          : {};
      const actionInput = isRecord(notes) ? notes : {};
      const companionCandidateScope = CANDIDATE_BOUND_ACTIONS.has(action) && hasCandidateScope(actionInput);
      const companionGateEligibility = companionCandidateScope
        ? resolveGatePromotionEligibility(task, { action, ...actionInput })
        : null;
      if (companionGateEligibility && !companionGateEligibility.ok) {
        send(response, companionGateEligibility.status, companionActionResponse(companionGateEligibility));
        return true;
      }
      if (action === "approve-spec") {
        const result = await orchestrator.approveSpecification(id, actionInput.note ?? "");
        send(response, result.started ? 202 : 200, result);
        return true;
      }
      if (action === "approve-plan") {
        await orchestrator.approvePlan(id, actionInput.note ?? "");
        send(response, 200, { approved: true });
        return true;
      }
      if (action === "revalidate-plan") {
        const result = await orchestrator.revalidatePlan(id);
        send(response, 202, result);
        return true;
      }
      if (action === "close-already-satisfied") {
        await orchestrator.closeAlreadySatisfied(id, actionInput.note ?? "");
        send(response, 200, { closed: true });
        return true;
      }
      if (action === "approve-merge") {
        try {
          await orchestrator.approvePullRequest(
            id,
            actionInput.note ?? "",
            companionCandidateScope ? candidateScopeFrom(actionInput) : undefined,
          );
        } catch (error) {
          if (error?.code === "STALE_CANDIDATE") {
            send(response, 409, staleCandidateResponse(error));
            return true;
          }
          if (error?.code === "REPOSITORY_AUTHORITY") {
            send(response, error.statusCode ?? 409, repositoryAuthorityResponse(error));
            return true;
          }
          throw error;
        }
        send(response, 200, { pullRequestOpened: true });
        return true;
      }
      if (action === "open-pr") {
        try {
          await orchestrator.approvePullRequest(
            id,
            actionInput.note ?? "",
            companionCandidateScope ? candidateScopeFrom(actionInput) : undefined,
          );
        } catch (error) {
          if (error?.code === "STALE_CANDIDATE") {
            send(response, 409, staleCandidateResponse(error));
            return true;
          }
          if (error?.code === "REPOSITORY_AUTHORITY") {
            send(response, error.statusCode ?? 409, repositoryAuthorityResponse(error));
            return true;
          }
          throw error;
        }
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
        await orchestrator.completeMergedTask(id, actionInput.note ?? "");
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
      const startOptions = companionCandidateScope
        ? {
            canStart: (draft) => resolveGatePromotionEligibility(draft, { action, ...actionInput }).ok,
          }
        : {};
      if (action === "plan" && task.currentStage === "implement") {
        startOptions.onReserve = (draft) => {
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
        };
      }
      const started = await orchestrator.start(id, runConfiguration.kind, startOptions);
      if (started) {
        send(response, 202, { started: true });
        return true;
      }
      const latest = await store.get(id);
      if (companionCandidateScope) {
        const latestEligibility = resolveGatePromotionEligibility(latest, {
          action,
          ...actionInput,
        });
        if (!latestEligibility.ok) {
          send(response, latestEligibility.status, companionActionResponse(latestEligibility));
          return true;
        }
      }
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

const CANDIDATE_BOUND_ACTIONS = new Set(["review", "test", "final-review", "approve-merge", "open-pr"]);
const CANDIDATE_SCOPE_FIELDS = ["candidateId", "candidateRevision", "candidateHeadRevision"];

function hasCandidateScope(value) {
  return CANDIDATE_SCOPE_FIELDS.some((field) => Object.hasOwn(value, field));
}

function candidateScopeFrom(value) {
  return Object.fromEntries(CANDIDATE_SCOPE_FIELDS.map((field) => [field, value[field]]));
}

function staleCandidateResponse(error) {
  return companionErrorResponse(error, "stale-candidate");
}

function repositoryAuthorityResponse(error) {
  return companionErrorResponse(error, "repository-authority");
}

function companionErrorResponse(error, code) {
  return {
    error: error.message,
    code,
    evidence: error.evidence ?? [error.message],
  };
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
