import test from "node:test";
import {
  assert,
  attachCandidateProducerEvidence,
  attachExactCandidateGate,
  cleanup,
  createServer,
  createTask,
  fetch,
  threeRevisionCandidate,
  twoRevisionCandidate,
} from "./api-test-support.mjs";

test("retains exact run provenance for an authorized adjacent prior-candidate grant", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Repaired candidate lineage",
      description:
        "Retain the exact exhausted review run while keeping current and workflow candidate bindings separate.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.status = "ready-for-review";
      draft.currentStage = "dev-review";
      draft.attemptsByStage.implement = 2;
      draft.attemptsByStage["dev-review"] = draft.stageRunLimits["dev-review"];
      const candidate = {
        id: "C1",
        revisionNumber: 2,
        headRevision: "candidate-c1-r2",
        status: "ready_for_review",
        sourceWorkflowAttempt: 2,
        sourceWorkflowReservationId: "reservation-c1-r1-repair-1",
        revisions: [
          {
            number: 1,
            headRevision: "candidate-c1-r1",
            reason: "assembly",
            sourceWorkflowAttempt: 1,
            sourceWorkflowReservationId: "reservation-c1-r1-implementation-1",
            createdAt: "2026-08-04T00:00:00.000Z",
          },
          {
            number: 2,
            headRevision: "candidate-c1-r2",
            reason: "repair",
            sourceWorkflowAttempt: 2,
            sourceWorkflowReservationId: "reservation-c1-r1-repair-1",
            createdAt: "2026-08-04T00:01:00.000Z",
          },
        ],
      };
      draft.candidates.push(candidate);
      candidate.revisions[1].sourceWorkflowReservedAt = "2026-08-04T00:00:30.000Z";
      const authorizer = attachExactCandidateGate(
        draft,
        {
          id: "C1",
          revisionNumber: 1,
          headRevision: "candidate-c1-r1",
        },
        {
          workflowAttempt: 3,
          reservationId: "reservation-c1-r1-review-3",
          reservedAt: "2026-08-04T00:00:10.000Z",
        },
      );
      Object.assign(candidate.revisions[1], {
        authorizingGateStage: authorizer.stage,
        authorizingGateWorkflowAttempt: authorizer.workflowAttempt,
        authorizingGateReservationId: authorizer.id,
        authorizingGateReservedAt: authorizer.reservedAt,
        authorizingGateRunId: authorizer.sourceRunId,
        authorizingGateArtifactId: authorizer.sourceArtifactId,
      });
      attachCandidateProducerEvidence(draft, candidate);
      draft.stageRunReservations.implement = {
        id: "reservation-c1-r1-repair-1",
        stage: "implement",
        kind: "repair",
        workflowAttempt: 2,
        candidateId: "C1",
        candidateRevision: 1,
        candidateHeadRevision: "candidate-c1-r1",
        reservedAt: "2026-08-04T00:00:30.000Z",
      };
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 200, JSON.stringify(await grantResponse.clone().json()));
    const updated = await store.get(task.id);
    assert.equal(updated.decisions.at(-1).sourceRunId, "run-reservation-c1-r1-review-3");
    assert.deepEqual(updated.decisions.at(-1).sourceRunIds, ["run-reservation-c1-r1-review-3"]);
    assert.equal(updated.decisions.at(-1).candidateId, "C1");
    assert.equal(updated.decisions.at(-1).candidateRevision, 2);
    assert.equal(updated.decisions.at(-1).candidateHeadRevision, "candidate-c1-r2");
    assert.equal(updated.decisions.at(-1).workflowCandidateId, "C1");
    assert.equal(updated.decisions.at(-1).workflowCandidateRevision, 1);
    assert.equal(updated.decisions.at(-1).workflowCandidateHeadRevision, "candidate-c1-r1");
    assert.equal(updated.decisions.at(-1).workflowReservationId, "reservation-c1-r1-review-3");
    assert.equal(updated.decisions.at(-1).authorizingGateReservationId, "reservation-c1-r1-review-3");
    assert.equal(updated.decisions.at(-1).authorizingGateRunId, "run-reservation-c1-r1-review-3");
    assert.match(updated.decisions.at(-1).authorizingGateArtifactId, /run-reservation-c1-r1-review-3/);
    assert.equal(updated.events.at(-1).sourceRunId, "run-reservation-c1-r1-review-3");
    assert.deepEqual(updated.events.at(-1).sourceRunIds, ["run-reservation-c1-r1-review-3"]);
    assert.equal(updated.events.at(-1).authorizingGateRunId, "run-reservation-c1-r1-review-3");
    assert.equal(updated.decisions.at(-1).candidateAuthorizerReservationIds.length, 1);
    assert.equal(updated.decisions.at(-1).candidateAuthorizerReservationIds[0], "reservation-c1-r1-review-3");
    assert.equal(updated.decisions.at(-1).candidateAuthorizerRunIds.length, 1);
    assert.equal(updated.decisions.at(-1).candidateAuthorizerArtifactIds.length, 1);
    assert.equal(updated.stageRunLimits["dev-review"], 4);
  } finally {
    await cleanup(server, directory);
  }
});

test("grants an exhausted prior gate after a later gate authorized the adjacent repair", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Cross-gate repaired candidate retry",
      description:
        "A Test-authorized repair must still permit an exhausted earlier Development Review to rerun.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.status = "ready-for-review";
      draft.currentStage = "dev-review";
      draft.attemptsByStage.implement = 3;
      draft.attemptsByStage["dev-review"] = draft.stageRunLimits["dev-review"];
      const candidate = threeRevisionCandidate();
      const repairedRevision = candidate.revisions[2];
      repairedRevision.sourceWorkflowReservedAt = "2026-08-04T00:01:40.000Z";
      draft.candidates.push(candidate);

      const testAuthorizer = attachExactCandidateGate(
        draft,
        {
          id: candidate.id,
          revisionNumber: 2,
          headRevision: "candidate-c1-r2",
        },
        {
          stage: "test",
          workflowAttempt: 1,
          reservationId: "reservation-c1-r2-test-1",
          reservedAt: "2026-08-04T00:01:20.000Z",
        },
      );
      const testRun = draft.runs.find((run) => run.id === testAuthorizer.sourceRunId);
      const testArtifact = draft.artifacts.find(
        (artifact) => artifact.id === testAuthorizer.sourceArtifactId,
      );
      const failedRow = {
        id: "cross-gate-test-failure",
        candidateId: candidate.id,
        candidateRevision: 2,
        bindingExplicit: true,
        command: "npm run test:frontend",
        status: "failed",
        durationMs: 5,
        title: "Frontend unit tests",
        artifactReferences: [],
        assertions: [{ label: "exit code", expected: "0", actual: "1" }],
        failureDetails: "One exact candidate assertion failed.",
      };
      const focusedTest = {
        candidateId: candidate.id,
        candidateRevision: 2,
        bindingExplicit: true,
        command: failedRow.command,
        status: "failed",
        startedAt: testRun.startedAt,
        completedAt: testRun.completedAt,
        durationMs: 1_000,
        rowCount: 1,
        failedRowIds: [failedRow.id],
        rows: [failedRow],
      };
      testRun.test = { ...focusedTest };
      testArtifact.focusedTest = focusedTest;
      Object.assign(repairedRevision, {
        authorizingGateStage: testAuthorizer.stage,
        authorizingGateProvider: "codex",
        authorizingGateWorkflowAttempt: testAuthorizer.workflowAttempt,
        authorizingGateReservationId: testAuthorizer.id,
        authorizingGateReservedAt: testAuthorizer.reservedAt,
        authorizingGateRunId: testAuthorizer.sourceRunId,
        authorizingGateArtifactId: testAuthorizer.sourceArtifactId,
      });
      attachCandidateProducerEvidence(draft, candidate);

      draft.stageRunReservations.implement = {
        id: repairedRevision.sourceWorkflowReservationId,
        stage: "implement",
        kind: "repair",
        workflowAttempt: repairedRevision.sourceWorkflowAttempt,
        candidateId: candidate.id,
        candidateRevision: 2,
        candidateHeadRevision: "candidate-c1-r2",
        authorizedRunScopes: [],
        reservedAt: repairedRevision.sourceWorkflowReservedAt,
      };
      const priorReviewReservation = {
        id: "reservation-c1-r2-review-3",
        stage: "dev-review",
        kind: "review",
        workflowAttempt: 3,
        candidateId: candidate.id,
        candidateRevision: 2,
        candidateHeadRevision: "candidate-c1-r2",
        authorizedRunScopes: [],
        reservedAt: "2026-08-04T00:01:10.000Z",
      };
      draft.stageRunReservations["dev-review"] = priorReviewReservation;
      draft.runs.push({
        id: "run-reservation-c1-r2-review-3",
        stage: "dev-review",
        kind: "review",
        role: "dev-review",
        status: "completed",
        startedAt: "2026-08-04T00:01:11.000Z",
        completedAt: "2026-08-04T00:01:12.000Z",
        candidateId: candidate.id,
        candidateRevision: 2,
        candidateHeadRevision: "candidate-c1-r2",
        workPackageId: null,
        attempt: 1,
        workflowAttempt: 3,
        workflowReservationId: priorReviewReservation.id,
      });
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 200, JSON.stringify(await grantResponse.clone().json()));
    assert.deepEqual(await grantResponse.json(), { granted: true });
    const updated = await store.get(task.id);
    const decision = updated.decisions.at(-1);
    assert.equal(updated.stageRunLimits["dev-review"], 4);
    assert.equal(decision.candidateRevision, 3);
    assert.equal(decision.workflowReservationId, "reservation-c1-r2-review-3");
    assert.equal(decision.workflowCandidateRevision, 2);
    assert.equal(decision.sourceRunId, "run-reservation-c1-r2-review-3");
    assert.equal(decision.authorizingGateStage, "test");
    assert.equal(decision.authorizingGateReservationId, "reservation-c1-r2-test-1");
    assert.equal(decision.authorizingGateRunId, "run-reservation-c1-r2-test-1");
    assert.equal(decision.candidateAuthorizerReservationIds.includes("reservation-c1-r2-test-1"), true);
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects an adjacent repaired-candidate gate grant without an exact prior gate run", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Missing adjacent repair authorizer",
      description: "A prior-revision gate cannot receive a retry without its exact exhausted-stage run.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
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
        id: "reservation-c1-r1-review-3",
        stage: "dev-review",
        kind: "review",
        workflowAttempt: 3,
        candidateId: "C1",
        candidateRevision: 1,
        candidateHeadRevision: "candidate-c1-r1",
        authorizedRunScopes: [],
        reservedAt: "2026-08-04T00:00:10.000Z",
      };
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 409);
    assert.match((await grantResponse.json()).error, /inconsistent workflow reservation|authorizing gate/i);
    const unchanged = await store.get(task.id);
    assert.equal(unchanged.stageRunLimits["dev-review"], 3);
    assert.equal(unchanged.decisions.length, 0);
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects a prior-candidate gate grant without exact adjacent revision lineage", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Missing repair lineage",
      description: "A prior gate reservation cannot authorize an unrelated current candidate.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.status = "ready-for-review";
      draft.currentStage = "dev-review";
      draft.attemptsByStage["dev-review"] = draft.stageRunLimits["dev-review"];
      draft.candidates.push({
        id: "C1",
        revisionNumber: 2,
        headRevision: "candidate-c1-r2",
        status: "ready_for_review",
        revisions: [],
      });
      draft.stageRunReservations["dev-review"] = {
        id: "reservation-unproven-c1-r1-review-3",
        stage: "dev-review",
        kind: "review",
        workflowAttempt: 3,
        candidateId: "C1",
        candidateRevision: 1,
        candidateHeadRevision: "candidate-c1-r1",
        reservedAt: "2026-08-04T00:00:00.000Z",
      };
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 409);
    assert.match((await grantResponse.json()).error, /inconsistent workflow reservation/i);
    assert.equal((await store.get(task.id)).stageRunLimits["dev-review"], 3);
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects adjacent prior-revision grants without unique repair provenance", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    for (const item of [
      {
        name: "non-repair current revision",
        mutate(candidate) {
          candidate.revisions[1].reason = "assembly";
        },
      },
      {
        name: "duplicate current revision",
        mutate(candidate) {
          candidate.revisions.push({ ...candidate.revisions[1] });
        },
      },
      {
        name: "missing source reservation",
        mutate(_candidate, draft) {
          delete draft.stageRunReservations.implement;
        },
      },
      {
        name: "mismatched repair source",
        mutate(candidate) {
          candidate.revisions[1].sourceWorkflowReservationId = "different-repair-reservation";
        },
      },
      {
        name: "malformed older revision",
        mutate(candidate) {
          delete candidate.revisions[0].createdAt;
        },
      },
    ]) {
      const response = await createTask(origin, {
        title: `Reject ${item.name}`,
        description: "The prior-revision exception requires exact durable repair provenance.",
        repositoryPath: directory,
        workflow: "implement",
      });
      const { task } = await response.json();
      await store.update(task.id, (draft) => {
        draft.status = "ready-for-review";
        draft.currentStage = "dev-review";
        draft.attemptsByStage.implement = 2;
        draft.attemptsByStage["dev-review"] = draft.stageRunLimits["dev-review"];
        const candidate = {
          id: "C1",
          revisionNumber: 2,
          headRevision: "candidate-c1-r2",
          status: "ready_for_review",
          sourceWorkflowAttempt: 2,
          sourceWorkflowReservationId: "reservation-c1-r1-repair-1",
          revisions: [
            {
              number: 1,
              headRevision: "candidate-c1-r1",
              reason: "assembly",
              sourceWorkflowAttempt: 1,
              sourceWorkflowReservationId: "reservation-c1-r1-implementation-1",
              createdAt: "2026-08-04T00:00:00.000Z",
            },
            {
              number: 2,
              headRevision: "candidate-c1-r2",
              reason: "repair",
              sourceWorkflowAttempt: 2,
              sourceWorkflowReservationId: "reservation-c1-r1-repair-1",
              createdAt: "2026-08-04T00:01:00.000Z",
            },
          ],
        };
        draft.candidates.push(candidate);
        attachCandidateProducerEvidence(draft, candidate);
        draft.stageRunReservations.implement = {
          id: "reservation-c1-r1-repair-1",
          stage: "implement",
          kind: "repair",
          workflowAttempt: 2,
          candidateId: "C1",
          candidateRevision: 1,
          candidateHeadRevision: "candidate-c1-r1",
          reservedAt: "2026-08-04T00:00:30.000Z",
        };
        draft.stageRunReservations["dev-review"] = {
          id: "reservation-c1-r1-review-3",
          stage: "dev-review",
          kind: "review",
          workflowAttempt: 3,
          candidateId: "C1",
          candidateRevision: 1,
          candidateHeadRevision: "candidate-c1-r1",
          reservedAt: "2026-08-04T00:00:00.000Z",
        };
        item.mutate(candidate, draft);
      });

      const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
      assert.equal(grantResponse.status, 409, item.name);
      assert.match(
        (await grantResponse.json()).error,
        /duplicate or inconsistent persisted identities|inconsistent workflow reservation/i,
        item.name,
      );
      assert.equal((await store.get(task.id)).stageRunLimits["dev-review"], 3, item.name);
    }
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects impossible older repair lineage before authorizing an adjacent gate grant", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    for (const item of [
      {
        name: "reused repair reservation",
        mutate(candidate) {
          candidate.revisions[1].sourceWorkflowReservationId =
            candidate.revisions[2].sourceWorkflowReservationId;
        },
      },
      {
        name: "non-monotonic repair attempt",
        mutate(candidate) {
          candidate.revisions[1].sourceWorkflowAttempt = candidate.revisions[2].sourceWorkflowAttempt;
        },
      },
      {
        name: "duplicate historical head",
        mutate(candidate) {
          candidate.revisions[1].headRevision = candidate.revisions[0].headRevision;
        },
      },
      {
        name: "backward repair timestamp",
        mutate(candidate) {
          candidate.revisions[1].createdAt = "2026-08-04T00:03:00.000Z";
        },
      },
      {
        name: "repair reservation before retained review",
        mutate(_candidate, draft) {
          draft.stageRunReservations.implement.reservedAt = "2026-08-04T00:01:00.000Z";
        },
      },
    ]) {
      const response = await createTask(origin, {
        title: `Reject ${item.name}`,
        description: "Every retained repair revision must be uniquely and chronologically producible.",
        repositoryPath: directory,
        workflow: "implement",
      });
      const { task } = await response.json();
      await store.update(task.id, (draft) => {
        draft.status = "ready-for-review";
        draft.currentStage = "dev-review";
        draft.attemptsByStage.implement = 3;
        draft.attemptsByStage["dev-review"] = draft.stageRunLimits["dev-review"];
        const candidate = {
          id: "C1",
          revisionNumber: 3,
          headRevision: "candidate-c1-r3",
          status: "ready_for_review",
          sourceWorkflowAttempt: 3,
          sourceWorkflowReservationId: "reservation-c1-r2-repair-3",
          revisions: [
            {
              number: 1,
              headRevision: "candidate-c1-r1",
              reason: "assembly",
              sourceWorkflowAttempt: 1,
              sourceWorkflowReservationId: "reservation-c1-assembly-1",
              createdAt: "2026-08-04T00:00:00.000Z",
            },
            {
              number: 2,
              headRevision: "candidate-c1-r2",
              reason: "repair",
              sourceWorkflowAttempt: 2,
              sourceWorkflowReservationId: "reservation-c1-r1-repair-2",
              createdAt: "2026-08-04T00:01:00.000Z",
            },
            {
              number: 3,
              headRevision: "candidate-c1-r3",
              reason: "repair",
              sourceWorkflowAttempt: 3,
              sourceWorkflowReservationId: "reservation-c1-r2-repair-3",
              createdAt: "2026-08-04T00:02:00.000Z",
            },
          ],
        };
        draft.candidates.push(candidate);
        draft.stageRunReservations.implement = {
          id: "reservation-c1-r2-repair-3",
          stage: "implement",
          kind: "repair",
          workflowAttempt: 3,
          candidateId: "C1",
          candidateRevision: 2,
          candidateHeadRevision: "candidate-c1-r2",
          reservedAt: "2026-08-04T00:01:30.000Z",
        };
        draft.stageRunReservations["dev-review"] = {
          id: "reservation-c1-r2-review-3",
          stage: "dev-review",
          kind: "review",
          workflowAttempt: 3,
          candidateId: "C1",
          candidateRevision: 2,
          candidateHeadRevision: "candidate-c1-r2",
          reservedAt: "2026-08-04T00:01:15.000Z",
        };
        item.mutate(candidate, draft);
      });

      const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
      assert.equal(grantResponse.status, 409, item.name);
      assert.match((await grantResponse.json()).error, /inconsistent workflow reservation/i, item.name);
      assert.equal((await store.get(task.id)).stageRunLimits["dev-review"], 3, item.name);
    }
  } finally {
    await cleanup(server, directory);
  }
});
