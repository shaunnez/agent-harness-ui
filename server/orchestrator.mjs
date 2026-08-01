import path from "node:path";
import { buildExecutionPrompt, buildStagePrompt, getStageMetadata, INVESTIGATION_PIPELINE } from "./prompts.mjs";
import { getCodexStatus, runCodex } from "./codex-runtime.mjs";
import { GitWorktreeManager } from "./git-worktree.mjs";

const RUN_KINDS = new Set(["investigation", "planning", "implementation", "repair", "review", "test", "final-review"]);

function now() {
  return new Date().toISOString();
}

function activity(stage, title, detail, tone = "info", category = "activity") {
  return { id: crypto.randomUUID(), at: now(), category, tone, stage, title, detail };
}

export class TaskOrchestrator {
  #store;
  #active = new Map();
  #runCodex;
  #getStatus;
  #worktrees;

  constructor(store, options = {}) {
    this.#store = store;
    this.#runCodex = options.runCodex ?? runCodex;
    this.#getStatus = options.getStatus ?? getCodexStatus;
    this.#worktrees = options.worktreeManager ?? new GitWorktreeManager(path.resolve(".data", "worktrees"));
  }

  status() {
    return this.#getStatus();
  }

  isRunning(id) {
    return this.#active.has(id);
  }

  start(id, kind = "investigation") {
    if (!RUN_KINDS.has(kind)) throw new Error(`Unknown run kind: ${kind}`);
    if (this.#active.has(id)) return false;
    const controller = new AbortController();
    const promise = this.#run(id, kind, controller.signal).finally(() => this.#active.delete(id));
    this.#active.set(id, { controller, kind, promise });
    return true;
  }

  cancel(id) {
    const active = this.#active.get(id);
    if (!active) return false;
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
      draft.events.push(activity("grill", "Human decision recorded", `${decision.question}: ${decision.answer}`, "success", "decision"));
    });
  }

  async approveSpecification(id, note = "") {
    const task = await this.#store.get(id);
    if (!task) throw new Error("Task not found.");
    if (!["awaiting-spec-approval", "awaiting-approval"].includes(task.status)) {
      throw new Error("The task is not awaiting specification approval.");
    }
    await this.#recordApproval(id, "specification", note);
    if (task.workflow === "investigate") {
      await this.#store.update(id, (draft) => {
        draft.status = "completed";
        draft.completedAt = now();
        draft.events.push(activity("specification", "Investigation approved", "The approved specification is the final deliverable for this task.", "success", "decision"));
      });
      return { started: false, completed: true };
    }
    const started = this.start(id, "planning");
    if (!started) throw new Error("Task is already running.");
    return { started: true, completed: false };
  }

  async approvePlan(id, note = "") {
    const task = await this.#store.get(id);
    if (!task) throw new Error("Task not found.");
    if (task.status !== "awaiting-plan-approval") throw new Error("The task is not awaiting plan approval.");
    await this.#recordApproval(id, "plan", note);
    return this.#store.update(id, (draft) => {
      draft.status = "ready-for-implementation";
      draft.currentStage = "implement";
      draft.events.push(activity("implement", "Implementation authorized", "The approved plan may now run in an isolated Git worktree.", "success", "decision"));
    });
  }

  async approveMerge(id, note = "") {
    const task = await this.#store.get(id);
    if (!task) throw new Error("Task not found.");
    if (task.status !== "awaiting-human-approval") throw new Error("The task is not awaiting merge approval.");
    const candidate = currentCandidate(task);
    if (candidate.status !== "awaiting_human_approval") throw new Error("The current candidate has not cleared every gate.");
    await this.#worktrees.merge(candidate);
    return this.#store.update(id, (draft) => {
      const activeCandidate = currentCandidate(draft);
      draft.approvals ??= [];
      draft.approvals.push({ id: crypto.randomUUID(), stage: "approval", note: note.trim().slice(0, 5_000), createdAt: now() });
      activeCandidate.status = "merged";
      activeCandidate.updatedAt = now();
      draft.status = "completed";
      draft.currentStage = "approval";
      draft.completedAt = now();
      if (!draft.completedStages.includes("approval")) draft.completedStages.push("approval");
      draft.events.push(activity("approval", "Human approval recorded", note.trim() || "Approved without an additional note.", "success", "decision"));
      draft.events.push(activity("approval", "Candidate merged", `${activeCandidate.id} fast-forwarded ${activeCandidate.baseBranch} to ${activeCandidate.headRevision.slice(0, 8)}.`, "success", "decision"));
    });
  }

  async #recordApproval(id, stage, note) {
    await this.#store.update(id, (draft) => {
      draft.approvals ??= [];
      draft.approvals.push({ id: crypto.randomUUID(), stage, note: note.trim().slice(0, 5_000), createdAt: now() });
      draft.events.push(activity(stage, `${getStageMetadata(stage)?.label ?? stage} approved`, note.trim() || "Approved without an additional note.", "success", "decision"));
    });
  }

  async #run(id, kind, signal) {
    const initial = await this.#store.get(id);
    if (!initial) return;
    const stage = stageForRun(kind, initial.currentStage);
    await this.#store.update(id, (draft) => {
      draft.status = "running";
      draft.error = null;
      draft.startedAt ??= now();
      draft.completedAt = null;
      draft.stageRun += 1;
      draft.attemptsByStage ??= {};
      draft.attemptsByStage[stage] = (draft.attemptsByStage[stage] ?? 0) + 1;
      draft.activeRunKind = kind;
      const candidate = draft.candidates?.at(-1);
      if (candidate) {
        const candidateStatus = {
          repair: "repairing",
          review: "reviewing",
          test: "testing",
          "final-review": "final_reviewing",
        }[kind];
        if (candidateStatus) candidate.status = candidateStatus;
      }
      draft.events.push(activity(stage, `${labelForRun(kind)} started`, runDetail(kind), "info", "agent"));
    });

    try {
      if (kind === "investigation") await this.#runInvestigation(id, signal);
      if (kind === "planning") await this.#runPlanning(id, signal);
      if (kind === "implementation") await this.#runImplementation(id, signal);
      if (kind === "repair") await this.#runRepair(id, signal);
      if (kind === "review") await this.#runEvaluation(id, "dev-review", signal);
      if (kind === "test") await this.#runEvaluation(id, "test", signal);
      if (kind === "final-review") await this.#runEvaluation(id, "final-review", signal);
    } catch (error) {
      await this.#store.update(id, (draft) => {
        const attempts = draft.attemptsByStage?.[draft.currentStage] ?? 1;
        draft.status = signal.aborted ? "cancelled" : attempts >= draft.stageRunLimit ? "blocked" : "failed";
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
        draft.events.push(activity(draft.currentStage, signal.aborted ? "Run cancelled" : "Stage failed", error.message, "danger"));
      });
    }
  }

  async #runInvestigation(id, signal) {
    let task = await this.#store.get(id);
    const stages = INVESTIGATION_PIPELINE.filter((stage) => !task.completedStages.includes(stage));
    for (const stageId of stages) {
      if (signal.aborted) throw new Error("Codex run cancelled.");
      task = await this.#store.get(id);
      const result = await this.#executeAgent(task, stageId, signal, task.repositoryPath, "read-only");
      throwIfAborted(signal);
      await this.#retainAgentResult(id, stageId, result, { replace: true });
    }
    await this.#store.update(id, (draft) => {
      draft.status = "awaiting-spec-approval";
      draft.currentStage = "specification";
      draft.activeRunKind = null;
      draft.events.push(activity("specification", "Specification ready for approval", "Review the evidence, record any consequential decisions, then approve or stop.", "success", "decision"));
    });
  }

  async #runPlanning(id, signal) {
    const task = await this.#store.get(id);
    const result = await this.#executeAgent(task, "plan", signal, task.repositoryPath, "read-only");
    throwIfAborted(signal);
    await this.#retainAgentResult(id, "plan", result, { replace: true });
    await this.#store.update(id, (draft) => {
      draft.status = "awaiting-plan-approval";
      draft.currentStage = "plan";
      draft.activeRunKind = null;
      draft.events.push(activity("plan", "Implementation plan ready", "Approve the dependency-ordered plan before any worktree is created.", "success", "decision"));
    });
  }

  async #runImplementation(id, signal) {
    let task = await this.#store.get(id);
    const candidateId = `C${(task.candidates?.length ?? 0) + 1}`;
    const candidate = await this.#worktrees.prepare(task, candidateId);
    await this.#store.update(id, (draft) => {
      draft.currentStage = "implement";
      draft.candidates ??= [];
      draft.candidates.push(candidate);
      draft.events.push(activity("implement", "Isolated worktree created", `${candidate.id} at ${candidate.worktreePath}`, "success"));
    });
    task = await this.#store.get(id);
    const result = await this.#executeAgent(task, "implement", signal, candidate.worktreePath, "workspace-write", candidate);
    throwIfAborted(signal);
    let committed;
    try {
      committed = await this.#worktrees.commit(candidate, `agent-harness(${task.id}): implement approved plan`);
    } catch (error) {
      await this.#retainAgentResult(id, "implement", result, {
        complete: false,
        name: `candidate-${candidate.id.toLowerCase()}-failed-attempt.md`,
        candidateId: candidate.id,
        candidateRevision: 1,
        artifactTone: "warning",
        artifactTitle: "Failed implementation attempt retained",
      });
      throw new Error(`${error.message} ${summarizeAgentReport(result.finalText)}`.trim());
    }
    const content = `${result.finalText}\n\n## Harness candidate evidence\n\n- Candidate: ${candidate.id} revision 1\n- Base: ${candidate.baseRevision}\n- Head: ${committed.headRevision}\n- Branch: ${candidate.branch}\n- Changed files: ${committed.files.length}\n\n\`\`\`text\n${committed.summary || "No diff stat returned."}\n\`\`\`\n\n<details><summary>Patch</summary>\n\n\`\`\`diff\n${committed.diff}\n\`\`\`\n\n</details>`;
    await this.#retainAgentResult(id, "implement", { ...result, finalText: content }, { replace: false, name: `candidate-${candidate.id.toLowerCase()}-r1.md`, candidateId, candidateRevision: 1 });
    await this.#store.update(id, (draft) => {
      const activeCandidate = currentCandidate(draft);
      activeCandidate.headRevision = committed.headRevision;
      activeCandidate.status = "ready_for_review";
      activeCandidate.updatedAt = now();
      activeCandidate.revisions.push({ number: 1, headRevision: committed.headRevision, reason: "implementation", createdAt: now() });
      draft.status = "ready-for-review";
      draft.currentStage = "dev-review";
      draft.activeRunKind = null;
      draft.events.push(activity("implement", "Integration candidate ready", `${candidate.id} @ ${committed.headRevision.slice(0, 8)} is ready for development review.`, "success", "artifact"));
    });
  }

  async #runEvaluation(id, stageId, signal) {
    const task = await this.#store.get(id);
    const candidate = currentCandidate(task);
    await this.#worktrees.verifyCandidate(candidate);
    const result = await this.#executeAgent(task, stageId, signal, candidate.worktreePath, "read-only", candidate);
    throwIfAborted(signal);
    const verdict = evaluationVerdict(stageId, result);
    await this.#retainAgentResult(id, stageId, result, {
      replace: false,
      name: `${stageId}-${candidate.id.toLowerCase()}-r${candidate.revisionNumber}.md`,
      candidateId: candidate.id,
      candidateRevision: candidate.revisionNumber,
      complete: verdict === "PASS",
    });
    await this.#store.update(id, (draft) => {
      const activeCandidate = currentCandidate(draft);
      activeCandidate.updatedAt = now();
      draft.activeRunKind = null;
      if (verdict !== "PASS") {
        activeCandidate.status = "repair_required";
        draft.status = "repair-required";
        draft.currentStage = stageId;
        draft.events.push(activity(stageId, "Candidate requires repair", `${activeCandidate.id} revision ${activeCandidate.revisionNumber} did not pass ${getStageMetadata(stageId).label}.`, "warning", "decision"));
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
      draft.events.push(activity(stageId, `${getStageMetadata(stageId).label} passed`, `${activeCandidate.id} revision ${activeCandidate.revisionNumber} advanced to the next gate.`, "success", "decision"));
    });
  }

  async #runRepair(id, signal) {
    const task = await this.#store.get(id);
    const candidate = currentCandidate(task);
    if (!["repair_required", "repairing"].includes(candidate.status)) {
      throw new Error("The current candidate is not awaiting repair.");
    }
    await this.#worktrees.verifyCandidate(candidate);
    const nextRevision = candidate.revisionNumber + 1;
    const result = await this.#executeAgent(task, "implement", signal, candidate.worktreePath, "workspace-write", candidate);
    throwIfAborted(signal);
    const committed = await this.#worktrees.commit(
      candidate,
      `agent-harness(${task.id}): repair ${candidate.id} revision ${nextRevision}`,
    );
    const content = `${result.finalText}\n\n## Harness repair evidence\n\n- Candidate: ${candidate.id} revision ${nextRevision}\n- Previous: ${candidate.headRevision}\n- Head: ${committed.headRevision}\n- Changed files in repair: ${committed.files.length}\n\n\`\`\`text\n${committed.summary || "No diff stat returned."}\n\`\`\`\n\n<details><summary>Candidate patch from base</summary>\n\n\`\`\`diff\n${committed.diff}\n\`\`\`\n\n</details>`;
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
      activeCandidate.revisions.push({ number: nextRevision, headRevision: committed.headRevision, reason: "repair", createdAt: now() });
      draft.completedStages = draft.completedStages.filter(
        (stage) => !["dev-review", "test", "final-review", "approval"].includes(stage),
      );
      draft.status = "ready-for-review";
      draft.currentStage = "dev-review";
      draft.activeRunKind = null;
      draft.events.push(activity("implement", "Repaired candidate ready", `${candidate.id} revision ${nextRevision} @ ${committed.headRevision.slice(0, 8)} must pass review again.`, "success", "artifact"));
    });
  }

  async #executeAgent(task, stageId, signal, cwd, sandbox, candidate = null) {
    const metadata = getStageMetadata(stageId);
    await this.#store.update(task.id, (draft) => {
      draft.currentStage = stageId;
      draft.events.push(activity(stageId, `${metadata.label} agent started`, `${sandbox === "read-only" ? "Reading" : "Working in"} ${cwd}`, "info", "agent"));
    });
    const runtimeEvents = [];
    const result = await this.#runCodex({
      cwd,
      prompt: candidate ? buildExecutionPrompt(task, stageId, candidate) : buildStagePrompt(task, stageId),
      signal,
      sandbox,
      timeoutMs: sandbox === "workspace-write" ? 600_000 : 240_000,
      onEvent(event) {
        if (event.type === "activity") runtimeEvents.push(event);
      },
    });
    result.runtimeEvents = runtimeEvents;
    return result;
  }

  async #retainAgentResult(id, stageId, result, options = {}) {
    const metadata = getStageMetadata(stageId);
    await this.#store.update(id, (draft) => {
      for (const event of result.runtimeEvents?.slice(-30) ?? []) {
        draft.events.push(activity(stageId, event.title, event.detail, event.tone, "agent"));
      }
      if (options.replace) draft.artifacts = draft.artifacts.filter((artifact) => artifact.stage !== stageId);
      draft.artifacts.push({
        id: crypto.randomUUID(),
        stage: stageId,
        name: options.name ?? metadata.artifactName,
        kind: "markdown",
        content: result.finalText,
        createdAt: now(),
        model: draft.models[0]?.model ?? "GPT-5.4-mini - ChatGPT plan",
        usage: result.usage,
        candidateId: options.candidateId ?? null,
        candidateRevision: options.candidateRevision ?? null,
      });
      if (options.complete !== false && !draft.completedStages.includes(stageId)) draft.completedStages.push(stageId);
      for (const key of ["inputTokens", "cachedInputTokens", "outputTokens", "totalTokens"]) {
        draft.usage[key] += result.usage[key] ?? 0;
      }
      draft.events.push(
        activity(
          stageId,
          options.artifactTitle ?? `${metadata.label} artifact ready`,
          options.name ?? metadata.artifactName,
          options.artifactTone ?? "success",
          "artifact",
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

function currentCandidate(task) {
  const candidate = task.candidates?.at(-1);
  if (!candidate) throw new Error("This task does not have an integration candidate.");
  return candidate;
}

export function evaluationVerdict(stageId, result) {
  if (stageId === "test" && result.runtimeEvents?.some((event) => event.commandFailed)) return "REPAIR";
  return parseVerdict(result.finalText);
}

function parseVerdict(text) {
  const first = text.slice(0, 1_000);
  if (/^\s*(?:PASS\b|(?:#+\s*)?Verdict\s*:?\s*(?:\r?\n)+\s*PASS\b)/i.test(first)) return "PASS";
  return "REPAIR";
}

function stageForRun(kind, currentStage) {
  return {
    investigation: ["triage", "scouts", "grill", "specification"].includes(currentStage) ? currentStage : "triage",
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
