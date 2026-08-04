import path from "node:path";
import os from "node:os";
import { rm } from "node:fs/promises";
import {
  buildExecutionRequest,
  buildRepairRequest,
  buildStageRequest,
  buildWorkPackageRequest,
  getStageMetadata,
  INVESTIGATION_PIPELINE,
  projectRepairFindings,
} from "./prompts.mjs";
import { getCodexStatus, isProcessTimeoutError, runCodex } from "./codex-runtime.mjs";
import { GitWorktreeManager } from "./git-worktree.mjs";
import {
  CREDIT_SOURCE_URL,
  enrichUsage,
  PRICING_SOURCE_URL,
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
  RUNTIME_FRESHNESS_REASONS,
  refreshGateFreshness,
  runEventMetadata,
  runKindFor,
  stageRunLimitFor,
} from "./run-activity.mjs";
import {
  isCandidateEvidenceError,
  parseFocusedTestEvidence,
  parseGateEvidence,
  parseGrillQuestions,
  parseWorkPackages,
  validateFocusedTestEvidence,
} from "./structured-output.mjs";

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

  constructor(store, options = {}) {
    this.#store = store;
    this.#runCodex = options.runCodex ?? runCodex;
    this.#getStatus = options.getStatus ?? getCodexStatus;
    this.#worktrees = options.worktreeManager ?? new GitWorktreeManager(path.resolve(".data", "worktrees"));
  }

  async status() {
    const [runtime, settings] = await Promise.all([this.#getStatus(), this.#store.settings()]);
    return {
      ...runtime,
      catalog: withConfiguredModels(runtime.catalog, settings),
      model: settings.defaultModel,
      reasoning: settings.defaultReasoning,
      settings,
      scouts: scoutCatalog(),
    };
  }

  async verifyPricing() {
    const settings = await this.#store.settings();
    const result = await this.#runCodex({
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
        (draft) => !draft.activeRunKind && (options.canStart ? options.canStart(draft) : canStartRun(draft, kind)),
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
      draft.status = "completed";
      draft.currentStage = "approval";
      draft.completedAt = approvedAt;
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
        draft.status = "running";
        draft.currentStage = "specification";
        draft.events.push(activity(
          "grill",
          "Grill Me completed automatically",
          draft.grillSession.completionReason,
          "success",
          "decision",
        ));
      });
      await this.#runSpecification(id, signal);
      return;
    }
    await this.#store.update(id, (draft) => {
      draft.status = "awaiting-grill";
      draft.currentStage = "grill";
      draft.activeRunKind = null;
      const count = draft.grillSession?.questions.length ?? 0;
      draft.events.push(activity("grill", "Grill Me ready", `${count} material question${count === 1 ? "" : "s"} need a decision.`, "success", "decision"));
    });
  }

  async #runScouts(id, task, signal) {
    const triageArtifact = [...task.artifacts].reverse().find((artifact) => artifact.stage === "triage");
    const selection = selectScoutDispatch(task, triageArtifact?.content ?? "");
    const dispatch = selection.selected;
    await this.#store.update(id, (draft) => {
      draft.artifacts = draft.artifacts.filter((artifact) => artifact.stage !== "scouts");
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
      { replace: false, name: "repository-scout.md", artifactTitle: "Scout evidence aggregated" },
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
      draft.events.push(activity("specification", "Specification ready for approval", "Review the evidence and approve or stop.", "success", "decision"));
    });
  }

  async #runPlanning(id, signal) {
    const task = await this.#store.get(id);
    const result = await this.#executeAgent(task, "plan", signal, task.repositoryPath, "read-only");
    throwIfAborted(signal);
    const workPackages = parseWorkPackages(result.finalText, task.repositoryPath);
    await this.#retainAgentResult(id, "plan", result, { replace: true });
    await this.#store.update(id, (draft) => {
      draft.workPackages = workPackages;
      draft.status = "awaiting-plan-approval";
      draft.currentStage = "plan";
      draft.activeRunKind = null;
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
    const candidate = await this.#worktrees.prepare(task, candidateId, { baseRevision: base.baseRevision });
    candidate.status = "assembling";
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
      .map((member) => `- ${member.order}. ${member.packageId}: ${member.headRevision}`)
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
      { replace: false, name: `candidate-${candidate.id.toLowerCase()}-r1.md`, candidateId, candidateRevision: 1 },
    );
    await this.#store.update(id, (draft) => {
      const activeCandidate = currentCandidate(draft);
      activeCandidate.headRevision = assembled.headRevision;
      activeCandidate.status = "ready_for_review";
      activeCandidate.updatedAt = now();
      activeCandidate.revisions.push({ number: 1, headRevision: assembled.headRevision, reason: "assembly", createdAt: now() });
      for (const workPackage of draft.workPackages) workPackage.status = "integrated";
      draft.status = "ready-for-review";
      draft.currentStage = "dev-review";
      draft.activeRunKind = null;
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
      .map((item) => item.headRevision);
    const sliceId = `${workPackage.id}-A${attempt}`;
    try {
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
      const committed = await this.#worktrees.commit(
        slice,
        `agent-harness(${task.id}): ${workPackageId} ${currentPackage.title}`,
        { ownedPaths: currentPackage.ownedPaths },
      );
      const content = `${result.finalText}\n\n## Harness slice evidence\n\n- Work package: ${workPackageId}\n- Attempt: ${attempt}\n- Dependencies: ${currentPackage.dependencies.join(", ") || "None"}\n- Base: ${slice.baseRevision}\n- Package commit: ${committed.headRevision}\n- Branch: ${slice.branch}\n- Changed files: ${committed.files.length}\n\n\`\`\`text\n${committed.ownSummary || "No diff stat returned."}\n\`\`\`\n\nThe exact package commit remains available through Git; its full patch is not copied into downstream prompts.`;
      await this.#retainAgentResult(id, "implement", { ...result, finalText: content }, {
        complete: false,
        replace: false,
        name: `slice-${workPackageId.toLowerCase()}-a${attempt}.md`,
        workPackageId,
      });
      await this.#store.update(id, (draft) => {
        const target = draft.workPackages.find((item) => item.id === workPackageId);
        target.status = "ready_for_integration";
        target.headRevision = committed.headRevision;
        target.files = committed.files;
        target.error = null;
        draft.events.push(activity("implement", `${workPackageId} ready for integration`, `${committed.headRevision.slice(0, 8)} changed ${committed.files.length} file${committed.files.length === 1 ? "" : "s"}.`, "success", "artifact"));
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

  async #runEvaluation(id, stageId, signal) {
    const task = await this.#store.get(id);
    const candidate = currentCandidate(task);
    await this.#worktrees.verifyCandidate(candidate);
    let result;
    try {
      result = await this.#executeAgent(task, stageId, signal, candidate.worktreePath, "read-only", candidate);
    } finally {
      if (stageId === "test") {
        if (typeof this.#worktrees.recoverCandidate === "function") {
          await this.#worktrees.recoverCandidate(candidate);
        }
        await this.#worktrees.verifyCandidate(candidate);
      }
    }
    throwIfAborted(signal);
    let focusedTestEvidence = null;
    let structuredGateEvidence = null;
    let evidenceError = null;
    try {
      focusedTestEvidence = stageId === "test"
        ? validateFocusedTestEvidence(parseFocusedTestEvidence(result.finalText), candidate)
        : null;
      structuredGateEvidence = ["dev-review", "final-review"].includes(stageId)
        ? parseGateEvidence(result.finalText, candidate, stageId)
        : null;
    } catch (error) {
      evidenceError = structuredEvidenceError(error);
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
        ...(stageId === "test" && result.runtimeEvents?.some((event) => event.commandFailed)
          ? ["A verification command failed."]
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
    await this.#store.update(id, (draft) => {
      const activeCandidate = currentCandidate(draft);
      const gateFailure = candidateGateFailure(draft, activeCandidate, [stageId]);
      const stageFreshness = gateFailure?.freshness ?? draft.gateFreshness?.[stageId] ?? null;
      const authoritativeRun = stageFreshness?.sourceRunId
        ? draft.runs?.find((run) => run.id === stageFreshness.sourceRunId)
        : null;
      activeCandidate.updatedAt = now();
      draft.activeRunKind = null;
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
    const repairRequest = buildRepairRequest(task, candidate);
    const requestedFindings = projectRepairFindings(repairRequest.repairEvidence.newestFailingGate.gateResult.findings);
    let result;
    let committed;
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
      committed = await this.#worktrees.commit(
        candidate,
        `agent-harness(${task.id}): repair ${candidate.id} revision ${nextRevision}`,
        { allowGeneratedDeletions: true },
      );
    } catch (error) {
      if (typeof this.#worktrees.recoverCandidate === "function") await this.#worktrees.recoverCandidate(candidate);
      throw error;
    }
    const content = `${result.finalText}\n\n## Harness repair evidence\n\n- Candidate: ${candidate.id} revision ${nextRevision}\n- Previous: ${candidate.headRevision}\n- Head: ${committed.headRevision}\n- Changed files in repair: ${committed.files.length}\n\n\`\`\`text\n${committed.summary || "No diff stat returned."}\n\`\`\`\n\nThe exact repaired candidate patch is loaded on demand from the recorded revision.`;
    await this.#retainAgentResult(id, "implement", { ...result, finalText: content }, {
      replace: false,
      name: `candidate-${candidate.id.toLowerCase()}-r${nextRevision}-repair.md`,
      candidateId: candidate.id,
      candidateRevision: nextRevision,
    });
    await this.#store.update(id, (draft) => {
      const activeCandidate = currentCandidate(draft);
      activeCandidate.revisionNumber = nextRevision;
      activeCandidate.headRevision = committed.headRevision;
      activeCandidate.status = "ready_for_review";
      activeCandidate.updatedAt = now();
      activeCandidate.revisions.push({
        number: nextRevision,
        headRevision: committed.headRevision,
        reason: "repair",
        requestedFindings: structuredClone(requestedFindings),
        createdAt: now(),
      });
      draft.completedStages = draft.completedStages.filter(
        (stage) => !["dev-review", "test", "final-review", "approval"].includes(stage),
      );
      draft.status = "ready-for-review";
      draft.currentStage = "dev-review";
      draft.activeRunKind = null;
      refreshGateFreshness(draft);
      draft.events.push(activity("implement", "Repaired candidate ready", `${candidate.id} revision ${nextRevision} @ ${committed.headRevision.slice(0, 8)} must pass review again.`, "success", "artifact"));
    });
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
  ) {
    const metadata = getStageMetadata(stageId);
    const testRuntime = stageId === "test";
    const effectiveSandbox = testRuntime ? "workspace-write" : sandbox;
    const agentRequest =
      promptOverride ?? (candidate ? buildExecutionRequest(task, stageId, candidate) : buildStageRequest(task, stageId));
    const settings = await this.#store.settings();
    const policy = resolveAgentPolicy(task, policyId, settings);
    const runId = crypto.randomUUID();
    const startedAt = now();
    const runKind = runKindFor(stageId, policyId, workPackageId);
    const runtimeTemp = path.join(os.tmpdir(), "agent-harness", task.id, runId);
    await this.#store.update(task.id, (draft) => {
      draft.currentStage = stageId;
      const detail = testRuntime
        ? `Verifying ${cwd}; source changes are checked before and after the run`
        : `${sandbox === "read-only" ? "Reading" : "Working in"} ${cwd}`;
      const run = beginAgentRun(draft, {
        id: runId,
        kind: runKind,
        stage: stageId,
        role: policyId,
        model: policy.model,
        reasoning: policy.reasoning,
        startedAt,
        candidateId: candidate?.id ?? null,
        candidateRevision: candidate?.revisionNumber ?? null,
        workPackageId,
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
    try {
      const result = await this.#runCodex({
        cwd,
        prompt: agentRequest.prompt,
        signal,
        sandbox: effectiveSandbox,
        networkAccess: testRuntime,
        model: policy.model,
        reasoning: policy.reasoning,
        tempDirectory: runtimeTemp,
        timeoutMs: stageTimeoutMs(stageId, effectiveSandbox),
        onEvent(event) {
          if (event.type === "activity") runtimeEvents.push(event);
        },
      });
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
    const resultModel = result.model ?? fallbackPolicy.model ?? task.models[0]?.model ?? "gpt-5.6-luna";
    const resultUsage = enrichUsage(
      resultModel,
      result.usage,
      settings.pricing?.rates,
      settings.pricing?.version,
    );
    await this.#store.update(id, (draft) => {
      if (options.replace) draft.artifacts = draft.artifacts.filter((artifact) => artifact.stage !== stageId);
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
        reasoning: result.reasoning !== undefined ? result.reasoning : fallbackPolicy.reasoning,
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
  if (stageId === "test" && result.runtimeEvents?.some((event) => event.commandFailed)) return "REPAIR";
  if (stageId === "test" && focusedTestEvidence?.status !== "passed") return "REPAIR";
  if (stageId === "test") return "PASS";
  if (["dev-review", "final-review"].includes(stageId)) return structuredGateEvidence?.verdict ?? "REPAIR";
  return "REPAIR";
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
  const allowed = {
    investigation: ["queued", "failed", "cancelled"],
    specification: ["awaiting-grill"],
    planning: ["failed", "cancelled"],
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
  task.status = "running";
  task.error = null;
  task.startedAt ??= now();
  task.completedAt = null;
  task.stageRun += 1;
  task.attemptsByStage ??= {};
  task.attemptsByStage[stage] = (task.attemptsByStage[stage] ?? 0) + 1;
  task.activeRunKind = kind;
  const candidate = task.candidates?.at(-1);
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

function dependencyClosure(workPackage, packages, seen = new Set()) {
  for (const dependencyId of workPackage.dependencies) {
    if (seen.has(dependencyId)) continue;
    seen.add(dependencyId);
    const dependency = packages.find((item) => item.id === dependencyId);
    if (dependency) dependencyClosure(dependency, packages, seen);
  }
  return [...seen];
}
