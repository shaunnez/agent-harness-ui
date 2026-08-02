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

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const VALID_WORKFLOWS = new Set(["investigate", "implement"]);
const RUNTIME_SCHEMA_VERSION = 4;
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
        const known = new Map(catalog.models.map((model) => [model.id, model]));
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
        const selectedModel = catalog.models.find((model) => model.id === requestedModel);
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
        const input = await readJson(request);
        const reason = ["not-needed", "superseded", "duplicate"].includes(input.reason) ? input.reason : "not-needed";
        const supersededBy = reason === "superseded" ? String(input.supersededBy ?? "").trim().slice(0, 80) : null;
        const note = String(input.note ?? "").trim().slice(0, 2_000);
        const closedAt = new Date().toISOString();
        const closed = await store.transition(id, (draft) => draft.status !== "running" && !draft.activeRunKind && draft.status !== "closed", (draft) => {
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
        /^\/api\/tasks\/([^/]+)\/(run|cancel|approve-spec|approve-plan|plan|implement|repair|review|test|final-review|approve-merge|grant-retry)$/,
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
          const cancelled = orchestrator.cancel(id);
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
          const candidate = task.candidates?.at(-1);
          const recoverableImplementation = task.currentStage === "implement";
          const currentAttempts = task.attemptsByStage?.[task.currentStage] ?? 0;
          const exhaustedRepair =
            ["repair-required", "failed"].includes(task.status) &&
            candidate?.status === "repair_required" &&
            currentAttempts >= task.stageRunLimit;
          const exhaustedReadyGate =
            ["ready-for-review", "ready-for-test", "ready-for-final-review"].includes(task.status) &&
            currentAttempts >= task.stageRunLimit;
          const blockedRetry =
            task.status === "blocked" && (candidate?.status === "repair_required" || recoverableImplementation);
          if (!exhaustedRepair && !exhaustedReadyGate && !blockedRetry) {
            send(response, 409, { error: "A retry can only be granted to a blocked repair or implementation attempt." });
            return;
          }
          await store.update(id, (draft) => {
            const attempts = draft.attemptsByStage?.[draft.currentStage] ?? 0;
            draft.stageRunLimit = Math.max(draft.stageRunLimit + 1, attempts + 1);
            draft.status = "failed";
            draft.error = null;
            draft.events.push({
              id: crypto.randomUUID(),
              at: new Date().toISOString(),
              category: "decision",
              tone: "warning",
              stage: draft.currentStage,
              title: candidate?.status === "repair_required" ? "One repair attempt granted" : "One stage attempt granted",
              detail: `Human override increased the stage allowance to ${draft.stageRunLimit}.`,
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
          plan: { kind: "planning", statuses: ["failed", "cancelled"], stages: ["plan"] },
          implement: {
            kind: "implementation",
            statuses: ["ready-for-implementation", "failed", "cancelled"],
            stages: ["implement"],
          },
          repair: {
            kind: "repair",
            statuses: ["repair-required", "failed", "cancelled"],
            stages: ["implement", "dev-review", "test"],
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
        const stageAttempts = task.attemptsByStage?.[task.currentStage] ?? 0;
        if (task.status === "blocked" || stageAttempts >= task.stageRunLimit) {
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
