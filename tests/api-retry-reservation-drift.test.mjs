import test from "node:test";
import {
  assert,
  attachAssemblyLineage,
  attachCandidateProducerEvidence,
  attachExactCandidateGate,
  bindLatestWorkflowAttempt,
  cleanup,
  createServer,
  createTask,
  fetch,
  twoRevisionCandidate,
} from "./api-test-support.mjs";

test("rejects a retry grant when reserved run metadata drifts before the atomic transition", async () => {
  let taskId = null;
  const { directory, origin, server, store } = await createServer({
    async beforeTransition(targetStore, id) {
      if (id !== taskId) return;
      await targetStore.update(id, (draft) => {
        const sourceRun = draft.runs.find((run) => run.id === "run-review-3");
        sourceRun.workPackageId = "unexpected-package";
      });
    },
  });
  try {
    const response = await createTask(origin, {
      title: "Atomic run history",
      description: "Reserve the complete exhausted run tuple before granting an allowance.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    taskId = task.id;
    await store.update(task.id, (draft) => {
      draft.status = "blocked";
      draft.currentStage = "dev-review";
      draft.attemptsByStage["dev-review"] = draft.stageRunLimits["dev-review"];
      const candidate = attachAssemblyLineage(draft, {
        id: "C1",
        revisionNumber: 1,
        headRevision: "candidate-c1-r1",
        status: "ready_for_review",
      });
      draft.candidates.push(candidate);
      draft.runs.push(
        ...[1, 2, 3].map((attempt) => ({
          id: `run-review-${attempt}`,
          stage: "dev-review",
          kind: "review",
          role: "dev-review",
          status: "failed",
          candidateId: "C1",
          candidateRevision: 1,
          candidateHeadRevision: "candidate-c1-r1",
          workPackageId: null,
          attempt,
        })),
      );
      bindLatestWorkflowAttempt(draft, "dev-review", "review");
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 409);
    assert.match((await grantResponse.json()).error, /state changed/i);
    const updated = await store.get(task.id);
    assert.equal(updated.stageRunLimits["dev-review"], 3);
    assert.equal(updated.decisions.length, 0);
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects a retry grant when candidate producer identities drift before the atomic transition", async () => {
  let taskId = null;
  const { directory, origin, server, store } = await createServer({
    async beforeTransition(targetStore, id) {
      if (id !== taskId) return;
      await targetStore.update(id, (draft) => {
        const candidate = draft.candidates.at(-1);
        const producerRun = draft.runs.find(
          (run) => run.workflowReservationId === candidate.sourceWorkflowReservationId,
        );
        const producerArtifact = draft.artifacts.find((artifact) => artifact.id === producerRun.artifactId);
        producerRun.id = `${producerRun.id}-renamed`;
        producerRun.artifactId = `${producerRun.artifactId}-renamed`;
        producerArtifact.id = producerRun.artifactId;
        producerArtifact.runId = producerRun.id;
      });
    },
  });
  try {
    const response = await createTask(origin, {
      title: "Atomic candidate producer identity",
      description: "Bind a retry grant to immutable candidate producer run and artifact identities.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    taskId = task.id;
    await store.update(task.id, (draft) => {
      draft.status = "ready-for-review";
      draft.currentStage = "dev-review";
      draft.attemptsByStage.implement = 2;
      draft.attemptsByStage["dev-review"] = draft.stageRunLimits["dev-review"];
      const candidate = twoRevisionCandidate();
      draft.candidates.push(candidate);
      attachCandidateProducerEvidence(draft, candidate);
      draft.stageRunReservations.implement = {
        id: candidate.sourceWorkflowReservationId,
        stage: "implement",
        kind: "repair",
        workflowAttempt: 2,
        candidateId: "C1",
        candidateRevision: 1,
        candidateHeadRevision: "candidate-c1-r1",
        authorizedRunScopes: [],
        reservedAt: "2026-08-04T00:00:30.000Z",
      };
      draft.stageRunReservations["dev-review"] = {
        id: "reservation-c1-r2-review-3",
        stage: "dev-review",
        kind: "review",
        workflowAttempt: 3,
        candidateId: "C1",
        candidateRevision: 2,
        candidateHeadRevision: "candidate-c1-r2",
        authorizedRunScopes: [],
        reservedAt: "2026-08-04T00:02:00.000Z",
      };
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 409);
    assert.match((await grantResponse.json()).error, /state changed/i);
    const unchanged = await store.get(task.id);
    assert.equal(unchanged.stageRunLimits["dev-review"], 3);
    assert.match(
      unchanged.runs.find(
        (run) => run.workflowReservationId === unchanged.candidates.at(-1).sourceWorkflowReservationId,
      ).id,
      /-renamed$/,
    );
    assert.equal(unchanged.decisions.length, 0);
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects a repair grant when its retained authorizing gate changes before the atomic transition", async () => {
  let taskId = null;
  const { directory, origin, server, store } = await createServer({
    async beforeTransition(targetStore, id) {
      if (id !== taskId) return;
      await targetStore.update(id, (draft) => {
        const originalId = draft.stageRunReservations["dev-review"].id;
        draft.stageRunReservations["dev-review"].id = "review-authorizer-swapped";
        const gateRun = draft.runs.find((run) => run.workflowReservationId === originalId);
        gateRun.workflowReservationId = "review-authorizer-swapped";
      });
    },
  });
  try {
    const response = await createTask(origin, {
      title: "Atomic repair authorizer",
      description:
        "Bind a repair grant to the exact retained gate that authorized the failed repair workflow.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    taskId = task.id;
    await store.update(task.id, (draft) => {
      draft.status = "repair-required";
      draft.currentStage = "dev-review";
      draft.attemptsByStage.implement = draft.stageRunLimits.implement;
      const candidate = attachAssemblyLineage(draft, {
        id: "C1",
        revisionNumber: 1,
        headRevision: "candidate-c1-r1",
        status: "repair_required",
      });
      draft.candidates.push(candidate);
      attachExactCandidateGate(draft, candidate, { reservationId: "review-authorizer-original" });
      draft.runs.push(
        ...[1, 2, 3].map((attempt) => ({
          id: `run-failed-repair-race-${attempt}`,
          stage: "implement",
          status: "failed",
        })),
      );
      bindLatestWorkflowAttempt(draft, "implement", "repair");
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 409);
    assert.match((await grantResponse.json()).error, /state changed/i);
    const unchanged = await store.get(task.id);
    assert.equal(unchanged.stageRunLimits.implement, 3);
    assert.equal(unchanged.stageRunReservations["dev-review"].id, "review-authorizer-swapped");
    assert.equal(
      unchanged.runs.find((run) => run.id === "run-review-authorizer-original").workflowReservationId,
      "review-authorizer-swapped",
    );
    assert.equal(unchanged.decisions.length, 0);
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects a retry grant when the persisted source run tuple is already impossible for the stage", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Malformed review lineage",
      description: "Reject package-scoped repair metadata presented as Dev Review provenance.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.status = "blocked";
      draft.currentStage = "dev-review";
      draft.attemptsByStage["dev-review"] = draft.stageRunLimits["dev-review"];
      const candidate = attachAssemblyLineage(draft, {
        id: "C1",
        revisionNumber: 1,
        headRevision: "candidate-c1-r1",
        status: "ready_for_review",
      });
      draft.candidates.push(candidate);
      draft.runs.push(
        ...[1, 2, 3].map((attempt) => ({
          id: `run-malformed-review-${attempt}`,
          stage: "dev-review",
          status: "failed",
        })),
      );
      bindLatestWorkflowAttempt(draft, "dev-review", "review");
      Object.assign(draft.runs.at(-1), {
        kind: "repair",
        role: "repair",
        workPackageId: "S1",
        attempt: 99,
      });
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 409);
    assert.match((await grantResponse.json()).error, /does not match its workflow reservation/i);
    const updated = await store.get(task.id);
    assert.equal(updated.stageRunLimits["dev-review"], 3);
    assert.equal(updated.decisions.length, 0);
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects all-null reservations for candidate-bound review and repair grants", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    for (const item of [
      { stage: "dev-review", kind: "review", status: "ready_for_review" },
      { stage: "implement", kind: "repair", status: "repair_required" },
    ]) {
      const response = await createTask(origin, {
        title: `Null ${item.stage} reservation`,
        description: "Candidate-bound workflow attempts require exact candidate identity.",
        repositoryPath: directory,
        workflow: "implement",
      });
      const { task } = await response.json();
      await store.update(task.id, (draft) => {
        draft.status = "blocked";
        draft.currentStage = item.stage;
        draft.attemptsByStage[item.stage] = draft.stageRunLimits[item.stage];
        draft.candidates.push({
          id: "C1",
          revisionNumber: 1,
          headRevision: "candidate-c1-r1",
          status: item.status,
        });
        draft.stageRunReservations[item.stage] = {
          id: `reservation-null-${item.stage}-3`,
          stage: item.stage,
          kind: item.kind,
          workflowAttempt: 3,
          candidateId: null,
          candidateRevision: null,
          candidateHeadRevision: null,
          reservedAt: "2026-08-04T00:00:00.000Z",
        };
      });

      const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
      assert.equal(grantResponse.status, 409, item.stage);
      assert.match((await grantResponse.json()).error, /inconsistent workflow reservation/i, item.stage);
      const updated = await store.get(task.id);
      assert.equal(updated.stageRunLimits[item.stage], 3, item.stage);
      assert.equal(updated.decisions.length, 0, item.stage);
    }
  } finally {
    await cleanup(server, directory);
  }
});

test("records null provenance when an exhausted preflight attempt has no persisted run", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Preflight-only exhaustion",
      description: "Grant a bounded retry without inventing run provenance.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.status = "blocked";
      draft.currentStage = "plan";
      draft.attemptsByStage.plan = draft.stageRunLimits.plan;
      draft.stageRunReservations.plan = {
        id: "reservation-plan-preflight-3",
        stage: "plan",
        kind: "planning",
        workflowAttempt: 3,
        candidateId: null,
        candidateRevision: null,
        candidateHeadRevision: null,
        reservedAt: "2026-08-04T00:00:00.000Z",
      };
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 200);
    const updated = await store.get(task.id);
    assert.equal(updated.stageRunLimits.plan, 4);
    assert.deepEqual(
      {
        grantedStage: updated.decisions.at(-1).grantedStage,
        previousLimit: updated.decisions.at(-1).previousLimit,
        newLimit: updated.decisions.at(-1).newLimit,
        sourceRunId: updated.decisions.at(-1).sourceRunId,
      },
      { grantedStage: "plan", previousLimit: 3, newLimit: 4, sourceRunId: null },
    );
    assert.deepEqual(
      {
        grantedStage: updated.events.at(-1).grantedStage,
        previousLimit: updated.events.at(-1).previousLimit,
        newLimit: updated.events.at(-1).newLimit,
        sourceRunId: updated.events.at(-1).sourceRunId,
      },
      { grantedStage: "plan", previousLimit: 3, newLimit: 4, sourceRunId: null },
    );
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects an exhausted grant without an exact workflow reservation", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Missing workflow reservation",
      description:
        "Migrated or incomplete state must fail closed instead of fabricating exhaustion evidence.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.status = "blocked";
      draft.currentStage = "plan";
      draft.attemptsByStage.plan = draft.stageRunLimits.plan;
      draft.stageRunReservations = {};
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 409);
    assert.match((await grantResponse.json()).error, /inconsistent workflow reservation/i);
    const updated = await store.get(task.id);
    assert.equal(updated.stageRunLimits.plan, 3);
    assert.equal(updated.decisions.length, 0);
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects a retry grant while the latest exhausted-stage run is still active", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Active retry source",
      description: "Do not grant over an unresolved terminal source.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.status = "blocked";
      draft.currentStage = "test";
      draft.attemptsByStage.test = draft.stageRunLimits.test;
      draft.candidates.push({ id: "C1", revisionNumber: 2, status: "ready_for_test" });
      draft.runs.push(
        { id: "run-test-1", stage: "test", status: "failed" },
        { id: "run-test-2", stage: "test", status: "failed" },
        { id: "run-test-3", stage: "test", status: "running" },
      );
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 409);
    assert.match((await grantResponse.json()).error, /active or inconsistent run history/i);
    const updated = await store.get(task.id);
    assert.equal(updated.stageRunLimits.test, 3);
    assert.equal(updated.decisions.length, 0);
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects a retry grant when an earlier exhausted-stage run remains active", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Earlier active retry source",
      description: "Do not grant while any run in the exhausted stage remains active.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.status = "blocked";
      draft.currentStage = "test";
      draft.attemptsByStage.test = draft.stageRunLimits.test;
      draft.candidates.push({
        id: "C1",
        revisionNumber: 1,
        headRevision: "candidate-c1-r1",
        status: "ready_for_test",
      });
      draft.runs.push(
        { id: "run-test-1", stage: "test", status: "failed" },
        { id: "run-test-2", stage: "test", status: "running" },
        { id: "run-test-3", stage: "test", status: "failed" },
      );
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 409);
    assert.match((await grantResponse.json()).error, /active or inconsistent run history/i);
    const updated = await store.get(task.id);
    assert.equal(updated.stageRunLimits.test, 3);
    assert.equal(updated.decisions.length, 0);
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects a retry grant when recorded attempts already exceed the allowance", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Exceeded repair allowance",
      description: "Reject inconsistent retry state instead of increasing the allowance by more than one.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.status = "failed";
      draft.currentStage = "implement";
      draft.attemptsByStage.implement = draft.stageRunLimits.implement + 1;
      draft.candidates.push({ id: "C1", status: "repair_required" });
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 409);
    assert.deepEqual(await grantResponse.json(), {
      error:
        "The recorded attempts exceed this stage's allowance; resolve the inconsistent task state before granting a retry.",
    });
    const updated = (await (await fetch(`${origin}/api/tasks/${task.id}`)).json()).task;
    assert.equal(updated.stageRunLimits.implement, 3);
    assert.equal(updated.attemptsByStage.implement, 4);
    assert.equal(updated.status, "failed");
    assert.equal(updated.decisions.length, 0);
  } finally {
    await cleanup(server, directory);
  }
});
