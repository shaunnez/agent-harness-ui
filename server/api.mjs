import { access, mkdir, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import {
  buildEvaluationSummary,
  hashTaskBrief,
  normalizeEvaluationInput,
  normalizeExperimentInput,
} from "./evaluation.mjs";
import { GitWorktreeManager } from "./git-worktree.mjs";
import { assertHttpBoundary, corsHeaders } from "./http-security.mjs";
import { normalizeModelId, POLICY_IDS, readCodexModelCatalog } from "./model-catalog.mjs";
import { CANONICAL_RUN_STAGES, stageRunLimitFor } from "./run-activity.mjs";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const VALID_WORKFLOWS = new Set(["investigate", "implement"]);
const RUNTIME_SCHEMA_VERSION = 5;
const DIFF_CHAR_LIMIT = 300_000;
const OUTPUT_LIMIT = 512 * 1024;

function send(response, status, value) {
  response.writeHead(status, JSON_HEADERS);
  response.end(JSON.stringify(value));
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 10_000_000) throw new Error("Request body is too large.");
  }
  try {
    return body ? JSON.parse(body) : {};
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
}

async function validateRepository(repositoryPath) {
  if (!repositoryPath || !path.isAbsolute(repositoryPath)) throw new Error("Choose an absolute local repository path.");
  const info = await stat(repositoryPath).catch(() => null);
  if (!info?.isDirectory()) throw new Error("The selected repository path is not a readable directory.");
  await access(repositoryPath);
  return path.resolve(repositoryPath);
}

function validateAttachments(input) {
  if (input == null) return [];
  if (!Array.isArray(input) || input.length > 6) throw new Error("Attach no more than six files.");
  const allowed = new Set([".html", ".htm", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".zip"]);
  let total = 0;
  return input.map((item) => {
    const name = path.basename(String(item?.name ?? "")).slice(0, 180);
    const size = Number(item?.size ?? 0);
    const data = String(item?.data ?? "");
    if (!name || !allowed.has(path.extname(name).toLowerCase())) throw new Error("Attachments must be HTML, an image, or a ZIP file.");
    if (!Number.isFinite(size) || size <= 0 || size > 5_000_000) throw new Error(`${name} must be 5 MB or smaller.`);
    total += size;
    if (total > 6_000_000) throw new Error("Attachments must total 6 MB or less.");
    const decoded = Buffer.from(data, "base64");
    if (!data || Math.abs(decoded.length - size) > 2) throw new Error(`${name} could not be decoded safely.`);
    return { name, type: String(item.type ?? "application/octet-stream").slice(0, 120), size, data };
  });
}

function validateStagePolicies(input, known, allowedModels, fallback) {
  const policies = {};
  for (const policyId of POLICY_IDS) {
    const fallbackPolicy = fallback?.[policyId];
    const requested = input?.[policyId] ?? (
      allowedModels.includes(normalizeModelId(fallbackPolicy?.model))
        ? fallbackPolicy
        : { model: allowedModels[0], reasoning: known.get(allowedModels[0])?.defaultReasoning }
    );
    const modelId = normalizeModelId(requested?.model);
    const model = known.get(modelId);
    const reasoning = String(requested?.reasoning ?? "");
    if (!model || !allowedModels.includes(modelId)) throw new Error(`${policyId} must use an allowed model.`);
    if (!model.reasoningLevels.includes(reasoning)) throw new Error(`${model.label} does not support ${reasoning || "that"} reasoning for ${policyId}.`);
    policies[policyId] = { model: modelId, reasoning };
  }
  return policies;
}

function worktreeEntriesForTask(task) {
  const entries = [];
  for (const workPackage of task.workPackages ?? []) {
    if (!workPackage?.worktreePath) continue;
    entries.push({
      id: `slice:${task.id}:${workPackage.id ?? workPackage.worktreePath}`,
      kind: "slice",
      label: `${workPackage.id ?? "Work package"} slice`,
      taskId: task.id,
      workPackageId: workPackage.id ?? null,
      worktreePath: workPackage.worktreePath,
      branch: workPackage.branch ?? null,
      baseRevision: workPackage.baseRevision ?? null,
      headRevision: workPackage.headRevision ?? null,
      recordedHeadRevision: workPackage.headRevision ?? null,
      lifecycleState: task.status === "closed" ? "stale" : workPackage.status ?? "retained",
    });
  }
  for (const candidate of task.candidates ?? []) {
    if (!candidate?.worktreePath) continue;
    entries.push({
      id: `candidate:${task.id}:${candidate.id ?? candidate.worktreePath}`,
      kind: "candidate",
      label: `${candidate.id ?? "Integration"} candidate`,
      taskId: task.id,
      workPackageId: candidate.packageId ?? candidate.id ?? null,
      worktreePath: candidate.worktreePath,
      branch: candidate.branch ?? null,
      baseRevision: candidate.baseRevision ?? null,
      headRevision: candidate.headRevision ?? null,
      recordedHeadRevision: candidate.headRevision ?? null,
      lifecycleState: task.status === "closed" ? "stale" : candidate.status ?? "retained",
    });
  }
  return entries;
}

export function createApiServer({ store, orchestrator, suggestedRepository, csrfToken = crypto.randomUUID() }) {
  const worktrees = new GitWorktreeManager(process.cwd());
  return createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (request.method === "OPTIONS") {
      try {
        assertHttpBoundary(request, csrfToken);
        response.writeHead(204, corsHeaders(request.headers.origin));
        response.end();
      } catch (error) {
        send(response, error.statusCode ?? 400, { error: error.message });
      }
      return;
    }

    try {
      assertHttpBoundary(request, csrfToken);
      if (request.method === "GET" && url.pathname === "/api/health") {
        send(response, 200, { ok: true, service: "agent-harness-local", runtimeSchemaVersion: RUNTIME_SCHEMA_VERSION });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/runtime/status") {
        const runtime = await orchestrator.status();
        send(response, 200, { ...runtime, suggestedRepository, runtimeSchemaVersion: RUNTIME_SCHEMA_VERSION, csrfToken });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/settings") {
        send(response, 200, { settings: await store.settings(), runtimeSchemaVersion: RUNTIME_SCHEMA_VERSION });
        return;
      }
      if (request.method === "PUT" && url.pathname === "/api/settings") {
        const input = await readJson(request);
        const catalog = await readCodexModelCatalog();
        const known = new Map(catalog.models.filter((model) => model.editable).map((model) => [model.id, model]));
        const allowedModels = [...new Set((Array.isArray(input.allowedModels) ? input.allowedModels : []).map(normalizeModelId))]
          .filter((modelId) => known.has(modelId));
        const defaultModel = normalizeModelId(input.defaultModel);
        const selected = known.get(defaultModel);
        if (!allowedModels.length) throw new Error("Allow at least one model.");
        if (!allowedModels.includes(defaultModel) || !selected) throw new Error("The default model must be in the allowed model list.");
        const defaultReasoning = String(input.defaultReasoning ?? "");
        if (!selected.reasoningLevels.includes(defaultReasoning)) throw new Error(`${selected.label} does not support ${defaultReasoning || "that"} reasoning.`);
        const currentSettings = await store.settings();
        const stagePolicies = validateStagePolicies(input.stagePolicies, known, allowedModels, currentSettings.stagePolicies);
        const settings = await store.updateSettings((draft) => {
          draft.allowedModels = allowedModels;
          draft.defaultModel = defaultModel;
          draft.defaultReasoning = defaultReasoning;
          draft.stagePolicies = stagePolicies;
        });
        send(response, 200, { settings });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/runtime/pricing/verify") {
        if (typeof orchestrator.verifyPricing !== "function") throw new Error("Pricing verification is unavailable in this runtime.");
        send(response, 200, await orchestrator.verifyPricing());
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/runtime/worktrees") {
        const tasks = await store.list();
        const entries = tasks.flatMap(worktreeEntriesForTask);
        const rows = await worktrees.inventory(entries);
        send(response, 200, { rows });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/changelog") {
        send(response, 200, { commits: await listChangelog(suggestedRepository, 10) });
        return;
      }
      const changelogFileMatch = url.pathname.match(/^\/api\/changelog\/([0-9a-f]{7,64})\/file$/i);
      if (request.method === "GET" && changelogFileMatch) {
        const sha = changelogFileMatch[1];
        const filePath = String(url.searchParams.get("path") ?? "");
        const detail = await changelogDetail(suggestedRepository, sha);
        if (!detail.files.some((file) => file.path === filePath)) throw new Error("Choose a file changed by this commit.");
        const diff = await git(suggestedRepository, ["show", "--format=", "--no-ext-diff", "--unified=3", sha, "--", filePath]);
        send(response, 200, { sha: detail.sha, path: filePath, diff: diff.slice(0, DIFF_CHAR_LIMIT), truncated: diff.length > DIFF_CHAR_LIMIT });
        return;
      }
      const changelogDetailMatch = url.pathname.match(/^\/api\/changelog\/([0-9a-f]{7,64})$/i);
      if (request.method === "GET" && changelogDetailMatch) {
        send(response, 200, { commit: await changelogDetail(suggestedRepository, changelogDetailMatch[1]) });
        return;
      }
      const taskWorktreesMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/worktrees$/);
      if (request.method === "GET" && taskWorktreesMatch) {
        const task = await store.get(decodeURIComponent(taskWorktreesMatch[1]));
        if (!task) {
          send(response, 404, { error: "Task not found." });
          return;
        }
        send(response, 200, { rows: await worktrees.inventory(worktreeEntriesForTask(task)) });
        return;
      }
      const candidateDiffMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/candidates\/([^/]+)\/diff$/);
      if (request.method === "GET" && candidateDiffMatch) {
        const taskId = decodeURIComponent(candidateDiffMatch[1]);
        const candidateId = decodeURIComponent(candidateDiffMatch[2]);
        const task = await store.get(taskId);
        if (!task) {
          send(response, 404, { error: "Task not found." });
          return;
        }
        const candidate = task.candidates?.find((entry) => entry?.id === candidateId);
        if (!candidate) {
          send(response, 404, { error: "Candidate not found." });
          return;
        }
        await worktrees.verifyCandidate(candidate);
        const diff = await git(candidate.worktreePath, [
          "diff",
          "--no-ext-diff",
          "--unified=3",
          candidate.baseRevision,
          candidate.headRevision,
        ]);
        const cappedDiff = diff.slice(0, DIFF_CHAR_LIMIT);
        send(response, 200, {
          candidateId: candidate.id,
          revisionNumber: candidate.revisionNumber,
          headRevision: candidate.headRevision,
          worktreePath: candidate.worktreePath,
          diff: cappedDiff,
          truncated: diff.length > DIFF_CHAR_LIMIT,
        });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/tasks") {
        send(response, 200, { tasks: await store.list() });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/evaluations/summary") {
        send(response, 200, buildEvaluationSummary(await store.list()));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/tasks") {
        const input = await readJson(request);
        if (!input.title?.trim() || !input.description?.trim()) throw new Error("Title and description are required.");
        if (!VALID_WORKFLOWS.has(input.workflow)) throw new Error("invalid workflow");
        const attachments = validateAttachments(input.attachments);
        const settings = await store.settings();
        const catalog = await readCodexModelCatalog();
        const requestedModel = normalizeModelId(input.model ?? settings.defaultModel);
        const selectedModel = catalog.models.find((model) => model.id === requestedModel && model.editable);
        if (!settings.allowedModels.includes(requestedModel) || !selectedModel) throw new Error("Choose a model from the allowed runtime list in Settings.");
        const requestedReasoning = String(input.reasoning ?? settings.defaultReasoning);
        if (!selectedModel.reasoningLevels.includes(requestedReasoning)) throw new Error(`${selectedModel.label} does not support ${requestedReasoning} reasoning.`);
        const taskPolicies = input.model || input.reasoning
          ? Object.fromEntries(POLICY_IDS.map((policyId) => [policyId, { model: requestedModel, reasoning: requestedReasoning }]))
          : structuredClone(settings.stagePolicies);
        const repositoryPath = await validateRepository(input.repositoryPath);
        const priority = ["low", "medium", "high"].includes(input.priority) ? input.priority : "medium";
        let experiment = null;
        if (input.experiment != null) {
          const requestedBase = String(input.experiment.frozenBaseSha ?? "").trim();
          if (!/^[a-f0-9]{40,64}$/i.test(requestedBase)) throw new Error("Controlled experiments require a full frozen base commit SHA.");
          const frozenBaseSha = String(await git(repositoryPath, ["rev-parse", "--verify", `${requestedBase}^{commit}`])).trim();
          const repositoryHead = String(await git(repositoryPath, ["rev-parse", "HEAD"])).trim();
          if (repositoryHead !== frozenBaseSha) throw new Error("The selected repository must be checked out at the frozen experiment base.");
          experiment = normalizeExperimentInput(input.experiment, {
            taskBriefHash: hashTaskBrief({ ...input, priority, attachments }),
            policyMatrix: taskPolicies,
            frozenBaseSha,
          });
        }
        let task = await store.create({
          title: input.title.trim().slice(0, 300),
          description: input.description.trim().slice(0, 20_000),
          repositoryPath,
          workflow: input.workflow,
          priority,
          model: requestedModel,
          reasoning: requestedReasoning,
          stagePolicies: taskPolicies,
          experiment,
        });
        if (attachments.length) {
          const attachmentRoot = path.join(store.dataDirectory(), "attachments", task.id);
          await mkdir(attachmentRoot, { recursive: true });
          const saved = [];
          for (const attachment of attachments) {
            const extension = path.extname(attachment.name).toLowerCase();
            const storedPath = path.join(attachmentRoot, `${crypto.randomUUID()}${extension}`);
            await writeFile(storedPath, Buffer.from(attachment.data, "base64"));
            saved.push({ id: crypto.randomUUID(), name: attachment.name, type: attachment.type, size: attachment.size, path: storedPath });
          }
          task = await store.update(task.id, (draft) => { draft.attachments = saved; });
        }
        send(response, 201, { task });
        return;
      }

      const taskMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)$/);
      if (request.method === "GET" && taskMatch) {
        const task = await store.get(decodeURIComponent(taskMatch[1]));
        send(response, task ? 200 : 404, task ? { task } : { error: "Task not found." });
        return;
      }

      const closeMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/close$/);
      if (request.method === "POST" && closeMatch) {
        const id = decodeURIComponent(closeMatch[1]);
        const task = await store.get(id);
        if (!task) {
          send(response, 404, { error: "Task not found." });
          return;
        }
        if (task.status === "running") throw new Error("Cancel the active run before closing this task.");
        if (task.status === "merging" || task.mergeIntent?.status === "pending") {
          send(response, 409, { error: "Wait for the pending merge reconciliation before closing this task." });
          return;
        }
        const input = await readJson(request);
        const reason = ["not-needed", "superseded", "duplicate"].includes(input.reason) ? input.reason : "not-needed";
        const supersededBy = reason === "superseded" ? String(input.supersededBy ?? "").trim().slice(0, 80) : null;
        const note = String(input.note ?? "").trim().slice(0, 2_000);
        const closedAt = new Date().toISOString();
        let closed;
        try {
          closed = await store.transition(id, (draft) => (
            draft.status !== "running" &&
            !draft.activeRunKind &&
            draft.status !== "closed" &&
            draft.status !== "merging" &&
            draft.mergeIntent?.status !== "pending"
          ), (draft) => {
            draft.status = "closed";
            draft.activeRunKind = null;
            draft.error = null;
            draft.closure = { reason, supersededBy: supersededBy || null, note, closedAt };
            draft.events.push({
              id: crypto.randomUUID(),
              at: closedAt,
              category: "decision",
              tone: "info",
              stage: draft.currentStage,
              title: reason === "superseded" ? "Task marked superseded" : "Task closed",
              detail: supersededBy ? `Superseded by ${supersededBy}${note ? ` - ${note}` : ""}` : note || "No further work is required.",
            });
          });
        } catch (error) {
          if (error.code !== "TASK_TRANSITION_CONFLICT") throw error;
          send(response, 409, { error: "Task state changed or merge reconciliation began before it could be closed." });
          return;
        }
        send(response, 200, { task: closed });
        return;
      }

      const evaluationMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/evaluation$/);
      if (request.method === "POST" && evaluationMatch) {
        const id = decodeURIComponent(evaluationMatch[1]);
        if (!(await store.get(id))) {
          send(response, 404, { error: "Task not found." });
          return;
        }
        const input = await readJson(request);
        const task = await store.update(id, (draft) => {
          draft.evaluation = normalizeEvaluationInput(input, draft.evaluation);
        });
        send(response, 200, { task });
        return;
      }

      const decisionMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/decisions$/);
      if (request.method === "POST" && decisionMatch) {
        const id = decodeURIComponent(decisionMatch[1]);
        const task = await store.get(id);
        if (!task) {
          send(response, 404, { error: "Task not found." });
          return;
        }
        if (task.status === "running") throw new Error("Wait for the active agent before recording a decision.");
        const input = await readJson(request);
        if (!input.question?.trim() || !input.answer?.trim()) throw new Error("Decision question and answer are required.");
        await orchestrator.recordDecision(id, input);
        send(response, 201, { recorded: true });
        return;
      }

      const grillAnswerMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/grill\/answers$/);
      if (request.method === "POST" && grillAnswerMatch) {
        const id = decodeURIComponent(grillAnswerMatch[1]);
        const input = await readJson(request);
        if (!input.questionId?.trim() || !input.answer?.trim()) throw new Error("Question ID and answer are required.");
        input.questionId = input.questionId.trim();
        input.answer = input.answer.trim();
        await orchestrator.answerGrillQuestion(id, input);
        send(response, 201, { recorded: true });
        return;
      }

      const finishGrillMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/grill\/finish$/);
      if (request.method === "POST" && finishGrillMatch) {
        const id = decodeURIComponent(finishGrillMatch[1]);
        const input = await readJson(request);
        const result = await orchestrator.finishGrill(id, { acceptRemaining: input.acceptRemaining === true });
        send(response, 202, result);
        return;
      }

      const actionMatch = url.pathname.match(
        /^\/api\/tasks\/([^/]+)\/(run|cancel|approve-spec|approve-plan|specification|plan|implement|repair|review|test|final-review|approve-merge|grant-retry)$/,
      );
      if (request.method === "POST" && actionMatch) {
        const id = decodeURIComponent(actionMatch[1]);
        const task = await store.get(id);
        if (!task) {
          send(response, 404, { error: "Task not found." });
          return;
        }
        const action = actionMatch[2];
        if (action === "cancel") {
          const cancelled = await orchestrator.cancel(id);
          send(response, cancelled ? 202 : 409, cancelled ? { cancelled: true } : { error: "Task is not running." });
          return;
        }

        const notes = ["approve-spec", "approve-plan", "approve-merge"].includes(action)
          ? await readJson(request)
          : {};
        if (action === "approve-spec") {
          const result = await orchestrator.approveSpecification(id, notes.note ?? "");
          send(response, result.started ? 202 : 200, result);
          return;
        }
        if (action === "approve-plan") {
          await orchestrator.approvePlan(id, notes.note ?? "");
          send(response, 200, { approved: true });
          return;
        }
        if (action === "approve-merge") {
          await orchestrator.approveMerge(id, notes.note ?? "");
          send(response, 200, { merged: true });
          return;
        }
        if (action === "grant-retry") {
          const grant = retryGrantContext(task);
          if (grant.error) {
            send(response, 409, { error: grant.error });
            return;
          }
          let reservedGrant = null;
          await store.transition(id, (draft) => {
            const currentGrant = retryGrantContext(draft);
            if (!sameRetryGrantContext(grant, currentGrant)) return false;
            reservedGrant = currentGrant;
            return true;
          }, (draft) => {
            const {
              candidate,
              candidateHeadRevision,
              candidateId,
              candidateRevision,
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
            const decision = {
              id: crypto.randomUUID(),
              question: candidate?.status === "repair_required" ? "Grant another repair attempt?" : "Grant another stage attempt?",
              answer: `Human override increased the ${grantedStage} allowance to ${nextStageLimit}.`,
              grantedStage,
              previousLimit: currentLimit,
              newLimit: nextStageLimit,
              sourceRunId: retrySource?.id ?? null,
              sourceRunIds,
              candidateId,
              candidateRevision,
              candidateHeadRevision,
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
              title: candidate?.status === "repair_required" ? "One repair attempt granted" : "One stage attempt granted",
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
              workflowAttempt,
              workflowCandidateId,
              workflowCandidateRevision,
              workflowCandidateHeadRevision,
              workflowReservationId,
              retryOfRunId: retrySource?.id ?? null,
            });
          });
          send(response, 200, { granted: true });
          return;
        }

        const runConfiguration = {
          run: {
            kind: "investigation",
            statuses: ["queued", "failed", "cancelled"],
            stages: ["triage", "scouts", "grill"],
          },
          specification: { kind: "specification", statuses: ["failed", "cancelled"], stages: ["specification"] },
          plan: { kind: "planning", statuses: ["failed", "cancelled"], stages: ["plan"] },
          implement: {
            kind: "implementation",
            statuses: ["ready-for-implementation", "failed", "cancelled"],
            stages: ["implement"],
          },
          repair: {
            kind: "repair",
            statuses: ["repair-required", "failed", "cancelled"],
            stages: ["implement", "dev-review", "test", "final-review"],
          },
          review: { kind: "review", statuses: ["ready-for-review", "failed", "cancelled"], stages: ["dev-review"] },
          test: { kind: "test", statuses: ["ready-for-test", "failed", "cancelled"], stages: ["test"] },
          "final-review": {
            kind: "final-review",
            statuses: ["ready-for-final-review", "failed", "cancelled"],
            stages: ["final-review"],
          },
        }[action];
        if (!runConfiguration?.statuses.includes(task.status) || !runConfiguration.stages.includes(task.currentStage)) {
          send(response, 409, { error: `Task cannot run ${action} while it is ${task.status}.` });
          return;
        }
        const candidate = task.candidates?.at(-1);
        if (action === "implement" && candidate?.status === "repair_required") {
          send(response, 409, { error: "Use the repair action to create a new revision of this candidate." });
          return;
        }
        if (action === "repair" && candidate?.status !== "repair_required") {
          send(response, 409, { error: "The current candidate is not awaiting repair." });
          return;
        }
        const runStage = runConfiguration.kind === "repair" ? "implement" : task.currentStage;
        const stageAttempts = task.attemptsByStage?.[runStage] ?? 0;
        if (task.status === "blocked" || stageAttempts >= stageRunLimitFor(task, runStage)) {
          send(response, 409, { error: "The current stage has exhausted its retry allowance." });
          return;
        }
        const started = await orchestrator.start(id, runConfiguration.kind);
        send(response, started ? 202 : 409, started ? { started: true } : { error: "Task is already running." });
        return;
      }

      send(response, 404, { error: "Not found." });
    } catch (error) {
      send(response, error.statusCode ?? 400, { error: error.message });
    }
  });
}

function retryGrantContext(task) {
  const candidate = task.candidates?.at(-1);
  const grantedStage = candidate?.status === "repair_required" ? "implement" : task.currentStage;
  if (!CANONICAL_RUN_STAGES.includes(grantedStage)) {
    return { error: "The current stage cannot receive a retry grant." };
  }
  const currentAttempts = task.attemptsByStage?.[grantedStage] ?? 0;
  const currentLimit = stageRunLimitFor(task, grantedStage);
  if (currentAttempts > currentLimit) {
    return {
      error: "The recorded attempts exceed this stage's allowance; resolve the inconsistent task state before granting a retry.",
    };
  }
  const exhaustedRepair =
    ["repair-required", "failed"].includes(task.status) &&
    candidate?.status === "repair_required" &&
    currentAttempts >= currentLimit;
  const exhaustedReadyGate =
    ["ready-for-review", "ready-for-test", "ready-for-final-review"].includes(task.status) &&
    currentAttempts >= currentLimit;
  const exhaustedBlockedStage = task.status === "blocked" && currentAttempts >= currentLimit;
  if (!exhaustedRepair && !exhaustedReadyGate && !exhaustedBlockedStage) {
    return { error: "A retry can only be granted to an exhausted blocked stage or repair attempt." };
  }
  if (task.activeRunKind || task.activeRunReservationId || (task.activeRunIds?.length ?? 0) > 0) {
    return { error: "An active or inconsistent run reservation must be resolved before granting a retry." };
  }
  if ((task.runs ?? []).some((run) => run?.status === "running")) {
    return { error: "An active or inconsistent run history must be resolved before granting a retry." };
  }
  const stageRuns = (task.runs ?? []).filter((run) => run.stage === grantedStage);
  const terminalStatuses = new Set(["completed", "failed", "cancelled", "interrupted", "timed-out", "timed_out", "timeout"]);
  if (stageRuns.some((run) => !terminalStatuses.has(run.status))) {
    return { error: "The exhausted stage contains a non-terminal run; resolve the inconsistent history before granting a retry." };
  }
  if (new Set(stageRuns.map((run) => run.id)).size !== stageRuns.length) {
    return { error: "The exhausted stage has duplicate run identities; resolve the inconsistent task state before granting a retry." };
  }
  const reservation = task.stageRunReservations?.[grantedStage] ?? null;
  const candidateBoundGrant = ["dev-review", "test", "final-review"].includes(grantedStage) ||
    candidate?.status === "repair_required";
  if (candidateBoundGrant && !validRetryCandidate(candidate)) {
    return { error: "The exhausted candidate-bound stage is missing an exact candidate identity; resolve it before granting a retry." };
  }
  if (!reservation || (
    typeof reservation.id !== "string" ||
    !reservation.id.trim() ||
    reservation.stage !== grantedStage ||
    !Number.isInteger(reservation.workflowAttempt) ||
    reservation.workflowAttempt < 1 ||
    reservation.workflowAttempt !== currentAttempts ||
    !validPersistedTimestamp(reservation.reservedAt) ||
    !validRetryReservationCandidateBinding(
      reservation,
      candidateBoundGrant,
      candidate,
      grantedStage,
      task.stageRunReservations,
    ) ||
    !validRetryReservationKind(grantedStage, reservation.kind)
  )) {
    return { error: "The exhausted stage has an inconsistent workflow reservation; resolve it before granting a retry." };
  }
  if (!validRetryWorkflowIdentities(stageRuns, reservation, currentAttempts)) {
    return { error: "The exhausted stage has partial or orphaned workflow identity; resolve it before granting a retry." };
  }
  const exactReservation = reservation?.workflowAttempt === currentAttempts ? reservation : null;
  const reservationRuns = exactReservation
    ? stageRuns.filter((run) => run.workflowReservationId === exactReservation.id)
    : [];
  if (exactReservation && reservationRuns.some((run) => (
    run.workflowAttempt !== exactReservation.workflowAttempt ||
    run.candidateId !== exactReservation.candidateId ||
    run.candidateRevision !== exactReservation.candidateRevision ||
    run.candidateHeadRevision !== exactReservation.candidateHeadRevision ||
    !validRetryRunTuple(run, exactReservation, stageRuns)
  ))) {
    return { error: "The exhausted stage run does not match its workflow reservation; resolve the inconsistent history before granting a retry." };
  }
  if (exactReservation && stageRuns.some((run) => (
    run.workflowAttempt === currentAttempts && run.workflowReservationId !== exactReservation.id
  ))) {
    return { error: "The exhausted workflow attempt contains conflicting run reservations; resolve it before granting a retry." };
  }
  const multiRunScopeError = validateRetryRunScopes(task, exactReservation, reservationRuns);
  if (multiRunScopeError) return { error: multiRunScopeError };
  const sourceRuns = orderRetrySourceRuns(exactReservation, reservationRuns);
  const retrySource = sourceRuns.at(-1) ?? null;
  const sourceRunIds = sourceRuns.map((run) => run.id);
  const historySnapshot = JSON.stringify({
    currentStage: task.currentStage,
    activeRunKind: task.activeRunKind ?? null,
    activeRunReservationId: task.activeRunReservationId ?? null,
    activeRunIds: task.activeRunIds ?? [],
    candidate: candidate ?? null,
    reservation,
    stageRuns,
  });
  const grantCandidate = candidateBoundGrant ? candidate : null;
  return {
    candidate,
    grantedStage,
    currentAttempts,
    currentLimit,
    taskStatus: task.status,
    candidateId: grantCandidate?.id ?? null,
    candidateRevision: grantCandidate?.revisionNumber ?? null,
    candidateHeadRevision: grantCandidate?.headRevision ?? null,
    candidateStatus: candidate?.status ?? null,
    historySnapshot,
    retrySource,
    sourceRunId: retrySource?.id ?? null,
    sourceRunIds,
    sourceRunStatus: retrySource?.status ?? null,
    workflowAttempt: exactReservation?.workflowAttempt ?? currentAttempts,
    workflowCandidateId: exactReservation?.candidateId ?? null,
    workflowCandidateRevision: exactReservation?.candidateRevision ?? null,
    workflowCandidateHeadRevision: exactReservation?.candidateHeadRevision ?? null,
    workflowReservationId: exactReservation?.id ?? null,
    error: null,
  };
}

function validRetryCandidate(candidate) {
  return typeof candidate?.id === "string" && candidate.id.trim().length > 0 &&
    Number.isInteger(candidate.revisionNumber) && candidate.revisionNumber > 0 &&
    typeof candidate.headRevision === "string" && candidate.headRevision.trim().length > 0;
}

function validRetryReservationCandidateBinding(reservation, candidateRequired, candidate, grantedStage, reservations) {
  const allNull = reservation.candidateId == null &&
    reservation.candidateRevision == null &&
    reservation.candidateHeadRevision == null;
  if (!candidateRequired) return allNull;
  const sourceReservation = reservation.id === candidate?.sourceWorkflowReservationId &&
    reservation.workflowAttempt === candidate?.sourceWorkflowAttempt;
  if (allNull) {
    return grantedStage === "implement" && sourceReservation && reservation.kind === "implementation";
  }
  const completeBinding = typeof reservation.candidateId === "string" && reservation.candidateId.trim().length > 0 &&
    Number.isInteger(reservation.candidateRevision) && reservation.candidateRevision > 0 &&
    typeof reservation.candidateHeadRevision === "string" && reservation.candidateHeadRevision.trim().length > 0;
  if (!completeBinding) return false;
  const exactCurrentCandidate = reservation.candidateId === candidate?.id &&
    reservation.candidateRevision === candidate?.revisionNumber &&
    reservation.candidateHeadRevision === candidate?.headRevision;
  if (exactCurrentCandidate) return true;
  if (grantedStage !== "implement") {
    if (
      reservation.candidateId !== candidate?.id ||
      reservation.candidateRevision + 1 !== candidate?.revisionNumber
    ) {
      return false;
    }
    return validAdjacentRepairLineage(candidate, reservation, reservations?.implement);
  }
  if (!sourceReservation || reservation.kind !== "repair" || reservation.candidateId !== candidate?.id) return false;
  return validAdjacentRepairLineage(candidate, reservation, reservation);
}

function validAdjacentRepairLineage(candidate, priorReservation, repairReservation) {
  const revisions = candidate?.revisions;
  if (!Array.isArray(revisions) || revisions.length !== candidate.revisionNumber) return false;
  const byNumber = new Map();
  const heads = new Set();
  const sourceReservations = new Set();
  for (const revision of revisions) {
    if (
      !Number.isInteger(revision?.number) ||
      revision.number < 1 ||
      revision.number > candidate.revisionNumber ||
      byNumber.has(revision.number) ||
      typeof revision.headRevision !== "string" ||
      !revision.headRevision.trim() ||
      heads.has(revision.headRevision) ||
      revision.reason !== (revision.number === 1 ? "assembly" : "repair") ||
      !Number.isInteger(revision.sourceWorkflowAttempt) ||
      revision.sourceWorkflowAttempt < 1 ||
      typeof revision.sourceWorkflowReservationId !== "string" ||
      !revision.sourceWorkflowReservationId.trim() ||
      sourceReservations.has(revision.sourceWorkflowReservationId) ||
      !validPersistedTimestamp(revision.createdAt)
    ) {
      return false;
    }
    byNumber.set(revision.number, revision);
    heads.add(revision.headRevision);
    sourceReservations.add(revision.sourceWorkflowReservationId);
  }
  let previousAttempt = 0;
  let previousCreatedAt = -Infinity;
  for (let number = 1; number <= candidate.revisionNumber; number += 1) {
    const revision = byNumber.get(number);
    if (!revision) return false;
    const createdAt = Date.parse(revision.createdAt);
    if (revision.sourceWorkflowAttempt <= previousAttempt || createdAt <= previousCreatedAt) return false;
    previousAttempt = revision.sourceWorkflowAttempt;
    previousCreatedAt = createdAt;
  }
  const priorRevision = byNumber.get(priorReservation.candidateRevision);
  const currentRevision = byNumber.get(candidate.revisionNumber);
  const sourceReservationId = currentRevision?.sourceWorkflowReservationId;
  const sourceAttempt = currentRevision?.sourceWorkflowAttempt;
  const priorCreatedAt = Date.parse(priorRevision?.createdAt);
  const currentCreatedAt = Date.parse(currentRevision?.createdAt);
  const priorReservedAt = Date.parse(priorReservation?.reservedAt);
  const repairReservedAt = Date.parse(repairReservation?.reservedAt);
  return priorReservation.candidateRevision + 1 === candidate.revisionNumber &&
    priorRevision?.headRevision === priorReservation.candidateHeadRevision &&
    currentRevision?.headRevision === candidate.headRevision &&
    currentRevision?.reason === "repair" &&
    typeof sourceReservationId === "string" &&
    sourceReservationId.trim().length > 0 &&
    Number.isInteger(sourceAttempt) &&
    sourceAttempt > 0 &&
    candidate.sourceWorkflowReservationId === sourceReservationId &&
    candidate.sourceWorkflowAttempt === sourceAttempt &&
    repairReservation?.id === sourceReservationId &&
    repairReservation.workflowAttempt === sourceAttempt &&
    repairReservation.stage === "implement" &&
    repairReservation.kind === "repair" &&
    repairReservation.candidateId === candidate.id &&
    repairReservation.candidateRevision === priorRevision.number &&
    repairReservation.candidateHeadRevision === priorRevision.headRevision &&
    validPersistedTimestamp(repairReservation.reservedAt) &&
    priorReservedAt >= priorCreatedAt &&
    priorReservedAt < currentCreatedAt &&
    repairReservedAt > priorCreatedAt &&
    repairReservedAt <= currentCreatedAt &&
    (priorReservation.stage === "implement" || repairReservation.id !== priorReservation.id);
}

function validPersistedTimestamp(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime()) && timestamp.toISOString() === value;
}

function validRetryWorkflowIdentities(stageRuns, reservation, currentAttempts) {
  for (const run of stageRuns) {
    const hasWorkflowAttempt = run.workflowAttempt != null;
    const hasReservationId = run.workflowReservationId != null;
    if (hasWorkflowAttempt !== hasReservationId) return false;
    if (!hasWorkflowAttempt) continue;
    if (
      !Number.isInteger(run.workflowAttempt) ||
      run.workflowAttempt < 1 ||
      run.workflowAttempt > currentAttempts ||
      typeof run.workflowReservationId !== "string" ||
      !run.workflowReservationId.trim()
    ) {
      return false;
    }
    if (!reservation) return false;
    if (run.workflowAttempt === currentAttempts && run.workflowReservationId !== reservation.id) return false;
    if (run.workflowReservationId === reservation.id && run.workflowAttempt !== reservation.workflowAttempt) return false;
  }
  return true;
}

function validRetryReservationKind(stage, kind) {
  const allowed = {
    triage: ["investigation"],
    scouts: ["investigation"],
    grill: ["investigation"],
    specification: ["investigation", "specification"],
    plan: ["planning"],
    implement: ["implementation", "repair"],
    "dev-review": ["review"],
    test: ["test"],
    "final-review": ["final-review"],
  }[stage] ?? [];
  return allowed.includes(kind);
}

function validRetryRunTuple(run, reservation, stageRuns) {
  const expected = reservation.kind === "repair"
    ? { kind: "repair", role: "repair", workPackage: "none" }
    : reservation.kind === "implementation"
      ? { kind: "implementation", role: "implement", workPackage: "required" }
      : {
          triage: { kind: "agent", role: "triage", workPackage: "none" },
          scouts: Array.isArray(reservation.authorizedRunScopes) && reservation.authorizedRunScopes.length
            ? { kind: "scout", role: "authorized-scout", workPackage: "none" }
            : { kind: "agent", role: "scouts", workPackage: "none" },
          grill: { kind: "agent", role: "grill", workPackage: "none" },
          specification: { kind: "agent", role: "specification", workPackage: "none" },
          plan: { kind: "agent", role: "plan", workPackage: "none" },
          "dev-review": { kind: "review", role: "dev-review", workPackage: "none" },
          test: { kind: "test", role: "test", workPackage: "none" },
          "final-review": { kind: "final-review", role: "final-review", workPackage: "none" },
        }[reservation.stage];
  if (typeof run.id !== "string" || !run.id.trim()) return false;
  if (!expected || run.kind !== expected.kind) return false;
  if (expected.role === "authorized-scout") {
    if (!reservation.authorizedRunScopes.includes(run.role)) return false;
  } else if (run.role !== expected.role) return false;
  if (expected.workPackage === "none" && run.workPackageId != null) return false;
  if (expected.workPackage === "required" && (typeof run.workPackageId !== "string" || !run.workPackageId.trim())) return false;
  if (!Number.isInteger(run.attempt) || run.attempt < 1) return false;
  let scopeAttempt = 0;
  for (const scopedRun of stageRuns) {
    if (
      scopedRun.stage === run.stage &&
      scopedRun.role === run.role &&
      scopedRun.workPackageId === run.workPackageId &&
      scopedRun.candidateId === run.candidateId &&
      scopedRun.candidateRevision === run.candidateRevision
    ) {
      scopeAttempt += 1;
    }
    if (scopedRun.id === run.id) return run.attempt === scopeAttempt;
  }
  return false;
}

function validateRetryRunScopes(task, reservation, reservationRuns) {
  const multiRunStage = reservation?.kind === "implementation" || reservation?.stage === "scouts";
  if (!multiRunStage) {
    if (reservationRuns.length <= 1) return null;
    return "The exhausted workflow reservation has multiple source runs for a singleton stage; resolve the inconsistent history before granting a retry.";
  }
  const authorized = reservation.authorizedRunScopes;
  if (reservationRuns.length <= 1 && (!Array.isArray(authorized) || !authorized.length)) return null;
  if (
    !Array.isArray(authorized) ||
    !authorized.length ||
    authorized.some((scope) => typeof scope !== "string" || !scope.trim()) ||
    new Set(authorized).size !== authorized.length
  ) {
    return "The exhausted multi-run reservation is missing unique authorized run scopes; resolve the inconsistent history before granting a retry.";
  }
  if (reservation.stage === "scouts") {
    const selected = (task.scoutDispatch?.selected ?? []).map((scout) => scout?.name);
    if (
      selected.length !== authorized.length ||
      new Set(selected).size !== selected.length ||
      selected.some((scope) => !authorized.includes(scope))
    ) {
      return "The exhausted Scout reservation does not match its persisted dispatch; resolve the inconsistent history before granting a retry.";
    }
  }
  const runScopes = reservationRuns.map((run) => (
    reservation.kind === "implementation" ? run.workPackageId : run.role
  ));
  if (new Set(runScopes).size !== runScopes.length || runScopes.some((scope) => !authorized.includes(scope))) {
    return "The exhausted multi-run reservation contains duplicate or unauthorized run scopes; resolve the inconsistent history before granting a retry.";
  }
  return null;
}

function orderRetrySourceRuns(reservation, runs) {
  const authorized = reservation?.authorizedRunScopes;
  if (!Array.isArray(authorized) || !authorized.length || runs.length <= 1) return runs;
  return [...runs].sort((left, right) => {
    const leftScope = reservation.kind === "implementation" ? left.workPackageId : left.role;
    const rightScope = reservation.kind === "implementation" ? right.workPackageId : right.role;
    return authorized.indexOf(leftScope) - authorized.indexOf(rightScope);
  });
}

function sameRetryGrantContext(expected, current) {
  if (expected.error || current.error) return false;
  return [
    "grantedStage",
    "currentAttempts",
    "currentLimit",
    "taskStatus",
    "candidateId",
    "candidateRevision",
    "candidateHeadRevision",
    "candidateStatus",
    "historySnapshot",
    "sourceRunId",
    "sourceRunStatus",
    "workflowAttempt",
    "workflowCandidateId",
    "workflowCandidateRevision",
    "workflowCandidateHeadRevision",
    "workflowReservationId",
  ].every((field) => expected[field] === current[field]) &&
    JSON.stringify(expected.sourceRunIds) === JSON.stringify(current.sourceRunIds);
}

async function listChangelog(repositoryPath, limit) {
  await git(repositoryPath, ["rev-parse", "--is-inside-work-tree"]);
  const output = await git(repositoryPath, [
    "log",
    `--max-count=${Math.min(10, Math.max(1, limit))}`,
    "--pretty=format:%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1e",
  ]);
  return output
    .split("\x1e")
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha, shortSha, author, authoredAt, subject] = record.split("\x1f");
      return { sha, shortSha, author, authoredAt, subject };
    });
}

async function changelogDetail(repositoryPath, revision) {
  const sha = (await git(repositoryPath, ["rev-parse", "--verify", `${revision}^{commit}`])).trim();
  const [metadata, filesOutput] = await Promise.all([
    git(repositoryPath, ["show", "-s", "--pretty=format:%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1f%b", sha]),
    git(repositoryPath, ["diff-tree", "--root", "--no-commit-id", "--name-status", "-r", "-M", sha, "--"]),
  ]);
  const [fullSha, shortSha, author, authoredAt, subject, ...bodyParts] = metadata.split("\x1f");
  const files = filesOutput
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [status, ...paths] = line.split("\t");
      return {
        status,
        path: paths.at(-1) ?? "",
        previousPath: paths.length > 1 ? paths[0] : null,
      };
    })
    .filter((file) => file.path);
  return { sha: fullSha, shortSha, author, authoredAt, subject, body: bodyParts.join("\x1f").trim(), files };
}

function git(cwd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout = `${stdout}${chunk}`.slice(-OUTPUT_LIMIT);
    });
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-OUTPUT_LIMIT);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `git ${args[0]} failed with code ${code ?? 1}.`));
    });
  });
}
