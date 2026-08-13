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
  projectRepairFindings,
} from "./prompts.mjs";
import { getCodexStatus } from "./codex-runtime.mjs";
import { resolveExecutionProvider } from "./execution-providers.mjs";
import { candidateGateCommandLimit } from "./candidate-gate-policy.mjs";
import { isProcessTimeoutError } from "./process-runtime.mjs";
import { defaultWorktreeRoot, GitWorktreeManager, symlinkedDependencySourceRoots } from "./git-worktree.mjs";
import { GitHubPullRequestManager, pullRequestBranch } from "./github-pull-request.mjs";
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
  parseFastChangeContract,
  parseGateEvidence,
  parseGrillQuestions,
  parseWorkPackages,
  isOwnedFile,
  validateFocusedTestEvidence,
} from "./structured-output.mjs";
import {
  discoverVerificationEvidence,
  OnboardingError,
  parseOnboardingProposal,
  renderManifestFile,
  VERIFICATION_MANIFEST_PATH,
} from "./onboarding.mjs";
import {
  gitHeadRevision,
  readVerificationManifest,
  readVerificationManifestAtRevision,
  runRepositoryVerification,
  selectVerificationCommands,
} from "./verification.mjs";
import {
  canOverrideWorkflowProfile,
  fastEscalation,
  isArchitecturalRisk,
  recordWorkflowProfile,
} from "./workflow-profiles.mjs";

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

class FastProfileReplanError extends Error {
  constructor(message, workPackageId = null) {
    super(message);
    this.name = "FastProfileReplanError";
    this.code = "FAST_PROFILE_REPLAN_REQUIRED";
    this.workPackageId = workPackageId;
  }
}

function zeroUsage() {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cost: 0,
    credits: 0,
  };
}

async function allSettledWithConcurrency(items, limit, worker) {
  const outcomes = new Array(items.length);
  let nextIndex = 0;
  const runWorker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        outcomes[index] = { status: "fulfilled", value: await worker(items[index], index) };
      } catch (reason) {
        outcomes[index] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => runWorker()));
  return outcomes;
}

function deterministicGateResult(stage, candidate, passed, blockingReasons) {
  return {
    verdict: passed ? "PASS" : "REPAIR",
    candidateId: candidate.id,
    candidateRevision: candidate.revisionNumber,
    schemaVersion: 1,
    stage,
    reportedVerdict: passed ? "PASS" : "REPAIR",
    evaluatedAt: now(),
    findings: [],
    blockingReasons,
  };
}

function deterministicTestMarkdown(candidate, verification) {
  const rows = verification.rows.map((row) =>
    `- **${row.id}: ${String(row.status).toUpperCase()}** — \`${row.command}\` (${row.durationMs}ms, exit ${row.exitCode ?? "unavailable"})`,
  ).join("\n");
  return `# Focused Test\n\n- Candidate: ${candidate.id} revision ${candidate.revisionNumber}\n- Head: ${candidate.headRevision}\n- Full manifest result: ${String(verification.status).toUpperCase()}\n- Duration: ${verification.durationMs}ms\n\n${rows}\n\nThis artifact was generated from harness-observed command evidence; no model interpreted or reran the manifest.`;
}

function deterministicFinalReviewMarkdown(task, candidate, verification) {
  const review = [...(task.runs ?? [])].reverse().find((run) =>
    run.stage === "dev-review" &&
    run.candidateId === candidate.id &&
    run.candidateRevision === candidate.revisionNumber &&
    run.gateResult?.verdict === "PASS",
  );
  const followUps = (review?.gateResult?.findings ?? []).filter((finding) => !finding.blocking);
  return `# Deterministic Final Review\n\n## Verdict\n\nPASS for ${candidate.id} revision ${candidate.revisionNumber} at ${candidate.headRevision}.\n\n## Workflow summary\n\n- Profile: fast\n- Work packages: exactly one\n- Development Review: independent PASS${followUps.length ? ` with ${followUps.length} non-blocking follow-up item${followUps.length === 1 ? "" : "s"}` : " with no findings"}\n- Full repository manifest: ${String(verification.status).toUpperCase()} once for this revision in ${verification.durationMs}ms\n- Candidate repairs: ${(candidate.revisions ?? []).filter((revision) => revision.reason === "repair").length}\n\n## Acceptance criteria\n\nThe bounded fast change contract remains in the retained Triage artifact. No unresolved blocking risk is recorded.\n\n## Evidence\n\nThe exact candidate-bound Dev Review and Focused Test artifacts are the authoritative evidence. Skipped stages retain explicit not-required reasons; they are not represented as completed runs.\n\n## Residual risks\n\n${followUps.length ? followUps.map((finding) => `- ${finding.severity}: ${finding.title}`).join("\n") : "- None recorded."}\n\n## Human approval brief\n\nHuman Approval must still revalidate the exact candidate revision, target, clean worktrees, and all three fresh candidate-bound gates before fast-forward merge.`;
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

function completeGrillSession(draft, { source, acceptRemaining }) {
  if (draft.grillSession?.status !== "open") {
    throw new Error("This task does not have an open Grill Me session.");
  }
  const unresolved = draft.grillSession.questions.filter((question) => !question.answer);
  if (unresolved.length && !acceptRemaining) {
    throw new Error("Answer every Grill question or explicitly accept the recommended assumptions.");
  }

  const acceptedDecisionIds = [];
  for (const question of unresolved) {
    const recommendation = question.options.find((option) => option.recommended);
    if (!recommendation) throw new Error(`Grill question ${question.id} has no recommended answer.`);
    question.answer = recommendation.label;
    question.answerSource = source === "automation-policy"
      ? "automation-policy"
      : "operator-accepted-recommendation";
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

  const acceptedCount = unresolved.length;
  draft.grillSession.status = "completed";
  draft.grillSession.completedAt = now();
  draft.grillSession.completionSource = source;
  draft.grillSession.policySnapshot = draft.grillPolicy ?? "manual";
  draft.grillSession.acceptedRecommendationCount = acceptedCount;
  draft.grillSession.completionReason = source === "automation-policy"
    ? `Automatically accepted ${acceptedCount} recommended assumption${acceptedCount === 1 ? "" : "s"} under the task's Grill policy.`
    : acceptedCount
      ? `Finished by the operator with ${acceptedCount} recommended assumption${acceptedCount === 1 ? "" : "s"} accepted.`
      : "All material questions were answered by the operator.";
  if (!draft.completedStages.includes("grill")) draft.completedStages.push("grill");
  draft.events.push(activity(
    "grill",
    source === "automation-policy" ? "Grill recommendations accepted automatically" : "Grill Me completed",
    draft.grillSession.completionReason,
    "success",
    "decision",
    {
      decisionIds: acceptedDecisionIds,
      grillCompletionSource: source,
      grillPolicy: draft.grillSession.policySnapshot,
      acceptedRecommendationCount: acceptedCount,
    },
  ));
}

export class TaskOrchestrator {
  #store;
  #active = new Map();
  #mergeActive = new Set();
  #refreshActive = new Set();
  #runCodex;
  #getStatus;
  #worktrees;
  #github;
  #runVerification;
  #runPackageVerification;
  #packageVerificationQueue = Promise.resolve();
  #packageConcurrency;
  #readVerificationManifest;
  #readVerificationManifestInjected;
  #readVerificationManifestAtRevision;

  constructor(store, options = {}) {
    this.#store = store;
    this.#runCodex = options.runCodex ?? null;
    this.#getStatus = options.getStatus ?? getCodexStatus;
    this.#worktrees = options.worktreeManager ?? new GitWorktreeManager(defaultWorktreeRoot());
    this.#github = options.pullRequestManager ?? new GitHubPullRequestManager();
    // The same injection seam `runCodex` and `worktreeManager` already use, for the same
    // reason: harness verification spawns real processes in a real worktree, so a test about
    // gate ingestion, freshness or retry accounting should be able to supply the observation
    // rather than stand up a repository to obtain it. The real path is exercised directly in
    // `tests/verification.test.mjs`, including against a real git worktree.
    this.#runVerification = options.runVerification ?? runRepositoryVerification;
    this.#readVerificationManifest = options.readVerificationManifest ?? readVerificationManifest;
    this.#readVerificationManifestInjected = Boolean(options.readVerificationManifest);
    this.#readVerificationManifestAtRevision = options.readVerificationManifestAtRevision
      ?? (options.readVerificationManifest
        ? async (repositoryPath) => options.readVerificationManifest(repositoryPath)
        : readVerificationManifestAtRevision);
    // Production slices qualify with the same repository-owned, argv-only manifest as
    // Focused Test. Unit tests that inject a model runner keep their existing lightweight
    // seam unless they explicitly inject package verification; real runtime execution never
    // gets that exemption.
    this.#runPackageVerification = options.runPackageVerification
      ?? (this.#runCodex
        ? null
        : async ({ worktreePath, workPackage, workPackageId, attempt, headRevision, signal, manifest = null }) => {
            return this.#runVerification({
              worktreePath,
              candidate: { id: workPackageId, revisionNumber: attempt, headRevision },
              commandIds: workPackage.verificationCommandIds,
              executionKind: "focused-package",
              signal,
              manifest,
            });
          });
    this.#packageConcurrency = Number.isInteger(options.packageConcurrency)
      ? Math.max(1, Math.min(8, options.packageConcurrency))
      : 3;
  }

  #qualifyPackage(input) {
    const run = () => {
      throwIfAborted(input.signal);
      return this.#runPackageVerification(input);
    };
    const pending = this.#packageVerificationQueue.then(run, run);
    this.#packageVerificationQueue = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
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
      if (await this.#blockCandidateGateOnTargetDrift(id, kind)) {
        throw new Error("The target branch advanced. Refresh the candidate before spending another candidate-bound gate attempt.");
      }
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

  async #blockCandidateGateOnTargetDrift(id, kind) {
    if (!["review", "test", "final-review"].includes(kind) || typeof this.#worktrees.mergeState !== "function") {
      return false;
    }
    const task = await this.#store.get(id);
    const candidate = currentCandidate(task);
    if (!candidate?.headRevision || task.activeRunKind || task.activeRunReservationId) return false;
    if (await this.#worktrees.mergeState(candidate) !== "diverged") return false;
    const message = "The target branch advanced after this candidate was created. Refresh the candidate before running another candidate-bound gate.";
    const blocked = await this.#store.transition(
      id,
      (draft) => {
        const current = currentCandidate(draft);
        return !draft.activeRunKind &&
          !draft.activeRunReservationId &&
          current?.id === candidate.id &&
          current.revisionNumber === candidate.revisionNumber &&
          current.headRevision === candidate.headRevision;
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
        draft.events.push(activity(
          draft.currentStage,
          "Candidate gate paused for target refresh",
          `${candidate.id} revision ${candidate.revisionNumber} remains retained, but its target advanced before ${draft.currentStage}. No gate attempt was spent.`,
          "warning",
          "decision",
        ));
      },
    );
    return Boolean(blocked);
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

  async overrideWorkflowProfile(id, profile, reason = "") {
    const task = await this.#store.get(id);
    if (!task) throw new Error("Task not found.");
    if (!canOverrideWorkflowProfile(task)) {
      throw new Error("Workflow profile can be changed only before implementation starts and while no agent is running.");
    }
    const prior = task.workflowProfile?.selected ?? "standard";
    const note = reason.trim().slice(0, 2_000)
      || `Operator changed the workflow profile from ${prior} to ${profile} before implementation.`;
    return this.#store.transition(id, canOverrideWorkflowProfile, (draft) => {
      const changed = recordWorkflowProfile(draft, profile, note, "operator");
      if (!changed) return;
      draft.models = [...new Set(Object.values(draft.agentConfig.stagePolicies ?? {}).map((policy) => policy.model))]
        .map((model) => ({ provider: "openai", model }));
      if (prior === "fast" && profile !== "fast" && draft.stageDispositions?.plan?.status === "not-required") {
        draft.workPackages = [];
        draft.scoutDispatch = null;
        draft.grillSession = null;
        draft.stageDispositions = {};
        draft.status = "failed";
        draft.currentStage = "scouts";
        draft.error = "The operator selected the full workflow. Resume investigation to produce the required scout, decision, specification, and plan evidence.";
      }
      draft.events.push(activity(
        draft.currentStage,
        "Workflow profile overridden",
        `${prior} → ${profile}. ${note}`,
        "warning",
        "decision",
        { workflowProfile: profile, priorWorkflowProfile: prior },
      ));
    });
  }

  async answerGrillQuestion(id, input) {
    if (input.source !== "operator") throw new Error("Grill answers require an explicit operator action.");
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
    await this.#assertExecutablePlan(task);
    if (task.workflowProfile?.selected === "fast") {
      if (task.workPackages?.length !== 1 || task.workPackages[0].dependencies.length) {
        throw new Error("Fast requires exactly one coherent work package with no package dependencies.");
      }
      if (!task.workPackages[0].verificationCommandIds?.length) {
        throw new Error("Fast requires at least one validated focused repository manifest command ID.");
      }
    }
    return this.#store.transition(id, (draft) => draft.status === "awaiting-plan-approval", (draft) => {
      recordApproval(draft, "plan", note);
      draft.status = "ready-for-implementation";
      draft.currentStage = "implement";
      draft.events.push(activity("implement", "Implementation authorized", "The approved plan may now run in an isolated Git worktree.", "success", "decision"));
    });
  }

  async correctInvalidPlan(id) {
    const task = await this.#store.get(id);
    if (!task) throw new Error("Task not found.");
    if (!["failed", "blocked"].includes(task.status) || task.currentStage !== "implement") {
      throw new Error("The task is not blocked by an invalid approved plan.");
    }
    let validationError = null;
    try {
      await this.#assertExecutablePlan(task);
    } catch (error) {
      validationError = error;
    }
    const failedQualification = task.workPackages?.find((workPackage) =>
      workPackage.status === "failed" &&
      workPackage.headRevision &&
      workPackage.worktreePath &&
      /did not qualify/i.test(workPackage.error ?? task.error ?? ""),
    );
    if (!validationError && !failedQualification) {
      throw new Error("The retained approved plan is executable and does not require plan correction.");
    }
    const correctionReason = validationError?.message
      ?? `${failedQualification.id} needs a corrected ownership or verification plan after focused package qualification failed.`;
    const planAttempts = task.attemptsByStage?.plan ?? 0;
    if (planAttempts >= stageRunLimitFor(task, "plan")) {
      throw new Error("The Plan correction allowance is exhausted; inspect the retained plans before granting another Plan attempt.");
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
        draft.events.push(activity(
          "plan",
          "Invalid approved plan returned for correction",
          `${correctionReason} One implementation allowance was reserved for the corrected plan; prior attempts remain retained for audit.`,
          "warning",
          "decision",
        ));
      },
    });
    if (!started) throw new Error("The invalid approved plan could not be reserved for correction.");
    return { started: true };
  }

  async continueRetainedPackage(id) {
    const task = await this.#store.get(id);
    if (!task) throw new Error("Task not found.");
    if (!["failed", "blocked"].includes(task.status) || task.currentStage !== "implement") {
      throw new Error("The task is not awaiting a retained implementation continuation.");
    }
    const workPackage = [...(task.workPackages ?? [])].reverse().find((item) =>
      item.status === "failed" &&
      item.worktreePath &&
      /run exceeded \d+ seconds|harness stopped while this task was running/i.test(item.error ?? task.error ?? ""),
    );
    if (!workPackage) throw new Error("No timed-out or interrupted retained work package is available to continue.");
    const retained = await this.#worktrees.inspectRetainedSlice(workPackage, { requireClean: false });
    if (retained.clean) throw new Error("The retained package is clean; use exact retained-slice requalification or a new implementation attempt.");
    const outsideOwnership = retained.files.filter((file) => !isOwnedFile(file, workPackage.ownedPaths));
    const worktreeSnapshot = workPackage.worktreePath;
    const started = await this.start(id, "implementation", {
      canStart: (draft) => {
        const current = draft.workPackages?.find((item) => item.id === workPackage.id);
        return ["failed", "blocked"].includes(draft.status) &&
          draft.currentStage === "implement" &&
          current?.status === "failed" &&
          current.worktreePath === worktreeSnapshot;
      },
      onReserve: (draft) => {
        const attempts = draft.attemptsByStage?.implement ?? 0;
        draft.stageRunLimits ??= {};
        draft.stageRunLimits.implement = Math.max(stageRunLimitFor(draft, "implement"), attempts + 1);
        draft.stageTimeoutOverridesMs ??= {};
        draft.stageTimeoutOverridesMs.implement = Math.max(draft.stageTimeoutOverridesMs.implement ?? 0, 1_800_000);
        const current = draft.workPackages.find((item) => item.id === workPackage.id);
        current.retainedContinuation = {
          requestedAt: now(),
          files: retained.files,
          outsideOwnership,
        };
        draft.events.push(activity(
          "implement",
          "Retained package continuation authorized",
          `${workPackage.id} will continue in ${workPackage.branch} with a 30-minute timeout. ${outsideOwnership.length ? `${outsideOwnership.length} path(s) outside declared ownership must be restored before qualification.` : "All retained paths are within declared ownership."}`,
          "warning",
          "decision",
        ));
      },
    });
    if (!started) throw new Error("The retained package continuation could not be reserved.");
    return { started: true };
  }

  async #assertExecutablePlan(task) {
    if (!task.workPackages?.length) {
      throw new Error("The approved plan does not contain executable work packages.");
    }
    for (const workPackage of task.workPackages) {
      if (!workPackage.verificationCommandIds?.length) {
        throw new Error(`${workPackage.id}: Focused package verification requires at least one repository manifest command id.`);
      }
    }
    if (this.#runCodex && !this.#readVerificationManifestInjected) return;
    const verificationManifest = this.#readVerificationManifestInjected
      ? await this.#readVerificationManifest(task.repositoryPath)
      : await this.#readVerificationManifestAtRevision(
          task.repositoryPath,
          (await this.#worktrees.base(task, { allowDirty: true })).baseRevision,
        );
    for (const workPackage of task.workPackages) {
      selectVerificationCommands(verificationManifest, workPackage.verificationCommandIds);
    }
  }

  async approvePullRequest(id, note = "") {
    if (this.#mergeActive.has(id)) throw new Error("This task already has a GitHub PR reconciliation in progress.");
    this.#mergeActive.add(id);
    return this.#approvePullRequest(id, note).finally(() => this.#mergeActive.delete(id));
  }

  async reconcilePullRequest(id) {
    if (this.#mergeActive.has(id)) throw new Error("This task already has a GitHub PR reconciliation in progress.");
    this.#mergeActive.add(id);
    return this.#reconcilePullRequestIntent(id, { operatorRequested: true })
      .finally(() => this.#mergeActive.delete(id));
  }

  async #approvePullRequest(id, note = "") {
    let task = await this.#store.get(id);
    if (!task) throw new Error("Task not found.");
    if (task.status === "awaiting-human-approval") {
      const candidate = currentCandidate(task);
      if (candidate.status !== "awaiting_human_approval") throw new Error("The current candidate has not cleared every gate.");
      assertCandidateGatesFresh(task, candidate);
      if (!candidate.headRevision || !candidate.baseBranch || candidate.baseBranch === "detached") {
        throw new Error("The candidate does not have a named GitHub target and exact head revision.");
      }
      await this.#worktrees.verifyCandidate(candidate);
      task = await this.#store.transition(id, (draft) => {
        const activeCandidate = currentCandidate(draft);
        return draft.status === "awaiting-human-approval" &&
          activeCandidate.status === "awaiting_human_approval" &&
          candidateGateFailure(draft, activeCandidate) == null;
      }, (draft) => {
        const activeCandidate = currentCandidate(draft);
        const startedAt = now();
        draft.status = "merging";
        draft.pullRequestIntent = {
          candidateId: activeCandidate.id,
          candidateRevision: activeCandidate.revisionNumber,
          baseRevision: activeCandidate.baseRevision,
          headRevision: activeCandidate.headRevision,
          targetBranch: activeCandidate.baseBranch,
          headBranch: pullRequestBranch(draft, activeCandidate),
          remoteName: null,
          repository: null,
          number: null,
          url: null,
          note: note.trim().slice(0, 5_000),
          status: "publishing",
          startedAt,
          openedAt: null,
          mergedAt: null,
          closedAt: null,
          mergeCommitRevision: null,
          lastCheckedAt: null,
          lastError: null,
          consecutivePollFailures: 0,
        };
        draft.events.push(activity(
          "approval",
          "GitHub PR intent recorded",
          `${activeCandidate.id} revision ${activeCandidate.revisionNumber} is reserved for a PR into ${activeCandidate.baseBranch}.`,
          "warning",
          "decision",
        ));
      });
    } else if (task.status !== "merging" || task.pullRequestIntent?.status !== "publishing") {
      throw new Error("The task is not awaiting GitHub PR approval.");
    }
    return this.#reconcilePullRequestIntent(id);
  }

  async #reconcilePullRequestIntent(id, { operatorRequested = false } = {}) {
    let task = await this.#store.get(id);
    if (!task) throw new Error("Task not found.");
    if (task.status === "completed" && task.pullRequestIntent?.status === "merged") return task;

    const retryablePublication = task.status === "blocked" &&
      task.blocker?.code === "pull-request-publication" &&
      task.pullRequestIntent?.status === "failed";
    if (retryablePublication) {
      task = await this.#store.transition(id, (draft) => (
        draft.status === "blocked" &&
        draft.blocker?.code === "pull-request-publication" &&
        draft.pullRequestIntent?.status === "failed"
      ), (draft) => {
        draft.status = "merging";
        draft.error = null;
        draft.blocker = null;
        draft.pullRequestIntent.status = "publishing";
        draft.pullRequestIntent.lastError = null;
        draft.events.push(activity(
          "approval",
          "GitHub PR publication retry requested",
          "The original exact-candidate approval is retained while the remote branch and PR are reconciled idempotently.",
          "warning",
          "decision",
        ));
      });
    }

    const retryableClosedPullRequest = task.status === "blocked" &&
      task.blocker?.code === "pull-request-closed" &&
      task.pullRequestIntent?.status === "closed";
    if (retryableClosedPullRequest) {
      task = await this.#store.transition(id, (draft) => (
        draft.status === "blocked" &&
        draft.blocker?.code === "pull-request-closed" &&
        draft.pullRequestIntent?.status === "closed"
      ), (draft) => {
        draft.status = "awaiting-pr-merge";
        draft.error = null;
        draft.blocker = null;
        draft.pullRequestIntent.status = "open";
        draft.pullRequestIntent.lastError = null;
        draft.events.push(activity(
          "approval",
          "GitHub PR recheck requested",
          "The PR will progress only if GitHub now reports the same exact candidate head open or merged.",
          "warning",
          "decision",
        ));
      });
    }

    const intent = task.pullRequestIntent;
    const candidate = currentCandidate(task);
    if (!intent || (
      intent.candidateId !== candidate.id ||
      intent.candidateRevision !== candidate.revisionNumber ||
      intent.headRevision !== candidate.headRevision ||
      intent.baseRevision !== candidate.baseRevision
    )) {
      throw new Error(operatorRequested
        ? "This task does not have a retained GitHub PR intent for its exact current candidate."
        : "The retained GitHub PR intent no longer matches the exact current candidate revision.");
    }
    assertCandidateGatesFresh(task, candidate);

    if (task.status === "merging" && intent.status === "publishing") {
      try {
        await this.#worktrees.verifyCandidate(candidate);
        const pullRequest = await this.#github.publish({ task, candidate, intent });
        return this.#recordOpenPullRequest(id, pullRequest);
      } catch (error) {
        await this.#blockPullRequestPublication(id, candidate, error);
        throw error;
      }
    }

    if (task.status !== "awaiting-pr-merge" || intent.status !== "open") {
      throw new Error(operatorRequested
        ? "This task does not have an open GitHub PR that can be reconciled."
        : "The task is not awaiting a GitHub PR merge.");
    }

    let pullRequest;
    try {
      pullRequest = await this.#github.inspect(intent);
    } catch (error) {
      if (/branch identity|head moved|exact approved candidate/i.test(error.message)) {
        await this.#blockPullRequestDrift(id, candidate, error);
      } else {
        const updated = await this.#recordPullRequestPollFailure(id, error);
        if (!operatorRequested) return updated;
      }
      if (operatorRequested) throw error;
      return this.#store.get(id);
    }
    if (pullRequest.state === "merged") return this.#finalizePullRequestMerge(id, pullRequest);
    if (pullRequest.state === "closed") {
      const error = new Error(`GitHub PR #${pullRequest.number} was closed without merging the approved candidate.`);
      await this.#blockPullRequestClosed(id, candidate, pullRequest, error);
      if (operatorRequested) throw error;
      return this.#store.get(id);
    }
    const updated = await this.#updatePullRequestTelemetry(id, (draft) => {
      if (draft.status !== "awaiting-pr-merge" || draft.pullRequestIntent?.status !== "open") return;
      draft.pullRequestIntent.lastCheckedAt = now();
      draft.pullRequestIntent.lastError = null;
      draft.pullRequestIntent.consecutivePollFailures = 0;
      draft.error = null;
    });
    return operatorRequested ? this.#store.get(id) : updated;
  }

  async #recordOpenPullRequest(id, pullRequest) {
    return this.#store.transition(id, (draft) => (
      draft.status === "merging" && draft.pullRequestIntent?.status === "publishing"
    ), (draft) => {
      const candidate = currentCandidate(draft);
      const openedAt = now();
      const intent = draft.pullRequestIntent;
      Object.assign(intent, {
        ...pullRequest,
        status: "open",
        openedAt,
        lastCheckedAt: openedAt,
        lastError: null,
        consecutivePollFailures: 0,
      });
      candidate.status = "pull_request_open";
      candidate.updatedAt = openedAt;
      draft.status = "awaiting-pr-merge";
      draft.currentStage = "approval";
      draft.error = null;
      draft.blocker = null;
      draft.approvals ??= [];
      const approval = { id: crypto.randomUUID(), stage: "approval", note: intent.note, createdAt: openedAt };
      draft.approvals.push(approval);
      const artifact = {
        id: crypto.randomUUID(),
        stage: "approval",
        name: `approval-${candidate.id.toLowerCase()}-r${candidate.revisionNumber}.md`,
        kind: "markdown",
        content: `# Human approval and GitHub pull request\n\n- Candidate: ${candidate.id} revision ${candidate.revisionNumber}\n- Repository: ${intent.repository}\n- Target branch: ${intent.targetBranch}\n- PR branch: ${intent.headBranch}\n- Exact candidate head: ${candidate.headRevision}\n- Pull request: [#${intent.number}](${intent.url})\n- Approved at: ${openedAt}\n- Note: ${intent.note || "Approved without an additional note."}\n\nThe task remains open until GitHub reports this exact pull request merged.`,
        createdAt: openedAt,
        model: "Human approval",
        usage: zeroUsage(),
        candidateId: candidate.id,
        candidateRevision: candidate.revisionNumber,
      };
      draft.artifacts.push(artifact);
      draft.events.push(activity("approval", "Human approval recorded", intent.note || "Approved without an additional note.", "success", "decision", { approvalId: approval.id }));
      draft.events.push(activity("approval", "GitHub PR opened", `PR #${intent.number} tracks ${candidate.id} revision ${candidate.revisionNumber} at ${intent.url}.`, "success", "decision", { approvalId: approval.id }));
      draft.events.push(activity("approval", "Approval artifact ready", artifact.name, "success", "artifact", { artifactId: artifact.id, approvalId: approval.id }));
    });
  }

  async #finalizePullRequestMerge(id, pullRequest) {
    return this.#store.transition(id, (draft) => (
      draft.status === "awaiting-pr-merge" &&
      draft.pullRequestIntent?.status === "open" &&
      draft.pullRequestIntent.number === pullRequest.number &&
      draft.pullRequestIntent.headRevision === pullRequest.headRevision
    ), (draft) => {
      const candidate = currentCandidate(draft);
      const completedAt = pullRequest.mergedAt ?? now();
      candidate.status = "merged";
      candidate.updatedAt = completedAt;
      draft.status = "completed";
      draft.completedAt = completedAt;
      draft.currentStage = "approval";
      if (!draft.completedStages.includes("approval")) draft.completedStages.push("approval");
      Object.assign(draft.pullRequestIntent, {
        ...pullRequest,
        status: "merged",
        lastCheckedAt: now(),
        lastError: null,
        consecutivePollFailures: 0,
      });
      draft.error = null;
      draft.blocker = null;
      draft.events.push(activity(
        "approval",
        "GitHub PR merged",
        `PR #${pullRequest.number} merged ${candidate.id} revision ${candidate.revisionNumber}${pullRequest.mergeCommitRevision ? ` as ${pullRequest.mergeCommitRevision.slice(0, 8)}` : ""}. The task is complete.`,
        "success",
        "decision",
      ));
    });
  }

  async #blockPullRequestPublication(id, candidate, error) {
    await this.#store.update(id, (draft) => {
      if (draft.status !== "merging" || draft.pullRequestIntent?.status !== "publishing") return;
      const targetDiverged = error.code === "GITHUB_TARGET_DIVERGED";
      draft.status = "blocked";
      draft.error = error.message;
      draft.blocker = {
        code: targetDiverged ? "target-diverged" : "pull-request-publication",
        detail: error.message,
        detectedAt: now(),
        candidateId: candidate.id,
        candidateRevision: candidate.revisionNumber,
        candidateBaseRevision: candidate.baseRevision,
        targetRevision: error.targetRevision ?? null,
        remoteName: error.remoteName ?? draft.pullRequestIntent.remoteName ?? null,
        source: targetDiverged ? "github" : null,
      };
      if (error.remoteName) draft.pullRequestIntent.remoteName = error.remoteName;
      draft.pullRequestIntent.status = "failed";
      draft.pullRequestIntent.lastError = error.message;
      draft.events.push(activity(
        "approval",
        targetDiverged ? "GitHub target advanced" : "GitHub PR publication blocked",
        error.message,
        "danger",
        "decision",
      ));
    });
  }

  async #blockPullRequestDrift(id, candidate, error) {
    await this.#store.update(id, (draft) => {
      if (draft.status !== "awaiting-pr-merge" || draft.pullRequestIntent?.status !== "open") return;
      draft.status = "blocked";
      draft.error = error.message;
      draft.blocker = {
        code: "pull-request-drift",
        detail: error.message,
        detectedAt: now(),
        candidateId: candidate.id,
        candidateRevision: candidate.revisionNumber,
        candidateBaseRevision: candidate.baseRevision,
      };
      draft.pullRequestIntent.status = "failed";
      draft.pullRequestIntent.lastError = error.message;
      draft.events.push(activity("approval", "GitHub PR identity changed", error.message, "danger", "decision"));
    });
  }

  async #blockPullRequestClosed(id, candidate, pullRequest, error) {
    await this.#store.update(id, (draft) => {
      if (draft.status !== "awaiting-pr-merge" || draft.pullRequestIntent?.status !== "open") return;
      draft.status = "blocked";
      draft.error = error.message;
      draft.blocker = {
        code: "pull-request-closed",
        detail: error.message,
        detectedAt: now(),
        candidateId: candidate.id,
        candidateRevision: candidate.revisionNumber,
        candidateBaseRevision: candidate.baseRevision,
      };
      Object.assign(draft.pullRequestIntent, { ...pullRequest, status: "closed", lastCheckedAt: now(), lastError: error.message });
      draft.events.push(activity("approval", "GitHub PR closed", error.message, "danger", "decision"));
    });
  }

  async #recordPullRequestPollFailure(id, error) {
    return this.#updatePullRequestTelemetry(id, (draft) => {
      if (draft.status !== "awaiting-pr-merge" || draft.pullRequestIntent?.status !== "open") return;
      draft.pullRequestIntent.lastCheckedAt = now();
      draft.pullRequestIntent.lastError = error.message;
      draft.pullRequestIntent.consecutivePollFailures = (draft.pullRequestIntent.consecutivePollFailures ?? 0) + 1;
    });
  }

  async #updatePullRequestTelemetry(id, updater) {
    if (typeof this.#store.updateCore === "function") {
      return this.#store.updateCore(id, updater, { touchUpdatedAt: false });
    }
    return this.#store.update(id, updater);
  }

  async pollPullRequests() {
    const tasks = typeof this.#store.listPullRequestTasks === "function"
      ? await this.#store.listPullRequestTasks()
      : (await this.#store.list()).filter((item) => (
          (item.status === "merging" && item.pullRequestIntent?.status === "publishing") ||
          (item.status === "awaiting-pr-merge" && item.pullRequestIntent?.status === "open")
        ));
    for (let offset = 0; offset < tasks.length; offset += 4) {
      await Promise.all(tasks.slice(offset, offset + 4).map(async (task) => {
        if (this.#mergeActive.has(task.id)) return;
        this.#mergeActive.add(task.id);
        try {
          await this.#reconcilePullRequestIntent(task.id);
        } catch {
          // The exact retained state is persisted by reconciliation. Polling is best effort
          // so one unavailable repository cannot prevent other PRs from advancing.
        } finally {
          this.#mergeActive.delete(task.id);
        }
      }));
    }
  }

  async approveMerge(id, note = "") {
    if (this.#mergeActive.has(id)) throw new Error("This task already has a merge reconciliation in progress.");
    this.#mergeActive.add(id);
    return this.#approveMerge(id, note).finally(() => this.#mergeActive.delete(id));
  }

  async reconcileMerge(id) {
    if (this.#mergeActive.has(id)) throw new Error("This task already has a merge reconciliation in progress.");
    this.#mergeActive.add(id);
    return this.#reconcileMergeIntent(id, { operatorRequested: true })
      .finally(() => this.#mergeActive.delete(id));
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
      const preflightState = typeof this.#worktrees.mergeState === "function"
        ? await this.#worktrees.mergeState(candidate)
        : "pending";
      if (preflightState === "diverged") {
        await this.#store.transition(id, (draft) => (
          draft.status === "awaiting-human-approval" &&
          currentCandidate(draft).headRevision === candidate.headRevision
        ), (draft) => {
          const detectedAt = now();
          draft.status = "blocked";
          draft.error = "The target branch advanced after this candidate was created. Refresh the candidate from the target before approval.";
          draft.blocker = {
            code: "target-diverged",
            detail: draft.error,
            detectedAt,
            candidateId: candidate.id,
            candidateRevision: candidate.revisionNumber,
            candidateBaseRevision: candidate.baseRevision,
          };
          draft.events.push(activity("approval", "Target branch advanced", draft.error, "warning", "decision"));
        });
        throw new Error("The target branch advanced. Refresh the candidate from the target before approval.");
      }
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

    return this.#reconcileMergeIntent(id);
  }

  async #reconcileMergeIntent(id, { operatorRequested = false } = {}) {
    let task = await this.#store.get(id);
    if (!task) throw new Error("Task not found.");
    if (task.status === "merged-to-target" && task.mergeIntent?.status === "completed") return task;
    const retryableFailure = task.status === "blocked" &&
      task.blocker?.code === "merge-reconciliation" &&
      task.mergeIntent?.status === "failed";
    if (retryableFailure) {
      task = await this.#store.transition(id, (draft) => (
        draft.status === "blocked" &&
        draft.blocker?.code === "merge-reconciliation" &&
        draft.mergeIntent?.status === "failed"
      ), (draft) => {
        draft.status = "merging";
        draft.error = null;
        draft.blocker = null;
        draft.mergeIntent.status = "pending";
        draft.mergeIntent.error = null;
        draft.mergeIntent.reconciliationAttempts = (draft.mergeIntent.reconciliationAttempts ?? 0) + 1;
        draft.mergeIntent.lastReconciliationAt = now();
        draft.events.push(activity(
          "approval",
          "Merge reconciliation requested",
          "The original exact-candidate approval intent is retained while the target and candidate are checked again.",
          "warning",
          "decision",
        ));
      });
    } else if (task.status !== "merging" || task.mergeIntent?.status !== "pending") {
      throw new Error(operatorRequested
        ? "This task does not have a retained merge intent that can be reconciled."
        : "The task is not awaiting merge reconciliation.");
    }

    const candidate = currentCandidate(task);
    if (
      task.mergeIntent.candidateId !== candidate.id ||
      task.mergeIntent.candidateRevision !== candidate.revisionNumber ||
      task.mergeIntent.headRevision !== candidate.headRevision ||
      task.mergeIntent.baseRevision !== candidate.baseRevision
    ) {
      const error = new Error("The retained merge intent no longer matches the exact current candidate revision.");
      await this.#blockMergeIntent(id, candidate, error);
      throw error;
    }
    try {
      assertCandidateGatesFresh(task, candidate);
      const mergeState = typeof this.#worktrees.mergeState === "function"
        ? await this.#worktrees.mergeState(candidate)
        : "pending";
      if (mergeState === "diverged") throw new Error("The recorded target ref moved after merge approval was reserved.");
      if (mergeState === "pending") await this.#worktrees.merge(candidate);
      return this.#finalizeMerge(id);
    } catch (error) {
      await this.#blockMergeIntent(id, candidate, error);
      throw error;
    }
  }

  async #blockMergeIntent(id, candidate, error) {
    await this.#store.update(id, (draft) => {
      if (draft.status !== "merging" || draft.mergeIntent?.status !== "pending") return;
      const targetDiverged = /target ref (?:diverged|moved)|target branch advanced|source branch moved/i.test(error.message);
      draft.status = "blocked";
      draft.error = error.message;
      draft.blocker = {
        code: targetDiverged ? "target-diverged" : "merge-reconciliation",
        detail: error.message,
        detectedAt: now(),
        candidateId: candidate.id,
        candidateRevision: candidate.revisionNumber,
        candidateBaseRevision: candidate.baseRevision,
      };
      draft.mergeIntent.status = "failed";
      draft.mergeIntent.error = error.message;
      draft.mergeIntent.failedAt = now();
      draft.events.push(activity(
        "approval",
        targetDiverged ? "Target branch advanced" : "Merge reconciliation required",
        error.message,
        "danger",
        "decision",
      ));
    });
  }

  async recoverMergeIntents() {
    const tasks = await this.#store.list();
    for (const task of tasks.filter((item) => item.status === "merging" && item.mergeIntent?.status === "pending")) {
      try {
        await this.#reconcileMergeIntent(task.id);
      } catch {
        // Reconciliation persists its exact blocker before returning. Startup recovery is
        // deliberately best-effort so one blocked task cannot keep the companion offline.
      }
    }
  }

  async refreshCandidate(id) {
    if (this.#refreshActive.has(id) || this.#mergeActive.has(id)) {
      throw new Error("This task already has a candidate or merge reconciliation in progress.");
    }
    this.#refreshActive.add(id);
    try {
      const task = await this.#store.get(id);
      if (!task) throw new Error("Task not found.");
      const candidate = currentCandidate(task);
      const legacyTargetDivergence = task.status === "blocked" && /target ref (?:diverged|moved)|target branch advanced/i.test(task.error ?? "");
      if (task.status !== "blocked" || (task.blocker?.code !== "target-diverged" && !legacyTargetDivergence)) {
        throw new Error("The task is not blocked by an advanced target branch.");
      }
      if (!candidate?.headRevision) throw new Error("The task does not have a refreshable candidate revision.");
      let refreshed;
      try {
        const remoteTargetRevision = task.blocker?.source === "github" && typeof this.#github.fetchTarget === "function"
          ? await this.#github.fetchTarget(candidate, {
              remoteName: task.pullRequestIntent?.remoteName ?? task.blocker?.remoteName ?? "origin",
            })
          : null;
        refreshed = await this.#worktrees.refreshCandidate(candidate, remoteTargetRevision ? { targetRevision: remoteTargetRevision } : undefined);
      } catch (error) {
        if (/candidate refresh conflicted/i.test(error.message)) {
          await this.#store.update(id, (draft) => {
            const activeCandidate = currentCandidate(draft);
            if (activeCandidate.id !== candidate.id || activeCandidate.revisionNumber !== candidate.revisionNumber) return;
            draft.status = "blocked";
            draft.error = error.message;
            draft.blocker = {
              code: "target-refresh-conflict",
              detail: error.message,
              detectedAt: now(),
              candidateId: candidate.id,
              candidateRevision: candidate.revisionNumber,
              candidateBaseRevision: candidate.baseRevision,
            };
            draft.events.push(activity(
              "implement",
              "Candidate refresh needs a clean rebuild",
              "The target and retained patch overlap. Re-run the approved work packages from the latest target instead of guessing a conflict resolution.",
              "warning",
              "decision",
            ));
          });
        }
        throw error;
      }
      const nextRevision = candidate.revisionNumber + 1;
      try {
        return await this.#store.transition(id, (draft) => {
          const activeCandidate = currentCandidate(draft);
          return draft.status === "blocked" &&
            activeCandidate.id === candidate.id &&
            activeCandidate.revisionNumber === candidate.revisionNumber &&
            activeCandidate.baseRevision === refreshed.previousBaseRevision &&
            activeCandidate.headRevision === refreshed.previousHeadRevision;
        }, (draft) => {
          const activeCandidate = currentCandidate(draft);
          activeCandidate.revisionNumber = nextRevision;
          activeCandidate.baseRevision = refreshed.targetRevision;
          activeCandidate.headRevision = refreshed.headRevision;
          activeCandidate.status = "ready_for_review";
          activeCandidate.updatedAt = now();
          activeCandidate.revisions.push({
            number: nextRevision,
            headRevision: refreshed.headRevision,
            reason: "target-refresh",
            previousBaseRevision: refreshed.previousBaseRevision,
            previousHeadRevision: refreshed.previousHeadRevision,
            baseRevision: refreshed.targetRevision,
            createdAt: now(),
          });
          draft.status = "ready-for-review";
          draft.currentStage = "dev-review";
          draft.error = null;
          draft.blocker = null;
          if (draft.mergeIntent) {
            draft.mergeIntentHistory ??= [];
            draft.mergeIntentHistory.push({
              ...structuredClone(draft.mergeIntent),
              status: "failed",
              error: draft.mergeIntent.error ?? "The target advanced; the approved candidate revision was superseded by target refresh.",
              supersededAt: now(),
              supersededByCandidateRevision: nextRevision,
            });
          }
          draft.mergeIntent = null;
          if (draft.pullRequestIntent) {
            draft.pullRequestIntentHistory ??= [];
            draft.pullRequestIntentHistory.push({
              ...structuredClone(draft.pullRequestIntent),
              status: "failed",
              lastError: draft.pullRequestIntent.lastError ?? "The GitHub target advanced; this PR intent was superseded by target refresh.",
              supersededAt: now(),
              supersededByCandidateRevision: nextRevision,
            });
          }
          draft.pullRequestIntent = null;
          draft.completedStages = draft.completedStages.filter(
            (stage) => !["dev-review", "test", "final-review", "approval"].includes(stage),
          );
          refreshGateFreshness(draft);
          draft.events.push(activity(
            "implement",
            "Candidate refreshed from target",
            refreshed.alreadyApplied
              ? `${candidate.id} revision ${nextRevision} records that its complete patch is already present at target ${refreshed.targetRevision.slice(0, 8)}. Every candidate-bound gate must still pass again.`
              : `${candidate.id} revision ${nextRevision} now starts from ${refreshed.targetRevision.slice(0, 8)} and must pass every candidate-bound gate again.`,
            "success",
            "decision",
          ));
        });
      } catch (error) {
        if (typeof this.#worktrees.recoverCandidate === "function") await this.#worktrees.recoverCandidate(candidate);
        throw error;
      }
    } finally {
      this.#refreshActive.delete(id);
    }
  }

  async rebuildCandidateFromTarget(id) {
    if (this.#refreshActive.has(id) || this.#mergeActive.has(id)) {
      throw new Error("This task already has a candidate or merge reconciliation in progress.");
    }
    this.#refreshActive.add(id);
    try {
      const task = await this.#store.get(id);
      if (!task) throw new Error("Task not found.");
      const candidate = currentCandidate(task);
      if (task.status !== "blocked" || task.blocker?.code !== "target-refresh-conflict") {
        throw new Error("The task is not blocked by a candidate refresh conflict.");
      }
      if (task.activeRunKind || task.activeRunReservationId) {
        throw new Error("Wait for the active run before rebuilding this candidate.");
      }
      if (typeof this.#worktrees.mergeState !== "function" || await this.#worktrees.mergeState(candidate) !== "diverged") {
        throw new Error("The candidate target is no longer diverged; refresh task state before rebuilding.");
      }
      return await this.#store.transition(id, (draft) => {
        const activeCandidate = currentCandidate(draft);
        return draft.status === "blocked" &&
          draft.blocker?.code === "target-refresh-conflict" &&
          activeCandidate.id === candidate.id &&
          activeCandidate.revisionNumber === candidate.revisionNumber &&
          activeCandidate.headRevision === candidate.headRevision;
      }, (draft) => {
        const activeCandidate = currentCandidate(draft);
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
        const attempts = draft.attemptsByStage?.implement ?? 0;
        draft.stageRunLimits ??= {};
        draft.stageRunLimits.implement = Math.max(stageRunLimitFor(draft, "implement"), attempts + 1);
        draft.status = "ready-for-implementation";
        draft.currentStage = "implement";
        draft.error = null;
        draft.blocker = null;
        draft.mergeIntent = null;
        draft.completedStages = draft.completedStages.filter(
          (stage) => !["implement", "dev-review", "test", "final-review", "approval"].includes(stage),
        );
        refreshGateFreshness(draft);
        draft.events.push(activity(
          "implement",
          "Clean candidate rebuild authorized",
          `${candidate.id} remains retained for audit. The approved packages will run again from the latest target and assemble a new candidate.`,
          "warning",
          "decision",
        ));
      });
    } finally {
      this.#refreshActive.delete(id);
    }
  }

  async restartImplementationFromTarget(id) {
    if (this.#refreshActive.has(id) || this.#mergeActive.has(id)) {
      throw new Error("This task already has a candidate or target reconciliation in progress.");
    }
    this.#refreshActive.add(id);
    try {
      const task = await this.#store.get(id);
      if (!task) throw new Error("Task not found.");
      if (!['failed', 'blocked'].includes(task.status) || task.currentStage !== "implement") {
        throw new Error("The task is not stopped during implementation.");
      }
      if (task.activeRunKind || task.activeRunReservationId) {
        throw new Error("Wait for the active run before restarting implementation.");
      }
      if (task.candidates?.length) {
        throw new Error("This task already has a candidate; use candidate refresh or rebuild instead.");
      }
      const target = await this.#worktrees.base(task, { allowDirty: true });
      const attemptedBases = new Set(
        (task.workPackages ?? []).map((workPackage) => workPackage.baseRevision).filter(Boolean),
      );
      if (!attemptedBases.size || [...attemptedBases].every((revision) => revision === target.baseRevision)) {
        throw new Error("The implementation packages already use the latest target revision.");
      }
      return await this.#store.transition(id, (draft) => (
        ['failed', 'blocked'].includes(draft.status) &&
        draft.currentStage === "implement" &&
        !draft.activeRunKind &&
        !draft.activeRunReservationId &&
        !(draft.candidates?.length)
      ), (draft) => {
        for (const workPackage of draft.workPackages ?? []) {
          workPackage.status = "planned";
          workPackage.error = null;
          workPackage.retainedContinuation = null;
          workPackage.retainedForRequalification = false;
          workPackage.retainedReplacementReason = null;
          workPackage.verificationRuns = [];
        }
        const attempts = draft.attemptsByStage?.implement ?? 0;
        draft.stageRunLimits ??= {};
        draft.stageRunLimits.implement = Math.max(stageRunLimitFor(draft, "implement"), attempts + 1);
        draft.status = "ready-for-implementation";
        draft.error = null;
        draft.blocker = null;
        draft.events.push(activity(
          "implement",
          "Implementation restart authorized from latest target",
          `Prior slice artifacts remain retained. Approved packages will restart from ${target.baseRevision.slice(0, 8)} with bounded concurrency and fresh qualification.`,
          "warning",
          "decision",
        ));
      });
    } finally {
      this.#refreshActive.delete(id);
    }
  }

  async retryTestOnSameCandidate(id) {
    const started = await this.start(id, "test", {
      canStart: (draft) => {
        sameCandidateTestRetryContext(draft);
        return true;
      },
      onReserve: (draft) => {
        const context = sameCandidateTestRetryContext(draft);
        context.verification.retryDisposition = "human-rerun-requested";
        context.verification.retryRequestedAt = now();
        draft.sameCandidateTestRetries ??= [];
        draft.sameCandidateTestRetries.push({
          id: crypto.randomUUID(),
          candidateId: context.candidate.id,
          candidateRevision: context.candidate.revisionNumber,
          candidateHeadRevision: context.candidate.headRevision,
          failedVerificationCompletedAt: context.verification.completedAt ?? null,
          requestedAt: now(),
        });
        const attempts = draft.attemptsByStage?.test ?? 0;
        draft.stageRunLimits ??= {};
        draft.stageRunLimits.test = Math.max(stageRunLimitFor(draft, "test"), attempts + 1);
        context.candidate.status = "ready_for_test";
        draft.status = "ready-for-test";
        draft.currentStage = "test";
        draft.error = null;
        draft.blocker = null;
        draft.completedStages = draft.completedStages.filter((stage) => !["test", "final-review", "approval"].includes(stage));
        refreshGateFreshness(draft);
        draft.events.push(activity(
          "test",
          "Same-candidate Test retry authorized",
          `${context.candidate.id} revision ${context.candidate.revisionNumber} is unchanged. The failed full manifest will run once more without authorizing candidate repair.`,
          "warning",
          "decision",
        ));
      },
    });
    if (!started) throw new Error("The same-candidate Test retry could not be reserved.");
    return { started: true };
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
    if (candidate?.status !== "merged") throw new Error("The task does not have a merged candidate to promote.");
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
      if (kind === "review") await this.#runReviewWithFastRepair(id, signal);
      if (kind === "test") await this.#runEvaluation(id, "test", signal);
      if (kind === "final-review") await this.#runEvaluation(id, "final-review", signal);
    } catch (error) {
      let implementationTargetDrift = null;
      if (kind === "implementation") {
        try {
          const stoppedTask = await this.#store.get(id);
          const latestTarget = await this.#worktrees.base(stoppedTask, { allowDirty: true });
          const attemptedBases = new Set(
            (stoppedTask.workPackages ?? []).map((workPackage) => workPackage.baseRevision).filter(Boolean),
          );
          if (attemptedBases.size && [...attemptedBases].some((revision) => revision !== latestTarget.baseRevision)) {
            implementationTargetDrift = latestTarget.baseRevision;
          }
        } catch { /* Preserve the original implementation failure when target inspection is unavailable. */ }
      }
      await this.#store.update(id, (draft) => {
        const failedKind = draft.activeRunKind ?? kind;
        const stage = stageForRun(failedKind, draft.currentStage);
        const attempts = draft.attemptsByStage?.[stage] ?? 1;
        const fastReplanRequired = error?.code === "FAST_PROFILE_REPLAN_REQUIRED";
        draft.currentStage = fastReplanRequired ? "scouts" : stage;
        draft.status = signal.aborted ? "cancelled" : attempts >= stageRunLimitFor(draft, stage) ? "blocked" : "failed";
        if (fastReplanRequired) {
          draft.stageDispositions = {};
          const affectedPackage = draft.workPackages?.find((workPackage) => workPackage.id === error.workPackageId);
          if (affectedPackage) {
            affectedPackage.status = "failed";
            affectedPackage.error = error.message;
          }
        }
        draft.error = error.message;
        if (implementationTargetDrift) {
          draft.status = "blocked";
          draft.blocker = {
            code: "implementation-target-diverged",
            detail: `The target advanced to ${implementationTargetDrift}. Restart approved packages from the latest target instead of continuing historical slices.`,
            detectedAt: now(),
            targetRevision: implementationTargetDrift,
          };
        }
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
          }[failedKind];
          if (candidateStatus) candidate.status = candidateStatus;
        }
        refreshGateFreshness(draft);
        draft.events.push(activity(
          fastReplanRequired ? "scouts" : stage,
          signal.aborted ? "Run cancelled" : fastReplanRequired ? "Full workflow evidence required" : "Stage failed",
          error.message,
          "danger",
        ));
      });
    }
  }

  async #runInvestigation(id, signal) {
    let task = await this.#store.get(id);
    if (!task.completedStages.includes("triage")) {
      if (signal.aborted) throw new Error("Codex run cancelled.");
      await this.#reserveInvestigationStage(id, "triage");
      task = await this.#store.get(id);
      const result = await this.#executeAgent(task, "triage", signal, task.repositoryPath, "read-only");
      throwIfAborted(signal);
      await this.#retainAgentResult(id, "triage", result, { replace: true });
    }

    task = await this.#store.get(id);
    if (task.workflowProfile?.selected === "fast") {
      const triageArtifact = [...task.artifacts].reverse().find((artifact) => artifact.stage === "triage");
      let contract = null;
      try {
        contract = parseFastChangeContract(triageArtifact?.content, task.repositoryPath);
      } catch (error) {
        await this.#escalateProfile(id, {
          target: "standard",
          reason: `Fast automatically escalated to standard because triage did not produce a valid bounded change contract: ${error.message}`,
        }, "triage");
      }
      if (contract) {
        const escalation = fastEscalation({
          profile: "fast",
          kind: "triage",
          text: triageArtifact?.content,
          riskSignals: contract.riskSignals,
          unresolvedDecisions: contract.unresolvedDecisions,
          ownedPaths: contract.ownedPaths,
        });
        if (escalation) await this.#escalateProfile(id, escalation, "triage");
      }
      task = await this.#store.get(id);
      if (contract && task.workflowProfile?.selected === "fast") {
        const dispatch = selectScoutDispatch(task, triageArtifact?.content ?? "").selected;
        if (dispatch.length) {
          await this.#reserveInvestigationStage(id, "scouts");
          await this.#runScouts(id, await this.#store.get(id), signal);
          const scoutArtifact = [...(await this.#store.get(id)).artifacts].reverse().find((artifact) => artifact.name === "repository-scout.md");
          const scoutEscalation = fastEscalation({
            profile: "fast",
            kind: "triage",
            text: scoutArtifact?.content,
            ownedPaths: contract.ownedPaths,
          });
          if (scoutEscalation) await this.#escalateProfile(id, scoutEscalation, "scouts");
        } else {
          await this.#store.update(id, (draft) => {
            draft.scoutDispatch = {
              selected: [],
              skipped: scoutCatalog().map((scout) => scout.id),
              rationale: "Fast profile had no unresolved repository fact, so no scout model was invoked.",
              createdAt: now(),
              completedAt: now(),
            };
            draft.stageDispositions.scouts = {
              status: "not-required",
              reason: "No unresolved repository fact remained after bounded triage; zero scouts is the fast-path default.",
              decidedAt: now(),
            };
            draft.events.push(activity("scouts", "Repository scouts not required", draft.stageDispositions.scouts.reason, "info", "decision"));
          });
        }
        task = await this.#store.get(id);
        if (task.workflowProfile?.selected === "fast") {
          await this.#store.update(id, (draft) => {
            draft.workPackages = [contract.workPackage];
            for (const [stage, reason] of Object.entries({
              grill: "Authoritative acceptance criteria contained no unresolved product decision, so Grill Me was not invoked.",
              specification: "The bounded fast change contract carries the acceptance criteria; a separate Specification model call is not required.",
              plan: "The bounded fast change contract defines exactly one package and its focused manifest command IDs; a separate Plan model call is not required.",
            })) {
              draft.stageDispositions[stage] = { status: "not-required", reason, decidedAt: now() };
              draft.events.push(activity(stage, `${getStageMetadata(stage).label} not required`, reason, "info", "decision"));
            }
            draft.status = "awaiting-plan-approval";
            draft.currentStage = "plan";
            draft.activeRunKind = null;
            draft.activeRunReservationId = null;
            draft.error = null;
            draft.events.push(activity("plan", "Bounded fast change ready", "Approve the one-package contract or change the workflow profile before implementation.", "success", "decision"));
          });
          return;
        }
      }
    }

    task = await this.#store.get(id);
    const stages = ["scouts", "grill"].filter((stage) => !task.completedStages.includes(stage));
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
      const grillQuestions = parseGrillQuestions(result.finalText);
      await this.#retainAgentResult(id, stageId, result, {
        replace: true,
        complete: grillQuestions.length === 0,
      });
      await this.#store.update(id, (draft) => {
        draft.grillSession = {
          status: grillQuestions.length ? "open" : "completed",
          questions: grillQuestions,
          createdAt: now(),
          completedAt: grillQuestions.length ? null : now(),
          completionReason: grillQuestions.length ? null : "No material product decisions remained after repository investigation.",
          completionSource: grillQuestions.length ? null : "no-questions",
          policySnapshot: draft.grillPolicy ?? "manual",
          acceptedRecommendationCount: 0,
        };
      });
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
    if (task.grillSession?.status === "open" && task.grillPolicy === "auto-accept-recommendations") {
      await this.#store.update(id, (draft) => {
        completeGrillSession(draft, { source: "automation-policy", acceptRemaining: true });
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
      const verificationManifest = await this.#readVerificationManifest(task.repositoryPath);
      for (const workPackage of workPackages) {
        selectVerificationCommands(verificationManifest, workPackage.verificationCommandIds);
      }
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
    const profileEscalation = fastEscalation({
      profile: task.workflowProfile?.selected,
      kind: "plan",
      packageCount: workPackages.length,
      dependencyCount: workPackages.reduce((total, workPackage) => total + workPackage.dependencies.length, 0),
    });
    if (profileEscalation) await this.#escalateProfile(id, profileEscalation, "plan");
    const retainedDispositions = new Map();
    if (typeof this.#worktrees.retainedPatchDisposition === "function") {
      try {
        const targetRevision = (await this.#worktrees.base(task, { allowDirty: true })).baseRevision;
        for (const workPackage of workPackages) {
          const prior = task.workPackages?.find((item) => item.id === workPackage.id);
          if (!retainedSliceCanBeRequalified(prior, workPackage)) continue;
          try {
            retainedDispositions.set(
              workPackage.id,
              await this.#worktrees.retainedPatchDisposition(
                { ...prior, repositoryRoot: task.repositoryPath },
                targetRevision,
              ),
            );
          } catch {
            retainedDispositions.set(workPackage.id, "conflicts");
          }
        }
      } catch { /* Test seams without a repository retain the conservative requalification path. */ }
    }
    await this.#retainAgentResult(id, "plan", result, artifactOptions);
    await this.#store.update(id, (draft) => {
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
    await this.#assertExecutablePlan(task);
    const retainedPackage = task.workPackages.find((item) =>
      item.retainedContinuation || item.retainedForRequalification || item.retainedReplacementReason,
    );
    // Implementation is isolated from the operator's checkout at an exact committed
    // HEAD. Unrelated local edits must remain untouched, but they do not make that
    // commit unsafe to use as a worktree base. Human Approval still requires the
    // target checkout to be clean before merge.
    const base = await this.#worktrees.base(task, { allowDirty: true });
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
      const outcomes = await allSettledWithConcurrency(
        packages,
        this.#packageConcurrency,
        (workPackage) => this.#runWorkPackage(id, workPackage.id, base.baseRevision, signal),
      );
      const failures = outcomes
        .map((outcome, index) => ({ outcome, workPackage: packages[index] }))
        .filter((entry) => entry.outcome.status === "rejected");
      if (failures.length) {
        const fastReplan = failures.find((entry) => entry.outcome.reason?.code === "FAST_PROFILE_REPLAN_REQUIRED");
        if (fastReplan) throw fastReplan.outcome.reason;
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
    const candidate = await this.#worktrees.prepare(task, candidateId, {
      baseRevision: base.baseRevision,
      allowHistoricalBase: Boolean(retainedPackage),
      allowDirtySource: true,
    });
    candidate.status = "assembling";
    candidate.verificationRuns = [];
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
    if (workPackage.retainedForRequalification) {
      await this.#requalifyRetainedWorkPackage(id, workPackageId, signal);
      return;
    }
    const retainedContinuation = workPackage.retainedContinuation ?? null;
    const attempt = retainedContinuation ? workPackage.attempts : workPackage.attempts + 1;
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
      if (workPackage.worktreePath && !retainedContinuation) {
        await this.#cleanupSliceWorktree(id, task, workPackage.worktreePath);
      }
      const slice = retainedContinuation
        ? {
            id: sliceId,
            baseRevision: workPackage.baseRevision,
            branch: workPackage.branch,
            worktreePath: workPackage.worktreePath,
            headRevision: workPackage.headRevision,
          }
        : await this.#worktrees.prepare(task, sliceId, {
            baseRevision,
            dependencyRevisions,
            branchId: sliceId,
            allowHistoricalBase: Boolean(workPackage.retainedReplacementReason),
            allowDirtySource: true,
          });
      if (retainedContinuation) {
        await this.#worktrees.inspectRetainedSlice(workPackage, { requireClean: false });
      }
      await this.#store.update(id, (draft) => {
        const target = draft.workPackages.find((item) => item.id === workPackageId);
        target.status = "running";
        if (!retainedContinuation) target.attempts = attempt;
        target.branch = slice.branch;
        target.worktreePath = slice.worktreePath;
        target.baseRevision = slice.baseRevision;
        target.error = null;
        draft.events.push(activity(
          "implement",
          retainedContinuation ? `${workPackageId} retained agent resumed` : `${workPackageId} agent started`,
          `${slice.branch} in dependency batch ${target.batch}.`,
          "info",
          "agent",
        ));
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
      const committed = await this.#worktrees.commit(
        slice,
        `agent-harness(${task.id}): ${workPackageId} ${currentPackage.title}`,
        {
          ownedPaths: currentPackage.ownedPaths,
          allowNoChanges: Boolean(noChangesNeeded),
          squashFromBase: Boolean(retainedContinuation && workPackage.headRevision),
        },
      );
      const packageHeadRevision = committed.headRevision ?? slice.baseRevision;
      await this.#store.update(id, (draft) => {
        const target = draft.workPackages.find((item) => item.id === workPackageId);
        target.headRevision = committed.headRevision;
        target.files = committed.files;
      });
      const pathEscalation = fastEscalation({
        profile: task.workflowProfile?.selected,
        kind: "changed-paths",
        files: committed.files,
      });
      if (pathEscalation) {
        await this.#escalateProfile(id, pathEscalation, "implement");
        throw new FastProfileReplanError(
          `${pathEscalation.reason} Resume investigation so standard scout, decision, specification, and plan evidence replaces the abbreviated fast contract before more implementation.`,
          workPackageId,
        );
      }
      let qualification = null;
      if (this.#runPackageVerification) {
        qualification = await this.#qualifyPackage({
          worktreePath: slice.worktreePath,
          workPackage: currentPackage,
          workPackageId,
          attempt,
          headRevision: packageHeadRevision,
          signal,
        });
        throwIfAborted(signal);
        await this.#store.update(id, (draft) => {
          const target = draft.workPackages.find((item) => item.id === workPackageId);
          target.verificationRuns ??= [];
          target.verificationRuns.push(qualification);
          target.headRevision = committed.headRevision;
          target.files = committed.files;
        });
        if (qualification.status !== "passed") {
          const verificationEscalation = fastEscalation({
            profile: (await this.#store.get(id)).workflowProfile?.selected,
            kind: "verification-failure",
          });
          if (verificationEscalation) await this.#escalateProfile(id, verificationEscalation, "implement");
          const failedEvidence = `## Harness slice evidence\n\n- Work package: ${workPackageId}\n- Attempt: ${attempt}\n- Base: ${slice.baseRevision}\n- Package commit tested: ${packageHeadRevision}\n- Branch: ${slice.branch}\n- Changed files: ${committed.files.length}`;
          const content = `${result.finalText}\n\n${workPackageVerificationMarkdown(qualification)}\n\n${failedEvidence}`;
          await this.#retainAgentResult(id, "implement", { ...result, finalText: content }, {
            complete: false,
            replace: false,
            name: `slice-${workPackageId.toLowerCase()}-a${attempt}.md`,
            workPackageId,
            focusedTestEvidence: qualification,
            artifactTitle: `${workPackageId} qualification failed`,
            artifactTone: "danger",
          });
          if (verificationEscalation) {
            throw new FastProfileReplanError(
              `${verificationEscalation.reason} Resume investigation so the standard workflow records fresh scout, decision, specification, and plan evidence before implementation retries.`,
              workPackageId,
            );
          }
          const failed = qualification.rows?.find((row) => row.status !== "passed");
          throw new Error(
            `${workPackageId} did not qualify: ${failed?.id ?? "repository verification"} failed${failed?.failureDetails ? ` — ${failed.failureDetails}` : "."}`,
          );
        }
      }
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
        target.verificationRuns ??= qualification ? [qualification] : [];
        target.error = null;
        target.retainedContinuation = null;
        target.retainedReplacementReason = null;
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

  async #requalifyRetainedWorkPackage(id, workPackageId, signal) {
    let task = await this.#store.get(id);
    const workPackage = task.workPackages.find((item) => item.id === workPackageId);
    if (!workPackage?.headRevision || !workPackage.worktreePath) {
      throw new Error(`${workPackageId} has no exact retained slice to requalify.`);
    }
    const retained = await this.#worktrees.inspectRetainedSlice(workPackage, {
      ownedPaths: workPackage.ownedPaths,
      requireClean: true,
    });
    throwIfAborted(signal);
    const manifestSourceRevision = (await this.#worktrees.base(task, { allowDirty: true })).baseRevision;
    const manifest = await this.#readVerificationManifestAtRevision(
      task.repositoryPath,
      manifestSourceRevision,
    );
    const qualification = await this.#qualifyPackage({
      worktreePath: retained.worktreePath,
      workPackage,
      workPackageId,
      attempt: workPackage.attempts,
      headRevision: retained.headRevision,
      signal,
      manifest,
    });
    qualification.manifestSourceRevision = manifestSourceRevision;
    throwIfAborted(signal);
    if (qualification.status !== "passed") {
      await this.#store.update(id, (draft) => {
        const target = draft.workPackages.find((item) => item.id === workPackageId);
        target.verificationRuns ??= [];
        target.verificationRuns.push(qualification);
        target.status = "failed";
        target.error = `${workPackageId} retained slice did not qualify under the corrected verification plan.`;
      });
      const failed = qualification.rows?.find((row) => row.status !== "passed");
      throw new Error(
        `${workPackageId} retained slice did not qualify: ${failed?.id ?? "repository verification"} failed${failed?.failureDetails ? ` — ${failed.failureDetails}` : "."}`,
      );
    }
    const startedAt = now();
    let runId = null;
    await this.#store.update(id, (draft) => {
      const reservation = requireActiveRunReservation(draft, "implementation", "implement");
      const run = beginAgentRun(draft, {
        kind: "implementation",
        provider: reservation.provider,
        stage: "implement",
        role: "implement",
        model: null,
        reasoning: null,
        startedAt,
        candidateId: null,
        candidateRevision: null,
        candidateHeadRevision: null,
        workPackageId,
        workflowAttempt: reservation.workflowAttempt,
        workflowReservationId: reservation.id,
      });
      run.source = "harness-requalification";
      runId = run.id;
      completeAgentRun(draft, run.id, {
        status: "completed",
        completedAt: now(),
        durationMs: qualification.durationMs ?? 0,
        usage: null,
        runtimeEvents: [],
        error: null,
      });
    });
    const content = `## Outcome\n\n${workPackageId} reused its exact clean retained commit after the corrected repository verification plan passed. No model implementation was rerun.\n\n${workPackageVerificationMarkdown(qualification)}\n\n## Harness retained-slice evidence\n\n- Work package: ${workPackageId}\n- Base: ${workPackage.baseRevision}\n- Package commit: ${retained.headRevision}\n- Branch: ${retained.branch}\n- Verification manifest source revision: ${manifestSourceRevision}\n- Changed files: ${retained.files.length}`;
    await this.#retainAgentResult(id, "implement", {
      runId,
      finalText: content,
      startedAt,
      completedAt: now(),
      durationMs: qualification.durationMs ?? 0,
      usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0 },
      runtimeEvents: [],
    }, {
      synthetic: true,
      complete: false,
      replace: false,
      name: `slice-${workPackageId.toLowerCase()}-retained-requalification.md`,
      workPackageId,
      focusedTestEvidence: qualification,
      artifactTitle: `${workPackageId} retained slice requalified`,
    });
    task = await this.#store.get(id);
    await this.#cleanupSliceWorktree(id, task, retained.worktreePath);
    await this.#store.update(id, (draft) => {
      const target = draft.workPackages.find((item) => item.id === workPackageId);
      target.status = "ready_for_integration";
      target.verificationRuns ??= [];
      target.verificationRuns.push(qualification);
      target.error = null;
      target.retainedForRequalification = false;
      draft.events.push(activity(
        "implement",
        `${workPackageId} retained commit ready for integration`,
        `${retained.headRevision.slice(0, 8)} passed the corrected focused repository verification without another model implementation run.`,
        "success",
        "decision",
      ));
    });
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

  async #escalateProfile(id, escalation, stage) {
    await this.#store.update(id, (draft) => {
      const prior = draft.workflowProfile?.selected ?? "standard";
      if (!recordWorkflowProfile(draft, escalation.target, escalation.reason, "automatic-escalation")) return;
      draft.models = [...new Set(Object.values(draft.agentConfig.stagePolicies ?? {}).map((policy) => policy.model))]
        .map((model) => ({ provider: "openai", model }));
      draft.events.push(activity(
        stage,
        "Workflow profile escalated",
        `${prior} → ${escalation.target}. ${escalation.reason}`,
        "warning",
        "decision",
        { workflowProfile: escalation.target, priorWorkflowProfile: prior },
      ));
    });
  }

  async #completeDeterministicFastGates(id, candidate, verification) {
    await this.#store.update(id, (draft) => {
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
      const testGateResult = deterministicGateResult("test", candidate, testPassed, testPassed
        ? []
        : ["The full repository verification manifest contains a failed command."]);
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
        if (escalation && recordWorkflowProfile(draft, escalation.target, escalation.reason, "automatic-escalation")) {
          draft.models = [...new Set(Object.values(draft.agentConfig.stagePolicies ?? {}).map((policy) => policy.model))]
            .map((model) => ({ provider: "openai", model }));
        }
        activeCandidate.status = "repair_required";
        draft.status = "repair-required";
        draft.currentStage = "test";
        draft.events.push(activity("test", "Candidate requires repair", "The exact candidate failed the recorded full repository manifest.", "danger", "decision", runEventMetadata(attachedTestRun, { artifactId: testArtifact.id })));
        return;
      }
      if (!draft.completedStages.includes("test")) draft.completedStages.push("test");
      draft.events.push(activity("test", "Focused Test passed", "The harness accepted the recorded full-manifest result without a model interpretation call.", "success", "decision", runEventMetadata(attachedTestRun, { artifactId: testArtifact.id })));

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
        reason: "Generated mechanically from the exact candidate, independent Dev Review, and recorded full-manifest result because no unresolved blocking risk remained.",
        decidedAt: finalCompletedAt,
      };
      activeCandidate.status = "awaiting_human_approval";
      activeCandidate.updatedAt = finalCompletedAt;
      draft.status = "awaiting-human-approval";
      draft.currentStage = "approval";
      draft.activeRunKind = null;
      draft.activeRunReservationId = null;
      draft.events.push(activity("final-review", "Deterministic Final Review passed", `${candidate.id} revision ${candidate.revisionNumber} advanced without another model call.`, "success", "decision", runEventMetadata(attachedFinalRun, { artifactId: finalArtifact.id })));
    });
  }

  async #runReviewWithFastRepair(id, signal) {
    await this.#runEvaluation(id, "dev-review", signal);
    let task = await this.#store.get(id);
    const candidate = task.candidates?.at(-1);
    const repairCount = candidate?.revisions?.filter((revision) => revision.reason === "repair").length ?? 0;
    if (
      task.workflowProfile?.selected !== "fast" ||
      task.status !== "repair-required" ||
      task.currentStage !== "dev-review" ||
      candidate?.status !== "repair_required" ||
      repairCount !== 0
    ) return;

    await this.#store.transition(id, (draft) => (
      draft.workflowProfile?.selected === "fast" &&
      draft.status === "repair-required" &&
      currentCandidate(draft).status === "repair_required" &&
      (currentCandidate(draft).revisions ?? []).every((revision) => revision.reason !== "repair")
    ), (draft) => {
      draft.automaticRepairCycles = (draft.automaticRepairCycles ?? 0) + 1;
      reserveRun(draft, "repair");
      draft.events.push(activity("implement", "Automatic fast repair started", "The first consolidated Development Review defect is receiving the one allowed automatic repair cycle.", "warning", "decision"));
    });
    await this.#runRepair(id, signal);
    task = await this.#store.get(id);
    if (task.status !== "ready-for-review") return;
    await this.#store.transition(id, (draft) => draft.status === "ready-for-review", (draft) => {
      reserveRun(draft, "review");
      draft.events.push(activity("dev-review", "Automatic fresh review started", "The repaired candidate revision must earn a new independent Development Review verdict.", "info", "decision"));
    });
    await this.#runEvaluation(id, "dev-review", signal);
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
      harnessVerification = [...(candidate.verificationRuns ?? [])].reverse().find((verification) =>
        verification.executionKind === "full-manifest" &&
        verification.candidateId === candidate.id &&
        verification.candidateRevision === candidate.revisionNumber &&
        verification.headRevision === candidate.headRevision &&
        verification.retryDisposition !== "human-rerun-requested"
      ) ?? null;
      if (harnessVerification) {
        await this.#store.update(id, (draft) => {
          draft.events.push(activity(
            "test",
            "Full verification manifest reused",
            `${candidate.id} revision ${candidate.revisionNumber} already has one exact-revision manifest execution; the recorded result is reused without rerunning commands.`,
            "info",
            "test",
          ));
        });
      } else {
        harnessVerification = await this.#runVerification({
          worktreePath: candidate.worktreePath,
          candidate,
          executionKind: "full-manifest",
          signal,
        });
        await this.#store.update(id, (draft) => {
          const activeCandidate = currentCandidate(draft);
          activeCandidate.verificationRuns ??= [];
          activeCandidate.verificationRuns.push(harnessVerification);
          draft.events.push(activity(
            "test",
            "Full verification manifest executed",
            `${activeCandidate.id} revision ${activeCandidate.revisionNumber} ran ${harnessVerification.rows.length} command${harnessVerification.rows.length === 1 ? "" : "s"} in ${harnessVerification.durationMs}ms.`,
            harnessVerification.status === "passed" ? "success" : "danger",
            "test",
          ));
        });
      }
      throwIfAborted(signal);
      if (task.workflowProfile?.selected === "fast") {
        await this.#completeDeterministicFastGates(id, candidate, validateFocusedTestEvidence(harnessVerification, candidate));
        return;
      }
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
    const reviewerToolingFailure = modelCommandFailed(result.runtimeEvents);
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
    // Model-run shell commands are diagnostics, never candidate verification. A
    // failure still fails closed, but it can only request a bounded rerun of this
    // read-only gate; it can never authorize candidate Repair, even when the model's
    // narrative also says REPAIR.
    if (!evidenceError && reviewerToolingFailure) {
      evidenceError = {
        code: "review_tooling_failure",
        copy: RUNTIME_FRESHNESS_REASONS.review_tooling_failure,
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
        ...(reviewerToolingFailure
          ? ["A reviewer diagnostic command failed; no candidate defect was inferred from that telemetry."]
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
        const authoritativeFailedTest = stageId === "test" &&
          focusedTestEvidence?.status === "failed" &&
          gateFailure.freshness.reasonCode === "repair_required";
        const blockingFindings = authoritativeRun?.gateResult?.findings?.filter((finding) => finding.blocking === true) ?? [];
        const reviewRetryRequired = ["dev-review", "final-review"].includes(stageId) &&
          gateFailure.freshness.reasonCode !== "repair_required" &&
          blockingFindings.length === 0;
        if ((evidenceError || reviewRetryRequired) && !authoritativeFailedTest) {
          const rerunState = evaluationRerunState(stageId);
          activeCandidate.status = rerunState.candidateStatus;
          draft.status = rerunState.taskStatus;
          draft.currentStage = stageId;
          if (["dev-review", "final-review"].includes(stageId)) {
            draft.reviewRetries ??= [];
            const repeatedReason = draft.reviewRetries.some((retry) =>
              retry.stage === stageId &&
              retry.candidateId === activeCandidate.id &&
              retry.candidateRevision === activeCandidate.revisionNumber &&
              retry.reasonCode === gateFailure.freshness.reasonCode,
            );
            draft.reviewRetries.push({
              stage: stageId,
              candidateId: activeCandidate.id,
              candidateRevision: activeCandidate.revisionNumber,
              runId: authoritativeRun?.id ?? null,
              reasonCode: gateFailure.freshness.reasonCode,
              reason: gateFailure.freshness.reasonCopy,
              createdAt: now(),
            });
            if (repeatedReason) {
              const attempts = draft.attemptsByStage?.[stageId] ?? 0;
              draft.stageRunLimits ??= {};
              draft.stageRunLimits[stageId] = Math.min(stageRunLimitFor(draft, stageId), attempts);
              draft.error = `${getStageMetadata(stageId).label} repeated ${gateFailure.freshness.reasonCode} for the same candidate revision. A human must inspect the retained telemetry before granting another attempt; candidate Repair is not authorized.`;
              draft.events.push(activity(
                stageId,
                "Repeated review failure stopped",
                draft.error,
                "danger",
                "decision",
                runEventMetadata(authoritativeRun),
              ));
              return;
            }
          }
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
        if (stageId === "dev-review" && draft.workflowProfile?.selected === "fast" && isArchitecturalRisk(blockingFindings)) {
          const escalation = fastEscalation({ profile: "fast", kind: "review-risk", architectural: true });
          if (escalation) recordWorkflowProfile(draft, escalation.target, escalation.reason, "automatic-escalation");
        }
        const repairCount = activeCandidate.revisions.filter((revision) => revision.reason === "repair").length;
        if (stageId === "dev-review" && draft.workflowProfile?.selected === "fast" && repairCount >= 1) {
          activeCandidate.status = "repair_required";
          draft.status = "blocked";
          draft.currentStage = stageId;
          draft.error = "Fast profile exhausted its one automatic candidate-repair cycle. Human direction or a profile override is required before more code changes.";
          draft.events.push(activity(
            stageId,
            "Fast repair limit reached",
            draft.error,
            "danger",
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
    const requestedFindings = projectRepairFindings(repairRequest.repairEvidence.newestFailingGate.blockingFindings);
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
    const policy = resolveRunAgentPolicy(task, policyId, settings);
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
    const commandLimit = candidateGateCommandLimit(stageId);
    const runController = commandLimit == null ? null : new AbortController();
    let commandStarts = 0;
    let commandLimitExceeded = false;
    const relayAbort = () => runController?.abort();
    if (runController) {
      if (signal.aborted) runController.abort();
      else signal.addEventListener("abort", relayAbort, { once: true });
    }
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
        signal: runController?.signal ?? signal,
        sandbox: effectiveSandbox,
        // No stage grants network access any more. The only stage that ever needed it needed
        // it to run commands, and it no longer runs them.
        networkAccess: false,
        extraReadRoots,
        model: policy.model,
        reasoning: policy.reasoning,
        tempDirectory: runtimeTemp,
        timeoutMs: stageTimeoutMs(stageId, effectiveSandbox, task),
        onEvent(event) {
          if (event.type === "activity") runtimeEvents.push(event);
          if (
            commandLimit != null &&
            event.toolCall?.category === "repository-command" &&
            event.toolCall?.phase === "started"
          ) {
            commandStarts += 1;
            if (commandStarts > commandLimit && !commandLimitExceeded) {
              commandLimitExceeded = true;
              runtimeEvents.push({
                type: "activity",
                tone: "warning",
                title: "Review command budget exceeded",
                detail: `${getStageMetadata(stageId).label} attempted more than ${commandLimit} repository commands; the model run was stopped before more review cost accumulated.`,
                commandFailed: true,
                runtimeScope: "review-tooling",
              });
              runController.abort();
            }
          }
        },
      });
      if (commandLimitExceeded) {
        throw new Error(`${getStageMetadata(stageId).label} exceeded its hard ${commandLimit}-command review budget.`);
      }
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
      const failure = commandLimitExceeded
        ? new Error(`${getStageMetadata(stageId).label} exceeded its hard ${commandLimit}-command review budget.`)
        : error;
      const completedAt = now();
      await this.#finishAgentRun(task.id, stageId, eventLabel ?? metadata.label, {
        runId,
        startedAt,
        completedAt,
        durationMs: Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime()),
        runtimeEvents,
        usage: null,
        error: failure instanceof Error ? failure.message : String(failure),
      }, signal.aborted ? "cancelled" : isProcessTimeoutError(error) ? "timed-out" : "failed");
      throw failure;
    } finally {
      signal.removeEventListener?.("abort", relayAbort);
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

function sameCandidateTestRetryContext(task) {
  const candidate = currentCandidate(task);
  if (
    !["repair-required", "failed", "blocked"].includes(task.status) ||
    task.currentStage !== "test" ||
    !["repair_required", "ready_for_test"].includes(candidate.status)
  ) {
    throw new Error("The task is not awaiting a retryable Test failure.");
  }
  const verification = [...(candidate.verificationRuns ?? [])].reverse().find((entry) =>
    (entry.executionKind == null || entry.executionKind === "full-manifest") &&
    entry.candidateId === candidate.id &&
    entry.candidateRevision === candidate.revisionNumber &&
    entry.headRevision === candidate.headRevision &&
    entry.status === "failed" &&
    entry.retryDisposition !== "human-rerun-requested"
  );
  if (!verification) throw new Error("No failed exact-candidate verification is available to rerun.");
  const alreadyRetried = (task.sameCandidateTestRetries ?? []).some((retry) =>
    retry.candidateId === candidate.id && retry.candidateRevision === candidate.revisionNumber
  );
  if (alreadyRetried) throw new Error("This candidate revision already used its one same-candidate Test retry.");
  const latestArtifact = [...(task.artifacts ?? [])].reverse().find((artifact) =>
    artifact.stage === "test" &&
    artifact.candidateId === candidate.id &&
    artifact.candidateRevision === candidate.revisionNumber
  );
  const blockingCandidateDefect = latestArtifact?.gateResult?.findings?.some((finding) =>
    finding.blocking === true && finding.kind === "candidate-defect"
  );
  if (blockingCandidateDefect) {
    throw new Error("The retained Test evidence identifies a blocking candidate defect; use candidate repair instead.");
  }
  return { candidate, verification };
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

function resolveRunAgentPolicy(task, policyId, settings) {
  if (policyId !== "repair") return resolveAgentPolicy(task, policyId, settings);
  const candidate = task.candidates?.at(-1);
  const failingGate = [...(task.runs ?? [])].reverse().find((run) =>
    CANDIDATE_GATE_STAGES.includes(run.stage) &&
    run.candidateId === candidate?.id &&
    run.candidateRevision === candidate?.revisionNumber &&
    run.gateResult?.verdict === "REPAIR",
  );
  const priorRepairFailed = (task.runs ?? []).some((run) => run.kind === "repair" && run.status !== "completed");
  if (priorRepairFailed || isArchitecturalRisk(failingGate?.gateResult?.findings ?? [])) {
    return { provider: "codex", model: "gpt-5.6-sol", reasoning: "high" };
  }
  return resolveAgentPolicy(task, "implement", settings);
}

function stageTimeoutMs(stageId, sandbox, task = null) {
  const defaultTimeout = ["implement", "repair"].includes(stageId)
    ? 900_000
    : sandbox === "workspace-write" || ["plan", "dev-review", "final-review"].includes(stageId)
      ? 600_000
      : 360_000;
  const configured = task?.stageTimeoutOverridesMs?.[stageId];
  return Number.isInteger(configured) && configured >= defaultTimeout && configured <= 3_600_000
    ? configured
    : defaultTimeout;
}

export function evaluationVerdict(stageId, result, focusedTestEvidence = null, structuredGateEvidence = null) {
  if (CANDIDATE_GATE_STAGES.includes(stageId) && modelCommandFailed(result.runtimeEvents)) return "REPAIR";
  if (stageId === "test" && focusedTestEvidence?.status !== "passed") return "REPAIR";
  if (stageId === "test") return "PASS";
  if (["dev-review", "final-review"].includes(stageId)) return structuredGateEvidence?.verdict ?? "REPAIR";
  return "REPAIR";
}

function modelCommandFailed(runtimeEvents = []) {
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
    "dev-review": { taskStatus: "review-retry-required", candidateStatus: "review_retry_required" },
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
    review: ["ready-for-review", "review-retry-required", "failed", "cancelled"],
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
  return resolveRunAgentPolicy(task, policyIdForRun(kind, stage)).provider;
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
    // A completed, exact REPAIR gate may be stale for reasons that still preserve its
    // repair authority. `missing_binding` can describe a non-blocking finding whose
    // identity safely fell back to the exact top-level gate binding. `command_failure`
    // correctly prevents promotion, but must not erase a separate blocking finding and
    // strand a candidate after the evaluation has already moved it to repair-required.
    // Every admitted reason remains guarded below by the exact reservation/run/artifact
    // tuple and by `sourceRun.gateResult.verdict === "REPAIR"`. This authorizes more
    // candidate work only; it never makes the failed gate fresh or promotable.
    !["repair_required", "missing_binding", "command_failure"].includes(freshness?.reasonCode) ||
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
  const artifactId = [...(task.artifacts ?? [])].reverse().find((artifact) => artifact.stage === stage)?.id ?? null;
  const approval = { id: crypto.randomUUID(), stage, note: approvalNote, createdAt: now(), artifactId };
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

function retainedSliceCanBeRequalified(prior, revised) {
  if (
    prior?.status !== "failed" ||
    !prior.headRevision ||
    !prior.worktreePath ||
    !prior.branch ||
    !prior.baseRevision ||
    !Array.isArray(prior.files) ||
    !/(?:repository manifest command id|did not qualify)/i.test(prior.error ?? "") ||
    !revised.verificationCommandIds?.length
  ) {
    return false;
  }
  const priorOwnedPaths = [...(prior.ownedPaths ?? [])].sort();
  const revisedOwnedPaths = [...(revised.ownedPaths ?? [])].sort();
  return priorOwnedPaths.every((priorPath) => isOwnedFile(priorPath, revisedOwnedPaths));
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
