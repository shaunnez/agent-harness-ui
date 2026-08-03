import assert from "node:assert/strict";
import test from "node:test";
import {
  appScreenForRoute,
  changelogRoute,
  parentTaskRoute,
  parseHashRoute,
  serializeHashRoute,
} from "../src/routes.ts";

test("parses and serializes stable detail routes", () => {
  const artifact = {
    kind: "task",
    taskId: "AH-42",
    stageId: "implement",
    detail: { kind: "artifact", artifactId: "artifact/with spaces" },
    returnTo: "command",
  };
  assert.equal(
    serializeHashRoute(artifact),
    "#/tasks/AH-42/implement/artifacts/artifact%2Fwith%20spaces?from=command",
  );
  assert.deepEqual(parseHashRoute(serializeHashRoute(artifact)), { route: artifact, valid: true });

  const candidate = {
    kind: "task",
    taskId: "AH-42",
    stageId: "dev-review",
    detail: { kind: "candidate-diff", candidateId: "C2", revision: 3 },
  };
  assert.equal(serializeHashRoute(candidate), "#/tasks/AH-42/dev-review/candidates/C2/r3/diff");
  assert.deepEqual(parseHashRoute(serializeHashRoute(candidate)), { route: candidate, valid: true });

  const result = {
    kind: "task",
    taskId: "AH-42",
    stageId: "test",
    detail: { kind: "test-result", resultId: "browser-smoke" },
  };
  assert.equal(serializeHashRoute(result), "#/tasks/AH-42/test/results/browser-smoke");
  assert.deepEqual(parseHashRoute(serializeHashRoute(result)), { route: result, valid: true });
});

test("preserves historic screen, task, skill, and agent URLs", () => {
  assert.deepEqual(parseHashRoute("#/tasks/AH-42/implement"), {
    route: { kind: "task", taskId: "AH-42", stageId: "implement" },
    valid: true,
  });
  assert.deepEqual(parseHashRoute("#/agents/repair"), {
    route: { kind: "agent", agentId: "repair" },
    valid: true,
  });
  assert.deepEqual(parseHashRoute("#/skills/grill"), {
    route: { kind: "skill", skillId: "grill" },
    valid: true,
  });
  assert.deepEqual(parseHashRoute("#/settings"), {
    route: { kind: "screen", screen: "settings" },
    valid: true,
  });
  assert.deepEqual(parseHashRoute("#/"), {
    route: { kind: "screen", screen: "command" },
    valid: true,
  });
});

test("stores a safe parent route for changelog commit and file links", () => {
  const parent = {
    kind: "task",
    taskId: "AH-42",
    stageId: "test",
    detail: { kind: "test-result", resultId: "api-contract" },
  };
  const route = changelogRoute(parent, "2f9a8bcd", "src/components/RuntimeTaskWorkspace.tsx");
  const hash = serializeHashRoute(route);
  assert.equal(
    hash,
    "#/changelog/commit/2f9a8bcd/file/src%2Fcomponents%2FRuntimeTaskWorkspace.tsx?from=tasks%2FAH-42%2Ftest%2Fresults%2Fapi-contract",
  );
  assert.deepEqual(parseHashRoute(hash), { route, valid: true });
  assert.deepEqual(parentTaskRoute(parent), { kind: "task", taskId: "AH-42", stageId: "test", detail: undefined });
  assert.equal(appScreenForRoute(parent), "tasks");
});

test("detail close and Escape return every task detail route to its stage parent", () => {
  for (const detail of [
    { kind: "artifact", artifactId: "specification-md" },
    { kind: "candidate-diff", candidateId: "C3", revision: 2 },
    { kind: "test-result", resultId: "browser-smoke" },
  ]) {
    const route = { kind: "task", taskId: "AH-42", stageId: "test", detail };
    assert.deepEqual(parentTaskRoute(route), { kind: "task", taskId: "AH-42", stageId: "test", detail: undefined });
  }
});

test("rejects malformed or unsupported routes without retaining an invalid identity", () => {
  for (const hash of [
    "#/tasks/AH-42/not-a-stage",
    "#/tasks/AH-42/candidates/C1/r2/diff",
    "#/tasks/AH-42/test/results",
    "#/skills/not-a-skill",
    "#/agents/not-an-agent",
    "#/changelog/commit",
    "#/tasks/%E0%A4%A",
  ]) {
    assert.deepEqual(parseHashRoute(hash), {
      route: { kind: "screen", screen: "command" },
      valid: false,
    });
  }
});
