import assert from "node:assert/strict";
import test from "node:test";
import {
  paginateTaskArtifacts,
  paginateTaskEvents,
  paginateTaskRuns,
  projectTaskCore,
  projectTaskPollState,
  projectTaskSummary,
} from "../server/task-projections.mjs";

function taskFixture() {
  return {
    id: "AH-001",
    title: "Projection fixture",
    status: "running",
    candidates: [
      {
        id: "candidate-1",
        revisionNumber: 7,
        baseRevision: "a".repeat(40),
        baseBranch: "main",
        headRevision: "b".repeat(40),
        branch: "agent-harness/AH-001",
        repositoryRoot: "/repository",
        worktreePath: "/worktree",
        status: "ready_for_review",
        createdAt: "2026-08-09T00:00:00.000Z",
        updatedAt: "2026-08-09T00:00:02.000Z",
        revisions: Array.from({ length: 30 }, (_, number) => ({ number, evidence: "x".repeat(2_000) })),
        verificationRuns: [{ rows: [{ output: "x".repeat(20_000) }] }],
      },
    ],
    workPackages: [
      {
        id: "S1",
        title: "Package",
        description: "Bounded package",
        dependencies: [],
        batch: 1,
        ownedPaths: ["src/example.ts"],
        verification: ["npm test"],
        status: "planned",
        attempts: 0,
        branch: null,
        worktreePath: null,
        baseRevision: null,
        headRevision: null,
        files: [],
        error: null,
        verificationRuns: [{ rows: [{ output: "x".repeat(20_000) }] }],
        retainedContinuation: { files: Array.from({ length: 50 }, (_, index) => `file-${index}`) },
      },
    ],
    gateFreshness: {
      test: {
        candidateId: "candidate-1",
        candidateRevision: 7,
        target: { candidateId: "candidate-1", candidateRevision: 7 },
        fresh: true,
        focusedTest: { rows: [{ output: "x".repeat(20_000) }] },
        focusedTestRows: [{ output: "x".repeat(20_000) }],
      },
    },
    decisions: Array.from({ length: 20 }, (_, index) => ({
      id: `decision-${index}`,
      answer: "x".repeat(2_000),
    })),
    artifacts: [
      {
        id: "artifact-1",
        stage: "triage",
        name: "triage.md",
        kind: "markdown",
        content: "x".repeat(10_000),
        createdAt: "2026-08-09T00:00:01.000Z",
        contextManifest: { sources: [{ label: "private prompt detail" }] },
        focusedTest: { rows: [{ output: "large output" }] },
        gateResult: { findings: [{ detail: "large finding" }] },
        freshness: { focusedTestRows: [{ output: "large output" }] },
        model: "gpt-5.6-luna",
        usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
      },
      {
        id: "artifact-2",
        stage: "plan",
        name: "plan.md",
        kind: "markdown",
        content: "second",
        createdAt: "2026-08-09T00:00:02.000Z",
        model: "gpt-5.6-sol",
        usage: { inputTokens: 2, cachedInputTokens: 0, outputTokens: 1, totalTokens: 3 },
      },
    ],
    events: [
      { id: "event-1", at: "2026-08-09T00:00:01.000Z", category: "activity", title: "Created" },
      { id: "event-2", at: "2026-08-09T00:00:02.000Z", category: "agent", role: "triage", title: "Started" },
      {
        id: "event-3",
        at: "2026-08-09T00:00:03.000Z",
        category: "agent",
        role: "test",
        runKind: "test",
        title: "Tested",
      },
    ],
    runs: [
      { id: "run-1", startedAt: "2026-08-09T00:00:01.000Z" },
      { id: "run-2", startedAt: "2026-08-09T00:00:02.000Z" },
    ],
  };
}

test("task summaries and core detail omit retained heavy evidence", () => {
  const task = taskFixture();
  const summary = projectTaskSummary(task);
  for (const projection of [summary, projectTaskCore(task)]) {
    assert.equal(projection.artifactCount, 2);
    assert.equal(projection.eventCount, 3);
    assert.equal(projection.runCount, 2);
    assert.equal("events" in projection, false);
    assert.equal("runs" in projection, false);
  }
  assert.equal(projectTaskCore(task).artifacts.length, 0);
  assert.equal("content" in summary.artifacts[0], false);
  assert.equal("contextManifest" in summary.artifacts[0], false);
  assert.equal("focusedTest" in summary.artifacts[0], false);
  assert.equal("gateResult" in summary.artifacts[0], false);
  assert.equal("freshness" in summary.artifacts[0], false);
  assert.equal("decisions" in summary, false);
  assert.equal(summary.candidates.length, 1);
  assert.deepEqual(summary.candidates[0].revisions, []);
  assert.equal("verificationRuns" in summary.candidates[0], false);
  assert.equal("verificationRuns" in summary.workPackages[0], false);
  assert.equal("retainedContinuation" in summary.workPackages[0], false);
  assert.equal(summary.gateFreshness.test.focusedTest, null);
  assert.deepEqual(summary.gateFreshness.test.focusedTestRows, []);
  assert.ok(
    Buffer.byteLength(JSON.stringify(summary)) < Buffer.byteLength(JSON.stringify(task)) * 0.1,
    "the list projection must remain at least 90% smaller than this retained-evidence fixture",
  );
});

test("task summaries bound artifact metadata while preserving the latest artifact for every stage", () => {
  const task = taskFixture();
  task.artifacts = Array.from({ length: 100 }, (_, index) => ({
    id: `artifact-${index}`,
    stage: [
      "triage",
      "scouts",
      "grill",
      "specification",
      "plan",
      "implement",
      "dev-review",
      "test",
      "final-review",
      "approval",
    ][index % 10],
    name: `artifact-${index}.md`,
    kind: "markdown",
    content: "retained content",
    createdAt: new Date(Date.UTC(2026, 7, 9, 0, 0, index)).toISOString(),
  }));

  const summary = projectTaskSummary(task, { artifactCount: 100, pollVersion: "17" });
  assert.equal(summary.artifactCount, 100);
  assert.equal(summary.artifacts.length, 10);
  assert.equal(summary.pollVersion, "17");
  assert.deepEqual(
    summary.artifacts.map((artifact) => artifact.id),
    Array.from({ length: 10 }, (_, index) => `artifact-${90 + index}`),
  );
});

test("poll state exposes only the revision token needed to detect change", () => {
  assert.deepEqual(projectTaskPollState(taskFixture(), "23"), {
    id: "AH-001",
    pollVersion: "23",
  });
});

test("cursor pages are stable, descending, and do not repeat boundary rows", () => {
  const task = taskFixture();
  const first = paginateTaskArtifacts(task, new URLSearchParams({ limit: "1" }));
  assert.deepEqual(
    first.items.map((item) => item.id),
    ["artifact-2"],
  );
  assert.equal(first.total, 2);
  assert.ok(first.nextCursor);
  const second = paginateTaskArtifacts(task, new URLSearchParams({ limit: "1", cursor: first.nextCursor }));
  assert.deepEqual(
    second.items.map((item) => item.id),
    ["artifact-1"],
  );
  assert.equal(second.nextCursor, null);
  assert.equal("content" in second.items[0], false);
});

test("activity filters and run pagination use retained structured data", () => {
  const task = taskFixture();
  const tests = paginateTaskEvents(task, new URLSearchParams({ filter: "test" }));
  assert.deepEqual(
    tests.items.map((item) => item.id),
    ["event-3"],
  );
  const agents = paginateTaskEvents(task, new URLSearchParams({ filter: "agent" }));
  assert.deepEqual(
    agents.items.map((item) => item.id),
    ["event-2"],
  );
  const runs = paginateTaskRuns(task, new URLSearchParams({ limit: "1" }));
  assert.deepEqual(
    runs.items.map((item) => item.id),
    ["run-2"],
  );
  assert.ok(runs.nextCursor);
});

test("invalid cursors and limits fail closed", () => {
  const task = taskFixture();
  assert.throws(
    () => paginateTaskEvents(task, new URLSearchParams({ cursor: "not-a-cursor" })),
    /cursor is invalid/i,
  );
  assert.throws(
    () => paginateTaskRuns(task, new URLSearchParams({ limit: "201" })),
    /limit must be an integer/i,
  );
});
