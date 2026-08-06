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
  for (const commitSha of ["2f9a8bcd00000000000000000000000000000000", "A".repeat(64)]) {
    const commitRoute = changelogRoute(parent, commitSha);
    const commitHash = serializeHashRoute(commitRoute);
    assert.equal(commitHash, `#/changelog/commit/${commitSha}?from=tasks%2FAH-42%2Ftest%2Fresults%2Fapi-contract`);
    assert.deepEqual(parseHashRoute(commitHash), { route: commitRoute, valid: true });

    const route = changelogRoute(parent, commitSha, "src/components/RuntimeTaskWorkspace.tsx");
    const hash = serializeHashRoute(route);
    assert.equal(
      hash,
      `#/changelog/commit/${commitSha}/file/src%2Fcomponents%2FRuntimeTaskWorkspace.tsx?from=tasks%2FAH-42%2Ftest%2Fresults%2Fapi-contract`,
    );
    assert.deepEqual(parseHashRoute(hash), { route, valid: true });
  }
  assert.equal(serializeHashRoute(changelogRoute(parent)), "#/changelog?from=tasks%2FAH-42%2Ftest%2Fresults%2Fapi-contract");
  assert.deepEqual(parentTaskRoute(parent), { kind: "task", taskId: "AH-42", stageId: "test", detail: undefined });
  assert.equal(appScreenForRoute(parent), "tasks");
});

test("rejects noncanonical changelog commit identities in parsing and serialization", () => {
  const parent = { kind: "screen", screen: "command" };
  const invalidIds = [
    "2f9a8bcd",
    "a".repeat(39),
    "a".repeat(41),
    "a".repeat(63),
    "a".repeat(65),
    "g".repeat(40),
  ];

  for (const commitSha of invalidIds) {
    for (const suffix of ["", "/file/src%2Ffile.ts"]) {
      assert.deepEqual(parseHashRoute(`#/changelog/commit/${commitSha}${suffix}`), {
        route: { kind: "screen", screen: "command" },
        valid: false,
      });
    }
    assert.throws(
      () => serializeHashRoute(changelogRoute(parent, commitSha)),
      /Commit ID must be exactly 40 or 64 hexadecimal characters/,
    );
    assert.throws(
      () => serializeHashRoute(changelogRoute(parent, commitSha, "src/file.ts")),
      /Commit ID must be exactly 40 or 64 hexadecimal characters/,
    );
  }

  assert.throws(
    () => serializeHashRoute(changelogRoute(parent, undefined, "src/file.ts")),
    /A changelog file route requires a canonical commit ID/,
  );
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

// P0-5 regression: a caller that builds a candidate-diff detail from an event handler with a
// mis-bound `onClick` (passing the click event through where a candidate was expected) ends up
// serializing `candidateId`/`revision` as `undefined`. That must not silently round-trip as a
// distinct, "valid-looking" route — it has to fail parsing the same way any other malformed
// detail does, so the caller lands back on a real fallback rather than a route that looks like
// it opened the diff viewer.
test("rejects a candidate-diff detail built from undefined candidate identity", () => {
  const brokenHash = "#/tasks/AH-42/dev-review/candidates/undefined/rundefined/diff";
  assert.deepEqual(parseHashRoute(brokenHash), {
    route: { kind: "screen", screen: "command" },
    valid: false,
  });
});

test("round-trips candidate-diff routes across representative candidate identities and revisions", () => {
  for (const [candidateId, revision] of [["C1", 1], ["C2", 3], ["candidate-with-dashes", 12], ["C1", 0]]) {
    const route = {
      kind: "task",
      taskId: "AH-42",
      stageId: "dev-review",
      detail: { kind: "candidate-diff", candidateId, revision },
    };
    const hash = serializeHashRoute(route);
    assert.deepEqual(parseHashRoute(hash), { route, valid: true });
  }
});
