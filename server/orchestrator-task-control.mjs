import { stageRunLimitFor } from "./run-activity.mjs";
import { isOwnedFile } from "./structured-output.mjs";
import { selectVerificationCommands } from "./verification.mjs";
import { canOverrideWorkflowProfile, recordWorkflowProfile } from "./workflow-profiles.mjs";

import { RUN_KINDS, now, activity, completeGrillSession } from "./orchestrator-stage-support.mjs";
import { currentCandidate, canStartRun, reserveRun } from "./orchestrator-run-policy.mjs";
import { recordApproval } from "./orchestrator-task-helpers.mjs";

export class TaskControlOrchestrator {
  constructor({
    store,
    active,
    worktrees,
    runCodex,
    readVerificationManifest,
    readVerificationManifestAtRevision,
    readVerificationManifestInjected,
    run,
  }) {
    this._store = store;
    this._active = active;
    this._worktrees = worktrees;
    this._runCodex = runCodex;
    this._readVerificationManifest = readVerificationManifest;
    this._readVerificationManifestAtRevision = readVerificationManifestAtRevision;
    this._readVerificationManifestInjected = readVerificationManifestInjected;
    this._run = run;
  }
  isRunning(id) {
    return this._active.has(id);
  }

  async start(id, kind = "investigation", options = {}) {
    if (!RUN_KINDS.has(kind)) throw new Error(`Unknown run kind: ${kind}`);
    if (this._active.has(id)) return false;
    const controller = new AbortController();
    const reservation = { controller, kind, promise: null };
    this._active.set(id, reservation);
    try {
      if (await this._blockCandidateGateOnTargetDrift(id, kind)) {
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
    } catch (error) {
      this._active.delete(id);
      if (error.code === "TASK_TRANSITION_CONFLICT") return false;
      throw error;
    }
    const promise = this._run(id, kind, controller.signal).finally(() => {
      if (this._active.get(id) === reservation) this._active.delete(id);
    });
    reservation.promise = promise;
    return true;
  }

  async _blockCandidateGateOnTargetDrift(id, kind) {
    if (
      !["review", "test", "final-review"].includes(kind) ||
      typeof this._worktrees.mergeState !== "function"
    ) {
      return false;
    }
    const task = await this._store.get(id);
    const candidate = currentCandidate(task);
    if (!candidate?.headRevision || task.activeRunKind || task.activeRunReservationId) return false;
    if ((await this._worktrees.mergeState(candidate)) !== "diverged") return false;
    const message =
      "The target branch advanced after this candidate was created. Refresh the candidate before running another candidate-bound gate.";
    const blocked = await this._store.transition(
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
    return Boolean(blocked);
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
      ].map((model) => ({ provider: "openai", model }));
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
    if (input.source !== "operator") throw new Error("Grill answers require an explicit operator action.");
    const answer = String(input.answer ?? "")
      .trim()
      .slice(0, 5_000);
    if (!answer) throw new Error("An answer is required.");
    const updated = await this._store.transition(
      id,
      (draft) => {
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
        draft.events.push(
          activity("grill", "Grill answer recorded", `${target.id}: ${answer}`, "success", "decision", {
            decisionId: decision?.id ?? null,
          }),
        );
      },
    );
    if (!updated) throw new Error("Task not found.");
    return updated;
  }

  async finishGrill(id, { acceptRemaining = false, source = null } = {}) {
    if (source !== "operator") throw new Error("Finishing Grill requires an explicit operator action.");
    const started = await this.start(id, "specification", {
      canStart: (draft) => {
        if (draft.status !== "awaiting-grill" || draft.grillSession?.status !== "open") {
          throw new Error("This task does not have an open Grill Me session.");
        }
        if (draft.grillSession.questions.some((question) => !question.answer) && !acceptRemaining) {
          throw new Error("Answer every Grill question or explicitly accept the recommended assumptions.");
        }
        return true;
      },
      onReserve: (draft) => completeGrillSession(draft, { source: "operator", acceptRemaining }),
    });
    if (!started) throw new Error("Task is already running.");
    return { started: true };
  }

  async approveSpecification(id, note = "") {
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
          recordApproval(draft, "specification", note);
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
      onReserve: (draft) => recordApproval(draft, "specification", note),
    });
    if (!started) throw new Error("Task is already running.");
    return { started: true, completed: false };
  }

  async approvePlan(id, note = "") {
    const task = await this._store.get(id);
    if (!task) throw new Error("Task not found.");
    if (task.status !== "awaiting-plan-approval") throw new Error("The task is not awaiting plan approval.");
    await this._assertExecutablePlan(task);
    if (task.workflowProfile?.selected === "fast") {
      if (task.workPackages?.length !== 1 || task.workPackages[0].dependencies.length) {
        throw new Error("Fast requires exactly one coherent work package with no package dependencies.");
      }
      if (!task.workPackages[0].verificationCommandIds?.length) {
        throw new Error("Fast requires at least one validated focused repository manifest command ID.");
      }
    }
    return this._store.transition(
      id,
      (draft) => draft.status === "awaiting-plan-approval",
      (draft) => {
        recordApproval(draft, "plan", note);
        draft.status = "ready-for-implementation";
        draft.currentStage = "implement";
        draft.events.push(
          activity(
            "implement",
            "Implementation authorized",
            "The approved plan may now run in an isolated Git worktree.",
            "success",
            "decision",
          ),
        );
      },
    );
  }

  async correctInvalidPlan(id) {
    const task = await this._store.get(id);
    if (!task) throw new Error("Task not found.");
    if (!["failed", "blocked"].includes(task.status) || task.currentStage !== "implement") {
      throw new Error("The task is not blocked by an invalid approved plan.");
    }
    let validationError = null;
    try {
      await this._assertExecutablePlan(task);
    } catch (error) {
      validationError = error;
    }
    const failedQualification = task.workPackages?.find(
      (workPackage) =>
        workPackage.status === "failed" &&
        workPackage.headRevision &&
        workPackage.worktreePath &&
        /did not qualify/i.test(workPackage.error ?? task.error ?? ""),
    );
    if (!validationError && !failedQualification) {
      throw new Error("The retained approved plan is executable and does not require plan correction.");
    }
    const correctionReason =
      validationError?.message ??
      `${failedQualification.id} needs a corrected ownership or verification plan after focused package qualification failed.`;
    const planAttempts = task.attemptsByStage?.plan ?? 0;
    if (planAttempts >= stageRunLimitFor(task, "plan")) {
      throw new Error(
        "The Plan correction allowance is exhausted; inspect the retained plans before granting another Plan attempt.",
      );
    }
    const workPackageSnapshot = JSON.stringify(task.workPackages ?? []);
    const started = await this.start(id, "planning", {
      canStart: (draft) =>
        ["failed", "blocked"].includes(draft.status) &&
        draft.currentStage === "implement" &&
        JSON.stringify(draft.workPackages ?? []) === workPackageSnapshot,
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
          /run exceeded \d+ seconds|harness stopped while this task was running/i.test(
            item.error ?? task.error ?? "",
          ),
      );
    if (!workPackage)
      throw new Error("No timed-out or interrupted retained work package is available to continue.");
    const retained = await this._worktrees.inspectRetainedSlice(workPackage, { requireClean: false });
    if (retained.clean)
      throw new Error(
        "The retained package is clean; use exact retained-slice requalification or a new implementation attempt.",
      );
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
        const attempts = draft.attemptsByStage?.implement ?? 0;
        draft.stageRunLimits ??= {};
        draft.stageRunLimits.implement = Math.max(stageRunLimitFor(draft, "implement"), attempts + 1);
        draft.stageTimeoutOverridesMs ??= {};
        draft.stageTimeoutOverridesMs.implement = Math.max(
          draft.stageTimeoutOverridesMs.implement ?? 0,
          1_800_000,
        );
        const current = draft.workPackages.find((item) => item.id === workPackage.id);
        current.retainedContinuation = {
          requestedAt: now(),
          files: retained.files,
          outsideOwnership,
        };
        draft.events.push(
          activity(
            "implement",
            "Retained package continuation authorized",
            `${workPackage.id} will continue in ${workPackage.branch} with a 30-minute timeout. ${outsideOwnership.length ? `${outsideOwnership.length} path(s) outside declared ownership must be restored before qualification.` : "All retained paths are within declared ownership."}`,
            "warning",
            "decision",
          ),
        );
      },
    });
    if (!started) throw new Error("The retained package continuation could not be reserved.");
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
          (await this._worktrees.base(task, { allowDirty: true })).baseRevision,
        );
    for (const workPackage of task.workPackages) {
      selectVerificationCommands(verificationManifest, workPackage.verificationCommandIds);
    }
  }
}
