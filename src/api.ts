import type { NewTaskDraft, RuntimeStatus, RuntimeTask } from "./domain";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: { "content-type": "application/json", ...init?.headers },
    });
  } catch {
    throw new Error("The local Agent Harness runtime is offline. Start the app with npm run dev.");
  }
  const value = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(value.error ?? `Local runtime request failed (${response.status}).`);
  return value;
}

export async function getRuntimeStatus() {
  return request<RuntimeStatus>("/api/runtime/status");
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
