import { access, stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const VALID_WORKFLOWS = new Set(["investigate", "implement"]);
const RUNTIME_SCHEMA_VERSION = 1;

function send(response, status, value) {
  response.writeHead(status, JSON_HEADERS);
  response.end(JSON.stringify(value));
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) throw new Error("Request body is too large.");
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

export function createApiServer({ store, orchestrator, suggestedRepository }) {
  return createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "access-control-allow-origin": "http://127.0.0.1:4173",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type",
      });
      response.end();
      return;
    }

    try {
      if (request.method === "GET" && url.pathname === "/api/health") {
        send(response, 200, { ok: true, service: "agent-harness-local", runtimeSchemaVersion: RUNTIME_SCHEMA_VERSION });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/runtime/status") {
        const runtime = await orchestrator.status();
        send(response, 200, { ...runtime, suggestedRepository, runtimeSchemaVersion: RUNTIME_SCHEMA_VERSION });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/tasks") {
        send(response, 200, { tasks: await store.list() });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/tasks") {
        const input = await readJson(request);
        if (!input.title?.trim() || !input.description?.trim()) throw new Error("Title and description are required.");
        if (!VALID_WORKFLOWS.has(input.workflow)) throw new Error("invalid workflow");
        const task = await store.create({
          title: input.title.trim().slice(0, 300),
          description: input.description.trim().slice(0, 20_000),
          repositoryPath: await validateRepository(input.repositoryPath),
          workflow: input.workflow,
          priority: ["low", "medium", "high"].includes(input.priority) ? input.priority : "medium",
        });
        send(response, 201, { task });
        return;
      }

      const taskMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)$/);
      if (request.method === "GET" && taskMatch) {
        const task = await store.get(decodeURIComponent(taskMatch[1]));
        send(response, task ? 200 : 404, task ? { task } : { error: "Task not found." });
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
          if (task.status !== "blocked" || (candidate?.status !== "repair_required" && !recoverableImplementation)) {
            send(response, 409, { error: "A retry can only be granted to a blocked repair or implementation attempt." });
            return;
          }
          await store.update(id, (draft) => {
            draft.stageRunLimit += 1;
            draft.status = "failed";
            draft.error = null;
            draft.events.push({
              id: crypto.randomUUID(),
              at: new Date().toISOString(),
              category: "decision",
              tone: "warning",
              stage: draft.currentStage,
              title: candidate?.status === "repair_required" ? "One repair attempt granted" : "One implementation attempt granted",
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
        const started = orchestrator.start(id, runConfiguration.kind);
        send(response, started ? 202 : 409, started ? { started: true } : { error: "Task is already running." });
        return;
      }

      send(response, 404, { error: "Not found." });
    } catch (error) {
      send(response, 400, { error: error.message });
    }
  });
}
