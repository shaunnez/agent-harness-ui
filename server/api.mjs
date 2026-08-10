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
import { defaultWorktreeRoot, GitWorktreeManager } from "./git-worktree.mjs";
import { assertHttpBoundary, corsHeaders } from "./http-security.mjs";
import { normalizeModelId, POLICY_IDS, readExecutionProviderCatalog } from "./model-catalog.mjs";
import {
  CANONICAL_RUN_STAGES,
  CANDIDATE_GATE_STAGES,
  resolveGateFreshness,
  readExecutionProvider,
  resolvePersistedRunFreshness,
  stageRunLimitFor,
} from "./run-activity.mjs";
import { SCOUT_NAMES } from "./scouts.mjs";
import { selectWorkflowProfile, WORKFLOW_PROFILE_IDS } from "./workflow-profiles.mjs";
import {
  findTaskArtifact,
  paginateTaskArtifacts,
  paginateTaskEvents,
  paginateTaskRuns,
  projectTaskCore,
  projectTaskSummary,
} from "./task-projections.mjs";
import { isCanonicalCommitId } from "../src/commit-id.ts";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const VALID_WORKFLOWS = new Set(["investigate", "implement"]);
const RUNTIME_SCHEMA_VERSION = 8;
const GRILL_POLICIES = new Set(["manual", "auto-accept-recommendations"]);
const DIFF_CHAR_LIMIT = 300_000;
const OUTPUT_LIMIT = 512 * 1024;

const requestMetrics = new WeakMap();

function send(response, status, value) {
  const body = JSON.stringify(value);
  const bytes = Buffer.byteLength(body);
  const metric = requestMetrics.get(response);
  const durationMs = metric ? performance.now() - metric.startedAt : 0;
  response.writeHead(status, {
    ...JSON_HEADERS,
    "content-length": String(bytes),
    "server-timing": `app;dur=${durationMs.toFixed(2)}`,
    "x-agent-harness-response-bytes": String(bytes),
  });
  response.end(body);
  metric?.report({
    method: metric.method,
    path: metric.path,
    status,
    durationMs: Math.round(durationMs * 100) / 100,
    responseBytes: bytes,
  });
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

// A closed or archived task's worktrees are no longer part of live work, so they report as
// `stale` regardless of the recorded per-entry status. Archiving additionally *removes* the
// ones it safely can, so for an archived task this mostly describes whatever archiving had to
// leave behind — an entry it could not discard without destroying uncommitted work.
const RETIRED_TASK_STATUSES = new Set(["closed", "archived"]);

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
      lifecycleState: RETIRED_TASK_STATUSES.has(task.status) ? "stale" : workPackage.status ?? "retained",
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
      lifecycleState: RETIRED_TASK_STATUSES.has(task.status) ? "stale" : candidate.status ?? "retained",
    });
  }
  return entries;
}

export function createApiServer({
  store,
  orchestrator,
  suggestedRepository,
  csrfToken = crypto.randomUUID(),
  reportHttpMetric = () => {},
}) {
  // Reads resolve each entry's recorded absolute path, so this root only matters for
  // `prepare`, which the API never calls. It still uses the shared default rather than a
  // second literal: two places computing a worktree root independently is how they drift.
  const worktrees = new GitWorktreeManager(defaultWorktreeRoot());
  const continuationLocks = new Map();
  return createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    requestMetrics.set(response, {
      startedAt: performance.now(),
      method: request.method ?? "UNKNOWN",
      path: url.pathname,
      report: reportHttpMetric,
    });
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
        const catalog = await readExecutionProviderCatalog();
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
        const grillPolicy = input.grillPolicy === undefined ? currentSettings.grillPolicy : String(input.grillPolicy);
        if (!GRILL_POLICIES.has(grillPolicy)) throw new Error("Choose a supported Grill interaction policy.");
        const stagePolicies = validateStagePolicies(input.stagePolicies, known, allowedModels, currentSettings.stagePolicies);
        const profileStagePolicies = Object.fromEntries(WORKFLOW_PROFILE_IDS.map((profile) => [
          profile,
          validateStagePolicies(
            input.profileStagePolicies?.[profile] ?? (profile === "standard" ? stagePolicies : null),
            known,
            allowedModels,
            currentSettings.profileStagePolicies?.[profile] ?? stagePolicies,
          ),
        ]));
        const settings = await store.updateSettings((draft) => {
          draft.allowedModels = allowedModels;
          draft.defaultModel = defaultModel;
          draft.defaultReasoning = defaultReasoning;
          draft.grillPolicy = grillPolicy;
          draft.stagePolicies = stagePolicies;
          draft.profileStagePolicies = profileStagePolicies;
        });
        send(response, 200, { settings });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/runtime/pricing/verify") {
        if (typeof orchestrator.verifyPricing !== "function") throw new Error("Pricing verification is unavailable in this runtime.");
        send(response, 200, await orchestrator.verifyPricing());
        return;
      }
      // Two separate calls on purpose. Proposing is read-only and cheap to repeat; approving
      // writes to the operator's repository and runs its commands unsandboxed. Collapsing them
      // into one endpoint would make approval implicit, and #47's guarantee depends on a human
      // ratifying the commands before they become the harness's source of truth.
      if (request.method === "POST" && url.pathname === "/api/runtime/onboarding/propose") {
        if (typeof orchestrator.proposeOnboarding !== "function") throw new Error("Repository onboarding is unavailable in this runtime.");
        const body = await readJson(request);
        send(response, 200, await orchestrator.proposeOnboarding(body?.repositoryPath));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/runtime/onboarding/approve") {
        if (typeof orchestrator.approveOnboarding !== "function") throw new Error("Repository onboarding is unavailable in this runtime.");
        const body = await readJson(request);
        send(response, 200, await orchestrator.approveOnboarding(body?.repositoryPath, body?.proposal));
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/runtime/worktrees") {
        const tasks = typeof store.listSummaries === "function"
          ? await store.listSummaries()
          : (await store.list()).map(projectTaskSummary);
        const entries = tasks.flatMap(worktreeEntriesForTask);
        const rows = await worktrees.inventory(entries);
        send(response, 200, { rows });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/changelog") {
        send(response, 200, { commits: await listChangelog(suggestedRepository, 10) });
        return;
      }
      const changelogFileMatch = url.pathname.match(/^\/api\/changelog\/([^/]+)\/file$/);
      if (request.method === "GET" && changelogFileMatch) {
        const sha = changelogFileMatch[1];
        if (!isCanonicalCommitId(sha)) throw new Error("Commit ID must be exactly 40 or 64 hexadecimal characters.");
        const filePath = String(url.searchParams.get("path") ?? "");
        const detail = await changelogDetail(suggestedRepository, sha);
        if (!detail.files.some((file) => file.path === filePath)) throw new Error("Choose a file changed by this commit.");
        const diff = await git(suggestedRepository, ["show", "--format=", "--no-ext-diff", "--unified=3", sha, "--", filePath]);
        send(response, 200, { sha: detail.sha, path: filePath, diff: diff.slice(0, DIFF_CHAR_LIMIT), truncated: diff.length > DIFF_CHAR_LIMIT });
        return;
      }
      const changelogDetailMatch = url.pathname.match(/^\/api\/changelog\/([^/]+)$/);
      if (request.method === "GET" && changelogDetailMatch) {
        const sha = changelogDetailMatch[1];
        if (!isCanonicalCommitId(sha)) throw new Error("Commit ID must be exactly 40 or 64 hexadecimal characters.");
        send(response, 200, { commit: await changelogDetail(suggestedRepository, sha) });
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
      const removeWorktreeMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/worktrees\/([^/]+)$/);
      if (request.method === "DELETE" && removeWorktreeMatch) {
        const task = await store.get(decodeURIComponent(removeWorktreeMatch[1]));
        if (!task) {
          send(response, 404, { error: "Task not found." });
          return;
        }
        const rowId = decodeURIComponent(removeWorktreeMatch[2]);
        const entry = worktreeEntriesForTask(task).find((candidate) => candidate.id === rowId);
        if (!entry) {
          send(response, 404, { error: "Worktree entry not found for this task." });
          return;
        }
        // Re-derive cleanup readiness now, from the filesystem, rather than trusting a
        // client-held row: the state behind it can change between the list request and
        // this one, and a currently active worktree must never be pulled out from under
        // a running agent.
        const [row] = await worktrees.inventory([entry]);
        if (!row.cleanupReady) {
          throw new Error(`This worktree is not ready for cleanup (${row.currentState}); wait for the current run to finish.`);
        }
        await worktrees.removeWorktree({ worktreePath: entry.worktreePath, repositoryRoot: task.repositoryPath });
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
        const requestedHeadRevision = url.searchParams.get("headRevision")?.trim() || null;
        const requestedRevision = requestedHeadRevision
          ? candidate.revisions?.find((entry) => entry.headRevision === requestedHeadRevision)
          : null;
        if (requestedHeadRevision && !requestedRevision && requestedHeadRevision !== candidate.headRevision) {
          send(response, 409, { error: "Requested candidate revision is no longer recorded for this task." });
          return;
        }
        const targetHeadRevision = requestedRevision?.headRevision ?? candidate.headRevision;
        const targetRevisionNumber = requestedRevision?.number ?? candidate.revisionNumber;
        if (!targetHeadRevision) {
          send(response, 409, { error: "Requested candidate revision has no recorded head commit." });
          return;
        }
        await worktrees.verifyCandidate(candidate);
        const diff = await git(candidate.worktreePath, [
          "diff",
          "--no-ext-diff",
          "--unified=3",
          candidate.baseRevision,
          targetHeadRevision,
        ]);
        const cappedDiff = diff.slice(0, DIFF_CHAR_LIMIT);
        send(response, 200, {
          candidateId: candidate.id,
          revisionNumber: targetRevisionNumber,
          headRevision: targetHeadRevision,
          worktreePath: candidate.worktreePath,
          diff: cappedDiff,
          truncated: diff.length > DIFF_CHAR_LIMIT,
        });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/tasks") {
        const full = url.searchParams.get("view") === "full";
        const tasks = full || typeof store.listSummaries !== "function"
          ? await store.list()
          : await store.listSummaries();
        send(response, 200, {
          tasks: full || typeof store.listSummaries === "function"
            ? tasks
            : tasks.map(projectTaskSummary),
        });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/evaluations/summary") {
        const tasks = typeof store.listEvaluationTasks === "function"
          ? await store.listEvaluationTasks()
          : await store.list();
        send(response, 200, buildEvaluationSummary(tasks));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/tasks") {
        const input = await readJson(request);
        if (!input.title?.trim() || !input.description?.trim()) throw new Error("Title and description are required.");
        if (!VALID_WORKFLOWS.has(input.workflow)) throw new Error("invalid workflow");
        if (input.workflowProfile != null && input.workflowProfile !== "auto" && !WORKFLOW_PROFILE_IDS.includes(input.workflowProfile)) {
          throw new Error("Workflow profile must be auto, fast, standard, or high-risk.");
        }
        const attachments = validateAttachments(input.attachments);
        const settings = await store.settings();
        const catalog = await readExecutionProviderCatalog();
        const requestedModel = normalizeModelId(input.model ?? settings.defaultModel);
        const selectedModel = catalog.models.find((model) => model.id === requestedModel && model.editable);
        if (!settings.allowedModels.includes(requestedModel) || !selectedModel) throw new Error("Choose a model from the allowed runtime list in Settings.");
        const requestedReasoning = String(input.reasoning ?? settings.defaultReasoning);
        if (!selectedModel.reasoningLevels.includes(requestedReasoning)) throw new Error(`${selectedModel.label} does not support ${requestedReasoning} reasoning.`);
        const workflowProfile = selectWorkflowProfile({
          title: input.title,
          description: input.description,
          requestedProfile: WORKFLOW_PROFILE_IDS.includes(input.workflowProfile) ? input.workflowProfile : null,
        });
        const taskProfilePolicies = input.model || input.reasoning
          ? Object.fromEntries(WORKFLOW_PROFILE_IDS.map((profile) => [
              profile,
              Object.fromEntries(POLICY_IDS.map((policyId) => [policyId, { model: requestedModel, reasoning: requestedReasoning }])),
            ]))
          : structuredClone(settings.profileStagePolicies);
        const taskPolicies = structuredClone(
          taskProfilePolicies?.[workflowProfile.selected] ?? settings.stagePolicies,
        );
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
          profileStagePolicies: taskProfilePolicies,
          workflowProfile,
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

      const taskActivityMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/activity$/);
      if (request.method === "GET" && taskActivityMatch) {
        const id = decodeURIComponent(taskActivityMatch[1]);
        const page = typeof store.pageEvents === "function"
          ? await store.pageEvents(id, url.searchParams)
          : null;
        const task = page ? null : await store.get(id);
        send(response, page || task ? 200 : 404, page
          ?? (task ? paginateTaskEvents(task, url.searchParams) : { error: "Task not found." }));
        return;
      }

      const taskRunsMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/runs$/);
      if (request.method === "GET" && taskRunsMatch) {
        const id = decodeURIComponent(taskRunsMatch[1]);
        const page = typeof store.pageRuns === "function"
          ? await store.pageRuns(id, url.searchParams)
          : null;
        const task = page ? null : await store.get(id);
        send(response, page || task ? 200 : 404, page
          ?? (task ? paginateTaskRuns(task, url.searchParams) : { error: "Task not found." }));
        return;
      }

      const taskArtifactMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/artifacts\/([^/]+)$/);
      if (request.method === "GET" && taskArtifactMatch) {
        const taskId = decodeURIComponent(taskArtifactMatch[1]);
        const artifactId = decodeURIComponent(taskArtifactMatch[2]);
        const artifact = typeof store.getArtifact === "function"
          ? await store.getArtifact(taskId, artifactId)
          : findTaskArtifact(await store.get(taskId), artifactId);
        send(response, artifact ? 200 : 404, artifact
          ? { artifact }
          : { error: "Task or artifact not found." });
        return;
      }

      const taskArtifactsMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/artifacts$/);
      if (request.method === "GET" && taskArtifactsMatch) {
        const id = decodeURIComponent(taskArtifactsMatch[1]);
        const page = typeof store.pageArtifacts === "function"
          ? await store.pageArtifacts(id, url.searchParams)
          : null;
        const task = page ? null : await store.get(id);
        send(response, page || task ? 200 : 404, page
          ?? (task ? paginateTaskArtifacts(task, url.searchParams) : { error: "Task not found." }));
        return;
      }

      const taskMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)$/);
      if (request.method === "GET" && taskMatch) {
        const id = decodeURIComponent(taskMatch[1]);
        const core = url.searchParams.get("view") === "core";
        const task = core && typeof store.getCore === "function"
          ? await store.getCore(id)
          : await store.get(id);
        send(response, task ? 200 : 404, task
          ? { task: core && typeof store.getCore !== "function" ? projectTaskCore(task) : task }
          : { error: "Task not found." });
        return;
      }

      const workflowProfileMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/workflow-profile$/);
      if (request.method === "PUT" && workflowProfileMatch) {
        const id = decodeURIComponent(workflowProfileMatch[1]);
        const input = await readJson(request);
        if (!WORKFLOW_PROFILE_IDS.includes(input.profile)) throw new Error("Choose fast, standard, or high-risk.");
        if (typeof orchestrator.overrideWorkflowProfile !== "function") throw new Error("Workflow profile overrides are unavailable.");
        const task = await orchestrator.overrideWorkflowProfile(id, input.profile, String(input.reason ?? ""));
        send(response, 200, { task });
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
        const supportedClosureReasons = ["not-needed", "superseded", "duplicate"];
        if (typeof input?.reason !== "string" || !supportedClosureReasons.includes(input.reason)) {
          throw new Error("Closure reason must be one of not-needed, superseded, or duplicate.");
        }
        const reason = input.reason;
        let supersededBy = null;
        if (reason === "superseded") {
          if (typeof input.supersededBy !== "string" || !input.supersededBy.trim()) {
            throw new Error("Superseded tasks require a nonblank supersededBy identifier.");
          }
          supersededBy = input.supersededBy.trim().slice(0, 80);
        }
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

      const archiveMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/archive$/);
      if (request.method === "POST" && archiveMatch) {
        const id = decodeURIComponent(archiveMatch[1]);
        const task = await store.get(id);
        if (!task) {
          send(response, 404, { error: "Task not found." });
          return;
        }
        if (task.status === "archived") {
          send(response, 409, { error: "This task is already archived." });
          return;
        }
        if (["running", "cancelling"].includes(task.status) || task.activeRunKind) {
          send(response, 409, { error: "Cancel the active run before archiving this task." });
          return;
        }
        if (task.status === "merging" || task.mergeIntent?.status === "pending") {
          send(response, 409, { error: "Wait for the pending merge reconciliation before archiving this task." });
          return;
        }
        const note = String((await readJson(request))?.note ?? "").trim().slice(0, 2_000);
        // Reclaim the worktrees, but never at the cost of work nobody has a copy of. A row is
        // discardable only when it is `cleanupReady` (present, clean, not active) or already gone
        // from disk. An entry carrying uncommitted changes is left exactly where it is and named
        // in the response, so archiving is always safe to run and never silently destructive.
        const entries = worktreeEntriesForTask(task);
        const archivedAt = new Date().toISOString();
        // The status moves *before* any worktree is touched. If the transition loses a race the
        // worktrees are still there, still listed, still removable from the inventory; the
        // opposite order would delete them and then fail, leaving nothing to point at.
        let archived;
        try {
          archived = await store.transition(id, (draft) => (
            draft.status !== "archived" &&
            draft.status !== "running" &&
            draft.status !== "cancelling" &&
            !draft.activeRunKind &&
            draft.status !== "merging" &&
            draft.mergeIntent?.status !== "pending"
          ), (draft) => {
            // `previousStatus` is recorded because archiving is a *visibility* decision, not a
            // verdict on the work: the status it interrupted is the only remaining evidence of
            // where the task actually stopped, and nothing else in the record preserves it.
            draft.archive = { archivedAt, previousStatus: draft.status, note, removedWorktrees: [], retainedWorktrees: [] };
            draft.status = "archived";
            draft.activeRunKind = null;
            draft.error = null;
            draft.events.push({
              id: crypto.randomUUID(),
              at: archivedAt,
              category: "decision",
              tone: "info",
              stage: draft.currentStage,
              title: "Task archived",
              detail: [`Archived from ${draft.archive.previousStatus}.`, note || null].filter(Boolean).join(" "),
            });
          });
        } catch (error) {
          if (error.code !== "TASK_TRANSITION_CONFLICT") throw error;
          send(response, 409, { error: "Task state changed before it could be archived." });
          return;
        }
        const rows = await worktrees.inventory(entries);
        const removed = [];
        const retained = [];
        for (const [index, row] of rows.entries()) {
          if (!row.gitExists) continue;
          if (!row.cleanupReady) {
            retained.push({
              id: row.id,
              worktreePath: row.worktreePath,
              reason: row.gitClean === false ? "uncommitted changes" : row.currentState,
            });
            continue;
          }
          await worktrees.removeWorktree({
            worktreePath: entries[index].worktreePath,
            repositoryRoot: task.repositoryPath,
          });
          removed.push({ id: row.id, worktreePath: row.worktreePath });
        }
        const recorded = await store.update(id, (draft) => {
          draft.archive.removedWorktrees = removed.map((entry) => entry.worktreePath);
          draft.archive.retainedWorktrees = retained.map((entry) => entry.worktreePath);
          if (removed.length || retained.length) {
            draft.events.push({
              id: crypto.randomUUID(),
              at: new Date().toISOString(),
              category: "decision",
              tone: retained.length ? "warning" : "info",
              stage: draft.currentStage,
              title: "Archived worktrees reclaimed",
              detail: [
                removed.length ? `${removed.length} worktree${removed.length === 1 ? "" : "s"} removed.` : null,
                retained.length
                  ? `${retained.length} left in place (${retained.map((entry) => entry.reason).join(", ")}).`
                  : null,
              ].filter(Boolean).join(" "),
            });
          }
        });
        send(response, 200, { task: recorded ?? archived, removedWorktrees: removed, retainedWorktrees: retained });
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
        if (input.interactionSource !== "operator-ui") {
          throw new Error("Grill answers require an explicit operator UI action.");
        }
        input.questionId = input.questionId.trim();
        input.answer = input.answer.trim();
        await orchestrator.answerGrillQuestion(id, {
          questionId: input.questionId,
          answer: input.answer,
          source: "operator",
        });
        send(response, 201, { recorded: true });
        return;
      }

      const finishGrillMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/grill\/finish$/);
      if (request.method === "POST" && finishGrillMatch) {
        const id = decodeURIComponent(finishGrillMatch[1]);
        const input = await readJson(request);
        if (input.interactionSource !== "operator-ui") {
          throw new Error("Finishing Grill requires an explicit operator UI action.");
        }
        const result = await orchestrator.finishGrill(id, {
          acceptRemaining: input.acceptRemaining === true,
          source: "operator",
        });
        send(response, 202, result);
        return;
      }

      const continueImplementationMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/continue-implementation$/);
      if (request.method === "POST" && continueImplementationMatch) {
        const sourceId = decodeURIComponent(continueImplementationMatch[1]);
        const priorContinuation = continuationLocks.get(sourceId) ?? Promise.resolve();
        let releaseContinuation;
        const continuation = new Promise((resolve) => { releaseContinuation = resolve; });
        const continuationTail = priorContinuation.then(() => continuation);
        continuationLocks.set(sourceId, continuationTail);
        await priorContinuation;
        try {
          const source = await store.get(sourceId);
          if (!source) {
            send(response, 404, { error: "Task not found." });
            return;
          }
          if (source.continuedByTaskId) {
            const existing = await store.get(source.continuedByTaskId);
            if (!existing) {
              send(response, 409, { error: `Linked implementation task ${source.continuedByTaskId} could not be found.` });
              return;
            }
            send(response, 200, { task: existing, created: false });
            return;
          }
          if (source.workflow !== "investigate" || source.status !== "completed") {
            send(response, 409, { error: "Only a completed investigate-only task can continue to implementation." });
            return;
          }
          const specificationApproval = [...(source.approvals ?? [])]
            .reverse()
            .find((approval) => approval.stage === "specification");
          const specificationArtifact = [...(source.artifacts ?? [])]
            .reverse()
            .find((artifact) => artifact.stage === "specification");
          if (!specificationApproval || !specificationArtifact) {
            send(response, 409, { error: "The investigation needs an approved specification artifact before implementation can continue." });
            return;
          }

          const repositoryPath = await validateRepository(source.repositoryPath);
          const settings = await store.settings();
          const selectedProfile = source.workflowProfile?.selected ?? "standard";
          const workflowProfile = selectWorkflowProfile({
            title: source.title,
            description: source.description,
            requestedProfile: selectedProfile,
          });
          const importedStages = new Set(["triage", "scouts", "grill", "specification"]);
          const importedArtifacts = (source.artifacts ?? [])
            .filter((artifact) => importedStages.has(artifact.stage))
            .map((artifact) => ({
              ...structuredClone(artifact),
              id: crypto.randomUUID(),
              runId: null,
              model: null,
              reasoning: null,
              agentRole: null,
              usage: { inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0, totalTokens: 0, cost: null, credits: null },
              contextManifest: null,
              candidateId: null,
              candidateRevision: null,
              workPackageId: null,
              sourceTaskId: source.id,
              sourceArtifactId: artifact.id,
            }));
          const importedDecisions = (source.decisions ?? []).map((decision) => ({
            ...structuredClone(decision),
            id: crypto.randomUUID(),
            sourceTaskId: source.id,
            sourceDecisionId: decision.id,
          }));
          const target = await store.create({
            title: `Implement: ${source.title}`.slice(0, 300),
            description: source.description,
            repositoryPath,
            workflow: "implement",
            priority: source.priority,
            model: source.agentConfig?.model ?? settings.defaultModel,
            reasoning: source.agentConfig?.reasoning ?? settings.defaultReasoning,
            stagePolicies: structuredClone(source.agentConfig?.stagePolicies ?? settings.stagePolicies),
            profileStagePolicies: structuredClone(source.agentConfig?.profileStagePolicies ?? settings.profileStagePolicies),
            workflowProfile,
            continuation: {
              sourceTaskId: source.id,
              sourceApprovedAt: specificationApproval.createdAt,
              sourceApprovalId: specificationApproval.id,
              artifacts: importedArtifacts,
              decisions: importedDecisions,
              attachments: structuredClone(source.attachments ?? []),
              scoutDispatch: structuredClone(source.scoutDispatch ?? null),
              grillSession: structuredClone(source.grillSession ?? null),
              stageDispositions: structuredClone(source.stageDispositions ?? {}),
            },
          });
          await store.update(source.id, (draft) => {
            draft.continuedByTaskId = target.id;
            draft.events.push({
              id: crypto.randomUUID(),
              at: new Date().toISOString(),
              category: "decision",
              tone: "success",
              stage: "specification",
              title: "Continued to implementation",
              detail: `${target.id} owns planning and implementation authority; ${source.id} remains an approved read-only investigation.`,
            });
          });
          const started = await orchestrator.start(target.id, "planning");
          if (!started) {
            await store.update(target.id, (draft) => {
              draft.status = "failed";
              draft.currentStage = "plan";
              draft.error = "Planning did not start. Retry planning from this implementation task.";
            });
          }
          send(response, 201, { task: await store.get(target.id), created: true });
          return;
        } finally {
          releaseContinuation();
          if (continuationLocks.get(sourceId) === continuationTail) continuationLocks.delete(sourceId);
        }
      }

      const actionMatch = url.pathname.match(
        /^\/api\/tasks\/([^/]+)\/(run|cancel|approve-spec|approve-plan|specification|plan|implement|continue-package|repair|review|test|retry-test|final-review|approve-merge|complete-merged|grant-retry|refresh-candidate|rebuild-candidate|restart-implementation)$/,
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

        const notes = ["approve-spec", "approve-plan", "approve-merge", "complete-merged"].includes(action)
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
        if (action === "complete-merged") {
          await orchestrator.completeMergedTask(id, notes.note ?? "");
          send(response, 200, { completed: true });
          return;
        }
        if (action === "refresh-candidate") {
          const refreshed = await orchestrator.refreshCandidate(id);
          send(response, 200, { refreshed: true, task: refreshed });
          return;
        }
        if (action === "rebuild-candidate") {
          const rebuilt = await orchestrator.rebuildCandidateFromTarget(id);
          send(response, 200, { rebuilt: true, task: rebuilt });
          return;
        }
        if (action === "restart-implementation") {
          const restarted = await orchestrator.restartImplementationFromTarget(id);
          send(response, 200, { restarted: true, task: restarted });
          return;
        }
        if (action === "retry-test") {
          const result = await orchestrator.retryTestOnSameCandidate(id);
          send(response, 202, result);
          return;
        }
        if (action === "continue-package") {
          const result = await orchestrator.continueRetainedPackage(id);
          send(response, 202, result);
          return;
        }
        if (action === "plan" && ["failed", "blocked"].includes(task.status) && task.currentStage === "implement") {
          const result = await orchestrator.correctInvalidPlan(id);
          send(response, 202, result);
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
          plan: { kind: "planning", statuses: ["awaiting-plan-approval", "failed", "cancelled"], stages: ["plan", "implement"] },
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
          review: { kind: "review", statuses: ["ready-for-review", "review-retry-required", "failed", "cancelled"], stages: ["dev-review"] },
          test: { kind: "test", statuses: ["ready-for-test", "failed", "cancelled"], stages: ["test"] },
          "final-review": {
            kind: "final-review",
            statuses: ["ready-for-final-review", "failed", "cancelled"],
            stages: ["final-review"],
          },
        }[action];
        // Candidate-gate actions must reach the orchestrator's exact-target
        // preflight even when the prior gate left the task blocked or awaiting
        // repair. The preflight can then replace that stale blocker with the safe
        // target-refresh action without spending an attempt. All other actions keep
        // the ordinary API status guard.
        const candidateGateAction = ["review", "test", "final-review"].includes(action);
        if (
          !runConfiguration ||
          !runConfiguration.stages.includes(task.currentStage) ||
          (!candidateGateAction && !runConfiguration.statuses.includes(task.status))
        ) {
          send(response, 409, { error: `Task cannot run ${action} while it is ${task.status}.` });
          return;
        }
        if (action === "plan" && task.status === "awaiting-plan-approval") {
          const latestPlanArtifact = task.artifacts?.filter((artifact) => artifact.stage === "plan").at(-1);
          const latestDecision = task.decisions?.at(-1);
          if (!latestPlanArtifact || !latestDecision || latestDecision.createdAt <= latestPlanArtifact.createdAt) {
            send(response, 409, {
              error: "Record the required plan correction as a task decision before revising the plan.",
            });
            return;
          }
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
        if (!candidateGateAction && (task.status === "blocked" || stageAttempts >= stageRunLimitFor(task, runStage))) {
          send(response, 409, { error: "The current stage has exhausted its retry allowance." });
          return;
        }
        const started = await orchestrator.start(id, runConfiguration.kind, action === "plan" && task.currentStage === "implement"
          ? {
              onReserve: (draft) => {
                draft.currentStage = "plan";
                draft.events.push({
                  id: crypto.randomUUID(),
                  at: new Date().toISOString(),
                  category: "decision",
                  tone: "warning",
                  stage: "plan",
                  title: "Invalid approved plan returned for correction",
                  detail: "Implementation did not have a valid focused verification contract. Planning must produce a corrected work-package manifest before writes resume.",
                });
              },
            }
          : {});
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
  if (
    task.workflowProfile?.selected === "fast" &&
    candidate?.status === "repair_required" &&
    (task.automaticRepairCycles ?? 0) >= 1
  ) {
    return { error: "Fast tasks permit one automatic review-driven candidate repair. A further candidate defect requires human direction, not another repair-loop grant." };
  }
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
  const readyGateTuple = {
    "ready-for-review": { stage: "dev-review", candidateStatus: "ready_for_review" },
    "review-retry-required": { stage: "dev-review", candidateStatus: "review_retry_required" },
    "ready-for-test": { stage: "test", candidateStatus: "ready_for_test" },
    "ready-for-final-review": { stage: "final-review", candidateStatus: "ready_for_final_review" },
  }[task.status] ?? null;
  const exhaustedReadyGate = readyGateTuple != null &&
    task.currentStage === readyGateTuple.stage &&
    candidate?.status === readyGateTuple.candidateStatus &&
    currentAttempts >= currentLimit;
  const exhaustedPlanApproval = task.status === "awaiting-plan-approval" &&
    task.currentStage === "plan" &&
    currentAttempts >= currentLimit;
  const exhaustedBlockedStage = task.status === "blocked" && currentAttempts >= currentLimit;
  if (!exhaustedRepair && !exhaustedReadyGate && !exhaustedPlanApproval && !exhaustedBlockedStage) {
    return { error: "A retry can only be granted to an exhausted blocked, approval, or repair stage." };
  }
  if (task.activeRunKind || task.activeRunReservationId || (task.activeRunIds?.length ?? 0) > 0) {
    return { error: "An active or inconsistent run reservation must be resolved before granting a retry." };
  }
  if ((task.runs ?? []).some((run) => run?.status === "running")) {
    return { error: "An active or inconsistent run history must be resolved before granting a retry." };
  }
  const globalIdentityError = validateGlobalRetryIdentities(task);
  if (globalIdentityError) return { error: globalIdentityError };
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
      task,
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
    readExecutionProvider(run) !== readExecutionProvider(exactReservation) ||
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
  const lineage = candidateBoundGrant ? candidateRevisionLineage(candidate) : null;
  const adjacentPriorRevision = candidateBoundGrant &&
    candidate?.status !== "repair_required" &&
    reservation.candidateId === candidate?.id &&
    reservation.candidateRevision + 1 === candidate?.revisionNumber;
  const priorTargetRefreshRevision = candidateBoundGrant &&
    candidate?.status !== "repair_required" &&
    targetRefreshesDescendFromReservation(lineage, candidate, reservation);
  const priorReplacedCandidate = candidateBoundGrant &&
    candidate?.status !== "repair_required" &&
    replacedCandidateMatchesReservation(task, candidate, reservation);
  if ((adjacentPriorRevision || priorTargetRefreshRevision || priorReplacedCandidate) && reservationRuns.length !== 1) {
    return { error: "The exhausted stage has an inconsistent workflow reservation; resolve it before granting a retry." };
  }
  const authorizingGate = candidate?.status === "repair_required"
    ? failedRepairAuthorizingGate(task, candidate, lineage)
    : adjacentPriorRevision && !priorTargetRefreshRevision
      ? adjacentRepairAuthorizingGate(
          task,
          candidate,
          reservation,
          task.stageRunReservations?.implement,
          lineage,
          task.attemptsByStage?.implement ?? 0,
        )
      : null;
  if ((candidate?.status === "repair_required" || (adjacentPriorRevision && !priorTargetRefreshRevision)) && !authorizingGate) {
    return { error: "The exhausted candidate repair is missing an exact authorizing gate; resolve the inconsistent history before granting a retry." };
  }
  const authorizingGateRun = authorizingGate?.sourceRunId
    ? (task.runs ?? []).find((run) => run.id === authorizingGate.sourceRunId) ?? null
    : null;
  const authorizingGateArtifact = authorizingGateRun?.artifactId
    ? (task.artifacts ?? []).find((artifact) => artifact.id === authorizingGateRun.artifactId) ?? null
    : null;
  const producerEvidence = lineage ? candidateRevisionProducerEvidence(task, candidate, lineage) : null;
  if (candidateBoundGrant && !producerEvidence) {
    return { error: "The exhausted candidate is missing exact producer evidence; resolve the inconsistent history before granting a retry." };
  }
  const candidateProducerRunIds = producerEvidence?.runs.map((run) => run.id) ?? [];
  const candidateProducerArtifactIds = producerEvidence?.artifacts.map((artifact) => artifact.id) ?? [];
  const candidateAuthorizerRunIds = producerEvidence?.authorizerRuns.map((run) => run.id) ?? [];
  const candidateAuthorizerArtifactIds = producerEvidence?.authorizerArtifacts.map((artifact) => artifact.id) ?? [];
  const candidateAuthorizerReservationIds = producerEvidence?.authorizerReservations.map((entry) => entry.id) ?? [];
  const historySnapshot = JSON.stringify({
    currentStage: task.currentStage,
    activeRunKind: task.activeRunKind ?? null,
    activeRunReservationId: task.activeRunReservationId ?? null,
    activeRunIds: task.activeRunIds ?? [],
    candidate: candidate ?? null,
    authorizingGateArtifact,
    authorizingGateRun,
    attemptsByStage: task.attemptsByStage ?? {},
    candidateProducerArtifacts: producerEvidence?.artifacts ?? [],
    candidateProducerRuns: producerEvidence?.runs ?? [],
    candidateAuthorizerArtifacts: producerEvidence?.authorizerArtifacts ?? [],
    candidateAuthorizerReservations: producerEvidence?.authorizerReservations ?? [],
    candidateAuthorizerRuns: producerEvidence?.authorizerRuns ?? [],
    reservation,
    stageRunReservations: task.stageRunReservations ?? {},
    stageRunLimits: task.stageRunLimits ?? {},
    stageRuns,
    workPackages: task.workPackages ?? [],
    scoutDispatch: task.scoutDispatch ?? null,
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
    authorizingGateArtifactId: authorizingGate?.sourceArtifactId ?? null,
    authorizingGateCandidateId: authorizingGate?.candidateId ?? null,
    authorizingGateCandidateRevision: authorizingGate?.candidateRevision ?? null,
    authorizingGateCandidateHeadRevision: authorizingGate?.candidateHeadRevision ?? null,
    authorizingGateKind: authorizingGate?.kind ?? null,
    authorizingGateReservedAt: authorizingGate?.reservedAt ?? null,
    authorizingGateReservationId: authorizingGate?.id ?? null,
    authorizingGateRunId: authorizingGate?.sourceRunId ?? null,
    authorizingGateStage: authorizingGate?.stage ?? null,
    authorizingGateWorkflowAttempt: authorizingGate?.workflowAttempt ?? null,
    candidateAuthorizerArtifactIds,
    candidateAuthorizerReservationIds,
    candidateAuthorizerRunIds,
    candidateProducerArtifactIds,
    candidateProducerRunIds,
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

function retainQualificationFailuresForImplementationRetry(task, grantedStage) {
  if (grantedStage !== "implement") return;
  for (const workPackage of task.workPackages ?? []) {
    const latestVerification = [...(workPackage.verificationRuns ?? [])].reverse().find((verification) => (
      verification.headRevision === workPackage.headRevision
    ));
    if (
      workPackage.status !== "failed" ||
      typeof workPackage.error !== "string" ||
      !/did not qualify/i.test(workPackage.error) ||
      typeof workPackage.branch !== "string" ||
      !workPackage.branch.trim() ||
      typeof workPackage.worktreePath !== "string" ||
      !workPackage.worktreePath.trim() ||
      typeof workPackage.baseRevision !== "string" ||
      !workPackage.baseRevision.trim() ||
      typeof workPackage.headRevision !== "string" ||
      !workPackage.headRevision.trim() ||
      !Array.isArray(workPackage.files) ||
      !workPackage.files.length ||
      latestVerification?.status !== "failed"
    ) {
      continue;
    }
    workPackage.retainedContinuation = {
      requestedAt: new Date().toISOString(),
      files: [...workPackage.files],
      outsideOwnership: [],
      qualificationFailure: workPackage.error,
    };
    workPackage.retainedForRequalification = false;
    workPackage.retainedReplacementReason = null;
  }
}

function validateGlobalRetryIdentities(task) {
  const runs = task.runs ?? [];
  const artifacts = task.artifacts ?? [];
  const reservationEntries = Object.entries(task.stageRunReservations ?? {})
    .filter(([, reservation]) => reservation != null);
  const runIds = runs.map((run) => run?.id);
  const artifactIds = artifacts.map((artifact) => artifact?.id);
  const linkedRunIds = artifacts.map((artifact) => artifact?.runId).filter((runId) => runId != null);
  const claimedArtifactIds = runs.map((run) => run?.artifactId).filter((artifactId) => artifactId != null);
  const reservationIds = reservationEntries.map(([, reservation]) => reservation?.id);
  if (
    runIds.some((id) => typeof id !== "string" || !id.trim()) ||
    new Set(runIds).size !== runIds.length ||
    artifactIds.some((id) => typeof id !== "string" || !id.trim()) ||
    new Set(artifactIds).size !== artifactIds.length ||
    linkedRunIds.some((id) => typeof id !== "string" || !id.trim()) ||
    new Set(linkedRunIds).size !== linkedRunIds.length ||
    claimedArtifactIds.some((id) => typeof id !== "string" || !id.trim()) ||
    new Set(claimedArtifactIds).size !== claimedArtifactIds.length ||
    reservationIds.some((id) => typeof id !== "string" || !id.trim()) ||
    new Set(reservationIds).size !== reservationIds.length ||
    reservationEntries.some(([stage, reservation]) => reservation?.stage !== stage) ||
    artifacts.some((artifact) => artifact?.runId != null && !runs.some((run) => (
      run.id === artifact.runId && run.artifactId === artifact.id
    ))) ||
    runs.some((run) => run?.artifactId != null && !artifacts.some((artifact) => (
      artifact.id === run.artifactId && artifact.runId === run.id
    )))
  ) {
    return "The exhausted workflow has duplicate or inconsistent persisted identities; resolve it before granting a retry.";
  }
  return null;
}

function validRetryReservationCandidateBinding(
  reservation,
  candidateRequired,
  candidate,
  grantedStage,
  task,
) {
  const reservations = task.stageRunReservations;
  const implementationAttempt = task.attemptsByStage?.implement ?? 0;
  const allNull = reservation.candidateId == null &&
    reservation.candidateRevision == null &&
    reservation.candidateHeadRevision == null;
  if (!candidateRequired) return allNull;
  const lineage = candidateRevisionLineage(candidate);
  if (!lineage) return false;
  if (!candidateRevisionProducerEvidence(task, candidate, lineage)) return false;
  if (grantedStage !== "implement" && lineage.sourceReservations.has(reservation.id)) return false;
  const sourceReservation = reservation.id === candidate?.sourceWorkflowReservationId &&
    reservation.workflowAttempt === candidate?.sourceWorkflowAttempt;
  if (allNull) {
    return grantedStage === "implement" &&
      sourceReservation &&
      reservation.kind === "implementation" &&
      validCandidateProducerReservation(task, candidate, reservation, lineage, implementationAttempt);
  }
  const completeBinding = typeof reservation.candidateId === "string" && reservation.candidateId.trim().length > 0 &&
    Number.isInteger(reservation.candidateRevision) && reservation.candidateRevision > 0 &&
    typeof reservation.candidateHeadRevision === "string" && reservation.candidateHeadRevision.trim().length > 0;
  if (!completeBinding) return false;
  const exactCurrentCandidate = reservation.candidateId === candidate?.id &&
    reservation.candidateRevision === candidate?.revisionNumber &&
    reservation.candidateHeadRevision === candidate?.headRevision;
  if (exactCurrentCandidate) {
    if (
      !validPersistedTimestamp(reservation.reservedAt) ||
      Date.parse(reservation.reservedAt) < Date.parse(lineage.currentRevision.createdAt)
    ) {
      return false;
    }
    if (grantedStage === "implement" && reservation.kind === "repair") {
      return Boolean(failedRepairAuthorizingGate(
        task,
        candidate,
        lineage,
        reservation,
      ));
    }
    return validCandidateProducerReservation(task, candidate, reservations?.implement, lineage, implementationAttempt);
  }
  if (grantedStage !== "implement") {
    if (targetRefreshesDescendFromReservation(lineage, candidate, reservation)) return true;
    if (replacedCandidateMatchesReservation(task, candidate, reservation)) return true;
    if (reservation.candidateId !== candidate?.id || reservation.candidateRevision + 1 !== candidate?.revisionNumber) {
      return false;
    }
    return Boolean(adjacentRepairAuthorizingGate(
      task,
      candidate,
      reservation,
      reservations?.implement,
      lineage,
      implementationAttempt,
    ));
  }
  return sourceReservation &&
    ["implementation", "repair"].includes(reservation.kind) &&
    validCandidateProducerReservation(task, candidate, reservation, lineage, implementationAttempt);
}

function failedRepairAuthorizingGate(
  task,
  candidate,
  lineage,
  repairReservation = null,
) {
  if (!lineage) return null;
  const reservations = task.stageRunReservations;
  const attemptsByStage = task.attemptsByStage;
  const gateStages = new Set(["dev-review", "test", "final-review"]);
  const retainedGates = Object.values(reservations ?? {}).filter((reservation) => gateStages.has(reservation?.stage));
  if (repairReservation && retainedGates.some((reservation) => reservation?.id === repairReservation.id)) return null;
  const retainedGateIds = retainedGates.map((reservation) => reservation?.id);
  if (
    retainedGateIds.some((id) => typeof id !== "string" || !id.trim()) ||
    new Set(retainedGateIds).size !== retainedGateIds.length ||
    retainedGateIds.some((id) => lineage.sourceReservations.has(id))
  ) {
    return null;
  }
  const requestedGateStage = CANDIDATE_GATE_STAGES.includes(task.currentStage)
    ? task.currentStage
    : task.stageRunReservations?.implement?.authorizingGateStage;
  const exactCandidateGates = retainedGates.filter((reservation) => (
    reservation?.candidateId === candidate.id &&
    reservation?.candidateRevision === candidate.revisionNumber &&
    reservation?.candidateHeadRevision === candidate.headRevision
  ));
  if (!exactCandidateGates.length) return null;
  const candidateCreatedAt = Date.parse(lineage.currentRevision.createdAt);
  let authorizingGate = null;
  for (const gateReservation of exactCandidateGates) {
    if (
      typeof gateReservation.id !== "string" ||
      !gateReservation.id.trim() ||
      !validPersistedTimestamp(gateReservation.reservedAt) ||
      !validRetryReservationKind(gateReservation.stage, gateReservation.kind) ||
      !Number.isInteger(gateReservation.workflowAttempt) ||
      gateReservation.workflowAttempt < 1 ||
      gateReservation.workflowAttempt !== attemptsByStage?.[gateReservation.stage] ||
      reservations?.[gateReservation.stage] !== gateReservation
    ) {
      return null;
    }
    const gateReservedAt = Date.parse(gateReservation.reservedAt);
    if (gateReservedAt < candidateCreatedAt) return null;
    if (gateReservation.stage === requestedGateStage) {
      if (authorizingGate) return null;
      authorizingGate = gateReservation;
    }
  }
  // `task.currentStage` is not a stable stand-in for "the gate stage this repair
  // answers": a failed repair attempt moves it to "implement" (repair is an implement
  // run), even though the candidate is still repair-required against whichever gate
  // stage actually failed. `repairAuthorizerSnapshot` already resolves this correctly
  // — falling back to the implement reservation's own recorded `authorizingGateStage`
  // whenever `currentStage` is not itself a candidate-gate stage — and this check must
  // agree with it, or every repair attempt after the first exhausts the stage with no
  // way to grant another: recorded live on AH-002, whose second repair attempt failed
  // (an unrelated, real empty-diff bug now fixed separately) and left `currentStage`
  // at "implement" while the authorizing dev-review reservation never moved.
  if (authorizingGate?.stage !== requestedGateStage) return null;
  const authoritativeGate = candidateGateAuthorizerEvidence(
    task,
    authorizingGate,
    { candidateId: candidate.id, candidateRevision: candidate.revisionNumber },
    { latestArtifactAt: repairReservation?.reservedAt ?? null },
  );
  const currentFreshness = resolveGateFreshness(task, authorizingGate.stage);
  // Same reasoning as `candidateGateAuthorizerEvidence`'s own reasonCode check just
  // above: a REPAIR verdict whose only complaint is a non-blocking finding's inherited
  // (non-explicit) binding is classified `missing_binding` by the freshness marker
  // check, not `repair_required`, even though it is the same authoritative gate.
  if (
    !authoritativeGate ||
    !["repair_required", "missing_binding"].includes(currentFreshness?.reasonCode) ||
    currentFreshness.sourceRunId !== authoritativeGate.sourceRunId ||
    currentFreshness.sourceArtifactId !== authoritativeGate.sourceArtifactId
  ) {
    return null;
  }
  if (!repairReservation) return authoritativeGate;
  const sourceArtifact = (task.artifacts ?? []).find((artifact) => artifact.id === authoritativeGate.sourceArtifactId);
  return repairReservation.workflowAttempt > candidate.sourceWorkflowAttempt &&
    !lineage.sourceReservations.has(repairReservation.id) &&
    Date.parse(repairReservation.reservedAt) > Date.parse(authorizingGate.reservedAt) &&
    Date.parse(repairReservation.reservedAt) > Date.parse(sourceArtifact.createdAt)
    ? authoritativeGate
    : null;
}

function candidateGateAuthorizerEvidence(task, gateReservation, target, { latestArtifactAt = null } = {}) {
  const gateStageRuns = (task.runs ?? []).filter((run) => run.stage === gateReservation?.stage);
  const reservationRuns = gateStageRuns.filter((run) => run.workflowReservationId === gateReservation?.id);
  const sourceRun = reservationRuns[0] ?? null;
  const sourceArtifacts = sourceRun?.artifactId
    ? (task.artifacts ?? []).filter((artifact) => artifact.id === sourceRun.artifactId)
    : [];
  const sourceArtifact = sourceArtifacts[0] ?? null;
  const freshness = sourceRun
    ? resolvePersistedRunFreshness(
        sourceRun,
        sourceArtifact,
        target,
        gateReservation.stage,
        readExecutionProvider(gateReservation),
      )
    : null;
  // Recorded live (AH-002 dev-review): a completed run whose gate finding was
  // non-blocking (P2/P3) and lacked its own explicit `candidateId`/`candidateRevision`
  // — falling back to the top-level binding, exactly as `parseGateEvidence` allows for
  // a REPAIR verdict — gets classified `missing_binding` by the freshness layer's
  // marker check (`persistedBindingMarkerReason`), not `repair_required`, even though
  // `sourceRun.gateResult?.verdict === "REPAIR"` is independently verified below. Ruling
  // that candidate's own genuine repair need un-authorizable left it permanently stuck
  // once its repair-attempt budget ran out, with no path to grant another. Both codes
  // describe the same completed, content-driven REPAIR verdict; only the diagnosis
  // differs, so both authorize the grant.
  if (
    reservationRuns.length !== 1 ||
    !isHistoricalRepairLineageReason(freshness?.reasonCode) ||
    sourceRun.status !== "completed" ||
    sourceRun.workflowReservationId !== gateReservation.id ||
    sourceRun.workflowAttempt !== gateReservation.workflowAttempt ||
    sourceRun.gateResult?.verdict !== "REPAIR" ||
    !validRetryRunTuple(sourceRun, gateReservation, gateStageRuns) ||
    sourceArtifacts.length !== 1 ||
    sourceArtifact.runId !== sourceRun.id ||
    sourceArtifact.stage !== gateReservation.stage ||
    sourceArtifact.kind !== "markdown" ||
    typeof sourceArtifact.name !== "string" ||
    !sourceArtifact.name.trim() ||
    typeof sourceArtifact.content !== "string" ||
    !sourceArtifact.content.trim() ||
    sourceArtifact.candidateId !== target.candidateId ||
    sourceArtifact.candidateRevision !== target.candidateRevision ||
    JSON.stringify(sourceArtifact.gateResult) !== JSON.stringify(sourceRun.gateResult) ||
    !validDurableRunArtifactEnvelope(sourceRun, sourceArtifact, {
      earliestStartedAt: gateReservation.reservedAt,
      latestCompletedAt: sourceRun.gateResult?.evaluatedAt,
      latestArtifactAt,
    }) ||
    !validPersistedTimestamp(sourceRun.gateResult?.evaluatedAt) ||
    Date.parse(sourceRun.gateResult.evaluatedAt) > Date.parse(sourceArtifact.createdAt)
  ) {
    return null;
  }
  return {
    ...gateReservation,
    sourceArtifactId: sourceArtifact.id,
    sourceRunId: sourceRun.id,
  };
}

function isHistoricalRepairLineageReason(reasonCode) {
  // A failed candidate command still prevents this gate from becoming fresh and the
  // live repair-grant path above continues to reject it. Once a later revision already
  // exists, however, its exact bound REPAIR finding remains the immutable causal
  // authorizer for that historical repair. Losing that lineage would strand the
  // repaired candidate and make an honest rerun impossible. This caller also requires
  // a completed REPAIR verdict, exact binding, linked artifact, and durable timestamps,
  // so command failure is admitted only as retained provenance, never as green proof.
  return ["repair_required", "missing_binding", "command_failure"].includes(reasonCode);
}

function candidateRevisionLineage(candidate) {
  const revisions = candidate?.revisions;
  if (!Array.isArray(revisions) || revisions.length !== candidate.revisionNumber) return null;
  const byNumber = new Map();
  const heads = new Set();
  const sourceReservations = new Set();
  const authorizingReservations = new Set();
  const authorizingRuns = new Set();
  const authorizingArtifacts = new Set();
  for (const revision of revisions) {
    const repairRevision = revision?.number > 1 && revision?.reason === "repair";
    const targetRefreshRevision = revision?.number > 1 && revision?.reason === "target-refresh";
    const hasValidRepairAuthorizer = repairRevision &&
      CANDIDATE_GATE_STAGES.includes(revision.authorizingGateStage) &&
      Number.isInteger(revision.authorizingGateWorkflowAttempt) &&
      revision.authorizingGateWorkflowAttempt > 0 &&
      typeof revision.authorizingGateReservationId === "string" &&
      revision.authorizingGateReservationId.trim().length > 0 &&
      typeof revision.authorizingGateRunId === "string" &&
      revision.authorizingGateRunId.trim().length > 0 &&
      typeof revision.authorizingGateArtifactId === "string" &&
      revision.authorizingGateArtifactId.trim().length > 0 &&
      validPersistedTimestamp(revision.authorizingGateReservedAt);
    const hasNoRepairAuthorizer = !repairRevision && [
      revision?.authorizingGateStage,
      revision?.authorizingGateWorkflowAttempt,
      revision?.authorizingGateReservationId,
      revision?.authorizingGateReservedAt,
      revision?.authorizingGateRunId,
      revision?.authorizingGateArtifactId,
    ].every((value) => value == null);
    if (
      !Number.isInteger(revision?.number) ||
      revision.number < 1 ||
      revision.number > candidate.revisionNumber ||
      byNumber.has(revision.number) ||
      typeof revision.headRevision !== "string" ||
      !revision.headRevision.trim() ||
      heads.has(revision.headRevision) ||
      (revision.number === 1
        ? revision.reason !== "assembly"
        : !["repair", "target-refresh"].includes(revision.reason)) ||
      (!targetRefreshRevision && (
        !Number.isInteger(revision.sourceWorkflowAttempt) ||
        revision.sourceWorkflowAttempt < 1 ||
        typeof revision.sourceWorkflowReservationId !== "string" ||
        !revision.sourceWorkflowReservationId.trim() ||
        sourceReservations.has(revision.sourceWorkflowReservationId) ||
        !validPersistedTimestamp(revision.sourceWorkflowReservedAt)
      )) ||
      (targetRefreshRevision && (
        typeof revision.previousBaseRevision !== "string" ||
        !revision.previousBaseRevision.trim() ||
        typeof revision.baseRevision !== "string" ||
        !revision.baseRevision.trim() ||
        revision.previousBaseRevision === revision.baseRevision ||
        [revision.sourceWorkflowAttempt, revision.sourceWorkflowReservationId, revision.sourceWorkflowReservedAt]
          .some((value) => value != null)
      )) ||
      (!repairRevision && !hasNoRepairAuthorizer) ||
      (repairRevision && !hasValidRepairAuthorizer) ||
      (repairRevision && (
        authorizingReservations.has(revision.authorizingGateReservationId) ||
        authorizingRuns.has(revision.authorizingGateRunId) ||
        authorizingArtifacts.has(revision.authorizingGateArtifactId) ||
        revision.authorizingGateReservationId === revision.sourceWorkflowReservationId
      )) ||
      !validPersistedTimestamp(revision.createdAt)
    ) {
      return null;
    }
    byNumber.set(revision.number, revision);
    heads.add(revision.headRevision);
    if (!targetRefreshRevision) sourceReservations.add(revision.sourceWorkflowReservationId);
    if (repairRevision) {
      authorizingReservations.add(revision.authorizingGateReservationId);
      authorizingRuns.add(revision.authorizingGateRunId);
      authorizingArtifacts.add(revision.authorizingGateArtifactId);
    }
  }
  if ([...authorizingReservations].some((id) => sourceReservations.has(id))) return null;
  let previousAttempt = 0;
  let previousCreatedAt = -Infinity;
  let currentProducerRevision = null;
  for (let number = 1; number <= candidate.revisionNumber; number += 1) {
    const revision = byNumber.get(number);
    if (!revision) return null;
    const createdAt = Date.parse(revision.createdAt);
    if (createdAt <= previousCreatedAt) return null;
    if (
      revision.reason === "target-refresh" &&
      revision.previousHeadRevision != null &&
      revision.previousHeadRevision !== byNumber.get(number - 1)?.headRevision
    ) {
      return null;
    }
    if (revision.reason !== "target-refresh") {
      const sourceReservedAt = Date.parse(revision.sourceWorkflowReservedAt);
      if (
        revision.sourceWorkflowAttempt <= previousAttempt ||
        sourceReservedAt > createdAt ||
        (number > 1 && sourceReservedAt <= previousCreatedAt)
      ) {
        return null;
      }
      previousAttempt = revision.sourceWorkflowAttempt;
      currentProducerRevision = revision;
    }
    previousCreatedAt = createdAt;
  }
  const currentRevision = byNumber.get(candidate.revisionNumber);
  if (
    currentRevision.headRevision !== candidate.headRevision ||
    currentProducerRevision?.sourceWorkflowReservationId !== candidate.sourceWorkflowReservationId ||
    currentProducerRevision?.sourceWorkflowAttempt !== candidate.sourceWorkflowAttempt ||
    (currentRevision.reason === "target-refresh" && currentRevision.baseRevision !== candidate.baseRevision)
  ) {
    return null;
  }
  return {
    authorizingArtifacts,
    authorizingReservations,
    authorizingRuns,
    byNumber,
    currentRevision,
    sourceReservations,
  };
}

function targetRefreshesDescendFromReservation(lineage, candidate, reservation) {
  if (
    !lineage ||
    reservation?.candidateId !== candidate?.id ||
    !Number.isInteger(reservation?.candidateRevision) ||
    reservation.candidateRevision < 1 ||
    reservation.candidateRevision >= candidate.revisionNumber ||
    !validPersistedTimestamp(reservation.reservedAt)
  ) {
    return false;
  }
  const reservedRevision = lineage.byNumber.get(reservation.candidateRevision);
  if (
    !reservedRevision ||
    reservation.candidateHeadRevision !== reservedRevision.headRevision ||
    Date.parse(reservation.reservedAt) < Date.parse(reservedRevision.createdAt)
  ) {
    return false;
  }
  for (let number = reservation.candidateRevision + 1; number <= candidate.revisionNumber; number += 1) {
    if (lineage.byNumber.get(number)?.reason !== "target-refresh") return false;
  }
  return true;
}

function replacedCandidateMatchesReservation(task, candidate, reservation) {
  const candidates = task.candidates ?? [];
  const currentIndex = candidates.length - 1;
  const previous = candidates[currentIndex - 1];
  const currentRevision = candidate?.revisions?.[0];
  return currentIndex > 0 &&
    candidates[currentIndex] === candidate &&
    currentRevision?.reason === "assembly" &&
    ["failed", "superseded"].includes(previous?.status) &&
    validRetryCandidate(previous) &&
    reservation?.candidateId === previous.id &&
    reservation.candidateRevision === previous.revisionNumber &&
    reservation.candidateHeadRevision === previous.headRevision &&
    validPersistedTimestamp(reservation.reservedAt) &&
    validPersistedTimestamp(currentRevision.createdAt) &&
    Date.parse(reservation.reservedAt) < Date.parse(currentRevision.createdAt);
}

function candidateRevisionProducerEvidence(task, candidate, lineage) {
  if (!validCandidateAssemblyMembership(task, candidate)) return null;
  const allRuns = task.runs ?? [];
  const runs = [];
  const artifacts = [];
  const authorizerArtifacts = [];
  const authorizerReservations = [];
  const authorizerRuns = [];
  const packageIds = new Set(task.workPackages.map((workPackage) => workPackage.id));
  for (let number = 1; number <= candidate.revisionNumber; number += 1) {
    const revision = lineage.byNumber.get(number);
    if (revision.reason === "target-refresh") continue;
    const revisionRuns = allRuns.filter((run) => (
      run.workflowReservationId === revision.sourceWorkflowReservationId &&
      run.workflowAttempt === revision.sourceWorkflowAttempt
    ));
    if (number === 1) {
      const runScopes = revisionRuns.map((run) => run.workPackageId);
      const syntheticReservation = {
        id: revision.sourceWorkflowReservationId,
        stage: "implement",
        kind: "implementation",
        workflowAttempt: revision.sourceWorkflowAttempt,
        candidateId: null,
        candidateRevision: null,
        candidateHeadRevision: null,
        authorizedRunScopes: runScopes,
      };
      if (
        new Set(runScopes).size !== runScopes.length ||
        revisionRuns.some((run) => (
          run.stage !== "implement" ||
          run.kind !== "implementation" ||
          run.role !== "implement" ||
          run.status !== "completed" ||
          typeof run.workPackageId !== "string" ||
          !packageIds.has(run.workPackageId) ||
          run.candidateId != null ||
          run.candidateRevision != null ||
          run.candidateHeadRevision != null ||
          !validRetryRunTuple(run, syntheticReservation, allRuns.filter((item) => item.stage === "implement"))
        ))
      ) {
        return null;
      }
      revisionRuns.sort((left, right) => left.workPackageId.localeCompare(right.workPackageId));
    } else {
      const priorRevision = lineage.byNumber.get(number - 1);
      const authorizer = candidateRevisionAuthorizerEvidence(task, candidate, revision, priorRevision);
      if (!authorizer) return null;
      authorizerReservations.push(authorizer.reservation);
      authorizerRuns.push(authorizer.run);
      authorizerArtifacts.push(authorizer.artifact);
      if (revisionRuns.length !== 1) return null;
      const run = revisionRuns[0];
      const syntheticReservation = {
        id: revision.sourceWorkflowReservationId,
        stage: "implement",
        kind: "repair",
        workflowAttempt: revision.sourceWorkflowAttempt,
        candidateId: candidate.id,
        candidateRevision: priorRevision.number,
        candidateHeadRevision: priorRevision.headRevision,
        authorizedRunScopes: [],
      };
      if (
        run.stage !== "implement" ||
        run.kind !== "repair" ||
        run.role !== "repair" ||
        run.status !== "completed" ||
        run.workPackageId != null ||
        run.candidateId !== candidate.id ||
        run.candidateRevision !== priorRevision.number ||
        run.candidateHeadRevision !== priorRevision.headRevision ||
        !validRetryRunTuple(run, syntheticReservation, allRuns.filter((item) => item.stage === "implement"))
      ) {
        return null;
      }
    }
    for (const run of revisionRuns) {
      const artifact = linkedProducerArtifact(task, candidate, revision, run);
      if (!artifact) return null;
      runs.push(run);
      artifacts.push(artifact);
    }
  }
  return {
    artifacts,
    authorizerArtifacts,
    authorizerReservations,
    authorizerRuns,
    runs,
  };
}

function candidateRevisionAuthorizerEvidence(task, candidate, revision, priorRevision) {
  const reservation = {
    id: revision.authorizingGateReservationId,
    stage: revision.authorizingGateStage,
    kind: revision.authorizingGateStage === "dev-review" ? "review" : revision.authorizingGateStage,
    // Recorded on the revision, not assumed. Defaulting this to the default provider
    // would fail every Claude gate that authorized a repair, on a task that never
    // involved Codex at all.
    provider: readExecutionProvider({ provider: revision.authorizingGateProvider }),
    workflowAttempt: revision.authorizingGateWorkflowAttempt,
    candidateId: candidate.id,
    candidateRevision: priorRevision.number,
    candidateHeadRevision: priorRevision.headRevision,
    authorizedRunScopes: [],
    reservedAt: revision.authorizingGateReservedAt,
  };
  if (
    Date.parse(reservation.reservedAt) < Date.parse(priorRevision.createdAt) ||
    Date.parse(reservation.reservedAt) >= Date.parse(revision.sourceWorkflowReservedAt)
  ) {
    return null;
  }
  const authoritativeGate = candidateGateAuthorizerEvidence(
    task,
    reservation,
    { candidateId: candidate.id, candidateRevision: priorRevision.number },
    { latestArtifactAt: revision.sourceWorkflowReservedAt },
  );
  if (
    !authoritativeGate ||
    authoritativeGate.sourceRunId !== revision.authorizingGateRunId ||
    authoritativeGate.sourceArtifactId !== revision.authorizingGateArtifactId
  ) {
    return null;
  }
  const run = (task.runs ?? []).find((item) => item.id === authoritativeGate.sourceRunId);
  const artifact = (task.artifacts ?? []).find((item) => item.id === authoritativeGate.sourceArtifactId);
  return Date.parse(artifact.createdAt) < Date.parse(revision.sourceWorkflowReservedAt)
    ? { artifact, reservation, run }
    : null;
}

function linkedProducerArtifact(task, candidate, revision, run) {
  if (typeof run.artifactId !== "string" || !run.artifactId.trim()) return null;
  const matching = (task.artifacts ?? []).filter((artifact) => artifact.id === run.artifactId);
  if (matching.length !== 1) return null;
  const artifact = matching[0];
  const initialRevision = revision.number === 1;
  return artifact.runId === run.id &&
    artifact.stage === "implement" &&
    artifact.kind === "markdown" &&
    typeof artifact.name === "string" &&
    artifact.name.trim().length > 0 &&
    typeof artifact.content === "string" &&
    artifact.content.trim().length > 0 &&
    artifact.candidateId === (initialRevision ? null : candidate.id) &&
    artifact.candidateRevision === (initialRevision ? null : revision.number) &&
    artifact.workPackageId === (initialRevision ? run.workPackageId : null) &&
    validDurableRunArtifactEnvelope(run, artifact, {
      earliestStartedAt: revision.sourceWorkflowReservedAt,
      latestCompletedAt: null,
      latestArtifactAt: revision.createdAt,
    })
    ? artifact
    : null;
}

function validDurableRunArtifactEnvelope(run, artifact, {
  earliestStartedAt,
  latestCompletedAt,
  latestArtifactAt,
}) {
  if (
    !validPersistedTimestamp(run?.startedAt) ||
    !validPersistedTimestamp(run?.completedAt) ||
    !validPersistedTimestamp(artifact?.createdAt)
  ) {
    return false;
  }
  const startedAt = Date.parse(run.startedAt);
  const completedAt = Date.parse(run.completedAt);
  const artifactAt = Date.parse(artifact.createdAt);
  return startedAt <= completedAt &&
    completedAt <= artifactAt &&
    (earliestStartedAt == null || (
      validPersistedTimestamp(earliestStartedAt) && Date.parse(earliestStartedAt) <= startedAt
    )) &&
    (latestCompletedAt == null || (
      validPersistedTimestamp(latestCompletedAt) && completedAt <= Date.parse(latestCompletedAt)
    )) &&
    (latestArtifactAt == null || (
      validPersistedTimestamp(latestArtifactAt) && artifactAt <= Date.parse(latestArtifactAt)
    ));
}

function validCandidateProducerReservation(task, candidate, producerReservation, lineage, implementationAttempt) {
  if (!producerReservation || !validPersistedTimestamp(producerReservation.reservedAt)) return false;
  const currentRevision = lineage.currentRevision;
  if (producerReservation.workflowAttempt !== implementationAttempt || producerReservation.stage !== "implement") {
    return false;
  }
  const producerReservedAt = Date.parse(producerReservation.reservedAt);
  const currentCreatedAt = Date.parse(currentRevision.createdAt);
  // A no-op repair (its own `<no-changes-needed>` marker, verified by `commit` — see
  // `#runRepair`) leaves the candidate at its *existing* revision by design: nothing
  // about the revision's true provenance changed, so the most recent implement
  // reservation can legitimately be a repair *of* the current revision without being
  // (or needing to equal) the reservation that originally produced it. Requiring an
  // exact identity match here would treat every such no-op repair as if it had
  // corrupted the candidate's lineage, when the lineage never moved at all.
  if (
    producerReservation.kind === "repair" &&
    producerReservation.candidateId === candidate.id &&
    producerReservation.candidateRevision === currentRevision.number &&
    producerReservation.candidateHeadRevision === currentRevision.headRevision &&
    producerReservedAt > currentCreatedAt
  ) {
    return true;
  }
  // A target refresh is mechanical lineage: it changes the candidate base and head,
  // but it does not create a new implementation producer. Retry authority therefore
  // remains bound to the newest preceding assembly/repair reservation. Without this
  // lookup, a genuine defect found after refresh can never receive a human-granted
  // repair once the Implement allowance is exhausted—the refresh revision correctly
  // has no sourceWorkflowReservationId of its own.
  const producerRevision = currentRevision.reason === "target-refresh"
    ? [...lineage.byNumber.values()].reverse().find((revision) => revision.reason !== "target-refresh")
    : currentRevision;
  if (!producerRevision) return false;
  if (
    producerReservation.id !== producerRevision.sourceWorkflowReservationId ||
    producerReservation.workflowAttempt !== producerRevision.sourceWorkflowAttempt ||
    producerReservation.reservedAt !== producerRevision.sourceWorkflowReservedAt
  ) {
    return false;
  }
  if (producerRevision.number === 1) {
    return producerReservation.kind === "implementation" &&
      producerReservation.candidateId == null &&
      producerReservation.candidateRevision == null &&
      producerReservation.candidateHeadRevision == null &&
      producerReservedAt <= Date.parse(producerRevision.createdAt) &&
      validInitialCandidateProducer(task, candidate, producerReservation);
  }
  const priorRevision = lineage.byNumber.get(producerRevision.number - 1);
  return producerReservation.kind === "repair" &&
    producerReservation.candidateId === candidate.id &&
    producerReservation.candidateRevision === priorRevision.number &&
    producerReservation.candidateHeadRevision === priorRevision.headRevision &&
    producerReservedAt > Date.parse(priorRevision.createdAt) &&
    producerReservedAt <= Date.parse(producerRevision.createdAt);
}

function adjacentRepairAuthorizingGate(task, candidate, priorReservation, repairReservation, lineage, implementationAttempt) {
  if (!validCandidateProducerReservation(task, candidate, repairReservation, lineage, implementationAttempt)) return false;
  const currentRevision = lineage.currentRevision;
  const priorRevision = lineage.byNumber.get(currentRevision.number - 1);
  const priorCreatedAt = Date.parse(priorRevision?.createdAt);
  const currentCreatedAt = Date.parse(currentRevision?.createdAt);
  const priorReservedAt = Date.parse(priorReservation?.reservedAt);
  const repairReservedAt = Date.parse(repairReservation?.reservedAt);
  const validLineage = priorReservation.candidateRevision + 1 === candidate.revisionNumber &&
    priorReservation.candidateId === candidate.id &&
    priorRevision?.headRevision === priorReservation.candidateHeadRevision &&
    priorReservation.id !== repairReservation.id &&
    priorReservedAt >= priorCreatedAt &&
    priorReservedAt < currentCreatedAt &&
    repairReservedAt > priorReservedAt &&
    repairReservedAt <= currentCreatedAt;
  if (!validLineage) return null;
  // The exhausted gate does not have to be the gate that authorized this repair.
  // A later Test or Final Review can request a new revision after Development Review
  // has already consumed its allowance; every earlier candidate-bound gate is then
  // stale and must rerun. The prior reservation above remains the exact retry source,
  // while the current revision's own recorded authorizer proves why the adjacent
  // revision exists. Keeping those identities distinct avoids both stranding the task
  // and pretending the prior gate authorized a repair that it did not request.
  const revisionAuthorizer = candidateRevisionAuthorizerEvidence(
    task,
    candidate,
    currentRevision,
    priorRevision,
  );
  if (!revisionAuthorizer || Date.parse(revisionAuthorizer.artifact.createdAt) >= repairReservedAt) return null;
  return {
    ...revisionAuthorizer.reservation,
    sourceArtifactId: revisionAuthorizer.artifact.id,
    sourceRunId: revisionAuthorizer.run.id,
  };
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
  if (
    !Array.isArray(authorized) ||
    authorized.some((scope) => typeof scope !== "string" || !scope.trim()) ||
    new Set(authorized).size !== authorized.length
  ) {
    return "The exhausted multi-run reservation is missing unique authorized run scopes; resolve the inconsistent history before granting a retry.";
  }
  if (
    reservation.kind === "implementation" &&
    !authorized.length &&
    !validAssemblyOnlyCandidateProducer(task, reservation, reservationRuns)
  ) {
    return "The exhausted Implementation reservation is missing an authorized work-package scope; resolve the inconsistent history before granting a retry.";
  }
  if (
    reservation.kind === "implementation" &&
    authorized.length &&
    !validImplementationScopeSnapshot(task, authorized)
  ) {
    return "The exhausted Implementation reservation does not match the persisted work-package plan; resolve the inconsistent history before granting a retry.";
  }
  if (reservation.stage === "scouts") {
    const selected = (task.scoutDispatch?.selected ?? []).map((scout) => scout?.name);
    if (
      selected.length !== authorized.length ||
      new Set(selected).size !== selected.length ||
      selected.some((scope) => !SCOUT_NAMES.includes(scope)) ||
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

function validImplementationScopeSnapshot(task, authorizedScopes) {
  const workPackages = task.workPackages ?? [];
  const packageIds = workPackages.map((workPackage) => workPackage?.id);
  const unresolvedPackageIds = workPackages
    .filter((workPackage) => !["ready_for_integration", "integrated"].includes(workPackage?.status))
    .map((workPackage) => workPackage.id);
  return packageIds.length > 0 &&
    packageIds.every((packageId) => typeof packageId === "string" && packageId.trim().length > 0) &&
    packageIds.length === new Set(packageIds).size &&
    authorizedScopes.every((scope) => packageIds.includes(scope)) &&
    unresolvedPackageIds.every((packageId) => authorizedScopes.includes(packageId));
}

function validInitialCandidateProducer(task, candidate, reservation) {
  if (!task || !validCandidateAssemblyMembership(task, candidate)) return false;
  const authorized = reservation.authorizedRunScopes;
  const packageIds = task.workPackages.map((workPackage) => workPackage.id);
  if (
    !Array.isArray(authorized) ||
    authorized.some((scope) => typeof scope !== "string" || !scope.trim() || !packageIds.includes(scope)) ||
    new Set(authorized).size !== authorized.length
  ) {
    return false;
  }
  const producerRuns = (task.runs ?? []).filter((run) => run.workflowReservationId === reservation.id);
  if (!authorized.length) return producerRuns.length === 0;
  const runScopes = producerRuns.map((run) => run.workPackageId);
  return producerRuns.length === authorized.length &&
    new Set(producerRuns.map((run) => run.id)).size === producerRuns.length &&
    new Set(runScopes).size === runScopes.length &&
    authorized.every((scope) => runScopes.includes(scope)) &&
    producerRuns.every((run) => (
      typeof run.id === "string" &&
      run.id.trim().length > 0 &&
      run.stage === "implement" &&
      run.kind === "implementation" &&
      run.role === "implement" &&
      run.status === "completed" &&
      Number.isInteger(run.attempt) &&
      run.attempt > 0 &&
      run.workflowAttempt === reservation.workflowAttempt &&
      run.candidateId == null &&
      run.candidateRevision == null &&
      run.candidateHeadRevision == null
    ));
}

function validCandidateAssemblyMembership(task, candidate) {
  const workPackages = task.workPackages ?? [];
  const members = candidate?.members ?? [];
  // `headRevision === null` is a legitimate outcome: a work package whose verification
  // already confirmed its goal was met commits nothing (see `allowNoChanges` in
  // git-worktree.mjs). Only a non-null revision must be a real, non-empty commit hash;
  // multiple work packages are allowed to independently be no-ops.
  const validHeadRevision = (value) => value === null || (typeof value === "string" && value.trim().length > 0);
  const committedHeadRevisions = workPackages.map((workPackage) => workPackage.headRevision).filter((value) => value !== null);
  if (
    !workPackages.length ||
    !workPackages.every((workPackage) => (
      workPackage.status === "integrated" &&
      typeof workPackage.id === "string" &&
      workPackage.id.trim().length > 0 &&
      validHeadRevision(workPackage.headRevision) &&
      Number.isInteger(workPackage.batch) &&
      workPackage.batch > 0
    )) ||
    new Set(workPackages.map((workPackage) => workPackage.id)).size !== workPackages.length ||
    // Two *committed* packages must never share a revision; any number of no-ops may
    // all be null at once.
    new Set(committedHeadRevisions).size !== committedHeadRevisions.length
  ) {
    return false;
  }
  const orderedPackages = [...workPackages].sort((left, right) => left.batch - right.batch || left.id.localeCompare(right.id));
  return members.length === orderedPackages.length &&
    members.every((member, index) => (
      member?.packageId === orderedPackages[index].id &&
      member?.headRevision === orderedPackages[index].headRevision &&
      member?.order === index + 1
    ));
}

function validAssemblyOnlyCandidateProducer(task, reservation, reservationRuns) {
  if (reservationRuns.length > 0) return false;
  const candidate = task.candidates?.at(-1);
  const currentRevision = candidate?.revisions?.find((revision) => revision.number === candidate?.revisionNumber);
  return candidate?.status === "repair_required" &&
    candidate.revisionNumber === 1 &&
    candidate.sourceWorkflowAttempt === reservation.workflowAttempt &&
    candidate.sourceWorkflowReservationId === reservation.id &&
    currentRevision?.reason === "assembly" &&
    currentRevision.sourceWorkflowAttempt === reservation.workflowAttempt &&
    currentRevision.sourceWorkflowReservationId === reservation.id &&
    currentRevision.sourceWorkflowReservedAt === reservation.reservedAt &&
    reservation.candidateId == null &&
    reservation.candidateRevision == null &&
    reservation.candidateHeadRevision == null &&
    validCandidateAssemblyMembership(task, candidate);
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
    "authorizingGateArtifactId",
    "authorizingGateCandidateId",
    "authorizingGateCandidateRevision",
    "authorizingGateCandidateHeadRevision",
    "authorizingGateKind",
    "authorizingGateReservedAt",
    "authorizingGateReservationId",
    "authorizingGateRunId",
    "authorizingGateStage",
    "authorizingGateWorkflowAttempt",
    "historySnapshot",
    "sourceRunId",
    "sourceRunStatus",
    "workflowAttempt",
    "workflowCandidateId",
    "workflowCandidateRevision",
    "workflowCandidateHeadRevision",
    "workflowReservationId",
  ].every((field) => expected[field] === current[field]) &&
    JSON.stringify(expected.sourceRunIds) === JSON.stringify(current.sourceRunIds) &&
    JSON.stringify(expected.candidateAuthorizerArtifactIds) === JSON.stringify(current.candidateAuthorizerArtifactIds) &&
    JSON.stringify(expected.candidateAuthorizerReservationIds) === JSON.stringify(current.candidateAuthorizerReservationIds) &&
    JSON.stringify(expected.candidateAuthorizerRunIds) === JSON.stringify(current.candidateAuthorizerRunIds) &&
    JSON.stringify(expected.candidateProducerArtifactIds) === JSON.stringify(current.candidateProducerArtifactIds) &&
    JSON.stringify(expected.candidateProducerRunIds) === JSON.stringify(current.candidateProducerRunIds);
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
