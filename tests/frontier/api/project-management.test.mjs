import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { JsonTaskStore } from "../../../server/store.mjs";
import { SqliteTaskStore } from "../../../server/sqlite-store.mjs";
import { enrichUsage } from "../../../server/model-catalog.mjs";
import { createIsolatedApi } from "../../../scripts/frontier/isolated-api.mjs";

for (const [name, Store, filename] of [
  ["JSON", JsonTaskStore, "tasks.json"],
  ["SQLite", SqliteTaskStore, "tasks.sqlite3"],
]) {
  test(`${name}: project management retains identity/history and serializes archive versus creation`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "frontier-project-policy-"));
    let store = new Store(path.join(root, filename));
    try {
      await store.init();
      const project = await store.createProject({ name: "Original", repositoryPath: root });
      const renamed = await store.updateProject(project.id, { kind: "rename", name: " Renamed " });
      assert.equal(renamed.name, "Renamed");
      assert.equal(renamed.id, project.id);
      assert.equal(renamed.repositoryPath, project.repositoryPath);
      await store.createProject({ name: "Second", repositoryPath: path.join(root, "other") });
      await assert.rejects(
        store.updateProject(project.id, { kind: "rename", name: "SECOND" }),
        /already exists/,
      );
      const draft = {
        title: "Retained",
        description: "Evidence",
        repositoryPath: root,
        workflow: "investigate",
        priority: "low",
      };

      // Both orders are checked on the actual store queue/transaction.
      const archiveWins = await Promise.allSettled([
        store.updateProject(project.id, { kind: "archive" }),
        store.create(draft),
      ]);
      assert.equal(archiveWins[0].status, "fulfilled");
      assert.equal(archiveWins[1].reason.code, "PROJECT_ARCHIVED");
      assert.equal((await store.list()).length, 0);
      await store.updateProject(project.id, { kind: "restore" });
      const createWins = await Promise.allSettled([
        store.create(draft),
        store.updateProject(project.id, { kind: "archive" }),
      ]);
      assert.equal(createWins[0].status, "fulfilled");
      assert.equal(createWins[1].reason.code, "PROJECT_HAS_ACTIVE_TASKS");
      const task = createWins[0].value;
      for (const evidence of [
        { status: "awaiting-spec-approval" },
        { status: "completed", activeRunKind: "repair" },
        { status: "completed", activeRunKind: null, activeRunReservationId: "reservation-1" },
        { status: "completed", activeRunReservationId: null, activeRunIds: ["run-1"] },
        { status: "completed", activeRunIds: [], pullRequestIntent: { status: "open" } },
        { status: "completed", pullRequestIntent: { status: "publishing" } },
        {
          status: "completed",
          pullRequestIntent: null,
          runs: [{ id: "run-1", status: "running", stage: "triage" }],
        },
      ]) {
        await store.update(task.id, (current) => Object.assign(current, evidence));
        await assert.rejects(store.updateProject(project.id, { kind: "archive" }), {
          code: "PROJECT_HAS_ACTIVE_TASKS",
        });
      }
      await store.update(task.id, (current) => {
        current.runs = [];
        current.status = "completed";
        current.artifacts = [
          {
            id: "artifact-1",
            stage: "specification",
            kind: "markdown",
            name: "spec.md",
            content: "# Retained evidence",
            model: null,
            reasoning: null,
            usage: { ...enrichUsage(null, {}), cost: null, credits: null },
            createdAt: new Date().toISOString(),
          },
        ];
      });
      const archived = await store.updateProject(project.id, { kind: "archive" });
      assert.ok(archived.archivedAt);
      const retained = await store.get(task.id);
      await assert.rejects(store.createContinuation(task.id, draft), { code: "PROJECT_ARCHIVED" });
      const exportPath = path.join(root, "export.json");
      if (name === "SQLite") await store.exportJson(exportPath);
      const exported = JSON.parse(
        await readFile(name === "SQLite" ? exportPath : path.join(root, filename), "utf8"),
      );
      assert.equal(exported.settings.projects[0].archivedAt, archived.archivedAt);
      await store.close();
      store = new Store(path.join(root, filename));
      await store.init();
      assert.equal((await store.listProjects())[0].archivedAt, archived.archivedAt);
      assert.deepEqual((await store.get(task.id)).artifacts, retained.artifacts);
      const restored = await store.updateProject(project.id, { kind: "restore" });
      assert.equal(restored.id, project.id);
      assert.equal(restored.archivedAt, null);
      assert.equal((await store.create(draft)).status, "queued");
    } finally {
      await store.close();
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("project routes preserve repository identity and reject archived task admission", async () => {
  const api = await createIsolatedApi();
  try {
    const status = await (await fetch(`${api.origin}/api/runtime/status`)).json();
    const headers = {
      origin: "http://127.0.0.1:5199",
      "content-type": "application/json",
      "x-agent-harness-csrf": status.csrfToken,
    };
    const send = (url, method, body) =>
      fetch(`${api.origin}${url}`, { method, headers, body: JSON.stringify(body) });
    const project = (await api.store.listProjects())[0];
    const route = `/api/projects/${project.id}`;
    assert.equal((await send(route, "PATCH", { name: "Renamed fixture" })).status, 200);
    assert.equal((await send(route, "PATCH", { name: "Wrong", repositoryPath: "/different" })).status, 400);
    assert.equal((await send(`${route}/archive`, "POST", {})).status, 200);
    const rejected = await send("/api/tasks", "POST", {
      title: "Blocked",
      description: "No creation in archived project",
      repositoryPath: api.repositoryPath,
      workflow: "investigate",
    });
    assert.equal(rejected.status, 409, await rejected.clone().text());
    assert.equal((await api.store.list()).length, 0);
    assert.equal((await send(`${route}/restore`, "POST", {})).status, 200);
    assert.equal((await api.store.listProjects())[0].repositoryPath, project.repositoryPath);
    assert.equal((await send("/api/projects/suggested%3Aunknown", "PATCH", { name: "Invalid" })).status, 404);
  } finally {
    await api.close();
    await rm(api.root, { recursive: true, force: true });
  }
});
