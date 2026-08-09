import type {
  NewTaskDraft,
  RuntimeChangelogCommit,
  RuntimeChangelogDetail,
  RuntimeChangelogDiff,
  RuntimeEvaluationSummary,
  RuntimeSettings,
  RuntimeStatus,
  RuntimeTask,
  RuntimeTaskCore,
  RuntimeTaskSummary,
  RuntimeArtifact,
  RuntimeArtifactMetadata,
  RuntimeEvent,
  RuntimePage,
  RuntimeRun,
  RuntimeUsage,
  RuntimeWorktreeInventoryRow,
} from "./domain";

export interface CandidateDiffResponse {
  candidateId: string;
  revisionNumber: number;
  headRevision: string;
  worktreePath: string;
  diff: string;
  truncated: boolean;
}

async function request<T>(path: string, init?: RequestInit, retried = false): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(init?.method && init.method !== "GET" && runtimeCsrfToken ? { "x-agent-harness-csrf": runtimeCsrfToken } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new Error("The local Agent Harness runtime is offline. Start the app with npm run dev.");
  }
  const value = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    const message = value.error ?? `Local runtime request failed (${response.status}).`;
    // The server mints a fresh CSRF token on every restart (see getRuntimeStatus below), so a
    // page left open across a restart holds a dead token and every mutation 403s forever until
    // reloaded. GETs carry no token and can't hit this, and we only retry once: a second 403
    // naming the token means it is genuinely invalid, not just stale, and should surface as-is.
    const isMutation = Boolean(init?.method && init.method !== "GET");
    if (response.status === 403 && isMutation && !retried && /csrf token/i.test(message)) {
      await getRuntimeStatus();
      return request<T>(path, init, true);
    }
    throw new Error(message);
  }
  return value;
}

let runtimeCsrfToken: string | null = null;

export async function getRuntimeStatus() {
  const status = await request<RuntimeStatus>("/api/runtime/status");
  runtimeCsrfToken = status.csrfToken ?? null;
  return status;
}

export async function updateRuntimeSettings(input: Pick<RuntimeSettings, "allowedModels" | "defaultModel" | "defaultReasoning" | "stagePolicies" | "profileStagePolicies">) {
  return (
    await request<{ settings: RuntimeSettings }>("/api/settings", {
      method: "PUT",
      body: JSON.stringify(input),
    })
  ).settings;
}

export async function verifyRuntimePricing() {
  return request<{ settings: RuntimeSettings; usage: RuntimeUsage }>("/api/runtime/pricing/verify", {
    method: "POST",
  });
}
export async function getRuntimeWorktreeInventory(taskId?: string) {
  return request<{ rows: RuntimeWorktreeInventoryRow[] }>(
    taskId ? `/api/tasks/${encodeURIComponent(taskId)}/worktrees` : "/api/runtime/worktrees",
  );
}

export async function removeRuntimeWorktree(taskId: string, rowId: string) {
  return request<{ rows: RuntimeWorktreeInventoryRow[] }>(
    `/api/tasks/${encodeURIComponent(taskId)}/worktrees/${encodeURIComponent(rowId)}`,
    { method: "DELETE" },
  );
}

export async function getEvaluationSummary() {
  return request<RuntimeEvaluationSummary>("/api/evaluations/summary");
}

export async function listChangelog() {
  return (await request<{ commits: RuntimeChangelogCommit[] }>("/api/changelog")).commits;
}

export async function getChangelogCommit(commitId: string) {
  return (await request<{ commit: RuntimeChangelogDetail }>(`/api/changelog/${encodeURIComponent(commitId)}`)).commit;
}

export async function getChangelogFileDiff(commitId: string, filePath: string) {
  const params = new URLSearchParams({ path: filePath });
  return request<RuntimeChangelogDiff>(`/api/changelog/${encodeURIComponent(commitId)}/file?${params.toString()}`);
}

export async function closeTask(id: string, reason: "not-needed" | "superseded" | "duplicate", note = "", supersededBy = "") {
  return request<{ task: RuntimeTask }>(`/api/tasks/${encodeURIComponent(id)}/close`, {
    method: "POST",
    body: JSON.stringify({ reason, note, supersededBy }),
  });
}

export async function archiveTask(id: string, note = "") {
  return request<{
    task: RuntimeTask;
    removedWorktrees: Array<{ id: string; worktreePath: string }>;
    retainedWorktrees: Array<{ id: string; worktreePath: string; reason: string }>;
  }>(`/api/tasks/${encodeURIComponent(id)}/archive`, {
    method: "POST",
    body: JSON.stringify({ note }),
  });
}

export async function evaluateTask(
  id: string,
  score: number,
  outcome: "accepted" | "rejected" | "mixed",
  notes = "",
  options?: { kind?: "human" | "blind"; rubric?: Record<string, number>; evaluator?: string; suiteId?: string; caseId?: string },
) {
  return request<{ task: RuntimeTask }>(`/api/tasks/${encodeURIComponent(id)}/evaluation`, {
    method: "POST",
    body: JSON.stringify({ score, outcome, notes, ...options }),
  });
}

export async function getCandidateDiff(taskId: string, candidateId: string, headRevision: string) {
  const params = new URLSearchParams({ headRevision });
  return request<CandidateDiffResponse>(
    `/api/tasks/${encodeURIComponent(taskId)}/candidates/${encodeURIComponent(candidateId)}/diff?${params.toString()}`,
  );
}

export async function listTasks() {
  return (await request<{ tasks: RuntimeTaskSummary[] }>("/api/tasks")).tasks;
}

export async function getTask(id: string) {
  return (await request<{ task: RuntimeTask }>(`/api/tasks/${encodeURIComponent(id)}?view=full`)).task;
}

export async function getTaskCore(id: string) {
  return (await request<{ task: RuntimeTaskCore }>(`/api/tasks/${encodeURIComponent(id)}?view=core`)).task;
}

export async function getTaskActivity(id: string, options: PageOptions = {}) {
  return request<RuntimePage<RuntimeEvent>>(
    `/api/tasks/${encodeURIComponent(id)}/activity?${pageParams(options)}`,
  );
}

export async function getTaskRuns(id: string, options: PageOptions = {}) {
  return request<RuntimePage<RuntimeRun>>(
    `/api/tasks/${encodeURIComponent(id)}/runs?${pageParams(options)}`,
  );
}

export async function getTaskArtifacts(id: string, options: PageOptions = {}) {
  return request<RuntimePage<RuntimeArtifactMetadata>>(
    `/api/tasks/${encodeURIComponent(id)}/artifacts?${pageParams(options)}`,
  );
}

export async function getTaskArtifact(id: string, artifactId: string) {
  return (await request<{ artifact: RuntimeArtifact }>(
    `/api/tasks/${encodeURIComponent(id)}/artifacts/${encodeURIComponent(artifactId)}`,
  )).artifact;
}

interface PageOptions {
  cursor?: string | null;
  limit?: number;
  filter?: "all" | "activity" | "agent" | "test" | "decision";
}

function pageParams(options: PageOptions) {
  const params = new URLSearchParams();
  if (options.cursor) params.set("cursor", options.cursor);
  if (options.limit != null) params.set("limit", String(options.limit));
  if (options.filter) params.set("filter", options.filter);
  return params.toString();
}

export async function createTask(draft: NewTaskDraft) {
  return (
    await request<{ task: RuntimeTask }>("/api/tasks", {
      method: "POST",
      body: JSON.stringify(draft),
    })
  ).task;
}

export async function continueTaskToImplementation(id: string) {
  return request<{ task: RuntimeTask; created: boolean }>(
    `/api/tasks/${encodeURIComponent(id)}/continue-implementation`,
    { method: "POST" },
  );
}

export async function updateTaskWorkflowProfile(
  id: string,
  profile: "fast" | "standard" | "high-risk",
  reason: string,
) {
  return (
    await request<{ task: RuntimeTask }>(`/api/tasks/${encodeURIComponent(id)}/workflow-profile`, {
      method: "PUT",
      body: JSON.stringify({ profile, reason }),
    })
  ).task;
}

export async function runTask(id: string) {
  return request<{ started: true }>(`/api/tasks/${encodeURIComponent(id)}/run`, { method: "POST" });
}

export async function cancelTask(id: string) {
  return request<{ cancelled: true }>(`/api/tasks/${encodeURIComponent(id)}/cancel`, { method: "POST" });
}

export async function recordTaskDecision(id: string, question: string, answer: string) {
  return request<{ recorded: true }>(`/api/tasks/${encodeURIComponent(id)}/decisions`, {
    method: "POST",
    body: JSON.stringify({ question, answer }),
  });
}

export async function answerGrillQuestion(id: string, questionId: string, answer: string) {
  return request<{ recorded: true }>(`/api/tasks/${encodeURIComponent(id)}/grill/answers`, {
    method: "POST",
    body: JSON.stringify({ questionId, answer }),
  });
}

export async function finishGrill(id: string, acceptRemaining: boolean) {
  return request<{ started: true }>(`/api/tasks/${encodeURIComponent(id)}/grill/finish`, {
    method: "POST",
    body: JSON.stringify({ acceptRemaining }),
  });
}

export async function runTaskAction(
  id: string,
  action:
    | "approve-spec"
    | "approve-plan"
    | "specification"
    | "plan"
    | "implement"
    | "repair"
    | "review"
    | "test"
    | "retry-test"
    | "final-review"
    | "approve-merge"
    | "complete-merged"
    | "refresh-candidate"
    | "grant-retry",
  note = "",
) {
  return request<Record<string, boolean>>(`/api/tasks/${encodeURIComponent(id)}/${action}`, {
    method: "POST",
    body: JSON.stringify({ note }),
  });
}
