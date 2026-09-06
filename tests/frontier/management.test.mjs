import assert from "node:assert/strict";
import test from "node:test";
import { createFixtureGateway } from "../../src/frontier/fixtures/gateway.ts";
import { overlayHash, parseOverlay } from "../../src/frontier/app/routes.ts";

test("fixture project changes are isolated and archive blocks task creation until restored", async () => {
  const first = createFixtureGateway(),
    second = createFixtureGateway();
  const project = await first.createProject({
    name: "Sample project",
    repositoryPath: "/demo/new-repository",
  });
  await first.changeProject(project.id, { kind: "rename", name: "Renamed project" });
  assert.equal(
    (await second.projects()).some((item) => item.id === project.id),
    false,
  );
  await first.changeProject(project.id, { kind: "archive" });
  const draft = {
    title: "A draft",
    description: "small label update",
    priority: "low",
    workflow: "investigate",
    repositoryPath: project.repositoryPath,
    rolePolicyOverrides: { grill: { model: "gpt-5.6-sol", reasoning: "high" } },
  };
  await assert.rejects(first.create(draft), /Restore/);
  await first.changeProject(project.id, { kind: "restore" });
  const task = await first.create(draft);
  assert.equal(task.agentConfig.stagePolicies.grill.model, "gpt-5.6-sol");
  assert.equal(task.agentConfig.rolePolicySources.grill, "task-override");
  await assert.rejects(first.changeProject(project.id, { kind: "archive" }), /unresolved/);
  await first.closeTask(task.id, { reason: "not-needed", note: "Browser sample completed" });
  await first.changeProject(project.id, { kind: "archive" });
  assert.equal((await first.core(task.id)).closure.note, "Browser sample completed");
  first.setDisconnected(true);
  await assert.rejects(
    first.createProject({ name: "Offline", repositoryPath: "/demo/offline" }),
    /connection lost/,
  );
});

test("overlay deep links preserve exact identifiers and reject unknown or malformed routes", () => {
  for (const overlay of [
    { kind: "projects" },
    { kind: "project-setup", projectId: "project/with space" },
    { kind: "artifact", taskId: "AH-001", artifactId: "spec/v2#draft" },
    { kind: "tasks", projectId: "my-project" },
    { kind: "task", taskId: "AH-002", stage: "implement" },
  ]) {
    const restored = parseOverlay(overlayHash(overlay));
    assert.equal(overlayHash(restored), overlayHash(overlay));
  }
  assert.equal(parseOverlay("#%ZZ"), null);
  assert.equal(parseOverlay("#unknown/AH-001"), null);
});
