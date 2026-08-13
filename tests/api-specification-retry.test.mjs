import test from "node:test";
import { assert, cleanup, createServer, createTask, fetch } from "./api-test-support.mjs";

test("classifies repository command failures as retryable upstream errors", async () => {
  const { directory, origin, server } = await createServer();
  try {
    const response = await fetch(`${origin}/api/runtime/repository-contract`, {
      method: "POST",
      body: JSON.stringify({ repositoryPath: directory }),
    });
    assert.equal(response.status, 502);
    assert.equal(response.headers.get("x-agent-harness-error-category"), "operational");
    assert.equal(response.headers.get("x-agent-harness-retryable"), "true");
  } finally {
    await cleanup(server, directory);
  }
});

test("starts a bounded specification retry with the dedicated run kind", async () => {
  const { directory, origin, server, store, startedIdRef, startedKindRef } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Retry specification",
      description: "Recover a failed specification synthesis.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.status = "blocked";
      draft.currentStage = "specification";
      draft.completedStages = ["triage", "scouts", "grill"];
      draft.attemptsByStage.specification = draft.stageRunLimits.specification;
      draft.stageRunReservations.specification = {
        id: "reservation-specification-3",
        stage: "specification",
        kind: "specification",
        workflowAttempt: 3,
        candidateId: null,
        candidateRevision: null,
        candidateHeadRevision: null,
        reservedAt: "2026-08-04T00:00:00.000Z",
      };
    });

    const blocked = await fetch(`${origin}/api/tasks/${task.id}/specification`, { method: "POST" });
    assert.equal(blocked.status, 409);
    const grant = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grant.status, 200, JSON.stringify(await grant.clone().json()));
    const retry = await fetch(`${origin}/api/tasks/${task.id}/specification`, { method: "POST" });
    assert.equal(retry.status, 202);
    assert.deepEqual(await retry.json(), { started: true });
    assert.equal(startedIdRef(), task.id);
    assert.equal(startedKindRef(), "specification");
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects specification retry outside a failed or cancelled specification state", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Guard specification retry",
      description: "Keep specification retry admission narrow.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    for (const item of [
      { status: "queued", currentStage: "specification", attempts: 0, error: /cannot run specification/i },
      { status: "failed", currentStage: "plan", attempts: 0, error: /cannot run specification/i },
      { status: "blocked", currentStage: "specification", attempts: 1, error: /cannot run specification/i },
      {
        status: "failed",
        currentStage: "specification",
        attempts: 3,
        error: /exhausted its retry allowance/i,
      },
    ]) {
      await store.update(task.id, (draft) => {
        draft.status = item.status;
        draft.currentStage = item.currentStage;
        draft.attemptsByStage.specification = item.attempts;
      });
      const retry = await fetch(`${origin}/api/tasks/${task.id}/specification`, { method: "POST" });
      assert.equal(retry.status, 409, `${item.status}:${item.currentStage}`);
      assert.match((await retry.json()).error, item.error);
    }
  } finally {
    await cleanup(server, directory);
  }
});
