import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApiServer } from "../server/api.mjs";
import { SqliteTaskStore } from "../server/sqlite-store.mjs";
import { JsonTaskStore } from "../server/store.mjs";

const CSRF_TOKEN = "refactor-characterization-token";

for (const storeKind of ["json", "sqlite"]) {
  test(`${storeKind} API preserves summary, polling revision, and retained artifact contracts`, async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), `agent-harness-${storeKind}-contract-`));
    const store =
      storeKind === "sqlite"
        ? new SqliteTaskStore(path.join(directory, "tasks.sqlite3"), {
            legacyJsonPath: path.join(directory, "tasks.json"),
          })
        : new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const server = createApiServer({
      store,
      suggestedRepository: directory,
      csrfToken: CSRF_TOKEN,
      orchestrator: {
        status: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
        isRunning: () => false,
      },
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const origin = `http://127.0.0.1:${address.port}`;

    try {
      const task = await store.create({
        title: "Refactor characterization",
        description: "Lock the public projection and retained evidence boundary.",
        repositoryPath: directory,
        workflow: "investigate",
        priority: "medium",
      });
      await store.update(task.id, (draft) => {
        draft.artifacts.push({
          id: "retained-artifact",
          stage: "triage",
          name: "triage.md",
          kind: "markdown",
          content: "retained content must not enter summary or poll payloads",
          createdAt: "2026-08-14T00:00:00.000Z",
        });
      });

      const summaryResponse = await fetch(`${origin}/api/tasks`);
      const summary = await summaryResponse.json();
      assert.equal(summaryResponse.status, 200);
      assert.equal(
        summaryResponse.headers.get("content-length"),
        summaryResponse.headers.get("x-agent-harness-response-bytes"),
      );
      assert.deepEqual(
        summary.tasks.map((item) => item.id),
        [task.id],
      );
      assert.equal(summary.tasks[0].artifactCount, 1);
      assert.equal("content" in summary.tasks[0].artifacts[0], false);
      assert.equal("runs" in summary.tasks[0], false);
      assert.equal("events" in summary.tasks[0], false);

      const firstPollResponse = await fetch(`${origin}/api/tasks/${task.id}?view=poll`);
      const firstPoll = await firstPollResponse.json();
      assert.deepEqual(Object.keys(firstPoll.task).sort(), ["id", "pollVersion"]);
      assert.equal(firstPoll.task.id, task.id);

      await store.update(task.id, (draft) => {
        draft.decisions.push({
          id: "decision-after-poll",
          question: "Preserve behaviour?",
          answer: "Yes",
          createdAt: "2026-08-14T00:00:01.000Z",
        });
      });
      const secondPoll = await (await fetch(`${origin}/api/tasks/${task.id}?view=poll`)).json();
      assert.notEqual(secondPoll.task.pollVersion, firstPoll.task.pollVersion);

      const page = await (
        await fetch(`${origin}/api/tasks/${task.id}/artifacts?limit=1&include=content`)
      ).json();
      assert.equal(page.total, 1);
      assert.equal(page.nextCursor, null);
      assert.deepEqual(
        page.items.map((artifact) => [artifact.id, artifact.content]),
        [["retained-artifact", "retained content must not enter summary or poll payloads"]],
      );
    } finally {
      if (typeof store.close === "function") store.close();
      await new Promise((resolve) => server.close(resolve));
      await rm(directory, { recursive: true, force: true });
    }
  });
}
