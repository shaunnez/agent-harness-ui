import { access, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import { defaultWorktreeRoot, GitWorktreeManager } from "./git-worktree.mjs";
import { assertHttpBoundary, corsHeaders } from "./http-security.mjs";
import { normalizeModelId, POLICY_IDS } from "./model-catalog.mjs";
import { withActionEligibility } from "./retry-admission-policy.mjs";
import { createCandidateWorktreeRoutes } from "./candidate-worktree-routes.mjs";
import { createChangelogRoutes } from "./changelog-routes.mjs";
import { createRetainedEvidenceRoutes } from "./retained-evidence-routes.mjs";
import { createProjectRoutes } from "./project-routes.mjs";
import { createRuntimeSettingsRoutes } from "./runtime-settings-routes.mjs";
import { createTaskCreationRoutes } from "./task-creation-routes.mjs";
import { createTaskActionRoutes } from "./task-action-routes.mjs";
import { createTaskLifecycleRoutes } from "./task-lifecycle-routes.mjs";
import { RepositoryAuthorityService } from "./repository-authority.mjs";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const VALID_WORKFLOWS = new Set(["investigate", "implement"]);
const RUNTIME_SCHEMA_VERSION = 12;
const diffCharLimit = 300_000;
const OUTPUT_LIMIT = 512 * 1024;
const requestMetrics = new WeakMap();

function send(response, status, value, extraHeaders = {}) {
  const body = JSON.stringify(value);
  const bytes = Buffer.byteLength(body);
  const metric = requestMetrics.get(response);
  const durationMs = metric ? performance.now() - metric.startedAt : 0;
  response.writeHead(status, {
    ...JSON_HEADERS,
    "content-length": String(bytes),
    "server-timing": `app;dur=${durationMs.toFixed(2)}`,
    "x-agent-harness-response-bytes": String(bytes),
    ...extraHeaders,
  });
  response.end(body);
  metric?.report({
    method: metric.method,
    path: metric.path,
    status,
    durationMs: Math.round(durationMs * 100) / 100,
    responseBytes: bytes,
    ...(extraHeaders["x-agent-harness-error-category"]
      ? { errorCategory: extraHeaders["x-agent-harness-error-category"] }
      : {}),
  });
}

function sendError(response, error) {
  const status = error.statusCode ?? 400;
  const firstApplicationFrame =
    String(error.stack ?? "")
      .split("\n")
      .find((line) => line.includes("/server/")) ?? "";
  const category =
    status >= 500
      ? "operational"
      : status === 409
        ? "conflict"
        : error.statusCode != null ||
            firstApplicationFrame.includes("/server/api.mjs") ||
            firstApplicationFrame.includes("-routes.mjs")
          ? "request"
          : "operational";
  send(
    response,
    status,
    { error: error.message },
    {
      "x-agent-harness-error-category": category,
      "x-agent-harness-retryable": category === "operational" ? "true" : "false",
    },
  );
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
  if (!repositoryPath || !path.isAbsolute(repositoryPath))
    throw new Error("Choose an absolute local repository path.");
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
    if (!name || !allowed.has(path.extname(name).toLowerCase()))
      throw new Error("Attachments must be HTML, an image, or a ZIP file.");
    if (!Number.isFinite(size) || size <= 0 || size > 5_000_000)
      throw new Error(`${name} must be 5 MB or smaller.`);
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
    const requested =
      input?.[policyId] ??
      (allowedModels.includes(normalizeModelId(fallbackPolicy?.model))
        ? fallbackPolicy
        : { model: allowedModels[0], reasoning: known.get(allowedModels[0])?.defaultReasoning });
    const modelId = normalizeModelId(requested?.model);
    const model = known.get(modelId);
    const reasoning = String(requested?.reasoning ?? "");
    if (!model || !allowedModels.includes(modelId)) throw new Error(`${policyId} must use an allowed model.`);
    if (!model.reasoningLevels.includes(reasoning))
      throw new Error(`${model.label} does not support ${reasoning || "that"} reasoning for ${policyId}.`);
    policies[policyId] = { model: modelId, reasoning };
  }
  return policies;
}

// A closed or archived task's worktrees are no longer part of live work, so they report as
// `stale` regardless of the recorded per-entry status. Archiving additionally *removes* the
// ones it safely can, so for an archived task this mostly describes whatever archiving had to
// leave behind — an entry it could not discard without destroying uncommitted work.
const RETIRED_TASK_STATUSES = new Set(["closed", "archived"]);
const DISCARDABLE_CANDIDATE_TASK_STATUSES = new Set(["completed", "closed", "archived"]);

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
      lifecycleState: RETIRED_TASK_STATUSES.has(task.status) ? "stale" : (workPackage.status ?? "retained"),
    });
  }
  const candidates = task.candidates ?? [];
  const currentCandidate = candidates.at(-1) ?? null;
  for (const candidate of candidates) {
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
      lifecycleState: RETIRED_TASK_STATUSES.has(task.status) ? "stale" : (candidate.status ?? "retained"),
      retainedRequired:
        candidate === currentCandidate && !DISCARDABLE_CANDIDATE_TASK_STATUSES.has(task.status),
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
  repositoryAuthorityService = orchestrator?._repositoryAuthority ?? new RepositoryAuthorityService(),
}) {
  // Reads resolve each entry's recorded absolute path, so this root only matters for
  // `prepare`, which the API never calls. It still uses the shared default rather than a
  // second literal: two places computing a worktree root independently is how they drift.
  const worktrees = new GitWorktreeManager(defaultWorktreeRoot());
  const continuationLocks = new Map();
  const runtimeSettingsRoutes = createRuntimeSettingsRoutes({
    store,
    orchestrator,
    suggestedRepository,
    csrfToken,
    worktrees,
    send,
    readJson,
    validateRepository,
    validateStagePolicies,
    worktreeEntriesForTask,
    runtimeSchemaVersion: RUNTIME_SCHEMA_VERSION,
  });
  const changelogRoutes = createChangelogRoutes({
    suggestedRepository,
    send,
    listChangelog,
    changelogDetail,
    git,
    diffCharLimit,
  });
  const candidateWorktreeRoutes = createCandidateWorktreeRoutes({
    store,
    worktrees,
    send,
    worktreeEntriesForTask,
    git,
    diffCharLimit,
  });
  const retainedEvidenceRoutes = createRetainedEvidenceRoutes({ store, send, withActionEligibility });
  const projectRoutes = createProjectRoutes({
    store,
    suggestedRepository,
    send,
    readJson,
    validateRepository,
  });
  const taskCreationRoutes = createTaskCreationRoutes({
    store,
    send,
    readJson,
    validateAttachments,
    validateRepository,
    git,
    repositoryAuthorityService,
    validWorkflows: VALID_WORKFLOWS,
  });
  const taskLifecycleRoutes = createTaskLifecycleRoutes({
    store,
    orchestrator,
    worktrees,
    continuationLocks,
    send,
    readJson,
    validateRepository,
    worktreeEntriesForTask,
    withActionEligibility,
    repositoryAuthorityService,
  });
  const taskActionRoutes = createTaskActionRoutes({ store, orchestrator, send, readJson });
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
        sendError(response, error);
      }
      return;
    }

    try {
      assertHttpBoundary(request, csrfToken);
      if (await runtimeSettingsRoutes(request, response, url)) return;
      if (await changelogRoutes(request, response, url)) return;
      if (await candidateWorktreeRoutes(request, response, url)) return;
      if (await projectRoutes(request, response, url)) return;
      if (await taskCreationRoutes(request, response, url)) return;
      if (await retainedEvidenceRoutes(request, response, url)) return;
      if (await taskLifecycleRoutes(request, response, url)) return;
      if (await taskActionRoutes(request, response, url)) return;
      send(response, 404, { error: "Not found." });
    } catch (error) {
      sendError(response, error);
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
