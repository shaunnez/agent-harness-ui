import test from "node:test";
import {
  assert,
  createTask,
  makeGateFreshness,
  React,
  renderToStaticMarkup,
  runtimeTaskToRecentTask,
  withWorkspace,
} from "./runtime-test-support.mjs";

test("surfaces the merged candidate, target ref, and a copy-only promotion command for a merged-to-target task", () => {
  return withWorkspace(async ({ RuntimeTaskWorkspace, isStageComplete, toTaskRunState }) => {
    const task = createTask({
      status: "merged-to-target",
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
      mergeIntent: {
        candidateId: "C1",
        candidateRevision: 3,
        baseRevision: "a".repeat(40),
        headRevision: "b".repeat(40),
        targetRef: "refs/heads/codex/vertical-slice",
        note: "",
        status: "completed",
        startedAt: "2026-08-01T12:04:00.000Z",
        completedAt: "2026-08-01T12:05:00.000Z",
        error: null,
      },
      gateFreshness: {
        "dev-review": makeGateFreshness("dev-review", { fresh: true, candidateRevision: 3 }),
        test: makeGateFreshness("test", { fresh: true, candidateRevision: 3 }),
        "final-review": makeGateFreshness("final-review", { fresh: true, candidateRevision: 3 }),
      },
    });

    assert.equal(
      isStageComplete(task, "approval"),
      true,
      "the fast-forward merge completes the approval stage before promotion",
    );
    assert.equal(toTaskRunState(task.status), "merged-to-target");

    const markup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task,
        onBack: async () => {},
        onRun: async () => {},
        onCancel: async () => {},
        onAction: async () => {},
        onDecision: async () => {},
      }),
    );

    assert.match(markup, /Merged to target/);
    assert.match(markup, /C1 r3/);
    assert.match(markup, new RegExp(`Merged head SHA[\\s\\S]*${"b".repeat(40)}`));
    assert.match(markup, /refs\/heads\/codex\/vertical-slice/);
    assert.match(markup, new RegExp(`git push origin ${"b".repeat(40)}:codex/vertical-slice`));
    assert.match(markup, /Copy command/);
    assert.match(markup, /Mark completed/);
  });
});

test("offers an implementation continuation only for completed investigations", () => {
  return withWorkspace(async ({ RuntimeCommandBar, nextAction }) => {
    const task = createTask({
      workflow: "investigate",
      status: "completed",
      currentStage: "specification",
      completedStages: ["triage", "scouts", "grill", "specification"],
    });
    assert.equal(nextAction(task).action, "continue-implementation");
    assert.equal(nextAction(task).label, "Continue to implementation");

    const markup = renderToStaticMarkup(
      React.createElement(RuntimeCommandBar, {
        task,
        viewedStageId: "specification",
        onRun: async () => {},
        onAction: async () => {},
        onFinishGrill: async () => {},
      }),
    );
    assert.match(markup, />Continue to implementation</);
    assert.match(markup, /separate implementation task/);

    const linked = { ...task, continuedByTaskId: "AH-012" };
    assert.equal(nextAction(linked).label, "Open implementation task");
    assert.match(nextAction(linked).title, /AH-012/);
    assert.equal(runtimeTaskToRecentTask(linked).status, "Continued");
  });
});

test("disables task closure while merge reconciliation is pending", () => {
  return withWorkspace(async ({ RuntimeTaskWorkspace }) => {
    const task = createTask({
      status: "merging",
      currentStage: "approval",
      mergeIntent: {
        status: "pending",
        candidateId: "C1",
        candidateRevision: 1,
        candidateHeadRevision: "candidate-c1-r1",
        targetBranch: "main",
        targetHeadRevision: "target-r1",
        mergeMethod: "fast-forward",
        requestedAt: "2026-08-04T00:00:00.000Z",
      },
    });
    const markup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task,
        onBack: async () => {},
        onRun: async () => {},
        onCancel: async () => {},
        onAction: async () => {},
        onDecision: async () => {},
        onCloseTask: async () => {},
      }),
    );
    assert.match(
      markup,
      /disabled=""[^>]*title="Wait for the pending GitHub PR lifecycle before closing this task\."[^>]*>.*Close task/s,
    );
  });
});

test("keeps retirement controls disabled and cancellation available during prototype generation", () => {
  return withWorkspace(async ({ RuntimeTaskWorkspace }) => {
    const task = createTask({
      status: "generating-designs",
      currentStage: "specification",
      activeRunKind: "design",
    });
    const markup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task,
        onBack: async () => {},
        onRun: async () => {},
        onCancel: async () => {},
        onAction: async () => {},
        onDecision: async () => {},
        onCloseTask: async () => {},
        onArchiveTask: async () => {},
      }),
    );

    assert.match(
      markup,
      /disabled=""[^>]*title="Wait for the active process tree to terminate before closing this task\."[^>]*>.*Close task/s,
    );
    assert.match(
      markup,
      /disabled=""[^>]*title="Wait for the active process tree to terminate before archiving this task\."[^>]*>.*Archive/s,
    );
    const cancelButton = markup.match(/<button[^>]*title="Cancel active design generation"[^>]*>/)?.[0];
    assert.ok(cancelButton);
    assert.doesNotMatch(cancelButton, /disabled=""/);
  });
});
