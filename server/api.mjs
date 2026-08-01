import { access, stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

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
        send(response, 200, { ok: true, service: "agent-harness-local" });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/runtime/status") {
        const runtime = await orchestrator.status();
        send(response, 200, { ...runtime, suggestedRepository });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/tasks") {
        send(response, 200, { tasks: await store.list() });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/tasks") {
        const input = await readJson(request);
        if (!input.title?.trim() || !input.description?.trim()) throw new Error("Title and description are required.");
        const task = await store.create({
          title: input.title.trim().slice(0, 300),
          description: input.description.trim().slice(0, 20_000),
          repositoryPath: await validateRepository(input.repositoryPath),
          workflow: input.workflow === "investigate" ? "investigate" : "implement",
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

      const actionMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/(run|cancel)$/);
      if (request.method === "POST" && actionMatch) {
        const id = decodeURIComponent(actionMatch[1]);
        const task = await store.get(id);
        if (!task) {
          send(response, 404, { error: "Task not found." });
          return;
        }
        if (actionMatch[2] === "run") {
          if (task.status === "blocked" || task.stageRun >= task.stageRunLimit) {
            send(response, 409, { error: "The task has exhausted its stage repair allowance." });
            return;
          }
          const started = orchestrator.start(id);
          send(response, started ? 202 : 409, started ? { started: true } : { error: "Task is already running." });
          return;
        }
        const cancelled = orchestrator.cancel(id);
        send(response, cancelled ? 202 : 409, cancelled ? { cancelled: true } : { error: "Task is not running." });
        return;
      }

      send(response, 404, { error: "Not found." });
    } catch (error) {
      send(response, 400, { error: error.message });
    }
  });
}
