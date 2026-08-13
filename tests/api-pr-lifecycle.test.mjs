import test from "node:test";
import {
  assert,
  cleanup,
  createServer,
  createTask,
  fetch,
  formatApprovalStage,
  formatApprovalTimestamp,
  getApprovalHistory,
} from "./api-test-support.mjs";

test("returns server-authoritative action eligibility and never grants Human Approval retries", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Authoritative action projection",
      description:
        "The command bar must consume backend eligibility rather than infer actions from counters.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    let detail = await (await fetch(`${origin}/api/tasks/${task.id}?view=core`)).json();
    assert.equal(detail.task.actionEligibility.actions.run.allowed, true);

    await store.update(task.id, (draft) => {
      draft.status = "failed";
      draft.currentStage = "plan";
      draft.attemptsByStage.plan = 1;
      draft.stageRunLimits.plan = 3;
      draft.error = "Every work package needs at least one repository manifest command ID.";
    });
    detail = await (await fetch(`${origin}/api/tasks/${task.id}?view=core`)).json();
    assert.equal(detail.task.actionEligibility.actions.plan.allowed, true);

    await store.update(task.id, (draft) => {
      draft.attemptsByStage.plan = 3;
    });
    detail = await (await fetch(`${origin}/api/tasks/${task.id}?view=core`)).json();
    assert.equal(detail.task.actionEligibility.actions.plan.allowed, false);
    assert.match(detail.task.actionEligibility.actions.plan.reason, /plan stage has exhausted/i);

    await store.update(task.id, (draft) => {
      draft.status = "blocked";
      draft.currentStage = "approval";
      draft.error = "Promotion policy requires operator input.";
      draft.blocker = {
        code: "promotion-policy",
        detail: draft.error,
        detectedAt: "2026-08-04T00:00:00.000Z",
      };
    });
    detail = await (await fetch(`${origin}/api/tasks/${task.id}?view=core`)).json();
    assert.equal(detail.task.actionEligibility.actions["grant-retry"].allowed, false);
    assert.match(
      detail.task.actionEligibility.actions["grant-retry"].reason,
      /Human Approval never accepts/i,
    );

    await store.update(task.id, (draft) => {
      draft.status = "blocked";
      draft.currentStage = "test";
      draft.blocker = {
        code: "target-diverged",
        detail: "The target advanced.",
        detectedAt: "2026-08-04T00:01:00.000Z",
      };
    });
    detail = await (await fetch(`${origin}/api/tasks/${task.id}?view=core`)).json();
    assert.equal(detail.task.actionEligibility.actions["refresh-candidate"].allowed, true);
    assert.equal(detail.task.actionEligibility.actions["retry-test"].allowed, false);
    assert.equal(detail.task.actionEligibility.actions.repair.allowed, false);
    assert.match(detail.task.actionEligibility.actions["retry-test"].reason, /refresh the candidate/i);
  } finally {
    await cleanup(server, directory);
  }
});

test("dispatches the complete-merged action to the orchestrator and reports 404 for an unknown task", async () => {
  const { directory, origin, server, completedMergedTaskRef } = await createServer();
  try {
    const createResponse = await createTask(origin, {
      title: "Promote a merged candidate",
      description: "Move a merged-to-target task onward to completed.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await createResponse.json();

    const missing = await fetch(`${origin}/api/tasks/AH-404/complete-merged`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: "" }),
    });
    assert.equal(missing.status, 404);
    assert.equal(completedMergedTaskRef(), null);

    const response = await fetch(`${origin}/api/tasks/${task.id}/complete-merged`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: "Promoted onward to the shared integration branch." }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { completed: true });
    assert.deepEqual(completedMergedTaskRef(), {
      id: task.id,
      note: "Promoted onward to the shared integration branch.",
    });
  } finally {
    await cleanup(server, directory);
  }
});

test("dispatches Human Approval to GitHub PR publication rather than a local merge", async () => {
  const { directory, origin, server, approvedPullRequestRef, reconciledPullRequestTaskRef } =
    await createServer();
  try {
    const createResponse = await createTask(origin, {
      title: "Raise an exact candidate PR",
      description: "Human Approval must not fast-forward the local checkout.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await createResponse.json();
    const open = await fetch(`${origin}/api/tasks/${task.id}/open-pr`, {
      method: "POST",
      body: JSON.stringify({ note: "Ready for GitHub review." }),
    });
    assert.equal(open.status, 200);
    assert.deepEqual(await open.json(), { pullRequestOpened: true });
    assert.deepEqual(approvedPullRequestRef(), { id: task.id, note: "Ready for GitHub review." });

    const reconcile = await fetch(`${origin}/api/tasks/${task.id}/reconcile-pr`, { method: "POST" });
    assert.equal(reconcile.status, 200);
    assert.equal(reconciledPullRequestTaskRef(), task.id);
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects closing a task while merge reconciliation is pending", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Pending merge reconciliation",
      description: "Preserve approval finalization after the Git fast-forward starts.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.status = "merging";
      draft.currentStage = "approval";
      draft.mergeIntent = {
        status: "pending",
        candidateId: "C1",
        candidateRevision: 1,
        candidateHeadRevision: "candidate-c1-r1",
        targetBranch: "main",
        targetHeadRevision: "target-r1",
        mergeMethod: "fast-forward",
        requestedAt: "2026-08-04T00:00:00.000Z",
      };
    });

    const closeResponse = await fetch(`${origin}/api/tasks/${task.id}/close`, {
      method: "POST",
      body: JSON.stringify({ reason: "not-needed", note: "Close during merge." }),
    });
    assert.equal(closeResponse.status, 409);
    assert.match((await closeResponse.json()).error, /pending GitHub PR lifecycle/i);
    const unchanged = await store.get(task.id);
    assert.equal(unchanged.status, "merging");
    assert.equal(unchanged.mergeIntent.status, "pending");
    assert.equal(unchanged.closure, null);
  } finally {
    await cleanup(server, directory);
  }
});

test("atomically rejects close when merge reconciliation begins after the initial read", async () => {
  let taskId = null;
  const { directory, origin, server, store } = await createServer({
    async beforeTransition(targetStore, id) {
      if (id !== taskId) return;
      await targetStore.update(id, (draft) => {
        draft.status = "merging";
        draft.currentStage = "approval";
        draft.mergeIntent = {
          status: "pending",
          candidateId: "C1",
          candidateRevision: 1,
          candidateHeadRevision: "candidate-c1-r1",
          targetBranch: "main",
          targetHeadRevision: "target-r1",
          mergeMethod: "fast-forward",
          requestedAt: "2026-08-04T00:00:00.000Z",
        };
      });
    },
  });
  try {
    const response = await createTask(origin, {
      title: "Close merge race",
      description: "A pending close must lose to merge reconciliation.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    taskId = task.id;

    const closeResponse = await fetch(`${origin}/api/tasks/${task.id}/close`, {
      method: "POST",
      body: JSON.stringify({ reason: "not-needed", note: "Racing close." }),
    });
    assert.equal(closeResponse.status, 409);
    assert.match((await closeResponse.json()).error, /state changed|merge reconciliation/i);
    const preserved = await store.get(task.id);
    assert.equal(preserved.status, "merging");
    assert.equal(preserved.mergeIntent.status, "pending");
    assert.equal(preserved.closure, null);
    assert.doesNotMatch(preserved.events.map((event) => event.title).join("\n"), /Task closed/);
  } finally {
    await cleanup(server, directory);
  }
});

test("exposes approval history in the task payload", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Approval history",
      description: "Return persisted approval records.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.approvals.push(
        {
          id: "A1",
          stage: "specification",
          note: "Specification approved.",
          createdAt: "2026-08-01T10:15:00.000Z",
        },
        { id: "A2", stage: "plan", note: "Plan approved.", createdAt: "2026-08-01T10:20:00.000Z" },
      );
    });

    const fetched = await (await fetch(`${origin}/api/tasks/${task.id}`)).json();
    assert.deepEqual(fetched.task.approvals, [
      {
        id: "A1",
        stage: "specification",
        note: "Specification approved.",
        createdAt: "2026-08-01T10:15:00.000Z",
      },
      { id: "A2", stage: "plan", note: "Plan approved.", createdAt: "2026-08-01T10:20:00.000Z" },
    ]);
  } finally {
    await cleanup(server, directory);
  }
});

test("formats approval history for the inspector", () => {
  const approvals = getApprovalHistory([
    {
      id: "A1",
      stage: "specification",
      note: "Specification approved.",
      createdAt: "2026-08-01T10:15:00.000Z",
    },
  ]);
  assert.equal(approvals.length, 1);
  assert.equal(formatApprovalStage(approvals[0].stage), "Task specification");
  assert.notEqual(formatApprovalTimestamp(approvals[0].createdAt), approvals[0].createdAt);
  assert.deepEqual(getApprovalHistory(undefined), []);
});
