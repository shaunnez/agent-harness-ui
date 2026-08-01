import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApiServer } from "../server/api.mjs";
import { JsonTaskStore } from "../server/store.mjs";

test("creates, lists, and starts a local task", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-api-"));
  const store = new JsonTaskStore(path.join(directory, "tasks.json"));
  await store.init();
  let startedId = null;
  const orchestrator = {
    status: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
    start(id) {
      startedId = id;
      return true;
    },
    cancel: () => false,
  };
  const server = createApiServer({ store, orchestrator, suggestedRepository: directory });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const createResponse = await fetch(`${origin}/api/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Real task",
        description: "Inspect the local repository.",
        repositoryPath: directory,
        workflow: "investigate",
        priority: "high",
      }),
    });
    assert.equal(createResponse.status, 201);
    const { task } = await createResponse.json();
    assert.equal(task.id, "AH-001");

    const listResponse = await fetch(`${origin}/api/tasks`);
    const list = await listResponse.json();
    assert.equal(list.tasks.length, 1);

    const runResponse = await fetch(`${origin}/api/tasks/${task.id}/run`, { method: "POST" });
    assert.equal(runResponse.status, 202);
    assert.equal(startedId, task.id);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
