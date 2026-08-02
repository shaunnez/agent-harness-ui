import type {
  NewTaskDraft,
  RuntimeChangelogCommit,
  RuntimeChangelogDetail,
  RuntimeChangelogDiff,
  RuntimeEvaluationSummary,
  RuntimeSettings,
  RuntimeStatus,
  RuntimeTask,
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
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
  if (!response.ok) throw new Error(value.error ?? `Local runtime request failed (${response.status}).`);
  return value;
}

let runtimeCsrfToken: string | null = null;

export async function getRuntimeStatus() {
  const status = await request<RuntimeStatus>("/api/runtime/status");
  runtimeCsrfToken = status.csrfToken ?? null;
  return status;
}

export async function updateRuntimeSettings(input: Pick<RuntimeSettings, "allowedModels" | "defaultModel" | "defaultReasoning" | "stagePolicies">) {
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

export async function getEvaluationSummary() {
  return request<RuntimeEvaluationSummary>("/api/evaluations/summary");
}

export async function listChangelog() {
  return (await request<{ commits: RuntimeChangelogCommit[] }>("/api/changelog")).commits;
}

export async function getChangelogCommit(sha: string) {
  return (await request<{ commit: RuntimeChangelogDetail }>(`/api/changelog/${encodeURIComponent(sha)}`)).commit;
}

export async function getChangelogFileDiff(sha: string, filePath: string) {
  const params = new URLSearchParams({ path: filePath });
  return request<RuntimeChangelogDiff>(`/api/changelog/${encodeURIComponent(sha)}/file?${params.toString()}`);
}

export async function closeTask(id: string, reason: "not-needed" | "superseded" | "duplicate", note = "", supersededBy = "") {
  return request<{ task: RuntimeTask }>(`/api/tasks/${encodeURIComponent(id)}/close`, {
    method: "POST",
    body: JSON.stringify({ reason, note, supersededBy }),
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
  return (await request<{ tasks: RuntimeTask[] }>("/api/tasks")).tasks;
}

export async function getTask(id: string) {
  return (await request<{ task: RuntimeTask }>(`/api/tasks/${encodeURIComponent(id)}`)).task;
}

export async function createTask(draft: NewTaskDraft) {
  return (
    await request<{ task: RuntimeTask }>("/api/tasks", {
      method: "POST",
      body: JSON.stringify(draft),
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
    | "plan"
    | "implement"
    | "repair"
    | "review"
    | "test"
    | "final-review"
    | "approve-merge"
    | "grant-retry",
  note = "",
) {
  return request<Record<string, boolean>>(`/api/tasks/${encodeURIComponent(id)}/${action}`, {
    method: "POST",
    body: JSON.stringify({ note }),
  });
}
