import { supportsRetainedPackageContinuation } from "../src/retained-package-continuation.ts";
import { assertLinearGrillReply } from "./linear-grill-contract.mjs";
import {
  candidateRepairCircuitExhausted,
  candidateRepairCircuitReason,
  isInvalidApprovedPlanFailure,
} from "../src/workflow-recovery-policy.ts";
import { GATE_APPROVAL_ADVANCE, resolveGateAutoAdvance, resolveGatePolicy } from "./gate-policies.mjs";
import { providerForModelId } from "./model-catalog.mjs";
import { canStartRun, currentCandidate, reserveRun } from "./orchestrator-run-policy.mjs";
import { activity, completeGrillSession, now, RUN_KINDS } from "./orchestrator-stage-support.mjs";
import { recordApproval, stageForRun } from "./orchestrator-task-helpers.mjs";
import { stageRunLimitFor } from "./run-activity.mjs";
import { isOwnedFile } from "./structured-output.mjs";
import { selectVerificationCommands } from "./verification.mjs";
import { canOverrideWorkflowProfile, recordWorkflowProfile } from "./workflow-profiles.mjs";

export class TaskControlOrchestrator {
  _acceptingRuns = true;

  constructor({
    store,
    active,
    worktrees,
    runCodex,
    readVerificationManifest,
    readVerificationManifestAtRevision,
    readVerificationManifestInjected,
    planAuthority,
    run,
    startDesigns,
    refreshCandidate,
  }) {
    this._store = store;
    this._active = active;
    this._worktrees = worktrees;
    this._runCodex = runCodex;
    this._readVerificationManifest = readVerificationManifest;
    this._readVerificationManifestAtRevision = readVerificationManifestAtRevision;
    this._readVerificationManifestInjected = readVerificationManifestInjected;
    this._planAuthority = planAuthority;
    this._run = run;
    this._startDesigns = startDesigns;
    this._refreshCandidate = refreshCandidate;
  }
  isRunning(id) {
    return this._active.has(id);
  }

  async start(id, kind = "investigation", options = {}) {
    if (!RUN_KINDS.has(kind)) throw new Error(`Unknown run kind: ${kind}`);
    if (!this._acceptingRuns) return false;
    if (this._active.has(id)) return false;
    const controller = new AbortController();
    const reservation = { controller, kind, promise: null };
    this._active.set(id, reservation);
    try {
      const preflightTask = kind === "implementation" ? await this._store.get(id) : null;
      const implementationCanStart =
        kind === "implementation" &&
        preflightTask &&
        (options.canStart ? options.canStart(preflightTask) : canStartRun(preflightTask, kind));
      if (implementationCanStart && (await this._planAuthority.blockStalePlan(id))) {
        throw new Error(
          "Repository authority changed or could not be verified. Revalidate the retained plan before implementation.",
        );
      }
      if (implementationCanStart) await this._assertSourceReadyForImplementation(preflightTask);
      const drift = await this._blockCandidateGateOnTargetDrift(id, kind, {
        allowAutoRefresh: options.allowAutoRefresh !== false,
      });
      if (drift === "refreshed") {
        // The candidate is now a new revision on the new target, so every candidate-bound
        // gate is stale and the requested one is no longer the right run: Dev Review is.
        // Release this reservation first — `start` refuses a task that is already active,
        // including itself. `allowAutoRefresh: false` bounds this to a single retry.
        this._active.delete(id);
        return await this.start(id, "review", { allowAutoRefresh: false });
      }
      if (drift) {
        throw new Error(
          "The target branch advanced. Refresh the candidate before spending another candidate-bound gate attempt.",
        );
      }
      const reserved = await this._store.transition(
        id,
        (draft) =>
          !draft.activeRunKind &&
          !draft.activeRunReservationId &&
          (options.canStart ? options.canStart(draft) : canStartRun(draft, kind)),
        (draft) => {
          options.onReserve?.(draft);
          reserveRun(draft, kind);
        },
      );
      if (!reserved) {
        this._active.delete(id);
        return false;
      }
      reservation.runReservationId = reserved.activeRunReservationId;
    } catch (error) {
      this._active.delete(id);
      if (error.code === "TASK_TRANSITION_CONFLICT") return false;
      throw error;
    }
    const promise = this._run(id, kind, controller.signal).finally(() => {
      if (this._active.get(id) === reservation) this._active.delete(id);
    });
    reservation.promise = promise;
    promise.then(() => this._autoAdvanceGate(id)).catch(() => {});
    return true;
  }

  /**
   * Approval gates are settled before run gates because approving the plan is what
   * produces `ready-for-implementation`: the two run back to back on one completed run,
   * and the run gate reads the task again so it sees the status the approval just wrote.
   */
  async _autoAdvanceGate(id) {
    await this._autoApproveGate(id);
    // `transition` is declared out here, not inside the `try`, because the `catch` needs the
    // stage to record the failure against. Scoped to the `try` it was invisible to the
    // handler, so every thrown failure became a ReferenceError inside the handler itself and
    // was swallowed by the caller's `.catch(() => {})` — the task simply stopped, with no
    // event explaining why. A gate that fails must always say so.
    let task;
    let transition;
    try {
      task = await this._store.get(id);
      if (!task) return;
      transition = resolveGateAutoAdvance(task);
      if (!transition || task.currentStage !== transition.stage) return;
      const readyStatus = task.status;
      const settings = await this._store.settings();
      // `policyStage`, not `stage`: Repair is settable as one decision but is recorded
      // against whichever gate rejected the candidate, so the two differ there alone.
      if (resolveGatePolicy(settings, transition.policyStage) !== "auto-accept-recommendations") return;
      // `start` refuses an exhausted allowance exactly the way it refuses a task that
      // moved underneath it, so without this both came back as "the task changed" and
      // sent an operator looking for a race that never happened. Only a human can
      // extend a spent budget, so the message has to name it.
      if (!canStartRun(task, transition.nextKind)) {
        const budgetStage = stageForRun(transition.nextKind, task.currentStage);
        const limit = stageRunLimitFor(task, budgetStage);
        await this._recordGateAutoAdvanceFailure(
          id,
          transition.stage,
          `${budgetStage} has used all ${limit} of its allowed attempts, so the automation policy cannot start another. Grant a retry to allow one.`,
        );
        return;
      }
      const started = await this.start(id, transition.nextKind, {
        canStart: (draft) =>
          draft.status === readyStatus &&
          draft.currentStage === transition.stage &&
          canStartRun(draft, transition.nextKind),
        onReserve: (draft) => {
          draft.events.push(
            activity(
              transition.stage,
              "Gate auto-run authorized",
              transition.nextKind === "repair"
                ? `${transition.stage} rejected this candidate and the persisted automation policy authorized a repair. No person read the findings.`
                : `${transition.stage} advanced through the persisted automation policy.`,
              "info",
              "decision",
            ),
          );
        },
      });
      if (!started) {
        await this._recordGateAutoAdvanceFailure(
          id,
          transition.stage,
          "The task changed before the automated gate run could be reserved.",
        );
      }
    } catch (error) {
      await this._recordGateAutoAdvanceFailure(id, transition?.stage ?? "implement", error.message);
    }
  }

  /**
   * Auto-approval goes through `approveSpecification` / `approvePlan` rather than
   * writing the transition itself, so a stale plan, a non-executable plan and the fast
   * profile's single-package requirement all still refuse. Those refusals throw, which
   * leaves the task parked exactly where a manual operator would find it, with the
   * reason recorded — the gate fails closed, never open.
   */
  async _autoApproveGate(id) {
    let stage = null;
    try {
      const task = await this._store.get(id);
      if (!task) return;
      const transition = GATE_APPROVAL_ADVANCE[task.status];
      if (!transition) return;
      stage = transition.stage;
      const settings = await this._store.settings();
      if (resolveGatePolicy(settings, transition.stage) !== "auto-accept-recommendations") return;
      const note = "Approved by the persisted gate auto-run policy without human review.";
      if (transition.approval === "specification") {
        await this.approveSpecification(id, note, { automatic: true });
      } else {
        await this.approvePlan(id, note, { automatic: true });
      }
    } catch (error) {
      await this._recordGateAutoAdvanceFailure(id, stage ?? "specification", error.message);
    }
  }

  async _recordGateAutoAdvanceFailure(id, stage, detail) {
    try {
      await this._store.update(id, (draft) => {
        draft.events.push(
          activity(
            stage,
            "Gate auto-run could not start",
            String(detail ?? "Unknown gate auto-run failure."),
            "warning",
            "decision",
          ),
        );
      });
    } catch {
      // The task store itself is unavailable, so there is nowhere durable to record this failure.
    }
  }

  /**
   * Refuse an Implement run whose source checkout is already in a state that will fail.
   *
   * `GitWorktreeManager.base()` rejects a dirty tree, but it does so several steps into
   * the run, after the stage has been reserved and the attempt counted. Every one of the
   * 13 recorded "uncommitted changes" stage failures was at Implement, and each spent a
   * stage attempt — enough of them in a row and the task blocks on its stage run limit
   * for a condition the operator could have fixed in a second. Checking here throws
   * before `reserveRun`, so the operator sees the reason and the attempt is not spent.
   */
  async _assertSourceReadyForImplementation(task) {
    if (typeof this._worktrees.uncommittedEntries !== "function") return;
    const dirty = await this._worktrees.uncommittedEntries(task.repositoryPath).catch(() => []);
    if (!dirty.length) return;
    const named = dirty.slice(0, 5).join(", ");
    throw new Error(
      `The selected repository has ${dirty.length} uncommitted change${dirty.length === 1 ? "" : "s"} (${named}${dirty.length > 5 ? ", …" : ""}). Commit or stash them, then start Implement again. No stage attempt was spent.`,
    );
  }

  /**
   * Resolve a candidate whose target branch moved out from under it.
   *
   * Returns `false` when there is nothing to resolve, `"refreshed"` when the candidate
   * was rebased onto the new target and the caller should restart from Dev Review, and
   * `true` when the task is blocked and needs an operator.
   */
  async _blockCandidateGateOnTargetDrift(id, kind, { allowAutoRefresh = true } = {}) {
    if (
      !["review", "test", "final-review"].includes(kind) ||
      typeof this._worktrees.mergeState !== "function"
    ) {
      return false;
    }
    const task = await this._store.get(id);
    const candidate = currentCandidate(task);
    if (!candidate?.headRevision || task.activeRunKind || task.activeRunReservationId) return false;
    const restored =
      typeof this._worktrees.ensureCandidate === "function"
        ? await this._worktrees.ensureCandidate(candidate)
        : false;
    if (restored) {
      await this._store.update(id, (draft) => {
        draft.events.push(
          activity(
            draft.currentStage,
            "Candidate worktree restored",
            `${candidate.id} was reattached at recorded revision ${candidate.headRevision.slice(0, 8)} before the gate retry.`,
            "warning",
            "decision",
          ),
        );
      });
    }
    if ((await this._worktrees.mergeState(candidate)) !== "diverged") return false;
    const message =
      "The target branch advanced after this candidate was created. Refresh the candidate before running another candidate-bound gate.";
    const blocked = await this._blockOnTargetDrift(id, candidate, message);
    if (!blocked) return false;
    // Merging anything into the target used to leave every in-flight candidate sitting at
    // `blocked`, waiting for an operator to press Refresh — 76 recorded `Candidate gate
    // paused for target refresh` events against 73 manual refreshes. The refresh itself is
    // mechanical: rebase the retained patch onto the new target, bump the revision, and
    // let the candidate-bound gates rerun. Only a genuine content conflict needs a human,
    // and `refreshCandidate` already blocks with `target-refresh-conflict` for that. So the
    // harness now does the mechanical part itself and asks only for the judgement.
    //
    // `allowAutoRefresh: false` on the retry after a refresh: if the target advanced again
    // in the seconds between refreshing and restarting, that is a moving target the
    // operator should see, not something to chase in a loop.
    if (
      allowAutoRefresh &&
      typeof this._refreshCandidate === "function" &&
      typeof this._worktrees.refreshCandidate === "function"
    ) {
      return (await this._autoRefreshAfterTargetDrift(id, candidate)) ? "refreshed" : true;
    }
    return true;
  }

  async _blockOnTargetDrift(id, candidate, message) {
    return await this._store.transition(
      id,
      (draft) => {
        const current = currentCandidate(draft);
        return (
          !draft.activeRunKind &&
          !draft.activeRunReservationId &&
          current?.id === candidate.id &&
          current.revisionNumber === candidate.revisionNumber &&
          current.headRevision === candidate.headRevision
        );
      },
      (draft) => {
        draft.status = "blocked";
        draft.error = message;
        draft.blocker = {
          code: "target-diverged",
          detail: message,
          detectedAt: now(),
          candidateId: candidate.id,
          candidateRevision: candidate.revisionNumber,
          candidateBaseRevision: candidate.baseRevision,
        };
        draft.events.push(
          activity(
            draft.currentStage,
            "Candidate gate paused for target refresh",
            `${candidate.id} revision ${candidate.revisionNumber} remains retained, but its target advanced before ${draft.currentStage}. No gate attempt was spent.`,
            "warning",
            "decision",
          ),
        );
      },
    );
  }

  /**
   * Rebase a drifted candidate onto the advanced target without an operator click.
   *
   * True when the candidate now sits on the new target and the gates may rerun. False
   * when the task stays blocked — a content conflict the operator has to resolve, a
   * refresh already in flight, or a target that moved again mid-refresh. Every one of
   * those already records its own blocker and evidence, so the failure path deliberately
   * leaves the task exactly as `refreshCandidate` left it.
   */
  async _autoRefreshAfterTargetDrift(id, candidate) {
    try {
      await this._refreshCandidate(id);
    } catch (error) {
      await this._store
        .update(id, (draft) => {
          draft.events.push(
            activity(
              draft.currentStage,
              "Automatic target refresh needs an operator",
              `${candidate.id} could not be rebased onto the advanced target automatically: ${error.message}`,
              "warning",
              "decision",
            ),
          );
        })
        .catch(() => {});
      return false;
    }
    await this._store.update(id, (draft) => {
      draft.events.push(
        activity(
          draft.currentStage,
          "Candidate refreshed automatically after the target advanced",
          `${candidate.id} was rebased onto the advanced target without an operator retry. Every candidate-bound gate reruns against the new revision.`,
          "success",
          "decision",
        ),
      );
    });
    return true;
  }

  async cancel(id) {
    const active = this._active.get(id);
    if (!active) return false;
    await this._store.update(id, (draft) => {
      draft.status = "cancelling";
      draft.events.push(
        activity(
          draft.currentStage,
          "Cancellation requested",
          "The active process tree is being terminated before this task can run again.",
          "warning",
          "decision",
        ),
      );
    });
    active.controller.abort();
    return true;
  }

  async shutdown() {
    this._acceptingRuns = false;
    const active = [...this._active.entries()];
    const persistenceErrors = [];
    for (const [id, reservation] of active) {
      try {
        await this._store.transition(
          id,
          (draft) => draft.activeRunReservationId === reservation.runReservationId,
          (draft) => {
            const stage = stageForRun(draft.activeRunKind ?? reservation.kind, draft.currentStage);
            draft.stageRunLimits ??= {};
            draft.stageRunLimits[stage] = stageRunLimitFor(draft, stage) + 1;
            draft.status = "cancelling";
            draft.events.push(
              activity(
                stage,
                "Runtime shutdown requested",
                "The active process tree is being terminated before the task store closes. This interruption does not consume the human retry allowance.",
                "warning",
                "decision",
              ),
            );
          },
        );
      } catch (error) {
        if (error.code !== "TASK_TRANSITION_CONFLICT") persistenceErrors.push(error);
      } finally {
        reservation.controller.abort();
      }
    }
    const runResults = await Promise.allSettled(
      active.map(([, reservation]) => reservation.promise).filter(Boolean),
    );
    for (const result of runResults) {
      if (result.status === "rejected") persistenceErrors.push(result.reason);
    }
    if (persistenceErrors.length) {
      throw new AggregateError(
        persistenceErrors,
        "One or more active tasks could not record runtime shutdown.",
      );
    }
    return active.length;
  }

  async recordDecision(id, input) {
    return this._store.update(id, (draft) => {
      draft.decisions ??= [];
      const decision = {
        id: crypto.randomUUID(),
        question: input.question.trim().slice(0, 1_000),
        answer: input.answer.trim().slice(0, 5_000),
        createdAt: now(),
      };
      draft.decisions.push(decision);
      draft.events.push(
        activity(
          "grill",
          "Human decision recorded",
          `${decision.question}: ${decision.answer}`,
          "success",
          "decision",
          { decisionId: decision.id },
        ),
      );
    });
  }

  async overrideWorkflowProfile(id, profile, reason = "") {
    const task = await this._store.get(id);
    if (!task) throw new Error("Task not found.");
    if (!canOverrideWorkflowProfile(task)) {
      throw new Error(
        "Workflow profile can be changed only before implementation starts and while no agent is running.",
      );
    }
    const prior = task.workflowProfile?.selected ?? "standard";
    const note =
      reason.trim().slice(0, 2_000) ||
      `Operator changed the workflow profile from ${prior} to ${profile} before implementation.`;
    return this._store.transition(id, canOverrideWorkflowProfile, (draft) => {
      const changed = recordWorkflowProfile(draft, profile, note, "operator");
      if (!changed) return;
      draft.models = [
        ...new Set(Object.values(draft.agentConfig.stagePolicies ?? {}).map((policy) => policy.model)),
      ].map((model) => ({
        provider: providerForModelId(model) === "claude" ? "anthropic" : "openai",
        model,
      }));
      if (
        prior === "fast" &&
        profile !== "fast" &&
        draft.stageDispositions?.plan?.status === "not-required"
      ) {
        draft.workPackages = [];
        draft.scoutDispatch = null;
        draft.grillSession = null;
        draft.stageDispositions = {};
        draft.status = "failed";
        draft.currentStage = "scouts";
        draft.error =
          "The operator selected the full workflow. Resume investigation to produce the required scout, decision, specification, and plan evidence.";
      }
      draft.events.push(
        activity(
          draft.currentStage,
          "Workflow profile overridden",
          `${prior} → ${profile}. ${note}`,
          "warning",
          "decision",
          { workflowProfile: profile, priorWorkflowProfile: prior },
        ),
      );
    });
  }

  async answerGrillQuestion(id, input) {
    if (!["operator", "linear"].includes(input.source))
      throw new Error("Grill answers require an explicit operator action.");
    const remote = input.source === "linear" ? input.linear : null;
    if (input.source === "linear" && !remote) throw new Error("Linear reply provenance is required.");
    const answer = String(input.answer ?? "")
      .trim()
      .slice(0, 5_000);
    if (!answer) throw new Error("An answer is required.");
    const updated = await this._store.transition(
      id,
      (draft) => {
        if (remote && draft.decisions.some((item) => item.linearReply?.eventId === remote.eventId))
          return false;
        if (remote)
          assertLinearGrillReply(
            draft,
            remote,
            draft.grillSession?.questions.find((item) => item.id === input.questionId),
          );
        if (draft.status !== "awaiting-grill" || draft.grillSession?.status !== "open") {
          throw new Error("This task does not have an open Grill Me session.");
        }
        if (!draft.grillSession.questions.some((item) => item.id === input.questionId)) {
          throw new Error("Grill question not found.");
        }
        return true;
      },
      (draft) => {
        const target = draft.grillSession.questions.find((item) => item.id === input.questionId);
        target.answer = answer;
        target.answerSource = "operator-answer";
        if (remote) target.linearReply = remote;
        target.resolvedAt = now();
        const existing = draft.decisions.find((decision) => decision.grillQuestionId === target.id);
        if (existing) {
          existing.answer = answer;
          existing.createdAt = now();
        } else {
          draft.decisions.push({
            id: crypto.randomUUID(),
            grillQuestionId: target.id,
            question: target.question,
            answer,
            createdAt: now(),
          });
        }
        const decision = draft.decisions.find((item) => item.grillQuestionId === target.id);
        if (remote) decision.linearReply = remote;
        draft.events.push(
          activity("grill", "Grill answer recorded", `${target.id}: ${answer}`, "success", "decision", {
            decisionId: decision?.id ?? null,
          }),
        );
      },
    );
    if (!updated && remote) {
      const task = await this._store.get(id);
      if (task?.decisions.some((item) => item.linearReply?.eventId === remote.eventId)) return task;
    }
    if (!updated) throw new Error("Task not found.");
    return updated;
  }

  async finishGrill(id, { acceptRemaining = false, source = null, linear = null } = {}) {
    if (!["operator", "linear"].includes(source))
      throw new Error("Finishing Grill requires an explicit operator action.");
    if (source === "linear" && (!linear || acceptRemaining))
      throw new Error("Linear continuation requires explicit answers and reply provenance.");
    const task = await this._store.get(id);
    if (source === "linear") {
      if (task?.grillSession?.linearCompletion?.eventId === linear.eventId)
        return { started: false, recorded: true };
      assertLinearGrillReply(task, linear);
    }
    if (task?.designRequest?.requested === true) {
      return this._startDesigns(id, { acceptRemaining, source, linear });
    }
    const started = await this.start(id, "specification", {
      canStart: (draft) => {
        if (source === "linear") assertLinearGrillReply(draft, linear);
        if (draft.status !== "awaiting-grill" || draft.grillSession?.status !== "open") {
          throw new Error("This task does not have an open Grill Me session.");
        }
        if (draft.grillSession.questions.some((question) => !question.answer) && !acceptRemaining) {
          throw new Error("Answer every Grill question or explicitly accept the recommended assumptions.");
        }
        return true;
      },
      onReserve: (draft) => {
        completeGrillSession(draft, { source, acceptRemaining });
        if (source === "linear") draft.grillSession.linearCompletion = linear;
      },
    });
    if (!started) throw new Error("Task is already running.");
    return { started: true };
  }

  async approveSpecification(id, note = "", { automatic = false } = {}) {
    const task = await this._store.get(id);
    if (!task) throw new Error("Task not found.");
    if (!["awaiting-spec-approval", "awaiting-approval"].includes(task.status)) {
      throw new Error("The task is not awaiting specification approval.");
    }
    if (task.workflow === "investigate") {
      await this._store.transition(
        id,
        (draft) => ["awaiting-spec-approval", "awaiting-approval"].includes(draft.status),
        (draft) => {
          recordApproval(draft, "specification", note, { automatic });
          draft.status = "completed";
          draft.completedAt = now();
          draft.events.push(
            activity(
              "specification",
              "Investigation approved",
              "The approved specification is the final deliverable for this task.",
              "success",
              "decision",
            ),
          );
        },
      );
      return { started: false, completed: true };
    }
    const started = await this.start(id, "planning", {
      canStart: (draft) => ["awaiting-spec-approval", "awaiting-approval"].includes(draft.status),
      onReserve: (draft) => recordApproval(draft, "specification", note, { automatic }),
    });
    if (!started) throw new Error("Task is already running.");
    return { started: true, completed: false };
  }

  async approvePlan(id, note = "", { automatic = false } = {}) {
    let task = await this._store.get(id);
    if (!task) throw new Error("Task not found.");
    if (task.status !== "awaiting-plan-approval") throw new Error("The task is not awaiting plan approval.");
    if (await this._planAuthority.blockStalePlan(id)) {
      throw new Error("Repository authority changed or could not be verified. Revalidate the retained plan.");
    }
    task = await this._store.get(id);
    await this._assertExecutablePlan(task);
    if (task.workflowProfile?.selected === "fast") {
      if (task.workPackages?.length !== 1 || task.workPackages[0].dependencies.length) {
        throw new Error("Fast requires exactly one coherent work package with no package dependencies.");
      }
      if (!task.workPackages[0].verificationCommandIds?.length) {
        throw new Error("Fast requires at least one validated focused repository manifest command ID.");
      }
    }
    // Plan approval parks on `ready-for-implementation` instead of starting a run, so
    // unlike every other gate nothing else would consult the implement auto-run policy.
    // The kick below is what lets a manually approved plan still start implementation
    // automatically when the operator has opted that stage in. An automatic approval
    // skips it: that call is already inside `_autoAdvanceGate`, which reads the task
    // again and settles the run gate itself, so kicking here would start the run twice.
    const approved = await this._store.transition(
      id,
      (draft) => draft.status === "awaiting-plan-approval",
      (draft) => {
        recordApproval(draft, "plan", note, { automatic });
        const approvedReplacementPlan =
          Boolean(draft.planRevalidation?.completedAt) &&
          Boolean(draft.planRevalidation?.replacementArtifactId) &&
          draft.planRevalidation.replacementArtifactId === draft.planResult?.artifactId;
        const implementationAttempts = draft.attemptsByStage?.implement ?? 0;
        const implementationLimit = stageRunLimitFor(draft, "implement");
        const reserveReplacementAttempt =
          approvedReplacementPlan && implementationAttempts >= implementationLimit;
        if (reserveReplacementAttempt) {
          draft.stageRunLimits ??= {};
          draft.stageRunLimits.implement = implementationAttempts + 1;
        }
        draft.status = "ready-for-implementation";
        draft.currentStage = "implement";
        draft.events.push(
          activity(
            "implement",
            "Implementation authorized",
            reserveReplacementAttempt
              ? "The approved replacement plan may now run in an isolated Git worktree. One bounded implementation attempt was reserved because prior attempts remain retained for audit."
              : "The approved plan may now run in an isolated Git worktree.",
            "success",
            "decision",
            reserveReplacementAttempt
              ? {
                  grantedStage: "implement",
                  previousLimit: implementationLimit,
                  newLimit: implementationAttempts + 1,
                  reason: "approved-replacement-plan",
                }
              : {},
          ),
        );
      },
    );
    if (!automatic) await this._autoAdvanceGate(id);
    return approved;
  }

  async correctInvalidPlan(id) {
    const task = await this._store.get(id);
    if (!task) throw new Error("Task not found.");
    const candidate = task.candidates?.at(-1) ?? null;
    const implementationCorrectionCandidate =
      ["failed", "blocked"].includes(task.status) && task.currentStage === "implement";
    const exhaustedCandidateRepair =
      ["repair-required", "failed", "blocked"].includes(task.status) &&
      candidate?.status === "repair_required" &&
      candidateRepairCircuitExhausted(task, candidate);
    if (!implementationCorrectionCandidate && !exhaustedCandidateRepair) {
      throw new Error("The task is not blocked by an invalid approved plan.");
    }
    let validationError = null;
    if (implementationCorrectionCandidate && isInvalidApprovedPlanFailure(task.error)) {
      validationError = new Error(task.error);
    } else if (exhaustedCandidateRepair) {
      validationError = new Error(candidateRepairCircuitReason(task, candidate));
    } else {
      try {
        await this._assertExecutablePlan(task);
      } catch (error) {
        validationError = error;
      }
    }
    if (!validationError) {
      throw new Error("The retained approved plan is executable and does not require plan correction.");
    }
    const correctionReason = validationError.message;
    const planAttempts = task.attemptsByStage?.plan ?? 0;
    if (planAttempts >= stageRunLimitFor(task, "plan")) {
      throw new Error(
        "The Plan correction allowance is exhausted; inspect the retained plans before granting another Plan attempt.",
      );
    }
    const workPackageSnapshot = JSON.stringify(task.workPackages ?? []);
    const candidateSnapshot = JSON.stringify(task.candidates ?? []);
    const started = await this.start(id, "planning", {
      canStart: (draft) =>
        JSON.stringify(draft.workPackages ?? []) === workPackageSnapshot &&
        JSON.stringify(draft.candidates ?? []) === candidateSnapshot &&
        ((["failed", "blocked"].includes(draft.status) && draft.currentStage === "implement") ||
          (["repair-required", "failed", "blocked"].includes(draft.status) &&
            draft.candidates?.at(-1)?.status === "repair_required" &&
            candidateRepairCircuitExhausted(draft, draft.candidates?.at(-1)))),
      onReserve: (draft) => {
        const attempts = draft.attemptsByStage?.implement ?? 0;
        draft.stageRunLimits ??= {};
        draft.stageRunLimits.implement = Math.max(stageRunLimitFor(draft, "implement"), attempts + 1);
        draft.currentStage = "plan";
        draft.events.push(
          activity(
            "plan",
            "Invalid approved plan returned for correction",
            `${correctionReason} One implementation allowance was reserved for the corrected plan; prior attempts remain retained for audit.`,
            "warning",
            "decision",
          ),
        );
      },
    });
    if (!started) throw new Error("The invalid approved plan could not be reserved for correction.");
    return { started: true };
  }

  async resumePlanningAfterPrerequisite(id) {
    const task = await this._store.get(id);
    if (!task) throw new Error("Task not found.");
    if (
      task.status !== "blocked" ||
      task.currentStage !== "plan" ||
      task.blocker?.code !== "plan-prerequisite"
    ) {
      throw new Error("The task is not blocked by a planning prerequisite.");
    }
    if ((task.attemptsByStage?.plan ?? 0) >= stageRunLimitFor(task, "plan")) {
      throw new Error(
        "The Plan retry allowance is exhausted; inspect the retained prerequisite evidence before granting another Plan attempt.",
      );
    }
    const blockerSnapshot = JSON.stringify(task.blocker);
    const started = await this.start(id, "planning", {
      canStart: (draft) =>
        draft.status === "blocked" &&
        draft.currentStage === "plan" &&
        draft.blocker?.code === "plan-prerequisite" &&
        JSON.stringify(draft.blocker) === blockerSnapshot,
      onReserve: (draft) => {
        draft.blocker = null;
        draft.error = null;
        draft.events.push(
          activity(
            "plan",
            "Planning prerequisite marked ready for recheck",
            "A new read-only planning attempt will verify whether the retained prerequisite is now available.",
            "info",
            "decision",
          ),
        );
      },
    });
    if (!started) throw new Error("Task is already running.");
    return { started: true };
  }

  async revalidatePlan(id) {
    return this._planAuthority.revalidatePlan(id);
  }

  async closeAlreadySatisfied(id, note = "") {
    return this._planAuthority.closeAlreadySatisfied(id, note);
  }

  async continueRetainedPackage(id) {
    const task = await this._store.get(id);
    if (!task) throw new Error("Task not found.");
    if (!["failed", "blocked"].includes(task.status) || task.currentStage !== "implement") {
      throw new Error("The task is not awaiting a retained implementation continuation.");
    }
    const workPackage = [...(task.workPackages ?? [])]
      .reverse()
      .find(
        (item) =>
          item.status === "failed" &&
          item.worktreePath &&
          supportsRetainedPackageContinuation(item.error ?? task.error ?? ""),
      );
    if (!workPackage)
      throw new Error(
        "No interrupted, timed-out or qualification-failed retained package is available to recover.",
      );
    const retained = await this._worktrees.inspectRetainedSlice(workPackage, { requireClean: false });
    const qualificationFailure = /(?:retained slice )?did not qualify/i.test(
      workPackage.error ?? task.error ?? "",
    );
    if (retained.clean && !qualificationFailure) {
      throw new Error("The retained package is clean and has no failed qualification to retry.");
    }
    const outsideOwnership = retained.files.filter((file) => !isOwnedFile(file, workPackage.ownedPaths));
    const worktreeSnapshot = workPackage.worktreePath;
    const started = await this.start(id, "implementation", {
      canStart: (draft) => {
        const current = draft.workPackages?.find((item) => item.id === workPackage.id);
        return (
          ["failed", "blocked"].includes(draft.status) &&
          draft.currentStage === "implement" &&
          current?.status === "failed" &&
          current.worktreePath === worktreeSnapshot
        );
      },
      onReserve: (draft) => {
        const current = draft.workPackages.find((item) => item.id === workPackage.id);
        if (retained.clean) {
          current.retainedForRequalification = true;
          current.retainedContinuation = null;
        } else {
          draft.stageTimeoutOverridesMs ??= {};
          draft.stageTimeoutOverridesMs.implement = Math.max(
            draft.stageTimeoutOverridesMs.implement ?? 0,
            1_800_000,
          );
          current.retainedContinuation = {
            requestedAt: now(),
            files: retained.files,
            outsideOwnership,
          };
        }
        draft.events.push(
          activity(
            "implement",
            retained.clean
              ? "Exact retained package requalification authorized"
              : "Retained package continuation authorized",
            retained.clean
              ? `${workPackage.id} will rerun repository qualification at ${retained.headRevision.slice(0, 8)} without another model implementation run.`
              : `${workPackage.id} will continue in ${workPackage.branch} with a 30-minute timeout. ${outsideOwnership.length ? `${outsideOwnership.length} path(s) outside declared ownership must be restored before qualification.` : "All retained paths are within declared ownership."}`,
            "warning",
            "decision",
          ),
        );
      },
    });
    if (!started) throw new Error("The retained package recovery could not be reserved.");
    return { started: true };
  }

  async _assertExecutablePlan(task) {
    if (!task.workPackages?.length) {
      throw new Error("The approved plan does not contain executable work packages.");
    }
    for (const workPackage of task.workPackages) {
      if (!workPackage.verificationCommandIds?.length) {
        throw new Error(
          `${workPackage.id}: Focused package verification requires at least one repository manifest command id.`,
        );
      }
    }
    if (this._runCodex && !this._readVerificationManifestInjected) return;
    const verificationManifest = this._readVerificationManifestInjected
      ? await this._readVerificationManifest(task.repositoryPath)
      : await this._readVerificationManifestAtRevision(
          task.repositoryPath,
          task.planResult?.repositoryRevision ?? task.repositoryAuthority?.selectedRevision,
        );
    for (const workPackage of task.workPackages) {
      selectVerificationCommands(verificationManifest, workPackage.verificationCommandIds);
    }
  }
}
