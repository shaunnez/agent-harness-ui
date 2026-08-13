import test from "node:test";
import {
  assert,
  createTask,
  makeGateFreshness,
  React,
  renderToStaticMarkup,
  withWorkspace,
} from "./runtime-test-support.mjs";

test("renders workspace artifact freshness from persisted run evidence", () => {
  return withWorkspace(async ({ RuntimeTaskWorkspace, isArtifactFresh }) => {
    const candidate = {
      id: "C1",
      revisionNumber: 2,
      status: "under_review",
      baseRevision: "a".repeat(40),
      headRevision: "b".repeat(40),
      baseBranch: "main",
      branch: "agent-harness/ah-999-c1",
      revisions: [],
    };
    const usage = { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 };
    const artifact = (id, runId, createdAt, freshness) => ({
      id,
      runId,
      stage: "dev-review",
      kind: "markdown",
      name: `${id}.md`,
      content: "# Candidate-bound review",
      createdAt,
      model: "gpt-5.6-sol",
      usage,
      candidateId: "C1",
      candidateRevision: 2,
      freshness,
    });
    const staleReason = "A later terminal attempt superseded this historical evidence.";
    const oldFreshness = makeGateFreshness("dev-review", {
      sourceRunId: "RUN-OLD",
      sourceArtifactId: "ART-OLD",
      reasonCode: "superseded_attempt",
      reasonCopy: staleReason,
    });
    const currentFreshness = makeGateFreshness("dev-review", {
      fresh: true,
      sourceRunId: "RUN-CURRENT",
      sourceArtifactId: "ART-CURRENT",
    });
    const markup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task: createTask({
          status: "awaiting-human-approval",
          currentStage: "dev-review",
          completedStages: ["triage", "scouts", "grill", "specification", "plan", "implement"],
          candidates: [candidate],
          artifacts: [
            artifact("ART-OLD", "RUN-OLD", "2026-08-01T12:01:00.000Z", oldFreshness),
            artifact("ART-CURRENT", "RUN-CURRENT", "2026-08-01T12:02:00.000Z", currentFreshness),
            {
              ...artifact("ART-UNRELATED", "RUN-UNRELATED", "2026-08-01T12:03:00.000Z", oldFreshness),
              candidateId: "C2",
            },
          ],
          runs: [
            { id: "RUN-OLD", artifactId: "ART-OLD", freshness: oldFreshness },
            { id: "RUN-CURRENT", artifactId: "ART-CURRENT", freshness: currentFreshness },
          ],
          gateFreshness: { "dev-review": currentFreshness },
        }),
        initialViewedStageId: "dev-review",
        onBack: async () => {},
        onRun: async () => {},
        onCancel: async () => {},
        onAction: async () => {},
        onDecision: async () => {},
        onGrillAnswer: async () => {},
        onFinishGrill: async () => {},
      }),
    );

    assert.doesNotMatch(markup, /Stale after repair/);
    assert.match(markup, /ART-CURRENT\.md/);
    const viewedRun = markup.slice(
      markup.indexOf("Viewed agent run"),
      markup.indexOf("Viewed agent run") + 500,
    );
    assert.match(viewedRun, /ART-CURRENT\.md/);
    assert.doesNotMatch(viewedRun, /ART-UNRELATED\.md/);
    assert.match(
      markup,
      new RegExp(
        `ART-OLD\\.md[\\s\\S]*Rerun required[\\s\\S]*${staleReason.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
      ),
    );
    assert.equal(
      isArtifactFresh(
        { ...artifact("ART-OLD", "RUN-OLD", "2026-08-01T12:01:00.000Z", oldFreshness) },
        candidate,
      ),
      false,
    );
    assert.equal(oldFreshness.reasonCopy, staleReason);
  });
});

test("renders the exact persisted reason for a stale viewed-stage artifact", () => {
  return withWorkspace(async ({ RuntimeTaskWorkspace }) => {
    const candidate = {
      id: "C1",
      revisionNumber: 7,
      status: "under_review",
      baseRevision: "a".repeat(40),
      headRevision: "b".repeat(40),
      baseBranch: "main",
      branch: "agent-harness/ah-005-c1",
      revisions: [],
    };
    const staleReason = "Candidate evidence belongs to a previous candidate revision.";
    const freshness = makeGateFreshness("dev-review", {
      sourceRunId: "RUN-R6",
      sourceArtifactId: "ART-R6",
      reasonCode: "revision_change",
      reasonCopy: staleReason,
    });
    const artifact = {
      id: "ART-R6",
      runId: "RUN-R6",
      stage: "dev-review",
      kind: "markdown",
      name: "dev-review-c1-r6.md",
      content: "# Prior review",
      createdAt: "2026-08-04T12:00:00.000Z",
      model: "gpt-5.6-sol",
      usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
      candidateId: "C1",
      candidateRevision: 6,
      freshness,
    };
    const markup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task: createTask({
          status: "ready-for-review",
          currentStage: "dev-review",
          completedStages: ["triage", "scouts", "grill", "specification", "plan", "implement"],
          candidates: [candidate],
          artifacts: [artifact],
          runs: [{ id: "RUN-R6", artifactId: "ART-R6", freshness }],
          gateFreshness: { "dev-review": freshness },
        }),
        initialViewedStageId: "dev-review",
        onBack: async () => {},
        onRun: async () => {},
        onCancel: async () => {},
        onAction: async () => {},
        onDecision: async () => {},
        onGrillAnswer: async () => {},
        onFinishGrill: async () => {},
      }),
    );

    assert.match(markup, /Rerun required/);
    assert.match(markup, new RegExp(staleReason.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(markup, /Stale after repair/);
    assert.match(markup, /Typed P0.P3 findings are persisted for gate evaluation/);
    assert.match(markup, /retained artifact remains the full prose review record/);
    assert.doesNotMatch(markup, /does not persist typed P0.P3 finding records/);
  });
});

test("renders dependency batches and package status during implementation", () => {
  return withWorkspace(async ({ RuntimeTaskWorkspace }) => {
    const markup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task: createTask({
          status: "running",
          currentStage: "implement",
          completedStages: ["triage", "scouts", "grill", "specification", "plan"],
          workPackages: [
            {
              id: "S1",
              title: "Runtime contract",
              description: "Add the API behavior.",
              dependencies: [],
              batch: 1,
              ownedPaths: ["server/api.mjs"],
              verification: ["npm test"],
              status: "ready_for_integration",
              attempts: 1,
              branch: "agent-harness/ah-999-s1-a1",
              worktreePath: "C:/worktrees/S1-A1",
              baseRevision: "a".repeat(40),
              headRevision: "b".repeat(40),
              files: ["server/api.mjs"],
              error: null,
            },
            {
              id: "S2",
              title: "Runtime UI",
              description: "Render the API result.",
              dependencies: ["S1"],
              batch: 2,
              ownedPaths: ["src/App.tsx"],
              verification: ["npm run typecheck"],
              status: "running",
              attempts: 1,
              branch: "agent-harness/ah-999-s2-a1",
              worktreePath: "C:/worktrees/S2-A1",
              baseRevision: "a".repeat(40),
              headRevision: null,
              files: [],
              error: null,
            },
          ],
        }),
        onBack: async () => {},
        onRun: async () => {},
        onCancel: async () => {},
        onAction: async () => {},
        onDecision: async () => {},
        onGrillAnswer: async () => {},
        onFinishGrill: async () => {},
      }),
    );
    assert.match(markup, /2 packages \u00b7 2 batches/);
    assert.match(markup, /Runtime contract/);
    assert.match(markup, /Runtime UI/);
    assert.match(markup, /dependencies unlock/);
  });
});

test("renders a truthful completion summary for historical merges without an approval artifact", () => {
  return withWorkspace(async ({ RuntimeTaskWorkspace }) => {
    const markup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task: createTask({
          status: "completed",
          currentStage: "approval",
          completedStages: [
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
          ],
          candidates: [
            {
              id: "C1",
              revisionNumber: 3,
              status: "merged",
              baseRevision: "a".repeat(40),
              headRevision: "b".repeat(40),
              baseBranch: "codex/vertical-slice",
              branch: "agent-harness/ah-999-c1",
              revisions: [],
            },
          ],
        }),
        onBack: async () => {},
        onRun: async () => {},
        onCancel: async () => {},
        onAction: async () => {},
        onDecision: async () => {},
      }),
    );

    assert.match(markup, /Candidate merged successfully/);
    assert.match(markup, /C1 revision 3 merged/);
    assert.match(markup, /Human approval gate/);
    assert.doesNotMatch(markup, /Human approval is not ready yet/);
  });
});

test("renders an exact-candidate approval artifact as current after a successful merge", () => {
  return withWorkspace(async ({ RuntimeTaskWorkspace }) => {
    const approvalArtifact = {
      id: "approval-c1-r3",
      stage: "approval",
      kind: "markdown",
      name: "approval-c1-r3.md",
      content: "# Human approval and merge\n\n- Candidate: C1 revision 3",
      createdAt: "2026-08-01T12:05:00.000Z",
      model: "Human approval",
      usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0 },
      candidateId: "C1",
      candidateRevision: 3,
    };
    const markup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task: createTask({
          status: "completed",
          currentStage: "approval",
          completedStages: [
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
          ],
          candidates: [
            {
              id: "C1",
              revisionNumber: 3,
              status: "merged",
              baseRevision: "a".repeat(40),
              headRevision: "b".repeat(40),
              baseBranch: "codex/vertical-slice",
              branch: "agent-harness/ah-999-c1",
              revisions: [],
            },
          ],
          artifacts: [approvalArtifact],
          gateFreshness: {
            "dev-review": makeGateFreshness("dev-review", { fresh: true, candidateRevision: 3 }),
            test: makeGateFreshness("test", { fresh: true, candidateRevision: 3 }),
            "final-review": makeGateFreshness("final-review", { fresh: true, candidateRevision: 3 }),
          },
        }),
        onBack: async () => {},
        onRun: async () => {},
        onCancel: async () => {},
        onAction: async () => {},
        onDecision: async () => {},
      }),
    );

    assert.match(markup, /Candidate merged successfully/);
    assert.match(markup, /approval-c1-r3\.md/);
    assert.match(markup, /Current evidence/);
    assert.doesNotMatch(markup, /Rerun required|Superseded evidence/);
  });
});

test("classifies workflow stages as past, current, or future from durable evidence alone (P0-4)", () => {
  return withWorkspace(async ({ getStageTemporalState }) => {
    const task = createTask({
      status: "ready-for-review",
      currentStage: "dev-review",
      completedStages: ["triage", "scouts", "grill", "specification", "plan", "implement"],
      attemptsByStage: { "dev-review": 1 },
    });

    // Past: already executed, whether or not it left a completedStages entry — a run or
    // artifact is equally durable evidence that the stage happened.
    assert.equal(getStageTemporalState(task, "triage"), "past");
    assert.equal(getStageTemporalState(task, "implement"), "past");

    // Current: the stage the task is actually on right now.
    assert.equal(getStageTemporalState(task, "dev-review"), "current");

    // Future: never reached, no run, no artifact, no attempt — must not read as history.
    assert.equal(getStageTemporalState(task, "test"), "future");
    assert.equal(getStageTemporalState(task, "final-review"), "future");
    assert.equal(getStageTemporalState(task, "approval"), "future");
  });
});

test("treats a stage with an artifact or run but no completedStages entry as past, not future (P0-4)", () => {
  return withWorkspace(async ({ getStageTemporalState }) => {
    const taskWithRun = createTask({
      status: "repair-required",
      currentStage: "implement",
      completedStages: ["triage", "scouts", "grill", "specification", "plan"],
      runs: [
        {
          id: "run-1",
          kind: "gate",
          status: "completed",
          stage: "dev-review",
          role: null,
          model: null,
          reasoning: null,
          startedAt: null,
          completedAt: null,
          durationMs: null,
          artifactId: null,
          usage: null,
          credits: null,
          apiEstimate: null,
          candidateId: "C1",
          candidateRevision: 1,
          workPackageId: null,
          attempt: 1,
          retryOfRunId: null,
          repairOfRunId: null,
        },
      ],
    });
    assert.equal(getStageTemporalState(taskWithRun, "dev-review"), "past");
  });
});

test("a run in flight for a stage overrides its freshness state (P0-3)", () => {
  return withWorkspace(async ({ getActiveRunStage, isStageRunning }) => {
    const runningDevReview = createTask({
      status: "running",
      currentStage: "dev-review",
      completedStages: ["triage", "scouts", "grill", "specification", "plan", "implement"],
      runs: [
        {
          id: "run-2",
          kind: "gate",
          status: "running",
          stage: "dev-review",
          role: null,
          model: null,
          reasoning: null,
          startedAt: null,
          completedAt: null,
          durationMs: null,
          artifactId: null,
          usage: null,
          credits: null,
          apiEstimate: null,
          candidateId: "C1",
          candidateRevision: 1,
          workPackageId: null,
          attempt: 1,
          retryOfRunId: null,
          repairOfRunId: null,
        },
      ],
    });
    assert.equal(getActiveRunStage(runningDevReview), "dev-review");
    assert.equal(isStageRunning(runningDevReview, "dev-review"), true);
    assert.equal(isStageRunning(runningDevReview, "test"), false);

    // A repair's own run.stage is "implement" even while the invalidated gate it will
    // eventually rerun is further along the workflow — task.currentStage has not moved
    // back to that gate yet, so nothing should claim that gate is running.
    const repairInFlight = createTask({
      status: "running",
      currentStage: "implement",
      completedStages: ["triage", "scouts", "grill", "specification", "plan"],
      runs: [
        {
          id: "run-3",
          kind: "repair",
          status: "running",
          stage: "implement",
          role: "repair",
          model: null,
          reasoning: null,
          startedAt: null,
          completedAt: null,
          durationMs: null,
          artifactId: null,
          usage: null,
          credits: null,
          apiEstimate: null,
          candidateId: "C1",
          candidateRevision: 1,
          workPackageId: null,
          attempt: 1,
          retryOfRunId: null,
          repairOfRunId: null,
        },
      ],
    });
    assert.equal(getActiveRunStage(repairInFlight), "implement");
    assert.equal(isStageRunning(repairInFlight, "dev-review"), false);

    const notRunning = createTask({ status: "ready-for-review", currentStage: "dev-review" });
    assert.equal(getActiveRunStage(notRunning), null);
    assert.equal(isStageRunning(notRunning, "dev-review"), false);
  });
});

test("raises a GitHub PR at Human Approval and renders automatic merge tracking", () => {
  return withWorkspace(async ({ RuntimeCommandBar, RuntimeTaskWorkspace, nextAction, toTaskRunState }) => {
    const candidate = {
      id: "C1",
      revisionNumber: 3,
      status: "awaiting_human_approval",
      baseRevision: "a".repeat(40),
      headRevision: "b".repeat(40),
      baseBranch: "main",
      branch: "agent-harness/ah-999-c1",
      revisions: [],
    };
    const approvalTask = createTask({
      status: "awaiting-human-approval",
      currentStage: "approval",
      candidates: [candidate],
      gateFreshness: {
        "dev-review": makeGateFreshness("dev-review", { fresh: true, candidateRevision: 3 }),
        test: makeGateFreshness("test", { fresh: true, candidateRevision: 3 }),
        "final-review": makeGateFreshness("final-review", { fresh: true, candidateRevision: 3 }),
      },
    });
    assert.equal(nextAction(approvalTask).action, "open-pr");
    const approvalMarkup = renderToStaticMarkup(
      React.createElement(RuntimeCommandBar, {
        task: approvalTask,
        viewedStageId: "approval",
        onRun: async () => {},
        onAction: async () => {},
        onFinishGrill: async () => {},
      }),
    );
    assert.match(approvalMarkup, /Approve &amp; raise PR/);
    assert.match(approvalMarkup, /push only the exact reviewed candidate SHA/i);

    const waitingTask = createTask({
      ...approvalTask,
      status: "awaiting-pr-merge",
      candidates: [{ ...candidate, status: "pull_request_open" }],
      pullRequestIntent: {
        candidateId: "C1",
        candidateRevision: 3,
        baseRevision: "a".repeat(40),
        headRevision: "b".repeat(40),
        targetBranch: "main",
        headBranch: "agent-harness/ah-999-c1-r3-bbbbbbbb",
        repository: "acme/widgets",
        number: 84,
        url: "https://github.com/acme/widgets/pull/84",
        note: "",
        status: "open",
        startedAt: "2026-08-01T12:00:00.000Z",
        openedAt: "2026-08-01T12:01:00.000Z",
        mergedAt: null,
        closedAt: null,
        mergeCommitRevision: null,
        lastCheckedAt: "2026-08-01T12:02:00.000Z",
        lastError: null,
        consecutivePollFailures: 0,
      },
    });
    assert.equal(toTaskRunState(waitingTask.status), "needs-input");
    assert.equal(nextAction(waitingTask).action, "reconcile-pr");
    const waitingMarkup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task: waitingTask,
        onBack: async () => {},
        onRun: async () => {},
        onCancel: async () => {},
        onAction: async () => {},
        onDecision: async () => {},
      }),
    );
    assert.match(waitingMarkup, /Awaiting PR merge/);
    assert.match(waitingMarkup, /Awaiting GitHub merge/);
    assert.match(waitingMarkup, /#84/);
    assert.match(waitingMarkup, /Open PR on GitHub/);
    assert.match(waitingMarkup, /Check GitHub now/);
  });
});
