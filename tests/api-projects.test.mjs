import { mkdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { assert, cleanup, createServer, fetch } from "./api-test-support.mjs";

for (const sqlite of [false, true]) {
  const storeLabel = sqlite ? "SQLite" : "JSON";

  test(`lists, validates, and persists projects with the ${storeLabel} store`, async () => {
    const { directory, origin, server, store } = await createServer({ sqlite });
    const projectDirectory = path.join(directory, "registered-project");
    const otherDirectory = path.join(directory, "other-project");
    await Promise.all([mkdir(projectDirectory), mkdir(otherDirectory)]);

    try {
      const initialResponse = await fetch(`${origin}/api/projects`);
      assert.equal(initialResponse.status, 200);
      const initial = (await initialResponse.json()).projects;
      assert.equal(initial.length, 1);
      assert.equal(initial[0].repositoryPath, directory);
      assert.equal(initial[0].name, path.basename(directory));
      assert.equal(initial[0].createdAt, null);

      const createResponse = await fetch(`${origin}/api/projects`, {
        method: "POST",
        body: JSON.stringify({
          name: "Registered project",
          repositoryPath: projectDirectory,
        }),
      });
      assert.equal(createResponse.status, 201);
      const created = (await createResponse.json()).project;
      assert.equal(created.name, "Registered project");
      assert.equal(created.repositoryPath, projectDirectory);
      assert.match(created.id, /^[0-9a-f-]{36}$/i);

      const refreshed = (await (await fetch(`${origin}/api/projects`)).json()).projects;
      assert.deepEqual(
        refreshed.map((project) => [project.name, project.repositoryPath]),
        [
          [path.basename(directory), directory],
          ["Registered project", projectDirectory],
        ].sort(([left], [right]) => left.localeCompare(right)),
      );
      assert.deepEqual(await store.listProjects(), [created]);

      const duplicateName = await fetch(`${origin}/api/projects`, {
        method: "POST",
        body: JSON.stringify({ name: "registered PROJECT", repositoryPath: otherDirectory }),
      });
      assert.equal(duplicateName.status, 400);
      assert.match((await duplicateName.json()).error, /name already exists/i);

      const duplicatePath = await fetch(`${origin}/api/projects`, {
        method: "POST",
        body: JSON.stringify({ name: "Different name", repositoryPath: projectDirectory }),
      });
      assert.equal(duplicatePath.status, 400);
      assert.match((await duplicatePath.json()).error, /already registered/i);

      const relativePath = await fetch(`${origin}/api/projects`, {
        method: "POST",
        body: JSON.stringify({ name: "Relative", repositoryPath: "./relative" }),
      });
      assert.equal(relativePath.status, 400);
      assert.match((await relativePath.json()).error, /absolute local repository path/i);
    } finally {
      if (typeof store.close === "function") store.close();
      await cleanup(server, directory);
    }
  });
}
