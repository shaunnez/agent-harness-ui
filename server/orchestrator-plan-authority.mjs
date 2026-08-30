import { sameAuthorityTarget } from "./repository-authority.mjs";
import { activity, now } from "./orchestrator-stage-support.mjs";

export class PlanAuthorityOrchestrator {
  constructor({ store, repositoryAuthority, start }) {
    this._store = store;
    this._repositoryAuthority = repositoryAuthority;
    this._start = start;
  }

  async revalidatePlan(id) {
    const task = await this._store.get(id);
    if (!task) throw new Error("Task not found.");
    if (
      !(
        task.blocker?.code === "stale-plan" ||
        this.legacyPlanNeedsRevalidation(task) ||
        (task.currentStage === "plan" && ["failed", "blocked"].includes(task.status))
      )
    ) {
      throw new Error("This task does not require plan revalidation.");
    }
    const authority = await this._repositoryAuthority.capture(task.repositoryPath, {
      frozenRevision: task.experiment?.frozenBaseSha ?? null,
    });
    const priorArtifactId = task.planResult?.artifactId ?? null;
    await this._store.transition(
      id,
      (draft) =>
        !draft.activeRunKind &&
        !draft.activeRunReservationId &&
        (draft.blocker?.code === "stale-plan" ||
          this.legacyPlanNeedsRevalidation(draft) ||
          (draft.currentStage === "plan" && ["failed", "blocked"].includes(draft.status))),
      (draft) => {
        this.recordRepositoryAuthority(draft, authority);
        draft.status = "failed";
        draft.currentStage = "plan";
        draft.blocker = null;
        draft.error = null;
        draft.planRevalidation = {
          priorArtifactId,
          priorRevision: task.planResult?.repositoryRevision ?? null,
          requestedAt: now(),
          targetAuthorityId: authority.id,
          completedAt: null,
          replacementArtifactId: null,
        };
        draft.events.push(
          activity(
            "plan",
            "Plan revalidation requested",
            `The retained plan${priorArtifactId ? ` (${priorArtifactId})` : ""} remains available for audit. Planning will inspect ${authority.selectedRevision.slice(0, 8)}.`,
            "warning",
            "decision",
          ),
        );
      },
    );
    const started = await this._start(id, "planning", {
      canStart: (draft) =>
        draft.status === "failed" &&
        draft.currentStage === "plan" &&
        draft.repositoryAuthority?.id === authority.id,
    });
    if (!started) throw new Error("Plan revalidation could not be reserved.");
    return { started: true };
  }

  async closeAlreadySatisfied(id, note = "") {
    const task = await this._store.get(id);
    if (!task) throw new Error("Task not found.");
    if (
      task.status !== "awaiting-already-satisfied" ||
      task.planResult?.disposition !== "already-satisfied"
    ) {
      throw new Error("The task is not awaiting an already-satisfied decision.");
    }
    if (await this.blockStalePlan(id)) {
      throw new Error(
        "Repository authority changed or could not be verified. Revalidate the retained evidence.",
      );
    }
    return this._store.transition(
      id,
      (draft) =>
        draft.status === "awaiting-already-satisfied" &&
        draft.planResult?.disposition === "already-satisfied",
      (draft) => {
        draft.status = "closed";
        draft.completedAt = now();
        draft.closure = {
          reason: "already-satisfied",
          note: String(note ?? "")
            .trim()
            .slice(0, 2_000),
          supersededBy: null,
          closedAt: now(),
          source: "operator",
        };
        draft.events.push(
          activity(
            "plan",
            "Closed — already implemented",
            "A human reviewed the revision-bound repository evidence and explicitly closed the task.",
            "success",
            "decision",
          ),
        );
      },
    );
  }

  async blockStalePlan(id) {
    const task = await this._store.get(id);
    if (!task || task.activeRunKind || task.activeRunReservationId) return false;
    const planBinding = task.planResult;
    const authority = await this._repositoryAuthority.capture(task.repositoryPath, {
      frozenRevision: task.experiment?.frozenBaseSha ?? null,
    });
    const remoteUnverified =
      Boolean(authority.upstreamRef) && authority.remoteVerification?.status !== "verified";
    const stale = !sameAuthorityTarget(planBinding, authority) || remoteUnverified;
    const expectedPlanArtifactId = planBinding?.artifactId ?? null;
    const expectedStatus = task.status;
    const changed = await this._store.transition(
      id,
      (draft) =>
        !draft.activeRunKind &&
        !draft.activeRunReservationId &&
        draft.status === expectedStatus &&
        (draft.planResult?.artifactId ?? null) === expectedPlanArtifactId,
      (draft) => {
        this.recordRepositoryAuthority(draft, authority);
        if (!stale) return;
        const priorRevision = planBinding?.repositoryRevision ?? null;
        const message = remoteUnverified
          ? "The current tracked target could not be verified. The retained plan is not being treated as fresh."
          : priorRevision
            ? `The target moved from ${priorRevision.slice(0, 8)} to ${authority.selectedRevision.slice(0, 8)} after planning.`
            : "This active legacy task has no revision-bound plan.";
        draft.status = "blocked";
        draft.currentStage = "plan";
        draft.error = message;
        draft.blocker = {
          code: "stale-plan",
          detail: message,
          detectedAt: now(),
          planArtifactId: expectedPlanArtifactId,
          planRevision: priorRevision,
          currentRevision: authority.selectedRevision,
          targetRef: authority.targetRef,
          remoteVerification: authority.remoteVerification,
        };
        draft.events.push(
          activity(
            "plan",
            "Plan blocked by repository authority",
            `${message} No implementation attempt or worktree was created. Revalidate the plan against the current target.`,
            "warning",
            "decision",
          ),
        );
      },
    );
    return Boolean(changed && stale);
  }

  recordRepositoryAuthority(draft, authority) {
    draft.repositoryAuthority = structuredClone(authority);
    draft.repositoryAuthorityHistory ??= [];
    if (!draft.repositoryAuthorityHistory.some((entry) => entry.id === authority.id)) {
      draft.repositoryAuthorityHistory.push(structuredClone(authority));
    }
    draft.repositoryAuthorityStatus = "bound";
  }

  legacyPlanNeedsRevalidation(task) {
    return Boolean(
      task.repositoryAuthorityStatus === "legacy-unbound" &&
        (task.currentStage === "plan" ||
          task.currentStage === "implement" ||
          (task.workPackages?.length ?? 0) > 0 ||
          (task.artifacts ?? []).some((artifact) => artifact.stage === "plan")),
    );
  }
}
