import assert from "node:assert/strict";
import test from "node:test";
import {
  baselineBlocker,
  classifyAgainstBaseline,
  failedCommandIds,
  recheckRepositoryBaseline,
} from "../server/baseline-verification.mjs";

function harness({ baselineRows, prepareFails = false, verifyThrows = false } = {}) {
  const prepared = [];
  const removed = [];
  const verified = [];
  const worktrees = {
    async prepareEvidence(task, authority, runId) {
      if (prepareFails) throw new Error("The repository authority revision is no longer available locally.");
      prepared.push({ taskId: task.id, revision: authority.selectedRevision, runId });
      return { worktreePath: `/tmp/evidence/${runId}` };
    },
    async removeEvidence(workspace) {
      removed.push(workspace.worktreePath);
    },
  };
  const runVerification = async (input) => {
    verified.push(input);
    if (verifyThrows) throw new Error("verification slot never arrived");
    return { rows: baselineRows ?? [] };
  };
  return { worktrees, runVerification, prepared, removed, verified };
}

const TASK = { id: "AH-087", repositoryPath: "/repo" };
const CANDIDATE = { id: "C1", revisionNumber: 1, baseRevision: "a".repeat(40) };
const CANDIDATE_FAILURE = {
  headRevision: "b".repeat(40),
  status: "failed",
  rows: [
    { id: "frontend-lint", status: "passed" },
    { id: "playwright-e2e", status: "failed" },
  ],
};

async function classify(overrides = {}, harnessOptions = {}) {
  const context = harness(harnessOptions);
  const result = await classifyAgainstBaseline({
    verification: CANDIDATE_FAILURE,
    task: TASK,
    candidate: CANDIDATE,
    baselineRevision: CANDIDATE.baseRevision,
    worktrees: context.worktrees,
    runVerification: context.runVerification,
    ...overrides,
  });
  return { result, ...context };
}

test("failedCommandIds names only the commands that did not pass", () => {
  assert.deepEqual(failedCommandIds(CANDIDATE_FAILURE), ["playwright-e2e"]);
  assert.deepEqual(failedCommandIds({ rows: [] }), []);
  assert.deepEqual(failedCommandIds(null), []);
});

test("a baseline recheck runs the recorded commands at the pinned revision and cleans up", async () => {
  const context = harness({ baselineRows: [{ id: "playwright-e2e", status: "passed" }] });
  await recheckRepositoryBaseline({
    task: TASK,
    baselineVerification: { revision: CANDIDATE.baseRevision, commandIds: ["playwright-e2e"] },
    worktrees: context.worktrees,
    runVerification: context.runVerification,
  });
  assert.equal(context.prepared[0].revision, CANDIDATE.baseRevision);
  assert.deepEqual(context.verified[0].commandIds, ["playwright-e2e"]);
  assert.equal(context.verified[0].candidate.headRevision, CANDIDATE.baseRevision);
  assert.equal(context.verified[0].executionKind, "baseline-recheck");
  assert.equal(context.removed.length, 1);
});

test("a command that also fails at the base revision is not the candidate's fault", async () => {
  // AH-087 exactly: every review passed, `playwright-e2e` failed identically three
  // times, and no repair could ever have fixed a suite the candidate never touched.
  const { result, prepared, verified, removed } = await classify(
    {},
    { baselineRows: [{ id: "playwright-e2e", status: "failed" }] },
  );

  assert.deepEqual(result, {
    revision: CANDIDATE.baseRevision,
    commandIds: ["playwright-e2e"],
    rows: [{ id: "playwright-e2e", status: "failed" }],
  });
  assert.equal(
    prepared[0].revision,
    CANDIDATE.baseRevision,
    "the baseline runs at the base, not the candidate head",
  );
  assert.deepEqual(verified[0].commandIds, ["playwright-e2e"], "only the failed commands are re-run");
  assert.equal(verified[0].executionKind, "baseline-manifest");
  assert.equal(removed.length, 1, "the throwaway worktree is always cleaned up");
});

test("the baseline evidence is never mistaken for a revision of the candidate", async () => {
  const { verified } = await classify({}, { baselineRows: [{ id: "playwright-e2e", status: "failed" }] });
  assert.notEqual(verified[0].candidate.id, CANDIDATE.id);
  assert.equal(verified[0].candidate.headRevision, CANDIDATE.baseRevision);
});

test("a command that passes at the base revision stays the candidate's to answer for", async () => {
  const { result } = await classify({}, { baselineRows: [{ id: "playwright-e2e", status: "passed" }] });
  assert.equal(result, null);
});

test("one genuinely broken command is not excused by an inherited failure beside it", async () => {
  // The strict rule: every failed command must also fail at the base. A candidate that
  // breaks something must not be let off because an unrelated suite was already broken.
  const context = harness({ baselineRows: [{ id: "playwright-e2e", status: "failed" }] });
  const result = await classifyAgainstBaseline({
    verification: {
      headRevision: "b".repeat(40),
      rows: [
        { id: "playwright-e2e", status: "failed" },
        { id: "backend-test", status: "failed" },
      ],
    },
    task: TASK,
    candidate: CANDIDATE,
    baselineRevision: CANDIDATE.baseRevision,
    worktrees: context.worktrees,
    runVerification: context.runVerification,
  });
  assert.equal(result, null);
});

test("a question that cannot be answered leaves the candidate accountable", async () => {
  // Failing to answer is not evidence of innocence, and both failure modes must clean
  // up after themselves.
  const unavailable = await classify({}, { prepareFails: true });
  assert.equal(unavailable.result, null);
  assert.deepEqual(unavailable.removed, [], "nothing was prepared, so nothing is removed");

  const unrunnable = await classify({}, { verifyThrows: true });
  assert.equal(unrunnable.result, null);
  assert.equal(unrunnable.removed.length, 1, "a worktree prepared before the throw is still cleaned up");
});

test("the baseline is not consulted when there is nothing to explain", async () => {
  for (const overrides of [
    { verification: { headRevision: "b".repeat(40), rows: [{ id: "lint", status: "passed" }] } },
    { task: null },
    { baselineRevision: null },
    // A candidate sitting on its own base has no earlier tree to compare against.
    { baselineRevision: CANDIDATE_FAILURE.headRevision },
  ]) {
    const { result, prepared } = await classify(overrides, { baselineRows: [{ id: "x", status: "failed" }] });
    assert.equal(result, null);
    assert.deepEqual(prepared, [], "no worktree is built for a question that need not be asked");
  }
});

test("the blocker tells the operator which commands and which revision, and forbids repair", () => {
  const blocker = baselineBlocker(
    { revision: "a".repeat(40), commandIds: ["playwright-e2e", "backend-test"], rows: [] },
    "Focused test",
  );
  assert.equal(blocker.code, "repository-baseline-verification");
  assert.match(blocker.detail, /playwright-e2e, backend-test/);
  assert.match(blocker.detail, /aaaaaaaaaaaa/);
  assert.match(blocker.detail, /not reporting a defect in this candidate/);
  assert.match(blocker.requiredAction, /Do not repair the candidate/);
});

// --- the Test stage acts on the answer ------------------------------------------

import { GateEvaluationOrchestrator } from "../server/orchestrator-gate-evaluation.mjs";

function gateOrchestrator({ baselineRows }) {
  const current = {
    id: "AH-087",
    repositoryPath: "/repo",
    status: "running",
    currentStage: "test",
    attemptsByStage: { test: 1 },
    stageRunLimits: { test: 3 },
    candidates: [{ ...CANDIDATE, status: "testing" }],
    events: [],
    activeRunKind: "test",
    activeRunReservationId: "reservation-1",
  };
  const store = {
    async get() {
      return structuredClone(current);
    },
    async update(_id, updater) {
      updater(current);
      return structuredClone(current);
    },
  };
  const control = new GateEvaluationOrchestrator({
    store,
    worktrees: {
      async prepareEvidence(_task, authority, runId) {
        return { worktreePath: `/tmp/evidence/${runId}`, revision: authority.selectedRevision };
      },
      async removeEvidence() {},
    },
    runVerification: async () => ({ rows: baselineRows }),
  });
  return { control, current };
}

test("a Test failure the baseline already had blocks the task instead of demanding a repair", async () => {
  const { control, current } = gateOrchestrator({
    baselineRows: [{ id: "playwright-e2e", status: "failed" }],
  });

  const stopped = await control._stopOnRepositoryBaselineFailure(
    "AH-087",
    current.candidates.at(-1),
    CANDIDATE_FAILURE,
    undefined,
  );

  assert.equal(stopped, true);
  assert.equal(
    current.status,
    "blocked",
    "blocked, not repair-required: this is a human's call about the repository",
  );
  assert.notEqual(current.status, "repair-required");
  assert.equal(current.blocker.code, "repository-baseline-verification");
  assert.equal(current.blocker.candidateId, "C1");
  assert.ok(current.blocker.detectedAt, "the blocker records when the harness worked this out");
  assert.deepEqual(current.blocker.baselineVerification.commandIds, ["playwright-e2e"]);
  assert.match(current.events.at(-1).title, /baseline already fails/i);
  assert.match(current.events.at(-1).detail, /Repairing it cannot make an inherited failure pass/);
  assert.equal(
    current.activeRunKind,
    null,
    "the reservation must be released or every later workflow action reads the task as still running",
  );
  assert.equal(current.activeRunReservationId, null);
  assert.equal(
    current.candidates.at(-1).status,
    "ready_for_test",
    "left at 'testing' the candidate can never satisfy a same-revision Test retry's status check",
  );
});

test("a Test failure the baseline did not have is left to the ordinary gate path", async () => {
  const { control, current } = gateOrchestrator({
    baselineRows: [{ id: "playwright-e2e", status: "passed" }],
  });

  const stopped = await control._stopOnRepositoryBaselineFailure(
    "AH-087",
    current.candidates.at(-1),
    CANDIDATE_FAILURE,
    undefined,
  );

  assert.equal(stopped, false);
  assert.equal(current.status, "running", "the gate, not this check, decides a genuine candidate defect");
  assert.equal(current.blocker, undefined);
  assert.deepEqual(current.events, []);
});
