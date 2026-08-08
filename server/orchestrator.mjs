import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import {
  buildExecutionRequest,
  buildRepairRequest,
  buildOnboardingRequest,
  buildStageRequest,
  buildTestInterpretationRequest,
  buildWorkPackageRequest,
  getStageMetadata,
  INVESTIGATION_PIPELINE,
  projectRepairFindings,
} from "./prompts.mjs";
import { getCodexStatus } from "./codex-runtime.mjs";
import { resolveExecutionProvider } from "./execution-providers.mjs";
import { isProcessTimeoutError } from "./process-runtime.mjs";
import { defaultWorktreeRoot, GitWorktreeManager, symlinkedDependencySourceRoots } from "./git-worktree.mjs";
import {
  CREDIT_SOURCE_URL,
  enrichUsage,
  PRICING_SOURCE_URL,
  policyIdForRun,
  providerForModelId,
  readExecutionProviderCatalog,
  resolveAgentPolicy,
  validatePricingRates,
  withConfiguredModels,
} from "./model-catalog.mjs";
import {
  aggregateScoutReports,
  buildScoutRequest,
  parseScoutReport,
  scoutCatalog,
  scoutReportMarkdown,
  selectScoutDispatch,
} from "./scouts.mjs";
import {
  attachRunArtifact,
  beginAgentRun,
  CANDIDATE_GATE_STAGES,
  completeAgentRun,
  DEFAULT_EXECUTION_PROVIDER,
  readExecutionProvider,
  RUNTIME_FRESHNESS_REASONS,
  refreshGateFreshness,
  runEventMetadata,
  runKindFor,
  stageRunLimitFor,
} from "./run-activity.mjs";
import {
  isCandidateEvidenceError,
  parseGateEvidence,
  parseGrillQuestions,
  parseWorkPackages,
  validateFocusedTestEvidence,
} from "./structured-output.mjs";
import {
  discoverVerificationEvidence,
  OnboardingError,
  parseOnboardingProposal,
  renderManifestFile,
  VERIFICATION_MANIFEST_PATH,
} from "./onboarding.mjs";
import { gitHeadRevision, runRepositoryVerification } from "./verification.mjs";

const RUN_KINDS = new Set([
  "investigation",
  "specification",
  "planning",
  "implementation",
  "repair",
  "review",
  "test",
  "final-review",
]);

function now() {
  return new Date().toISOString();
}

function workPackageVerificationMarkdown(verification) {
  const rows = (verification.rows ?? []).map((row) => {
    const detail = row.failureDetails ? `\n\n${row.failureDetails}` : "";
    return `### ${row.id}: ${String(row.status).toUpperCase()}\n\n- Command: \`${row.command}\`\n- Duration: ${row.durationMs}ms${detail}`;
  });
  const skipped = (verification.declaredCommandIds ?? []).filter(
    (id) => !(verification.executedCommandIds ?? []).includes(id),
  );
  return `## Harness slice qualification\n\n- Result: ${String(verification.status).toUpperCase()}\n- Revision: ${verification.headRevision}\n- Source: ${verification.command}\n${skipped.length ? `- Skipped after failure: ${skipped.join(", ")}\n` : ""}\n${rows.join("\n\n")}`;
}

function activity(stage, title, detail, tone = "info", category = "activity", metadata = {}) {
  return { id: crypto.randomUUID(), at: now(), category, tone, stage, title, detail, ...metadata };
}

export class TaskOrchestrator {
  #store;
  #active = new Map();
  #mergeActive = new Set();
  #runCodex;
  #getStatus;
  #worktrees;
  #runVerification;
  #runPackageVerification;

  constructor(store, options = {}) {
    this.#store = store;
    this.#runCodex = options.runCodex ?? null;
    this.#getStatus = options.getStatus ?? getCodexStatus;
    this.#worktrees = options.worktreeManager ?? new GitWorktreeManager(defaultWorktreeRoot());
    // The same injection seam `runCodex` and `worktreeManager` already use, for the same
    // reason: harness verification spawns real processes in a real worktree, so a test about
    // gate ingestion, freshness or retry accounting should be able to supply the observation
    // rather than stand up a repository to obtain it. The real path is exercised directly in
    // `tests/verification.test.mjs`, including against a real git worktree.
    this.#runVerification = options.runVerification ?? runRepositoryVerification;
    // Production slices qualify with the same repository-owned, argv-only manifest as
    // Focused Test. Unit tests that inject a model runner keep their existing lightweight
    // seam unless they explicitly inject package verification; real runtime execution never
    // gets that exemption.
    this.#runPackageVerification = options.runPackageVerification
      ?? (this.#runCodex
        ? null
        : async ({ worktreePath, workPackageId, attempt, signal }) => {
            const headRevision = await gitHeadRevision(worktreePath);
            return this.#runVerification({
              worktreePath,
              candidate: { id: workPackageId, revisionNumber: attempt, headRevision },
              signal,
            });
          });
  }

  /**
   * Dispatch one agent run to the named execution provider.
   *
   * `options.runCodex` remains an honoured injection point and overrides the
   * resolved provider entirely, which is what keeps the existing runtime tests
   * driving the orchestrator without knowing the seam exists.
   */
  #runAgent(providerId, request) {
    if (this.#runCodex) return this.#runCodex(request);
    return resolveExecutionProvider(providerId).run(request);
  }

  /**
   * The seam's teeth. A provider that reports anything weaker than an OS-enforced
   * sandbox for this posture gets the harness's own verification *required*, and the
   * stage refuses to run when that verification is not wired. A provider whose
   * confinement is one OS-level guarantee is verified anyway where the hook exists —
   * both additions strengthen existing checks — but is not blocked by its absence,
   * which is what lets an injected partial worktree manager keep working.
   */
  #requiresHarnessConfinement(providerId, sandbox) {
    if (this.#runCodex) return false;
    const provider = resolveExecutionProvider(providerId);
    return provider.capabilities().sandboxes?.[sandbox] !== "os-enforced";
  }

  /**
   * Refuse a stage the provider cannot confine, before anything is spawned.
   *
   * A posture the provider does not list is unavailable, not weakly available —
   * this is what keeps `workspace-write` on Codex. And a provider whose confinement
   * is verified by the harness rather than by the OS must demonstrate it on *this*
   * host: the layered posture depends on mechanisms a CLI release can change without
   * a changelog entry the harness reads, so configuration is not evidence.
   *
   * A provider may also refuse on host capacity rather than on confinement. That
   * refusal runs first and is not overridable: it names what the operator must do, and
   * a stage that cannot exec a shell would produce unverifiable evidence at best. Its
   * check is racy by construction — the exec-argument budget is per repository, so a
   * concurrent task can consume the headroom after this returns — which is why the
   * mid-run shell-start guard stays as well.
   */
  async #assertProviderConfinement(providerId, sandbox, networkAccess = false, cwd = null) {
    if (this.#runCodex) return;
    const provider = resolveExecutionProvider(providerId);
    const capabilities = provider.capabilities();
    const posture = capabilities.sandboxes?.[sandbox];
    if (!posture) {
      throw new Error(`${provider.label} does not support the ${sandbox} sandbox, so this stage cannot run on it.`);
    }
    if (networkAccess && !capabilities.grantsNetworkAccess) {
      throw new Error(`${provider.label} cannot grant the network access this stage requires, so it cannot run on it.`);
    }
    if (typeof provider.preflight === "function") {
      const budget = await provider.preflight({ sandbox, cwd });
      if (budget && budget.ok === false) throw new Error(budget.refusal ?? budget.detail);
    }
    if (capabilities.confinementVerifiedBy !== "harness") return;
    if (typeof provider.canary !== "function") {
      throw new Error(`${provider.label} reports ${posture} confinement but provides no way to verify it on this host.`);
    }
    const canary = await provider.canary({ sandbox, cwd });
    if (!canary?.passed) {
      throw new Error(
        `${provider.label} ${sandbox} confinement is not established on this host: ${canary?.detail ?? "the sandbox canary did not pass."}`,
      );
    }
  }

  async #snapshotSource(providerId, cwd, sandbox) {
    const available = typeof this.#worktrees.snapshotRepository === "function"
      && typeof this.#worktrees.assertRepositoryUnchanged === "function";
    const snapshot = available ? await this.#worktrees.snapshotRepository(cwd) : null;
    if (snapshot) return snapshot;
    // Unverifiable. A provider whose confinement is one OS-level guarantee proceeds
    // exactly as it does today; a provider relying on the harness as its enforcement
    // of record refuses rather than running unverified.
    if (this.#requiresHarnessConfinement(providerId, sandbox)) {
      throw new Error(
        `A ${sandbox} stage on this provider requires source-repository verification, and ${cwd} cannot be verified.`,
      );
    }
    return null;
  }

  async status() {
    const [runtime, settings] = await Promise.all([this.#getStatus(), this.#store.settings()]);
    // Every provider's models, so the picker can offer a Claude model for one stage and
    // a Codex model for another with each model's own reasoning levels.
    const catalog = runtime.catalog ? await readExecutionProviderCatalog() : runtime.catalog;
    return {
      ...runtime,
      catalog: withConfiguredModels(catalog, settings),
      model: settings.defaultModel,
      reasoning: settings.defaultReasoning,
      settings,
      scouts: scoutCatalog(),
    };
  }

  /**
   * Propose a verification manifest for a repository that has none.
   *
   * Read-only and operator-initiated. Nothing here is reachable from a stage: if a failing test
   * stage could ask for a new manifest, a failing candidate could clear itself by having a model
   * rewrite its own verification commands, which is exactly what #47 removed. The proposal is
   * returned for approval; it is not written.
   */
  async proposeOnboarding(repositoryPath) {
    const repositoryRoot = await this.#worktrees.repositoryRoot(repositoryPath);
    const existing = await readFile(path.join(repositoryRoot, VERIFICATION_MANIFEST_PATH), "utf8").catch(() => null);
    const evidence = await discoverVerificationEvidence(repositoryRoot);
    const settings = await this.#store.settings();
    // The provider follows the model, never a constant. `verifyPricing` is pinned to Codex on
    // purpose (#27, it hard-requires GPT-5.6 ids); copying that shape here was wrong, because
    // this call uses the operator's *default* model, and Codex rejects a model it does not own
    // with "not supported when using Codex with a ChatGPT account".
    const provider = providerForModelId(settings.defaultModel)
      ?? settings.defaultProvider
      ?? DEFAULT_EXECUTION_PROVIDER;
    const result = await this.#runAgent(provider, {
      cwd: repositoryRoot,
      prompt: buildOnboardingRequest(repositoryRoot, evidence).prompt,
      sandbox: "read-only",
      model: settings.defaultModel,
      reasoning: settings.defaultReasoning,
      // 300s was not enough for a real repository at the operator's default reasoning effort: the
      // run is a read-only exploration of a whole codebase, and it timed out with nothing to show
      // for the call. A timeout here wastes an operator-initiated, paid call and teaches nothing,
      // whereas the run itself is bounded by having a single artifact to produce.
      timeoutMs: 900_000,
    });
    const proposal = parseOnboardingProposal(result.finalText, evidence);
    return {
      repositoryRoot,
      evidence,
      proposal,
      alreadyOnboarded: existing != null,
      manifestPath: VERIFICATION_MANIFEST_PATH,
      manifestPreview: proposal.determined
        ? renderManifestFile(proposal, { model: settings.defaultModel, at: now() })
        : null,
      usage: enrichUsage(settings.defaultModel, result.usage, settings.pricing?.rates, settings.pricing?.version),
    };
  }

  /**
   * Write an approved manifest, confirm its commands actually run, then commit.
   *
   * The confirmation is not ceremony: a manifest that does not execute converts a configuration
   * error into a per-task failure, so the harness must not commit one it has never seen work. A
   * failed confirmation removes the file and reports, leaving the repository as it was.
   *
   * This runs repository commands unsandboxed with the harness's privileges — the same trade #47
   * documents — and only ever after an explicit approval from the operator.
   */
  async approveOnboarding(repositoryPath, proposal, options = {}) {
    if (!proposal?.determined) throw new OnboardingError("An undetermined proposal cannot be approved.");
    const repositoryRoot = await this.#worktrees.repositoryRoot(repositoryPath);
    const settings = await this.#store.settings();
    const target = path.join(repositoryRoot, VERIFICATION_MANIFEST_PATH);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, renderManifestFile(proposal, { model: options.model ?? settings.defaultModel, at: now() }), "utf8");
    try {
      const confirmation = await this.#runVerification({
        worktreePath: repositoryRoot,
        candidate: { id: "onboarding", revisionNumber: 1, headRevision: await gitHeadRevision(repositoryRoot) },
      });
      if (confirmation.status !== "passed") {
        throw new OnboardingError(
          `The approved commands did not pass in this repository, so the manifest was not committed: `
            + `${confirmation.rows.filter((row) => row.status !== "passed").map((row) => row.command).join(", ")}.`,
        );
      }
      return { repositoryRoot, manifestPath: VERIFICATION_MANIFEST_PATH, confirmation };
    } catch (error) {
      // The repository is left exactly as it was. A half-onboarded repository whose manifest has
      // never run is worse than one that still refuses, because the refusal is honest.
      await rm(target, { force: true });
      throw error;
    }
  }

  async verifyPricing() {
    const settings = await this.#store.settings();
    // Pricing verification prompts for OpenAI rates and `validatePricingRates`
    // hard-requires the GPT-5.6 ids, so it stays pinned to Codex until it is
    // provider-scoped with its own required-id set.
    const result = await this.#runAgent(DEFAULT_EXECUTION_PROVIDER, {
      cwd: process.cwd(),
      prompt: `You are verifying a local GPT-5.6 pricing registry. Use current official OpenAI documentation only: API prices from ${PRICING_SOURCE_URL} and ChatGPT/Codex credit rates from ${CREDIT_SOURCE_URL}. Do not modify files. Return exactly one JSON object between <pricing-rates> and </pricing-rates>. Include gpt-5.6-sol, gpt-5.6-terra, and gpt-5.6-luna. Each value must have short and, when documented, long objects with numeric input, cachedInput, cacheWrite (or null), and output USD prices per 1M tokens. Do not include prose inside the tags.`,
      sandbox: "read-only",
      model: settings.defaultModel,
      reasoning: "low",
      timeoutMs: 180_000,
    });
    const match = result.finalText.match(/<pricing-rates>\s*([\s\S]*?)\s*<\/pricing-rates>/i);
    if (!match) throw new Error("The pricing verifier did not return the required structured rate card.");
    const rates = validatePricingRates(JSON.parse(match[1]));
    const updated = await this.#store.updateSettings((draft) => {
      draft.pricing = {
        version: new Date().toISOString().slice(0, 10),
        sourceUrl: PRICING_SOURCE_URL,
        verifiedAt: now(),
        verifiedBy: `${settings.defaultModel} read-only verification agent`,
        rates: { ...draft.pricing.rates, ...rates },
        creditRates: draft.pricing.creditRates,
        creditSourceUrl: draft.pricing.creditSourceUrl ?? CREDIT_SOURCE_URL,
      };
    });
    return { settings: updated, usage: enrichUsage(settings.defaultModel, result.usage, updated.pricing.rates, updated.pricing.version) };
  }

  isRunning(id) {
    return this.#active.has(id);
  }

  async start(id, kind = "investigation", options = {}) {
    if (!RUN_KINDS.has(kind)) throw new Error(`Unknown run kind: ${kind}`);
    if (this.#active.has(id)) return false;
    const controller = new AbortController();
    const reservation = { controller, kind, promise: null };
    this.#active.set(id, reservation);
    try {
      const reserved = await this.#store.transition(
        id,
        (draft) => !draft.activeRunKind && !draft.activeRunReservationId && (options.canStart ? options.canStart(draft) : canStartRun(draft, kind)),
        (draft) => {
          options.onReserve?.(draft);
          reserveRun(draft, kind);
        },
      );
      if (!reserved) {
        this.#active.delete(id);
        return false;
      }
    } catch (error) {
      this.#active.delete(id);
      if (error.code === "TASK_TRANSITION_CONFLICT") return false;
      throw error;
    }
    const promise = this.#run(id, kind, controller.signal).finally(() => {
      if (this.#active.get(id) === reservation) this.#active.delete(id);
    });
    reservation.promise = promise;
    return true;
  }

  async cancel(id) {
    const active = this.#active.get(id);
    if (!active) return false;
    await this.#store.update(id, (draft) => {
      draft.status = "cancelling";
      draft.events.push(activity(draft.currentStage, "Cancellation requested", "The active process tree is being terminated before this task can run again.", "warning", "decision"));
    });
    active.controller.abort();
    return true;
  }

  async recordDecision(id, input) {
    return this.#store.update(id, (draft) => {
      draft.decisions ??= [];
      const decision = {
        id: crypto.randomUUID(),
        question: input.question.trim().slice(0, 1_000),
        answer: input.answer.trim().slice(0, 5_000),
        createdAt: now(),
      };
      draft.decisions.push(decision);
      draft.events.push(activity(
        "grill",
        "Human decision recorded",
        `${decision.question}: ${decision.answer}`,
        "success",
        "decision",
        { decisionId: decision.id },
      ));
    });
  }

  async answerGrillQuestion(id, input) {
    const answer = String(input.answer ?? "").trim().slice(0, 5_000);
    if (!answer) throw new Error("An answer is required.");
    const updated = await this.#store.transition(id, (draft) => {
      if (draft.status !== "awaiting-grill" || draft.grillSession?.status !== "open") {
        throw new Error("This task does not have an open Grill Me session.");
      }
      if (!draft.grillSession.questions.some((item) => item.id === input.questionId)) {
        throw new Error("Grill question not found.");
      }
      return true;
    }, (draft) => {
      const target = draft.grillSession.questions.find((item) => item.id === input.questionId);
      target.answer = answer;
      target.answerSource = "user";
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
      draft.events.push(activity(
        "grill",
        "Grill answer recorded",
        `${target.id}: ${answer}`,
        "success",
        "decision",
        { decisionId: decision?.id ?? null },
      ));
    });
    if (!updated) throw new Error("Task not found.");
    return updated;
  }

  async finishGrill(id, { acceptRemaining = false } = {}) {
    let unresolvedCount = 0;
    const started = await this.start(id, "specification", {
      canStart: (draft) => {
        if (draft.status !== "awaiting-grill" || draft.grillSession?.status !== "open") {
          throw new Error("This task does not have an open Grill Me session.");
        }
        unresolvedCount = draft.grillSession.questions.filter((question) => !question.answer).length;
        if (unresolvedCount && !acceptRemaining) {
          throw new Error("Answer every Grill question or explicitly accept the recommended assumptions.");
        }
        return true;
      },
      onReserve: (draft) => {
        const acceptedDecisionIds = [];
        for (const question of draft.grillSession.questions.filter((item) => !item.answer)) {
          const recommendation = question.options.find((option) => option.recommended);
          question.answer = recommendation.label;
          question.answerSource = "accepted-assumption";
          question.resolvedAt = now();
          const decision = {
            id: crypto.randomUUID(),
            grillQuestionId: question.id,
            question: question.question,
            answer: recommendation.label,
            createdAt: now(),
          };
          draft.decisions.push(decision);
          acceptedDecisionIds.push(decision.id);
        }
        draft.grillSession.status = "completed";
        draft.grillSession.completedAt = now();
        draft.grillSession.completionReason = unresolvedCount
          ? `Finished by the user with ${unresolvedCount} recommended assumption${unresolvedCount === 1 ? "" : "s"} accepted.`
          : draft.grillSession.questions.length
            ? "All material questions were answered."
            : "No material product decisions remained after repository investigation.";
        if (!draft.completedStages.includes("grill")) draft.completedStages.push("grill");
        draft.events.push(activity(
          "grill",
          "Grill Me completed",
          draft.grillSession.completionReason,
          "success",
          "decision",
          { decisionIds: acceptedDecisionIds },
        ));
      },
    });
    if (!started) throw new Error("Task is already running.");
    return { started: true };
  }

  async approveSpecification(id, note = "") {
    const task = await this.#store.get(id);
    if (!task) throw new Error("Task not found.");
    if (!["awaiting-spec-approval", "awaiting-approval"].includes(task.status)) {
      throw new Error("The task is not awaiting specification approval.");
    }
    if (task.workflow === "investigate") {
      await this.#store.transition(id, (draft) => ["awaiting-spec-approval", "awaiting-approval"].includes(draft.status), (draft) => {
        recordApproval(draft, "specification", note);
        draft.status = "completed";
        draft.completedAt = now();
        draft.events.push(activity("specification", "Investigation approved", "The approved specification is the final deliverable for this task.", "success", "decision"));
      });
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
    const task = await this.#store.get(id);
    if (!task) throw new Error("Task not found.");
    if (task.status !== "awaiting-plan-approval") throw new Error("The task is not awaiting plan approval.");
    return this.#store.transition(id, (draft) => draft.status === "awaiting-plan-approval", (draft) => {
      recordApproval(draft, "plan", note);
      draft.status = "ready-for-implementation";
      draft.currentStage = "implement";
      draft.events.push(activity("implement", "Implementation authorized", "The approved plan may now run in an isolated Git worktree.", "success", "decision"));
    });
  }

  async approveMerge(id, note = "") {
    if (this.#mergeActive.has(id)) throw new Error("This task already has a merge reconciliation in progress.");
    this.#mergeActive.add(id);
    return this.#approveMerge(id, note).finally(() => this.#mergeActive.delete(id));
  }

  async #approveMerge(id, note = "") {
    let task = await this.#store.get(id);
    if (!task) throw new Error("Task not found.");
    if (task.status === "awaiting-human-approval") {
      const candidate = currentCandidate(task);
      if (candidate.status !== "awaiting_human_approval") throw new Error("The current candidate has not cleared every gate.");
      assertCandidateGatesFresh(task, candidate);
      const targetRef = candidate.baseRef ?? (candidate.baseBranch && candidate.baseBranch !== "detached" ? `refs/heads/${candidate.baseBranch}` : null);
      if (!targetRef || !candidate.headRevision) throw new Error("The candidate does not have a mergeable target revision.");
      task = await this.#store.transition(id, (draft) => {
        const activeCandidate = currentCandidate(draft);
        return draft.status === "awaiting-human-approval" &&
          activeCandidate.status === "awaiting_human_approval" &&
          candidateGateFailure(draft, activeCandidate) == null;
      }, (draft) => {
        const activeCandidate = currentCandidate(draft);
        draft.status = "merging";
        draft.mergeIntent = {
          candidateId: activeCandidate.id,
          candidateRevision: activeCandidate.revisionNumber,
          baseRevision: activeCandidate.baseRevision,
          headRevision: activeCandidate.headRevision,
          targetRef,
          note: note.trim().slice(0, 5_000),
          status: "pending",
          startedAt: now(),
          completedAt: null,
          error: null,
        };
        draft.events.push(activity("approval", "Merge intent recorded", `${activeCandidate.id} revision ${activeCandidate.revisionNumber} is reserved for ${targetRef}.`, "warning", "decision"));
      });
    } else if (task.status !== "merging" || task.mergeIntent?.status !== "pending") {
      throw new Error("The task is not awaiting merge approval.");
    }

    const candidate = currentCandidate(task);
    assertCandidateGatesFresh(task, candidate);
    try {
      const mergeState = typeof this.#worktrees.mergeState === "function"
        ? await this.#worktrees.mergeState(candidate)
        : "pending";
      if (mergeState === "diverged") throw new Error("The recorded target ref moved after merge approval was reserved.");
      if (mergeState === "pending") await this.#worktrees.merge(candidate);
      return this.#finalizeMerge(id);
    } catch (error) {
      await this.#store.update(id, (draft) => {
        if (draft.status !== "merging" || draft.mergeIntent?.status !== "pending") return;
        draft.error = error.message;
        draft.mergeIntent.error = error.message;
        draft.events.push(activity("approval", "Merge reconciliation required", error.message, "danger", "decision"));
      });
      throw error;
    }
  }

  async recoverMergeIntents() {
    const tasks = await this.#store.list();
    for (const task of tasks.filter((item) => item.status === "merging" && item.mergeIntent?.status === "pending")) {
      try {
        const candidate = currentCandidate(task);
        assertCandidateGatesFresh(task, candidate);
        const mergeState = typeof this.#worktrees.mergeState === "function"
          ? await this.#worktrees.mergeState(candidate)
          : "pending";
        if (mergeState === "diverged") throw new Error("The recorded target ref diverged while recovering a pending merge.");
        if (mergeState === "pending") await this.#worktrees.merge(candidate);
        await this.#finalizeMerge(task.id);
      } catch (error) {
        await this.#store.update(task.id, (draft) => {
          if (draft.status !== "merging" || draft.mergeIntent?.status !== "pending") return;
          draft.status = "blocked";
          draft.error = error.message;
          draft.mergeIntent.status = "failed";
          draft.mergeIntent.error = error.message;
          draft.events.push(activity("approval", "Pending merge blocked", error.message, "danger", "decision"));
        });
      }
    }
  }

  async #finalizeMerge(id) {
    return this.#store.transition(id, (draft) => draft.status === "merging" && draft.mergeIntent?.status === "pending", (draft) => {
      const activeCandidate = currentCandidate(draft);
      const approvedAt = now();
      const approvalNote = draft.mergeIntent.note;
      draft.approvals ??= [];
      const approval = { id: crypto.randomUUID(), stage: "approval", note: approvalNote, createdAt: approvedAt };
      draft.approvals.push(approval);
      activeCandidate.status = "merged";
      activeCandidate.updatedAt = approvedAt;
      draft.status = "merged-to-target";
      draft.currentStage = "approval";
      if (!draft.completedStages.includes("approval")) draft.completedStages.push("approval");
      draft.mergeIntent.status = "completed";
      draft.mergeIntent.completedAt = approvedAt;
      draft.mergeIntent.error = null;
      draft.error = null;
      const approvalArtifact = {
        id: crypto.randomUUID(),
        stage: "approval",
        name: `approval-${activeCandidate.id.toLowerCase()}-r${activeCandidate.revisionNumber}.md`,
        kind: "markdown",
        content: `# Human approval and merge\n\n- Candidate: ${activeCandidate.id} revision ${activeCandidate.revisionNumber}\n- Repository: ${draft.repositoryPath}\n- Target branch: ${activeCandidate.baseBranch}\n- Merge method: fast-forward only\n- Base revision: ${activeCandidate.baseRevision}\n- Merged revision: ${activeCandidate.headRevision}\n- Approved at: ${approvedAt}\n- Note: ${approvalNote || "Approved without an additional note."}`,
        createdAt: approvedAt,
        model: "Human approval",
        usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0 },
        candidateId: activeCandidate.id,
        candidateRevision: activeCandidate.revisionNumber,
      };
      draft.artifacts.push(approvalArtifact);
      draft.events.push(activity("approval", "Human approval recorded", approvalNote || "Approved without an additional note.", "success", "decision", { approvalId: approval.id }));
      draft.events.push(activity("approval", "Approval artifact ready", approvalArtifact.name, "success", "artifact", { artifactId: approvalArtifact.id, approvalId: approval.id }));
      draft.events.push(activity("approval", "Candidate merged", `${activeCandidate.id} fast-forwarded ${activeCandidate.baseBranch} to ${activeCandidate.headRevision.slice(0, 8)}.`, "success", "decision", { approvalId: approval.id }));
    });
  }

  async completeMergedTask(id, note = "") {
    const task = await this.#store.get(id);
    if (!task) throw new Error("Task not found.");
    if (task.status !== "merged-to-target") throw new Error("The task is not merged to its target branch.");
    const candidate = currentCandidate(task);
    if (!candidate || candidate.status !== "merged") throw new Error("The task does not have a merged candidate to promote.");
    return this.#store.transition(id, (draft) => draft.status === "merged-to-target", (draft) => {
      const approvedAt = now();
      const activeCandidate = currentCandidate(draft);
      recordApproval(draft, "promotion", note);
      draft.status = "completed";
      draft.completedAt = approvedAt;
      draft.events.push(activity(
        "approval",
        "Task marked completed",
        `${activeCandidate.id} revision ${activeCandidate.revisionNumber} was promoted onward from ${activeCandidate.baseBranch}.`,
        "success",
        "decision",
      ));
    });
  }

  async #run(id, kind, signal) {
    try {
      if (kind === "investigation") await this.#runInvestigation(id, signal);
      if (kind === "specification") await this.#runSpecification(id, signal);
      if (kind === "planning") await this.#runPlanning(id, signal);
      if (kind === "implementation") await this.#runImplementation(id, signal);
      if (kind === "repair") await this.#runRepair(id, signal);
      if (kind === "review") await this.#runEvaluation(id, "dev-review", signal);
      if (kind === "test") await this.#runEvaluation(id, "test", signal);
      if (kind === "final-review") await this.#runEvaluation(id, "final-review", signal);
    } catch (error) {
      await this.#store.update(id, (draft) => {
        const stage = stageForRun(kind, draft.currentStage);
        const attempts = draft.attemptsByStage?.[stage] ?? 1;
        draft.currentStage = stage;
        draft.status = signal.aborted ? "cancelled" : attempts >= stageRunLimitFor(draft, stage) ? "blocked" : "failed";
        draft.error = error.message;
        draft.activeRunKind = null;
        draft.activeRunReservationId = null;
        const candidate = draft.candidates?.at(-1);
        if (candidate) {
          const candidateStatus = {
            implementation: "failed",
            repair: "repair_required",
            review: "ready_for_review",
            test: "ready_for_test",
            "final-review": "ready_for_final_review",
          }[kind];
          if (candidateStatus) candidate.status = candidateStatus;
        }
        refreshGateFreshness(draft);
        draft.events.push(activity(stage, signal.aborted ? "Run cancelled" : "Stage failed", error.message, "danger"));
      });
    }
  }

  async #runInvestigation(id, signal) {
    let task = await this.#store.get(id);
    const stages = INVESTIGATION_PIPELINE.filter((stage) => !task.completedStages.includes(stage));
    for (const stageId of stages) {
      if (signal.aborted) throw new Error("Codex run cancelled.");
      await this.#reserveInvestigationStage(id, stageId);
      task = await this.#store.get(id);
      if (stageId === "scouts") {
        await this.#runScouts(id, task, signal);
        continue;
      }
      const result = await this.#executeAgent(task, stageId, signal, task.repositoryPath, "read-only");
      throwIfAborted(signal);
      const grillQuestions = stageId === "grill" ? parseGrillQuestions(result.finalText) : null;
      await this.#retainAgentResult(id, stageId, result, {
        replace: true,
        complete: stageId !== "grill" || grillQuestions?.length === 0,
      });
      if (grillQuestions) {
        await this.#store.update(id, (draft) => {
          draft.grillSession = {
            status: grillQuestions.length ? "open" : "completed",
            questions: grillQuestions,
            createdAt: now(),
            completedAt: grillQuestions.length ? null : now(),
            completionReason: grillQuestions.length ? null : "No material product decisions remained after repository investigation.",
          };
        });
      }
    }
    task = await this.#store.get(id);
    if (task.grillSession?.status === "completed" && task.grillSession.questions.length === 0) {
      await this.#store.update(id, (draft) => {
        draft.events.push(activity(
          "grill",
          "Grill Me completed automatically",
          draft.grillSession.completionReason,
          "success",
          "decision",
        ));
      });
      await this.#reserveInvestigationStage(id, "specification");
      await this.#runSpecification(id, signal);
      return;
    }
    await this.#store.update(id, (draft) => {
      draft.status = "awaiting-grill";
      draft.currentStage = "grill";
      draft.activeRunKind = null;
      draft.activeRunReservationId = null;
      const count = draft.grillSession?.questions.length ?? 0;
      draft.events.push(activity("grill", "Grill Me ready", `${count} material question${count === 1 ? "" : "s"} need a decision.`, "success", "decision"));
    });
  }

  async #reserveInvestigationStage(id, stageId) {
    const task = await this.#store.get(id);
    const activeReservation = Object.values(task.stageRunReservations ?? {}).find(
      (entry) => entry?.id === task.activeRunReservationId,
    );
    if (activeReservation?.stage === stageId) {
      requireActiveRunReservation(task, "investigation", stageId);
      return;
    }
    if (
      task.status !== "running" ||
      task.activeRunKind !== "investigation" ||
      !activeReservation ||
      activeReservation.kind !== "investigation" ||
      (task.activeRunIds?.length ?? 0) > 0
    ) {
      throw new Error(`The ${stageId} investigation stage cannot reserve over inconsistent active state.`);
    }
    const priorReservationId = activeReservation.id;
    try {
      await this.#store.transition(id, (draft) => {
        const currentReservation = Object.values(draft.stageRunReservations ?? {}).find(
          (entry) => entry?.id === draft.activeRunReservationId,
        );
        const attempts = draft.attemptsByStage?.[stageId] ?? 0;
        return draft.status === "running" &&
          draft.activeRunKind === "investigation" &&
          currentReservation?.id === priorReservationId &&
          currentReservation.kind === "investigation" &&
          (draft.activeRunIds?.length ?? 0) === 0 &&
          attempts < stageRunLimitFor(draft, stageId);
      }, (draft) => {
        const reservation = createStageRunReservation(draft, "investigation", stageId);
        applyStageRunReservation(draft, reservation);
        draft.currentStage = stageId;
        draft.events.push(activity(
          stageId,
          `${getStageMetadata(stageId)?.label ?? stageId} attempt reserved`,
          `Workflow attempt ${reservation.workflowAttempt} is bound to ${reservation.id}.`,
          "info",
          "agent",
        ));
      });
    } catch (error) {
      if (error.code === "TASK_TRANSITION_CONFLICT") {
        throw new Error(`The ${stageId} investigation stage has exhausted its retry allowance or changed before reservation.`);
      }
      throw error;
    }
  }

  async #runScouts(id, task, signal) {
    const triageArtifact = [...task.artifacts].reverse().find((artifact) => artifact.stage === "triage");
    const selection = selectScoutDispatch(task, triageArtifact?.content ?? "");
    const dispatch = selection.selected;
    await this.#store.update(id, (draft) => {
      removeStageArtifacts(draft, "scouts");
      const reservation = requireActiveRunReservation(draft, "investigation", "scouts");
      reservation.authorizedRunScopes = dispatch.map((spec) => spec.name);
      draft.scoutDispatch = {
        selected: dispatch.map((spec) => ({ ...spec, status: "queued" })),
        skipped: scoutCatalog().filter((scout) => !dispatch.some((spec) => spec.name === scout.id)).map((scout) => scout.id),
        rationale: selection.rationale,
        createdAt: now(),
        completedAt: null,
      };
      draft.events.push(activity("scouts", "Scout dispatch selected", `${dispatch.length} selected · ${selection.rationale}`, "info", "agent"));
    });

    const reports = await Promise.all(
      dispatch.map(async (spec) => {
        try {
          const request = buildScoutRequest(task, spec, triageArtifact);
          const result = await this.#executeAgent(
            task,
            "scouts",
            signal,
            task.repositoryPath,
            "read-only",
            null,
            request,
            `${spec.name} scout`,
            "scouts",
            null,
            spec.name,
          );
          const report = parseScoutReport(result.finalText);
          await this.#retainAgentResult(id, "scouts", { ...result, finalText: scoutReportMarkdown(spec, report) }, {
            complete: false,
            replace: false,
            name: `${spec.name}.md`,
            artifactTitle: `${spec.name} report ready`,
            agentRole: spec.name,
          });
          await this.#store.update(id, (draft) => {
            const selected = draft.scoutDispatch?.selected.find((entry) => entry.name === spec.name);
            if (selected) selected.status = "complete";
          });
          return { spec, report, status: "ok" };
        } catch (error) {
          await this.#store.update(id, (draft) => {
            const selected = draft.scoutDispatch?.selected.find((entry) => entry.name === spec.name);
            if (selected) {
              selected.status = "failed";
              selected.error = error.message;
            }
            draft.events.push(activity("scouts", `${spec.name} failed`, error.message, "warning", "agent"));
          });
          return { spec, status: "error", error: error.message, report: { findings: [], uncertainties: [] } };
        }
      }),
    );
    throwIfAborted(signal);
    const successful = reports.filter((entry) => entry.status === "ok").length;
    const required = dispatch.length === 0 ? 0 : Math.max(1, dispatch.length - 1);
    const aggregate = aggregateScoutReports(dispatch, reports);
    await this.#retainAgentResult(
      id,
      "scouts",
      {
        finalText: aggregate,
        usage: { inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0, totalTokens: 0 },
        runtimeEvents: [],
        model: "deterministic-aggregation",
        reasoning: null,
        contextManifest: {
          stage: "scouts",
          promptCharacters: 0,
          estimatedPromptTokens: 0,
          repositoryAccess: "read-only",
          policy: "Deterministic aggregation of selected scout reports; no additional model or repository access.",
          sources: reports.filter((entry) => entry.status === "ok").map((entry) => ({
            kind: "artifact",
            id: entry.spec.name,
            label: `${entry.spec.name}.md`,
            stage: "scouts",
            includedCharacters: null,
            originalCharacters: null,
            truncated: false,
          })),
        },
      },
      {
        complete: successful >= required,
        replace: false,
        name: "repository-scout.md",
        artifactTitle: "Scout evidence aggregated",
      },
    );
    await this.#store.update(id, (draft) => {
      if (draft.scoutDispatch) draft.scoutDispatch.completedAt = now();
    });
    if (successful < required) {
      throw new Error(`Scout coverage was incomplete: ${successful} of ${dispatch.length} selected scouts completed; ${required} required.`);
    }
  }

  async #runSpecification(id, signal) {
    const task = await this.#store.get(id);
    const result = await this.#executeAgent(task, "specification", signal, task.repositoryPath, "read-only");
    throwIfAborted(signal);
    await this.#retainAgentResult(id, "specification", result, { replace: true });
    await this.#store.update(id, (draft) => {
      draft.status = "awaiting-spec-approval";
      draft.currentStage = "specification";
      draft.activeRunKind = null;
      draft.activeRunReservationId = null;
      draft.events.push(activity("specification", "Specification ready for approval", "Review the evidence and approve or stop.", "success", "decision"));
    });
  }

  async #runPlanning(id, signal) {
    const task = await this.#store.get(id);
    const planAttempt = task.attemptsByStage?.plan ?? 1;
    const result = await this.#executeAgent(task, "plan", signal, task.repositoryPath, "read-only");
    throwIfAborted(signal);
    const artifactOptions = {
      replace: planAttempt === 1,
      name: planAttempt === 1 ? undefined : `implementation-plan-r${planAttempt}.md`,
    };
    let workPackages;
    try {
      workPackages = parseWorkPackages(result.finalText, task.repositoryPath);
    } catch (error) {
      await this.#retainAgentResult(id, "plan", result, {
        ...artifactOptions,
        complete: false,
        name: planAttempt === 1
          ? "implementation-plan-invalid.md"
          : `implementation-plan-r${planAttempt}-invalid.md`,
        artifactTitle: "Unparseable implementation plan retained",
        artifactTone: "warning",
      });
      throw error;
    }
    await this.#retainAgentResult(id, "plan", result, artifactOptions);
    await this.#store.update(id, (draft) => {
      draft.workPackages = workPackages;
      draft.status = "awaiting-plan-approval";
      draft.currentStage = "plan";
      draft.activeRunKind = null;
      draft.activeRunReservationId = null;
      const batches = Math.max(...workPackages.map((item) => item.batch));
      draft.events.push(activity("plan", "Implementation plan ready", `${workPackages.length} work package${workPackages.length === 1 ? "" : "s"} across ${batches} dependency batch${batches === 1 ? "" : "es"}.`, "success", "decision"));
    });
  }

  async #runImplementation(id, signal) {
    let task = await this.#store.get(id);
    if (!task.workPackages?.length) {
      throw new Error("The approved plan does not contain executable work packages. Rerun planning with the current planner.");
    }
    const base = await this.#worktrees.base(task);
    const batchNumbers = [...new Set(task.workPackages.map((item) => item.batch))].sort((a, b) => a - b);
    for (const batch of batchNumbers) {
      throwIfAborted(signal);
      task = await this.#store.get(id);
      const packages = task.workPackages.filter(
        (item) => item.batch === batch && item.status !== "ready_for_integration" && item.status !== "integrated",
      );
      if (!packages.length) continue;
      const blocked = packages.find((item) =>
        item.dependencies.some((dependency) => {
          const dependencyPackage = task.workPackages.find((candidate) => candidate.id === dependency);
          return !["ready_for_integration", "integrated"].includes(dependencyPackage?.status);
        }),
      );
      if (blocked) throw new Error(`${blocked.id} cannot start because one or more dependency packages are not ready.`);
      await this.#store.update(id, (draft) => {
        draft.events.push(activity("implement", `Dependency batch ${batch} started`, `${packages.map((item) => item.id).join(", ")} running in isolated worktrees.`, "info", "agent"));
      });
      const outcomes = await Promise.allSettled(
        packages.map((workPackage) => this.#runWorkPackage(id, workPackage.id, base.baseRevision, signal)),
      );
      const failures = outcomes
        .map((outcome, index) => ({ outcome, workPackage: packages[index] }))
        .filter((entry) => entry.outcome.status === "rejected");
      if (failures.length) {
        throw new Error(
          failures
            .map((entry) => `${entry.workPackage.id}: ${entry.outcome.reason?.message ?? "implementation failed"}`)
            .join(" | "),
        );
      }
      await this.#store.update(id, (draft) => {
        draft.events.push(activity("implement", `Dependency batch ${batch} qualified`, `${packages.map((item) => item.id).join(", ")} ready for integration.`, "success", "decision"));
      });
    }

    throwIfAborted(signal);
    task = await this.#store.get(id);
    const orderedPackages = [...task.workPackages].sort((a, b) => a.batch - b.batch || a.id.localeCompare(b.id));
    if (orderedPackages.some((item) => item.status !== "ready_for_integration" && item.status !== "integrated")) {
      throw new Error("Candidate assembly cannot start until every work package is ready for integration.");
    }
    const candidateId = `C${(task.candidates?.length ?? 0) + 1}`;
    const implementationReservation = requireActiveRunReservation(task, "implementation", "implement");
    const candidate = await this.#worktrees.prepare(task, candidateId, { baseRevision: base.baseRevision });
    candidate.status = "assembling";
    candidate.sourceWorkflowAttempt = implementationReservation.workflowAttempt;
    candidate.sourceWorkflowReservationId = implementationReservation.id;
    candidate.members = orderedPackages.map((item, index) => ({
      packageId: item.id,
      headRevision: item.headRevision,
      order: index + 1,
    }));
    await this.#store.update(id, (draft) => {
      draft.currentStage = "implement";
      draft.candidates ??= [];
      draft.candidates.push(candidate);
      draft.events.push(activity("implement", "Candidate assembly started", `${candidate.id} will apply ${candidate.members.map((item) => item.packageId).join(" -> ")}.`, "info", "agent"));
    });
    const assembled = await this.#worktrees.assemble(candidate, candidate.members);
    const manifest = candidate.members
      .map((member) => `- ${member.order}. ${member.packageId}: ${member.headRevision ?? "no changes needed"}`)
      .join("\n");
    const content = `## Outcome\n\nAll ${candidate.members.length} work packages were assembled into ${candidate.id}.\n\n## Candidate membership\n\n${manifest}\n\n## Harness candidate evidence\n\n- Candidate: ${candidate.id} revision 1\n- Base: ${candidate.baseRevision}\n- Head: ${assembled.headRevision}\n- Branch: ${candidate.branch}\n- Changed files: ${assembled.files.length}\n\n\`\`\`text\n${assembled.summary || "No diff stat returned."}\n\`\`\`\n\nThe exact candidate patch is loaded on demand from the recorded revision.`;
    await this.#retainAgentResult(
      id,
      "implement",
      {
        finalText: content,
        usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0 },
        runtimeEvents: [],
      },
      { replace: false, name: `candidate-${candidate.id.toLowerCase()}-r1.md`, candidateId, candidateRevision: 1, synthetic: true },
    );
    await this.#store.update(id, (draft) => {
      const activeCandidate = currentCandidate(draft);
      activeCandidate.headRevision = assembled.headRevision;
      activeCandidate.status = "ready_for_review";
      activeCandidate.updatedAt = now();
      activeCandidate.revisions.push({
        number: 1,
        headRevision: assembled.headRevision,
        reason: "assembly",
        sourceWorkflowAttempt: implementationReservation.workflowAttempt,
        sourceWorkflowReservationId: implementationReservation.id,
        sourceWorkflowReservedAt: implementationReservation.reservedAt,
        createdAt: now(),
      });
      for (const workPackage of draft.workPackages) workPackage.status = "integrated";
      draft.status = "ready-for-review";
      draft.currentStage = "dev-review";
      draft.activeRunKind = null;
      draft.activeRunReservationId = null;
      refreshGateFreshness(draft);
      draft.events.push(activity("implement", "Integration candidate ready", `${candidate.id} @ ${assembled.headRevision.slice(0, 8)} contains ${candidate.members.length} work packages and is ready for development review.`, "success", "artifact"));
    });
  }

  async #runWorkPackage(id, workPackageId, baseRevision, signal) {
    let task = await this.#store.get(id);
    const workPackage = task.workPackages.find((item) => item.id === workPackageId);
    const attempt = workPackage.attempts + 1;
    const dependencyIds = dependencyClosure(workPackage, task.workPackages);
    const dependencyRevisions = task.workPackages
      .filter((item) => dependencyIds.includes(item.id))
      .sort((a, b) => a.batch - b.batch || a.id.localeCompare(b.id))
      .map((item) => item.headRevision)
      // A dependency that legitimately made no changes has no commit to bring in.
      .filter(Boolean);
    const sliceId = `${workPackage.id}-A${attempt}`;
    try {
      // The previous attempt's worktree, if any, is permanently superseded the moment a
      // retry starts — nothing reads it again — and every worktree left behind spends
      // this repository's shared exec-argument budget (see claude-exec-budget.mjs).
      // Kept around for exactly one generation past its own failure, for inspection,
      // and reaped here rather than immediately on failure.
      if (workPackage.worktreePath) {
        await this.#cleanupSliceWorktree(id, task, workPackage.worktreePath);
      }
      const slice = await this.#worktrees.prepare(task, sliceId, {
        baseRevision,
        dependencyRevisions,
        branchId: sliceId,
      });
      await this.#store.update(id, (draft) => {
        const target = draft.workPackages.find((item) => item.id === workPackageId);
        target.status = "running";
        target.attempts = attempt;
        target.branch = slice.branch;
        target.worktreePath = slice.worktreePath;
        target.baseRevision = slice.baseRevision;
        target.error = null;
        draft.events.push(activity("implement", `${workPackageId} agent started`, `${slice.branch} in dependency batch ${target.batch}.`, "info", "agent"));
      });
      task = await this.#store.get(id);
      const currentPackage = task.workPackages.find((item) => item.id === workPackageId);
      const result = await this.#executeAgent(
        task,
        "implement",
        signal,
        slice.worktreePath,
        "workspace-write",
        null,
        buildWorkPackageRequest(task, currentPackage, slice),
        `${workPackageId} implementation`,
        "implement",
        workPackageId,
      );
      throwIfAborted(signal);
      // Trusted only in combination with `commit`'s own status check: the marker is
      // read here, but it is `allowNoChanges` inside `commit` that actually verifies
      // the worktree is clean before treating this as a no-op. An agent that emits the
      // marker while having actually changed something still goes through the ordinary
      // commit path below.
      const noChangesNeeded = parseNoChangesNeeded(result.finalText);
      let qualification = null;
      if (this.#runPackageVerification) {
        qualification = await this.#runPackageVerification({
          worktreePath: slice.worktreePath,
          workPackageId,
          attempt,
          signal,
        });
        throwIfAborted(signal);
        if (qualification.status !== "passed") {
          const content = `${result.finalText}\n\n${workPackageVerificationMarkdown(qualification)}`;
          await this.#retainAgentResult(id, "implement", { ...result, finalText: content }, {
            complete: false,
            replace: false,
            name: `slice-${workPackageId.toLowerCase()}-a${attempt}.md`,
            workPackageId,
            focusedTestEvidence: qualification,
            artifactTitle: `${workPackageId} qualification failed`,
            artifactTone: "danger",
          });
          const failed = qualification.rows?.find((row) => row.status !== "passed");
          throw new Error(
            `${workPackageId} did not qualify: ${failed?.id ?? "repository verification"} failed${failed?.failureDetails ? ` — ${failed.failureDetails}` : "."}`,
          );
        }
      }
      const committed = await this.#worktrees.commit(
        slice,
        `agent-harness(${task.id}): ${workPackageId} ${currentPackage.title}`,
        { ownedPaths: currentPackage.ownedPaths, allowNoChanges: Boolean(noChangesNeeded) },
      );
      // The branch (or, for a no-op, the unchanged base) is all downstream assembly
      // needs; the worktree itself is done being useful the moment it lands.
      await this.#cleanupSliceWorktree(id, task, slice.worktreePath);
      const evidence = committed.noChangesNeeded
        ? `## Harness slice evidence\n\n- Work package: ${workPackageId}\n- Attempt: ${attempt}\n- Dependencies: ${currentPackage.dependencies.join(", ") || "None"}\n- Base: ${slice.baseRevision}\n- Outcome: no changes needed — ${noChangesNeeded.reason}\n- Branch: ${slice.branch}\n\nNothing was committed: the base revision already satisfies this work package.`
        : `## Harness slice evidence\n\n- Work package: ${workPackageId}\n- Attempt: ${attempt}\n- Dependencies: ${currentPackage.dependencies.join(", ") || "None"}\n- Base: ${slice.baseRevision}\n- Package commit: ${committed.headRevision}\n- Branch: ${slice.branch}\n- Changed files: ${committed.files.length}\n\n\`\`\`text\n${committed.ownSummary || "No diff stat returned."}\n\`\`\`\n\nThe exact package commit remains available through Git; its full patch is not copied into downstream prompts.`;
      const content = `${result.finalText}${qualification ? `\n\n${workPackageVerificationMarkdown(qualification)}` : ""}\n\n${evidence}`;
      await this.#retainAgentResult(id, "implement", { ...result, finalText: content }, {
        complete: false,
        replace: false,
        name: `slice-${workPackageId.toLowerCase()}-a${attempt}.md`,
        workPackageId,
        focusedTestEvidence: qualification,
      });
      await this.#store.update(id, (draft) => {
        const target = draft.workPackages.find((item) => item.id === workPackageId);
        target.status = "ready_for_integration";
        target.headRevision = committed.headRevision;
        target.files = committed.files;
        target.error = null;
        draft.events.push(activity(
          "implement",
          `${workPackageId} ready for integration`,
          committed.noChangesNeeded
            ? `No changes needed — ${noChangesNeeded.reason}`
            : `${committed.headRevision.slice(0, 8)} changed ${committed.files.length} file${committed.files.length === 1 ? "" : "s"}.`,
          "success",
          "artifact",
        ));
      });
    } catch (error) {
      await this.#store.update(id, (draft) => {
        const target = draft.workPackages.find((item) => item.id === workPackageId);
        target.status = "failed";
        target.error = error.message;
        draft.events.push(activity("implement", `${workPackageId} failed`, error.message, "danger", "decision"));
      });
      throw error;
    }
  }

  /**
   * Best-effort: a worktree that fails to remove is a warning, not a reason to fail
   * the retry or the stage that just succeeded — the caller's own outcome does not
   * depend on this cleanup landing, only on it eventually landing.
   */
  async #cleanupSliceWorktree(id, task, worktreePath) {
    try {
      await this.#worktrees.removeWorktree({ worktreePath, repositoryRoot: task.repositoryPath });
    } catch (error) {
      await this.#store.update(id, (draft) => {
        draft.events.push(activity("implement", "Worktree cleanup skipped", `${worktreePath}: ${error.message}`, "warning", "activity"));
      });
    }
  }

  async #runEvaluation(id, stageId, signal) {
    const task = await this.#store.get(id);
    const candidate = currentCandidate(task);
    await this.#worktrees.verifyCandidate(candidate);
    // The harness executes the repository's declared verification commands *before* any model
    // runs, and the result of that execution is the evidence. A model is asked afterwards to
    // interpret it, never to produce it.
    //
    // Deliberately not inside the try below: a repository that declares no verification
    // commands is a configuration gap, not a candidate defect, so it fails the run with an
    // actionable message rather than becoming a REPAIR verdict a repair could only "fix" by
    // having a model invent the commands — the exact thing this change exists to prevent.
    let harnessVerification = null;
    if (stageId === "test") {
      harnessVerification = await this.#runVerification({
        worktreePath: candidate.worktreePath,
        candidate,
        signal,
      });
      throwIfAborted(signal);
    }
    let result;
    // A reviewer that dirties its worktree without committing leaves every exact-SHA
    // check reporting agreement, because the SHA genuinely did not change — while the
    // gate's evidence now attests to file contents that were never in the reviewed
    // commit. That is a silent invalidation, and until now a final-review mutation
    // was caught nowhere: it is the last gate before merge.
    let reviewerMutation = null;
    try {
      result = await this.#executeAgent(
        task,
        stageId,
        signal,
        candidate.worktreePath,
        "read-only",
        candidate,
        harnessVerification ? buildTestInterpretationRequest(task, candidate, harnessVerification) : null,
      );
    } finally {
      if (stageId === "test") {
        // The test stage is *expected* to dirty its worktree, so it recovers.
        if (typeof this.#worktrees.recoverCandidate === "function") {
          await this.#worktrees.recoverCandidate(candidate);
        }
        await this.#worktrees.verifyCandidate(candidate);
      } else if (result) {
        // A reviewer is not expected to dirty anything, so it is never recovered:
        // silently restoring the worktree would erase the only evidence that the
        // reviewer mutated the candidate it was reviewing.
        try {
          await this.#worktrees.verifyCandidate(candidate);
        } catch (error) {
          reviewerMutation = error;
        }
      }
    }
    throwIfAborted(signal);
    let focusedTestEvidence = null;
    let structuredGateEvidence = null;
    let evidenceError = null;
    const commandFailure = candidateVerificationCommandFailed(result.runtimeEvents);
    try {
      if (reviewerMutation) throw reviewerMutation;
      // Same contract, same validator, different source: the evidence is what the harness
      // observed, so `parseFocusedTestEvidence` is no longer in this path at all. Nothing the
      // model returned can change a status, a row or an exit code.
      focusedTestEvidence = stageId === "test"
        ? validateFocusedTestEvidence(harnessVerification, candidate)
        : null;
      structuredGateEvidence = ["dev-review", "final-review"].includes(stageId)
        ? parseGateEvidence(result.finalText, candidate, stageId)
        : null;
    } catch (error) {
      evidenceError = structuredEvidenceError(error);
    }
    if (!evidenceError && commandFailure && structuredGateEvidence?.verdict !== "REPAIR") {
      evidenceError = {
        code: "command_failure",
        copy: RUNTIME_FRESHNESS_REASONS.command_failure,
      };
    }
    const verdict = evidenceError
      ? "REPAIR"
      : evaluationVerdict(stageId, result, focusedTestEvidence, structuredGateEvidence);
    const gateResult = {
      verdict,
      candidateId: candidate.id,
      candidateRevision: candidate.revisionNumber,
      schemaVersion: 1,
      stage: stageId,
      reportedVerdict: structuredGateEvidence?.reportedVerdict ?? null,
      evaluatedAt: now(),
      findings: structuredGateEvidence?.findings ?? [],
      blockingReasons: [
        ...(evidenceError ? [evidenceError.copy] : []),
        ...(reviewerMutation ? [`The ${stageId} agent mutated the candidate it was reviewing. ${reviewerMutation.message}`] : []),
        ...(commandFailure
          ? ["A candidate-scope command failed."]
          : []),
        ...(focusedTestEvidence?.status === "failed" ? ["Structured test evidence contains a failed result."] : []),
        ...(structuredGateEvidence?.blockingReasons ?? []),
      ],
    };
    await this.#retainAgentResult(id, stageId, result, {
      replace: false,
      name: `${stageId}-${candidate.id.toLowerCase()}-r${candidate.revisionNumber}.md`,
      candidateId: candidate.id,
      candidateRevision: candidate.revisionNumber,
      complete: verdict === "PASS",
      focusedTestEvidence,
      gateResult,
      evidenceError,
    });
    if (reviewerMutation) {
      await this.#store.update(id, (draft) => {
        draft.events.push(activity(
          stageId,
          "Reviewer mutated the candidate",
          `${reviewerMutation.message} The verdict was not accepted; this gate requires a rerun.`,
          "danger",
          "decision",
        ));
      });
    }
    await this.#store.update(id, (draft) => {
      const activeCandidate = currentCandidate(draft);
      const gateFailure = candidateGateFailure(draft, activeCandidate, [stageId]);
      const stageFreshness = gateFailure?.freshness ?? draft.gateFreshness?.[stageId] ?? null;
      const authoritativeRun = stageFreshness?.sourceRunId
        ? draft.runs?.find((run) => run.id === stageFreshness.sourceRunId)
        : null;
      activeCandidate.updatedAt = now();
      draft.activeRunKind = null;
      draft.activeRunReservationId = null;
      if (gateFailure) {
        if (evidenceError) {
          const rerunState = evaluationRerunState(stageId);
          activeCandidate.status = rerunState.candidateStatus;
          draft.status = rerunState.taskStatus;
          draft.currentStage = stageId;
          draft.events.push(activity(
            stageId,
            `${getStageMetadata(stageId).label} rerun required`,
            `${activeCandidate.id} revision ${activeCandidate.revisionNumber} could not accept the persisted gate evidence. ${gateFailure.freshness.reasonCopy}`,
            "warning",
            "decision",
            runEventMetadata(authoritativeRun),
          ));
          return;
        }
        activeCandidate.status = "repair_required";
        draft.status = "repair-required";
        draft.currentStage = stageId;
        draft.events.push(activity(
          stageId,
          "Candidate requires repair",
          `${activeCandidate.id} revision ${activeCandidate.revisionNumber} did not pass ${getStageMetadata(stageId).label}. ${gateFailure.freshness.reasonCopy}`,
          "warning",
          "decision",
          runEventMetadata(authoritativeRun),
        ));
        return;
      }
      if (stageId === "dev-review") {
        activeCandidate.status = "ready_for_test";
        draft.status = "ready-for-test";
        draft.currentStage = "test";
      } else if (stageId === "test") {
        activeCandidate.status = "ready_for_final_review";
        draft.status = "ready-for-final-review";
        draft.currentStage = "final-review";
      } else {
        activeCandidate.status = "awaiting_human_approval";
        draft.status = "awaiting-human-approval";
        draft.currentStage = "approval";
      }
      draft.events.push(activity(
        stageId,
        `${getStageMetadata(stageId).label} passed`,
        `${activeCandidate.id} revision ${activeCandidate.revisionNumber} advanced to the next gate.`,
        "success",
        "decision",
        runEventMetadata(authoritativeRun),
      ));
    });
  }

  async #runRepair(id, signal) {
    const task = await this.#store.get(id);
    const candidate = currentCandidate(task);
    if (!["repair_required", "repairing"].includes(candidate.status)) {
      throw new Error("The current candidate is not awaiting repair.");
    }
    const recovered = typeof this.#worktrees.recoverCandidate === "function"
      ? await this.#worktrees.recoverCandidate(candidate)
      : false;
    if (recovered) {
      await this.#store.update(id, (draft) => {
        draft.events.push(activity("implement", "Candidate worktree recovered", `${candidate.id} was restored to recorded revision ${candidate.headRevision.slice(0, 8)} before repair.`, "warning", "decision"));
      });
    }
    await this.#worktrees.verifyCandidate(candidate);
    const nextRevision = candidate.revisionNumber + 1;
    const initialRepairReservation = requireActiveRunReservation(task, "repair", "implement");
    assertRepairAuthorizerUnchanged(task, candidate, initialRepairReservation);
    const repairRequest = buildRepairRequest(task, candidate);
    if (repairRequest.repairEvidence.newestFailingGate.runId !== initialRepairReservation.authorizingGateRunId) {
      throw new Error("The repair request drifted from its reserved authorizing gate.");
    }
    const requestedFindings = projectRepairFindings(repairRequest.repairEvidence.newestFailingGate.gateResult.findings);
    let result;
    let committed;
    let noChangesNeeded;
    try {
      result = await this.#executeAgent(
        task,
        "implement",
        signal,
        candidate.worktreePath,
        "workspace-write",
        candidate,
        repairRequest,
        "Candidate repair",
        "repair",
      );
      throwIfAborted(signal);
      const beforeCommit = await this.#store.get(id);
      const beforeCommitCandidate = currentCandidate(beforeCommit);
      const beforeCommitReservation = requireActiveRunReservation(beforeCommit, "repair", "implement");
      if (!sameRepairReservationAuthority(initialRepairReservation, beforeCommitReservation)) {
        throw new Error("The repair authorizing gate changed before candidate commit.");
      }
      assertRepairAuthorizerUnchanged(beforeCommit, beforeCommitCandidate, beforeCommitReservation);
      // Recorded live (AH-002): the newest failing gate's only finding was non-blocking
      // and explicitly said no code change was warranted — the repair agent correctly
      // made none, and without this marker `commit` always treats an empty diff as a
      // stuck run. Same trusted-only-with-`commit`'s-own-check caveat as the slice flow.
      noChangesNeeded = parseNoChangesNeeded(result.finalText);
      committed = await this.#worktrees.commit(
        candidate,
        `agent-harness(${task.id}): repair ${candidate.id} revision ${nextRevision}`,
        { allowGeneratedDeletions: true, allowNoChanges: Boolean(noChangesNeeded) },
      );
    } catch (error) {
      if (typeof this.#worktrees.recoverCandidate === "function") await this.#worktrees.recoverCandidate(candidate);
      throw error;
    }
    // A no-op repair must not become a new revision: `candidateRevisionLineage` (and
    // everything built on it — producer evidence, retry-grant authorization) requires
    // every revision to have a *distinct* `headRevision`, and this candidate's head is,
    // by definition, unchanged. Sending it back to `ready_for_review` at its existing
    // revision — the same shape a plain re-review of stale evidence already uses —
    // asks dev-review to look again rather than fabricating an identical "new" one.
    // `commit` reports `headRevision: null` for a no-op, which is right for a work
    // package starting unattempted but wrong here regardless: the candidate's real,
    // existing head is what stays authoritative.
    const revisionLabel = committed.noChangesNeeded ? candidate.revisionNumber : nextRevision;
    const content = committed.noChangesNeeded
      ? `${result.finalText}\n\n## Harness repair evidence\n\n- Candidate: ${candidate.id} revision ${revisionLabel}\n- Head: ${candidate.headRevision} (unchanged)\n- Outcome: no changes needed — ${noChangesNeeded.reason}\n\nNothing was committed: the newest failing gate's findings required no code change.`
      : `${result.finalText}\n\n## Harness repair evidence\n\n- Candidate: ${candidate.id} revision ${revisionLabel}\n- Previous: ${candidate.headRevision}\n- Head: ${committed.headRevision}\n- Changed files in repair: ${committed.files.length}\n\n\`\`\`text\n${committed.summary || "No diff stat returned."}\n\`\`\`\n\nThe exact repaired candidate patch is loaded on demand from the recorded revision.`;
    try {
      await this.#retainAgentResult(id, "implement", { ...result, finalText: content }, {
        replace: false,
        name: `candidate-${candidate.id.toLowerCase()}-r${revisionLabel}-repair.md`,
        candidateId: candidate.id,
        candidateRevision: revisionLabel,
      });
      await this.#store.update(id, (draft) => {
        const activeCandidate = currentCandidate(draft);
        const repairReservation = requireActiveRunReservation(draft, "repair", "implement");
        if (!sameRepairReservationAuthority(initialRepairReservation, repairReservation)) {
          throw new Error("The repair authorizing gate changed before revision persistence.");
        }
        assertRepairAuthorizerUnchanged(draft, activeCandidate, repairReservation);
        if (!committed.noChangesNeeded) {
          activeCandidate.revisionNumber = nextRevision;
          activeCandidate.headRevision = committed.headRevision;
          activeCandidate.sourceWorkflowAttempt = repairReservation.workflowAttempt;
          activeCandidate.sourceWorkflowReservationId = repairReservation.id;
          activeCandidate.revisions.push({
            number: nextRevision,
            headRevision: committed.headRevision,
            reason: "repair",
            requestedFindings: structuredClone(requestedFindings),
            sourceWorkflowAttempt: repairReservation.workflowAttempt,
            sourceWorkflowReservationId: repairReservation.id,
            sourceWorkflowReservedAt: repairReservation.reservedAt,
            authorizingGateStage: repairReservation.authorizingGateStage,
            authorizingGateProvider: readExecutionProvider({ provider: repairReservation.authorizingGateProvider }),
            authorizingGateWorkflowAttempt: repairReservation.authorizingGateWorkflowAttempt,
            authorizingGateReservationId: repairReservation.authorizingGateReservationId,
            authorizingGateReservedAt: repairReservation.authorizingGateReservedAt,
            authorizingGateRunId: repairReservation.authorizingGateRunId,
            authorizingGateArtifactId: repairReservation.authorizingGateArtifactId,
            createdAt: now(),
          });
        }
        activeCandidate.status = "ready_for_review";
        activeCandidate.updatedAt = now();
        draft.completedStages = draft.completedStages.filter(
          (stage) => !["dev-review", "test", "final-review", "approval"].includes(stage),
        );
        draft.status = "ready-for-review";
        draft.currentStage = "dev-review";
        draft.activeRunKind = null;
        draft.activeRunReservationId = null;
        refreshGateFreshness(draft);
        draft.events.push(activity(
          "implement",
          "Repaired candidate ready",
          committed.noChangesNeeded
            ? `${candidate.id} revision ${revisionLabel} made no changes — ${noChangesNeeded.reason} — and must pass review again.`
            : `${candidate.id} revision ${revisionLabel} @ ${committed.headRevision.slice(0, 8)} must pass review again.`,
          "success",
          "artifact",
        ));
      });
    } catch (error) {
      if (typeof this.#worktrees.recoverCandidate === "function") await this.#worktrees.recoverCandidate(candidate);
      throw error;
    }
  }

  async #executeAgent(
    task,
    stageId,
    signal,
    cwd,
    sandbox,
    candidate = null,
    promptOverride = null,
    eventLabel = null,
    policyId = stageId,
    workPackageId = null,
    runScopeId = null,
  ) {
    const metadata = getStageMetadata(stageId);
    // The test stage used to be the one exception here: workspace-write plus
    // `networkAccess: true`, because a model ran the verification commands itself. The
    // harness runs them now (`server/verification.mjs`), so this stage's model only reads the
    // worktree in order to interpret results the harness already observed. Read-only, no
    // network, nothing provider-specific — which is precisely what made the stage impossible
    // on Claude (#40) and dependent on Codex credits.
    const effectiveSandbox = sandbox;
    const agentRequest =
      promptOverride ?? (candidate ? buildExecutionRequest(task, stageId, candidate) : buildStageRequest(task, stageId));
    const settings = await this.#store.settings();
    const policy = resolveAgentPolicy(task, policyId, settings);
    const runId = crypto.randomUUID();
    const startedAt = now();
    const runRole = runScopeId ?? policyId;
    const runKind = runKindFor(stageId, runRole, workPackageId);
    const runtimeTemp = path.join(os.tmpdir(), "agent-harness", task.id, runId);
    // Stages against `task.repositoryPath` run in the operator's real working tree,
    // where there is no existing check, so it is snapshotted and required to come back
    // identical. `candidate` was the wrong proxy for that: a work package (`candidate`
    // left null, `cwd` its own isolated slice worktree) is *supposed* to leave the slice
    // dirty — that is the run succeeding — and comparing it against its pre-run status
    // would fail every successful implementation. The real distinguishing fact is
    // whether `cwd` is the operator's real checkout at all.
    const sourceSnapshot = cwd === task.repositoryPath ? await this.#snapshotSource(policy.provider, cwd, effectiveSandbox) : null;
    let runProvider = DEFAULT_EXECUTION_PROVIDER;
    await this.#store.update(task.id, (draft) => {
      const reservation = Object.values(draft.stageRunReservations ?? {}).find(
        (entry) => entry?.id === draft.activeRunReservationId,
      );
      if (!reservation || reservation.kind !== draft.activeRunKind || reservation.stage !== stageId) {
        throw new Error("The active workflow attempt is missing its persisted run reservation.");
      }
      // The reservation owns provider identity for the attempt. A run may never
      // execute on a provider other than the one its reservation reserved, so a
      // resolved policy that disagrees refuses to spawn instead of falling back.
      const reservationProvider = readExecutionProvider(reservation);
      if (policy.provider !== reservationProvider) {
        throw new Error(
          `Stage ${stageId} resolved provider ${policy.provider} but its workflow reservation is bound to ${reservationProvider}.`,
        );
      }
      runProvider = reservationProvider;
      draft.currentStage = stageId;
      const detail = stageId === "test"
        ? `Interpreting harness verification of ${cwd}; source changes are checked before and after the run`
        : `${sandbox === "read-only" ? "Reading" : "Working in"} ${cwd}`;
      const run = beginAgentRun(draft, {
        id: runId,
        kind: runKind,
        provider: reservationProvider,
        stage: stageId,
        role: runRole,
        model: policy.model,
        reasoning: policy.reasoning,
        startedAt,
        candidateId: candidate?.id ?? null,
        candidateRevision: candidate?.revisionNumber ?? null,
        candidateHeadRevision: candidate?.headRevision ?? null,
        workPackageId,
        workflowAttempt: reservation?.workflowAttempt ?? null,
        workflowReservationId: reservation?.id ?? null,
      });
      draft.events.push(activity(
        stageId,
        `${eventLabel ?? metadata.label} agent started`,
        `${detail} · ${policy.model} · ${policy.reasoning}`,
        "info",
        "agent",
        runEventMetadata(run),
      ));
    });
    const runtimeEvents = [];
    // `cwd` is the operator's real checkout for stages that run there, which is already
    // fully within its own allow-read scope. Only an isolated worktree (a candidate or a
    // work-package slice) can carry the symlink-into-source-checkout gap described on
    // `symlinkedDependencySourceRoots`.
    const extraReadRoots = cwd === task.repositoryPath
      ? []
      : await symlinkedDependencySourceRoots(
          cwd,
          typeof this.#worktrees.repositoryRoot === "function"
            ? await this.#worktrees.repositoryRoot(task.repositoryPath)
            : task.repositoryPath,
        ).catch(() => []);
    try {
      await this.#assertProviderConfinement(runProvider, effectiveSandbox, false, cwd);
      const result = await this.#runAgent(runProvider, {
        cwd,
        prompt: agentRequest.prompt,
        signal,
        sandbox: effectiveSandbox,
        // No stage grants network access any more. The only stage that ever needed it needed
        // it to run commands, and it no longer runs them.
        networkAccess: false,
        extraReadRoots,
        model: policy.model,
        reasoning: policy.reasoning,
        tempDirectory: runtimeTemp,
        timeoutMs: stageTimeoutMs(stageId, effectiveSandbox),
        onEvent(event) {
          if (event.type === "activity") runtimeEvents.push(event);
        },
      });
      // Before the run is recorded as completed: a stage that mutated the operator's
      // working tree produced evidence about files that were never in the tree it
      // claims to have read.
      if (sourceSnapshot) await this.#worktrees.assertRepositoryUnchanged(cwd, sourceSnapshot);
      const completedAt = now();
      result.runId = runId;
      result.model = policy.model;
      result.reasoning = policy.reasoning;
      result.agentRole = policyId;
      result.contextManifest = agentRequest.contextManifest;
      result.startedAt = startedAt;
      result.completedAt = completedAt;
      result.durationMs = Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime());
      result.usage = enrichUsage(
        result.model,
        result.usage,
        settings.pricing?.rates,
        settings.pricing?.version,
      );
      result.runtimeEvents = runtimeEvents;
      await this.#finishAgentRun(task.id, stageId, eventLabel ?? metadata.label, result, "completed");
      return result;
    } catch (error) {
      const completedAt = now();
      await this.#finishAgentRun(task.id, stageId, eventLabel ?? metadata.label, {
        runId,
        startedAt,
        completedAt,
        durationMs: Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime()),
        runtimeEvents,
        usage: null,
        error: error instanceof Error ? error.message : String(error),
      }, signal.aborted ? "cancelled" : isProcessTimeoutError(error) ? "timed-out" : "failed");
      throw error;
    } finally {
      await rm(runtimeTemp, { recursive: true, force: true });
    }
  }

  async #finishAgentRun(id, stageId, label, result, status) {
    await this.#store.update(id, (draft) => {
      const run = completeAgentRun(draft, result.runId, {
        status,
        completedAt: result.completedAt,
        durationMs: result.durationMs,
        usage: result.usage,
        runtimeEvents: result.runtimeEvents,
        error: result.error,
      });
      for (const event of result.runtimeEvents?.slice(-100) ?? []) {
        draft.events.push(activity(
          stageId,
          event.title,
          event.detail,
          event.tone,
          event.toolCall ? "tool" : "agent",
          runEventMetadata(run, { toolCall: event.toolCall ?? null }),
        ));
      }
      const duration = result.durationMs == null
        ? "Duration unavailable"
        : `${(result.durationMs / 1_000).toFixed(1)}s`;
      draft.events.push(activity(
        stageId,
        `${label} agent ${status === "completed" ? "completed" : status}`,
        status === "completed" ? duration : (result.error ?? duration),
        status === "completed" ? "success" : "danger",
        "agent",
        runEventMetadata(run),
      ));
    });
  }

  async #retainAgentResult(id, stageId, result, options = {}) {
    const metadata = getStageMetadata(stageId);
    const task = await this.#store.get(id);
    const settings = await this.#store.settings();
    const fallbackPolicy = resolveAgentPolicy(task, stageId, settings);
    // A harness-generated artifact (candidate assembly, say) never called a model at all.
    // Attributing it to the stage's configured policy anyway would fabricate a Model /
    // Reasoning pairing next to honestly-zero usage, which reads as a broken agent run
    // rather than as the mechanical step it actually was.
    const resultModel = options.synthetic ? null : result.model ?? fallbackPolicy.model ?? task.models[0]?.model ?? "gpt-5.6-luna";
    const resultUsage = enrichUsage(
      resultModel,
      result.usage,
      settings.pricing?.rates,
      settings.pricing?.version,
    );
    await this.#store.update(id, (draft) => {
      if (options.replace) removeStageArtifacts(draft, stageId);
      const artifact = {
        id: crypto.randomUUID(),
        runId: result.runId ?? null,
        stage: stageId,
        name: options.name ?? metadata.artifactName,
        kind: "markdown",
        content: result.finalText,
        createdAt: now(),
        startedAt: result.startedAt ?? null,
        completedAt: result.completedAt ?? null,
        durationMs: result.durationMs ?? null,
        model: resultModel,
        reasoning: options.synthetic ? null : result.reasoning !== undefined ? result.reasoning : fallbackPolicy.reasoning,
        agentRole: options.agentRole ?? result.agentRole ?? stageId,
        usage: resultUsage,
        candidateId: options.candidateId ?? null,
        candidateRevision: options.candidateRevision ?? null,
        workPackageId: options.workPackageId ?? null,
        focusedTest: options.focusedTestEvidence ?? null,
        evidenceError: options.evidenceError ?? null,
        gateResult: options.gateResult ?? null,
        contextManifest: result.contextManifest ?? null,
      };
      draft.artifacts.push(artifact);
      const run = attachRunArtifact(draft, result.runId, artifact);
      const stageIsAuthoritative = !CANDIDATE_GATE_STAGES.includes(stageId) || run?.freshness?.fresh === true;
      if (options.complete !== false && stageIsAuthoritative && !draft.completedStages.includes(stageId)) {
        draft.completedStages.push(stageId);
      }
      for (const key of ["inputTokens", "cachedInputTokens", "cacheWriteTokens", "outputTokens", "totalTokens"]) {
        draft.usage[key] += resultUsage[key] ?? 0;
      }
      draft.usage.cost = (draft.usage.cost ?? 0) + (resultUsage.cost ?? 0);
      draft.usage.credits = (draft.usage.credits ?? 0) + (resultUsage.credits ?? 0);
      draft.usage.pricingVersion = resultUsage.pricingVersion ?? draft.usage.pricingVersion;
      draft.events.push(
        activity(
          stageId,
          options.artifactTitle ?? `${metadata.label} artifact ready`,
          options.name ?? metadata.artifactName,
          options.artifactTone ?? "success",
          "artifact",
          runEventMetadata(run, { artifactId: artifact.id }),
        ),
      );
    });
  }
}

function removeStageArtifacts(task, stageId) {
  const removedIds = new Set(
    (task.artifacts ?? [])
      .filter((artifact) => artifact.stage === stageId)
      .map((artifact) => artifact.id),
  );
  task.artifacts = (task.artifacts ?? []).filter((artifact) => artifact.stage !== stageId);
  if (!removedIds.size) return;
  for (const run of task.runs ?? []) {
    if (removedIds.has(run.artifactId)) run.artifactId = null;
  }
}

function summarizeAgentReport(text) {
  const summary = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
  return summary ? `Agent report: ${summary}` : "";
}

function throwIfAborted(signal) {
  if (signal.aborted) throw new Error("Codex run cancelled.");
}

function candidateGateFailure(task, candidate, stages = CANDIDATE_GATE_STAGES) {
  const projection = refreshGateFreshness(task);
  for (const stage of stages) {
    const freshness = projection[stage];
    const exactCandidate = freshness?.candidateId === candidate.id &&
      freshness?.candidateRevision === candidate.revisionNumber;
    if (!freshness?.fresh || !exactCandidate) return { stage, freshness };
  }
  return null;
}

function assertCandidateGatesFresh(task, candidate) {
  const failure = candidateGateFailure(task, candidate);
  if (!failure) return;
  const stageLabel = getStageMetadata(failure.stage).label;
  const reason = failure.freshness?.reasonCopy ?? RUNTIME_FRESHNESS_REASONS.missing_authoritative_summary;
  throw new Error(
    `${candidate.id} revision ${candidate.revisionNumber} cannot be approved because ${stageLabel} is not fresh. ${reason}`,
  );
}

function currentCandidate(task) {
  const candidate = task.candidates?.at(-1);
  if (!candidate) throw new Error("This task does not have an integration candidate.");
  return candidate;
}

function stageTimeoutMs(stageId, sandbox) {
  if (["implement", "repair"].includes(stageId)) return 900_000;
  if (sandbox === "workspace-write" || ["plan", "dev-review", "final-review"].includes(stageId)) return 600_000;
  return 360_000;
}

export function evaluationVerdict(stageId, result, focusedTestEvidence = null, structuredGateEvidence = null) {
  if (CANDIDATE_GATE_STAGES.includes(stageId) && candidateVerificationCommandFailed(result.runtimeEvents)) return "REPAIR";
  if (stageId === "test" && focusedTestEvidence?.status !== "passed") return "REPAIR";
  if (stageId === "test") return "PASS";
  if (["dev-review", "final-review"].includes(stageId)) return structuredGateEvidence?.verdict ?? "REPAIR";
  return "REPAIR";
}

function candidateVerificationCommandFailed(runtimeEvents = []) {
  return runtimeEvents.some((event) =>
    event?.commandFailed === true && event?.runtimeScope !== "context-preflight",
  );
}

export function structuredEvidenceError(error) {
  const code = isCandidateEvidenceError(error)
    ? error.code
    : "contradictory_evidence";
  return { code, copy: RUNTIME_FRESHNESS_REASONS[code] };
}

function evaluationRerunState(stageId) {
  return {
    "dev-review": { taskStatus: "ready-for-review", candidateStatus: "ready_for_review" },
    test: { taskStatus: "ready-for-test", candidateStatus: "ready_for_test" },
    "final-review": { taskStatus: "ready-for-final-review", candidateStatus: "ready_for_final_review" },
  }[stageId];
}

function canStartRun(task, kind) {
  const stage = stageForRun(kind, task.currentStage);
  const attempts = task.attemptsByStage?.[stage] ?? 0;
  if (task.status === "blocked" || attempts >= stageRunLimitFor(task, stage)) return false;
  if (kind === "specification" && ["failed", "cancelled"].includes(task.status) && task.currentStage !== "specification") {
    return false;
  }
  const allowed = {
    investigation: ["queued", "failed", "cancelled"],
    specification: ["awaiting-grill", "failed", "cancelled"],
    planning: ["awaiting-plan-approval", "failed", "cancelled"],
    implementation: ["ready-for-implementation", "failed", "cancelled"],
    repair: ["repair-required", "failed", "cancelled"],
    review: ["ready-for-review", "failed", "cancelled"],
    test: ["ready-for-test", "failed", "cancelled"],
    "final-review": ["ready-for-final-review", "failed", "cancelled"],
  }[kind];
  if (!allowed.includes(task.status)) return false;
  if (kind === "repair" && currentCandidate(task).status !== "repair_required") return false;
  if (kind === "implementation" && task.candidates?.at(-1)?.status === "repair_required") return false;
  return true;
}

function reserveRun(task, kind) {
  const stage = stageForRun(kind, task.currentStage);
  const candidate = task.candidates?.at(-1) ?? null;
  const reservation = createStageRunReservation(task, kind, stage);
  task.status = "running";
  task.error = null;
  task.startedAt ??= now();
  task.completedAt = null;
  applyStageRunReservation(task, reservation);
  task.activeRunKind = kind;
  if (candidate) {
    const candidateStatus = {
      repair: "repairing",
      review: "reviewing",
      test: "testing",
      "final-review": "final_reviewing",
    }[kind];
    if (candidateStatus) candidate.status = candidateStatus;
  }
  task.events.push(activity(stage, `${labelForRun(kind)} started`, runDetail(kind), "info", "agent"));
}

function createStageRunReservation(task, kind, stage, provider = reservationProviderFor(task, kind, stage)) {
  const candidate = kind === "implementation" ? null : (task.candidates?.at(-1) ?? null);
  const repairAuthorizer = kind === "repair" ? repairAuthorizerSnapshot(task, candidate) : null;
  const reservedAt = repairAuthorizer
    ? timestampAfter(repairAuthorizer.authorizingGateArtifactCreatedAt)
    : now();
  const authorizedRunScopes = kind === "implementation"
    ? (task.workPackages ?? [])
        .filter((workPackage) => !["ready_for_integration", "integrated"].includes(workPackage.status))
        .map((workPackage) => workPackage.id)
    : [];
  return {
    id: crypto.randomUUID(),
    stage,
    kind,
    provider,
    workflowAttempt: (task.attemptsByStage?.[stage] ?? 0) + 1,
    candidateId: candidate?.id ?? null,
    candidateRevision: candidate?.revisionNumber ?? null,
    candidateHeadRevision: candidate?.headRevision ?? null,
    authorizedRunScopes,
    reservedAt,
    ...(repairAuthorizer ?? {}),
  };
}

/**
 * The provider that will execute this attempt, resolved from the stage policy that
 * owns it rather than from the task. This is what lets a task review on one runtime
 * and implement on another while a run still cannot execute on a provider its
 * reservation did not reserve.
 */
function reservationProviderFor(task, kind, stage) {
  return resolveAgentPolicy(task, policyIdForRun(kind, stage)).provider;
}

function repairAuthorizerSnapshot(task, candidate, requestedStage = null) {
  const stage = requestedStage ?? (
    CANDIDATE_GATE_STAGES.includes(task.currentStage)
      ? task.currentStage
      : task.stageRunReservations?.implement?.authorizingGateStage
  );
  const freshness = refreshGateFreshness(task)?.[stage] ?? null;
  const sourceRun = freshness?.sourceRunId
    ? (task.runs ?? []).find((run) => run.id === freshness.sourceRunId)
    : null;
  const sourceArtifact = freshness?.sourceArtifactId
    ? (task.artifacts ?? []).find((artifact) => artifact.id === freshness.sourceArtifactId)
    : null;
  const gateReservation = sourceRun?.workflowReservationId
    ? task.stageRunReservations?.[stage]
    : null;
  const sourceArtifacts = sourceRun?.artifactId
    ? (task.artifacts ?? []).filter((artifact) => artifact.id === sourceRun.artifactId)
    : [];
  const reservationRuns = gateReservation?.id
    ? (task.runs ?? []).filter((run) => run.workflowReservationId === gateReservation.id)
    : [];
  const timestamps = [
    gateReservation?.reservedAt,
    sourceRun?.startedAt,
    sourceRun?.completedAt,
    sourceRun?.gateResult?.evaluatedAt,
    sourceArtifact?.createdAt,
  ];
  const ordered = timestamps.every(isCanonicalTimestamp) &&
    timestamps.every((value, index) => index === 0 || Date.parse(timestamps[index - 1]) <= Date.parse(value));
  if (
    !CANDIDATE_GATE_STAGES.includes(stage) ||
    !candidate ||
    // A REPAIR verdict whose only complaint is a non-blocking finding's inherited
    // (non-explicit) binding is classified `missing_binding` by the freshness marker
    // check, not `repair_required`, even though it is the same authoritative,
    // content-driven repair need. See the matching fix in server/api.mjs.
    !["repair_required", "missing_binding"].includes(freshness?.reasonCode) ||
    freshness.candidateId !== candidate.id ||
    freshness.candidateRevision !== candidate.revisionNumber ||
    !sourceRun ||
    !sourceArtifact ||
    !gateReservation ||
    reservationRuns.length !== 1 ||
    reservationRuns[0].id !== sourceRun.id ||
    sourceArtifacts.length !== 1 ||
    sourceArtifacts[0].id !== sourceArtifact.id ||
    (task.runs ?? []).filter((run) => run.artifactId === sourceArtifact.id).length !== 1 ||
    gateReservation.stage !== stage ||
    gateReservation.kind !== runKindFor(stage, stage) ||
    gateReservation.workflowAttempt !== task.attemptsByStage?.[stage] ||
    gateReservation.id !== sourceRun.workflowReservationId ||
    gateReservation.workflowAttempt !== sourceRun.workflowAttempt ||
    gateReservation.candidateId !== candidate.id ||
    gateReservation.candidateRevision !== candidate.revisionNumber ||
    gateReservation.candidateHeadRevision !== candidate.headRevision ||
    readExecutionProvider(sourceRun) !== readExecutionProvider(gateReservation) ||
    sourceRun.stage !== stage ||
    sourceRun.role !== stage ||
    sourceRun.kind !== runKindFor(stage, stage) ||
    sourceRun.status !== "completed" ||
    sourceRun.workPackageId != null ||
    sourceRun.candidateId !== candidate.id ||
    sourceRun.candidateRevision !== candidate.revisionNumber ||
    sourceRun.candidateHeadRevision !== candidate.headRevision ||
    sourceRun.artifactId !== sourceArtifact.id ||
    sourceRun.gateResult?.verdict !== "REPAIR" ||
    sourceArtifact.runId !== sourceRun.id ||
    sourceArtifact.stage !== stage ||
    sourceArtifact.kind !== "markdown" ||
    typeof sourceArtifact.name !== "string" ||
    !sourceArtifact.name.trim() ||
    typeof sourceArtifact.content !== "string" ||
    !sourceArtifact.content.trim() ||
    sourceArtifact.candidateId !== candidate.id ||
    sourceArtifact.candidateRevision !== candidate.revisionNumber ||
    JSON.stringify(sourceArtifact.gateResult) !== JSON.stringify(sourceRun.gateResult) ||
    !ordered
  ) {
    throw new Error("The candidate repair is missing one exact durable authorizing gate.");
  }
  const snapshot = {
    reservation: {
      id: gateReservation.id,
      stage: gateReservation.stage,
      kind: gateReservation.kind,
      provider: readExecutionProvider(gateReservation),
      workflowAttempt: gateReservation.workflowAttempt,
      candidateId: gateReservation.candidateId,
      candidateRevision: gateReservation.candidateRevision,
      candidateHeadRevision: gateReservation.candidateHeadRevision,
      authorizedRunScopes: gateReservation.authorizedRunScopes,
      reservedAt: gateReservation.reservedAt,
    },
    run: {
      id: sourceRun.id,
      kind: sourceRun.kind,
      provider: readExecutionProvider(sourceRun),
      stage: sourceRun.stage,
      role: sourceRun.role,
      status: sourceRun.status,
      attempt: sourceRun.attempt,
      candidateId: sourceRun.candidateId,
      candidateRevision: sourceRun.candidateRevision,
      candidateHeadRevision: sourceRun.candidateHeadRevision,
      workPackageId: sourceRun.workPackageId,
      workflowAttempt: sourceRun.workflowAttempt,
      workflowReservationId: sourceRun.workflowReservationId,
      startedAt: sourceRun.startedAt,
      completedAt: sourceRun.completedAt,
      artifactId: sourceRun.artifactId,
      gateResult: sourceRun.gateResult,
    },
    artifact: {
      id: sourceArtifact.id,
      stage: sourceArtifact.stage,
      name: sourceArtifact.name,
      kind: sourceArtifact.kind,
      content: sourceArtifact.content,
      createdAt: sourceArtifact.createdAt,
      runId: sourceArtifact.runId,
      candidateId: sourceArtifact.candidateId,
      candidateRevision: sourceArtifact.candidateRevision,
      workPackageId: sourceArtifact.workPackageId,
      gateResult: sourceArtifact.gateResult,
    },
  };
  return {
    authorizingGateStage: stage,
    // Persisted for the same reason the other authorizing-gate fields are: the
    // retry-grant path reconstructs this reservation from candidate-revision lineage
    // long after the reservation itself has been replaced, and without a recorded
    // provider that reconstruction has to guess one.
    authorizingGateProvider: readExecutionProvider(gateReservation),
    authorizingGateWorkflowAttempt: gateReservation.workflowAttempt,
    authorizingGateReservationId: gateReservation.id,
    authorizingGateReservedAt: gateReservation.reservedAt,
    authorizingGateRunId: sourceRun.id,
    authorizingGateArtifactId: sourceArtifact.id,
    authorizingGateArtifactCreatedAt: sourceArtifact.createdAt,
    authorizingGateSnapshotDigest: createHash("sha256").update(JSON.stringify(snapshot)).digest("hex"),
  };
}

function assertRepairAuthorizerUnchanged(task, candidate, repairReservation) {
  const current = repairAuthorizerSnapshot(task, candidate, repairReservation.authorizingGateStage);
  if (
    !sameRepairAuthorizerSnapshot(repairReservation, current) ||
    Date.parse(current.authorizingGateArtifactCreatedAt) >= Date.parse(repairReservation.reservedAt)
  ) {
    throw new Error("The repair authorizing gate changed after its workflow reservation.");
  }
}

function sameRepairAuthorizerSnapshot(expected, current) {
  return [
    "authorizingGateStage",
    "authorizingGateProvider",
    "authorizingGateWorkflowAttempt",
    "authorizingGateReservationId",
    "authorizingGateReservedAt",
    "authorizingGateRunId",
    "authorizingGateArtifactId",
    "authorizingGateArtifactCreatedAt",
    "authorizingGateSnapshotDigest",
  ].every((field) => expected?.[field] === current?.[field]);
}

function isCanonicalTimestamp(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function timestampAfter(value) {
  const current = now();
  if (!isCanonicalTimestamp(value) || Date.parse(current) > Date.parse(value)) return current;
  return new Date(Date.parse(value) + 1).toISOString();
}

function sameRepairReservationAuthority(expected, current) {
  return [
    "id",
    "workflowAttempt",
    "reservedAt",
    "candidateId",
    "candidateRevision",
    "candidateHeadRevision",
    "provider",
    "authorizingGateStage",
    "authorizingGateProvider",
    "authorizingGateWorkflowAttempt",
    "authorizingGateReservationId",
    "authorizingGateReservedAt",
    "authorizingGateRunId",
    "authorizingGateArtifactId",
    "authorizingGateArtifactCreatedAt",
    "authorizingGateSnapshotDigest",
  ].every((field) => expected?.[field] === current?.[field]);
}

function applyStageRunReservation(task, reservation) {
  task.stageRun += 1;
  task.attemptsByStage ??= {};
  task.attemptsByStage[reservation.stage] = reservation.workflowAttempt;
  task.stageRunReservations ??= {};
  task.stageRunReservations[reservation.stage] = reservation;
  task.activeRunReservationId = reservation.id;
}

function requireActiveRunReservation(task, kind, stage) {
  const reservation = task.stageRunReservations?.[stage] ?? null;
  if (
    !reservation ||
    reservation.id !== task.activeRunReservationId ||
    reservation.kind !== kind ||
    reservation.stage !== stage ||
    reservation.workflowAttempt !== task.attemptsByStage?.[stage]
  ) {
    throw new Error(`The active ${stage} workflow reservation is inconsistent.`);
  }
  return reservation;
}

function recordApproval(task, stage, note) {
  const approvalNote = note.trim().slice(0, 5_000);
  task.approvals ??= [];
  const approval = { id: crypto.randomUUID(), stage, note: approvalNote, createdAt: now() };
  task.approvals.push(approval);
  task.events.push(activity(
    stage,
    `${getStageMetadata(stage)?.label ?? stage} approved`,
    approvalNote || "Approved without an additional note.",
    "success",
    "decision",
    { approvalId: approval.id },
  ));
}

function stageForRun(kind, currentStage) {
  return {
    investigation: ["triage", "scouts", "grill", "specification"].includes(currentStage) ? currentStage : "triage",
    specification: "specification",
    planning: "plan",
    implementation: "implement",
    repair: "implement",
    review: "dev-review",
    test: "test",
    "final-review": "final-review",
  }[kind];
}

function labelForRun(kind) {
  return {
    investigation: "Investigation workflow",
    specification: "Specification synthesis",
    planning: "Planning gate",
    implementation: "Implementation candidate",
    repair: "Candidate repair",
    review: "Development review",
    test: "Focused test gate",
    "final-review": "Final holdout review",
  }[kind];
}

function runDetail(kind) {
  if (kind === "implementation" || kind === "repair") return "Using the local ChatGPT-authenticated Codex CLI inside an isolated Git worktree.";
  return "Using the local ChatGPT-authenticated Codex CLI with retained workflow context.";
}

/**
 * The implementation prompt's escape hatch for a work package whose goal is already
 * met: the agent makes no edits and reports why instead of the harness treating an
 * empty diff as a stuck or broken run. Only trusted when the worktree is actually
 * clean — see the call site in `#runWorkPackage` — so a model that emits the marker
 * without believing it (or while having actually changed something) still goes
 * through the ordinary commit path instead of skipping evidence.
 */
function parseNoChangesNeeded(text) {
  const match = String(text ?? "").match(/<no-changes-needed>\s*([\s\S]*?)\s*<\/no-changes-needed>/i);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]);
    return typeof parsed?.reason === "string" && parsed.reason.trim() ? parsed : null;
  } catch {
    return null;
  }
}

function dependencyClosure(workPackage, packages, seen = new Set()) {
  for (const dependencyId of workPackage.dependencies) {
    if (seen.has(dependencyId)) continue;
    seen.add(dependencyId);
    const dependency = packages.find((item) => item.id === dependencyId);
    if (dependency) dependencyClosure(dependency, packages, seen);
  }
  return [...seen];
}
