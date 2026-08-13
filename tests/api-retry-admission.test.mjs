import test from "node:test";
import {
  assert,
  attachAssemblyLineage,
  attachCandidateProducerEvidence,
  attachExactCandidateGate,
  attachLinkedArtifact,
  bindLatestWorkflowAttempt,
  CANONICAL_RUN_STAGES,
  cleanup,
  createServer,
  createTask,
  fetch,
  refreshGateFreshness,
  threeRevisionCandidate,
  twoRevisionCandidate,
} from "./api-test-support.mjs";

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

test("grants one bounded repair attempt to a blocked candidate", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Repair candidate",
      description: "Recover a blocked candidate without discarding its history.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    let reservation;
    let authorizingGate;
    let producerArtifactIds;
    let producerRunIds;
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
      producerRunIds = draft.runs
        .filter((run) => run.workflowReservationId === candidate.sourceWorkflowReservationId)
        .map((run) => run.id);
      producerArtifactIds = draft.artifacts
        .filter((artifact) => producerRunIds.includes(artifact.runId))
        .map((artifact) => artifact.id);
      authorizingGate = attachExactCandidateGate(draft, candidate);
      draft.runs.push(
        ...[1, 2, 3].map((attempt) => ({
          id: `run-failed-repair-${attempt}`,
          stage: "implement",
          status: "failed",
        })),
      );
      reservation = bindLatestWorkflowAttempt(draft, "implement", "repair");
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 200, JSON.stringify(await grantResponse.clone().json()));
    assert.deepEqual(await grantResponse.json(), { granted: true });

    const updated = (await (await fetch(`${origin}/api/tasks/${task.id}`)).json()).task;
    assert.equal(updated.status, "failed");
    assert.equal(updated.stageRunLimits.implement, 4);
    assert.equal(updated.stageRunLimits["dev-review"], 3);
    assert.equal(updated.decisions.at(-1).grantedStage, "implement");
    assert.equal(updated.decisions.at(-1).previousLimit, 3);
    assert.equal(updated.decisions.at(-1).newLimit, 4);
    assert.equal(updated.decisions.at(-1).sourceRunId, "run-failed-repair-3");
    assert.deepEqual(updated.decisions.at(-1).sourceRunIds, ["run-failed-repair-3"]);
    assert.equal(updated.decisions.at(-1).candidateId, "C1");
    assert.equal(updated.decisions.at(-1).candidateRevision, 1);
    assert.equal(updated.decisions.at(-1).candidateHeadRevision, "candidate-c1-r1");
    assert.equal(updated.decisions.at(-1).authorizingGateCandidateId, "C1");
    assert.equal(updated.decisions.at(-1).authorizingGateCandidateRevision, 1);
    assert.equal(updated.decisions.at(-1).authorizingGateCandidateHeadRevision, "candidate-c1-r1");
    assert.equal(updated.decisions.at(-1).authorizingGateArtifactId, authorizingGate.sourceArtifactId);
    assert.equal(updated.decisions.at(-1).authorizingGateKind, "review");
    assert.equal(updated.decisions.at(-1).authorizingGateReservedAt, authorizingGate.reservedAt);
    assert.equal(updated.decisions.at(-1).authorizingGateReservationId, authorizingGate.id);
    assert.equal(updated.decisions.at(-1).authorizingGateRunId, authorizingGate.sourceRunId);
    assert.equal(updated.decisions.at(-1).authorizingGateStage, "dev-review");
    assert.equal(updated.decisions.at(-1).authorizingGateWorkflowAttempt, 1);
    assert.deepEqual(updated.decisions.at(-1).candidateProducerArtifactIds, producerArtifactIds);
    assert.deepEqual(updated.decisions.at(-1).candidateProducerRunIds, producerRunIds);
    assert.equal(updated.decisions.at(-1).workflowAttempt, 3);
    assert.equal(updated.decisions.at(-1).workflowCandidateId, "C1");
    assert.equal(updated.decisions.at(-1).workflowCandidateRevision, 1);
    assert.equal(updated.decisions.at(-1).workflowCandidateHeadRevision, "candidate-c1-r1");
    assert.equal(updated.decisions.at(-1).workflowReservationId, reservation.id);
    assert.equal(updated.attemptsByStage.implement, 3);
    assert.equal(updated.candidates.at(-1).status, "repair_required");
    assert.equal(updated.events.at(-1).title, "One repair attempt granted");
    assert.equal(updated.events.at(-1).sourceRunId, "run-failed-repair-3");
    assert.deepEqual(updated.events.at(-1).sourceRunIds, ["run-failed-repair-3"]);
    assert.equal(updated.events.at(-1).candidateId, "C1");
    assert.equal(updated.events.at(-1).candidateRevision, 1);
    assert.equal(updated.events.at(-1).candidateHeadRevision, "candidate-c1-r1");
    assert.equal(updated.events.at(-1).authorizingGateCandidateId, "C1");
    assert.equal(updated.events.at(-1).authorizingGateCandidateRevision, 1);
    assert.equal(updated.events.at(-1).authorizingGateCandidateHeadRevision, "candidate-c1-r1");
    assert.equal(updated.events.at(-1).authorizingGateArtifactId, authorizingGate.sourceArtifactId);
    assert.equal(updated.events.at(-1).authorizingGateKind, "review");
    assert.equal(updated.events.at(-1).authorizingGateReservedAt, authorizingGate.reservedAt);
    assert.equal(updated.events.at(-1).authorizingGateReservationId, authorizingGate.id);
    assert.equal(updated.events.at(-1).authorizingGateRunId, authorizingGate.sourceRunId);
    assert.equal(updated.events.at(-1).authorizingGateStage, "dev-review");
    assert.equal(updated.events.at(-1).authorizingGateWorkflowAttempt, 1);
    assert.deepEqual(updated.events.at(-1).candidateProducerArtifactIds, producerArtifactIds);
    assert.deepEqual(updated.events.at(-1).candidateProducerRunIds, producerRunIds);
    assert.equal(updated.events.at(-1).workflowAttempt, 3);
    assert.equal(updated.events.at(-1).workflowCandidateId, "C1");
    assert.equal(updated.events.at(-1).workflowCandidateRevision, 1);
    assert.equal(updated.events.at(-1).workflowCandidateHeadRevision, "candidate-c1-r1");
    assert.equal(updated.events.at(-1).workflowReservationId, reservation.id);

    const repeatedResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(repeatedResponse.status, 409);
    assert.equal((await store.get(task.id)).stageRunLimits.implement, 4);
  } finally {
    await cleanup(server, directory);
  }
});

test("grants a repair attempt when the authorizing gate's only non-blocking finding lacks explicit binding", async () => {
  // Recorded live (AH-002 dev-review): the reviewer's one finding was P3 (informational,
  // non-blocking) and — like every non-blocking finding `parseGateEvidence` allows to
  // fall back to the top-level candidate binding — carried `bindingExplicit: false`.
  // That is enough for the freshness layer's marker check to classify the gate
  // `missing_binding` instead of `repair_required`, even though the run's own
  // `gateResult.verdict` is genuinely "REPAIR" and the candidate is genuinely
  // `repair_required`. Before the fix, this made the exhausted repair permanently
  // ungrantable: `failedRepairAuthorizingGate`/`candidateGateAuthorizerEvidence`
  // required the literal reasonCode "repair_required" and found no authorizing gate.
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Repair candidate with an unbound informational finding",
      description: "A non-blocking finding lacking explicit binding must not block a repair grant.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    let authorizingGate;
    await store.update(task.id, (draft) => {
      draft.status = "repair-required";
      draft.currentStage = "dev-review";
      const candidate = attachAssemblyLineage(draft, {
        id: "C1",
        revisionNumber: 1,
        headRevision: "candidate-c1-r1",
        status: "repair_required",
      });
      draft.candidates.push(candidate);
      authorizingGate = attachExactCandidateGate(draft, candidate, {
        findings: [
          {
            severity: "P3",
            title: "Reporter ordering is load-bearing and undocumented",
            detail: "Informational only; no repair required for this finding on its own.",
            file: "e2e/playwright.config.ts",
            line: 38,
            candidateId: candidate.id,
            candidateRevision: candidate.revisionNumber,
            bindingExplicit: false,
          },
        ],
        blockingReasons: [
          "Finding Reporter ordering is load-bearing and undocumented is missing explicit candidate identity fields.",
        ],
      });
      draft.runs.push(
        ...[1, 2, 3].map((attempt) => ({
          id: `run-failed-repair-${attempt}`,
          stage: "implement",
          status: "failed",
        })),
      );
      draft.attemptsByStage.implement = draft.stageRunLimits.implement;
      bindLatestWorkflowAttempt(draft, "implement", "repair");
      refreshGateFreshness(draft);
    });

    const before = await store.get(task.id);
    assert.equal(before.gateFreshness["dev-review"].reasonCode, "missing_binding");

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 200, JSON.stringify(await grantResponse.clone().json()));
    assert.deepEqual(await grantResponse.json(), { granted: true });

    const updated = (await (await fetch(`${origin}/api/tasks/${task.id}`)).json()).task;
    assert.equal(updated.stageRunLimits.implement, 4);
    assert.equal(updated.decisions.at(-1).authorizingGateStage, "dev-review");
    assert.equal(updated.decisions.at(-1).authorizingGateArtifactId, authorizingGate.sourceArtifactId);
    assert.equal(updated.decisions.at(-1).authorizingGateRunId, authorizingGate.sourceRunId);
  } finally {
    await cleanup(server, directory);
  }
});

test("grants a second repair attempt after the first failed and moved currentStage off the authorizing gate", async () => {
  // Recorded live (AH-002): a repair attempt's own failure handler sets
  // `task.currentStage = "implement"` (a repair is an implement run) even though the
  // candidate is still repair-required against whichever gate stage actually failed —
  // here, dev-review. `failedRepairAuthorizingGate` compared the authorizing gate's
  // stage directly against `task.currentStage` and found "dev-review" !== "implement",
  // so the *second* repair attempt (after the first failed) could never be granted —
  // every task exhausts its repair allowance the moment one attempt fails, forever.
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Second repair attempt after a failed first",
      description: "A failed repair must not move currentStage off the authorizing gate.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    let authorizingGate;
    await store.update(task.id, (draft) => {
      draft.status = "repair-required";
      // The failed first repair attempt already moved currentStage here.
      draft.currentStage = "implement";
      const candidate = attachAssemblyLineage(draft, {
        id: "C1",
        revisionNumber: 1,
        headRevision: "candidate-c1-r1",
        status: "repair_required",
      });
      draft.candidates.push(candidate);
      authorizingGate = attachExactCandidateGate(draft, candidate);
      // The failed attempt itself, plus the exhausted allowance it left behind.
      draft.runs.push(
        ...[1, 2, 3].map((attempt) => ({
          id: `run-failed-repair-${attempt}`,
          stage: "implement",
          status: "failed",
        })),
      );
      draft.attemptsByStage.implement = draft.stageRunLimits.implement;
      const reservation = bindLatestWorkflowAttempt(draft, "implement", "repair");
      reservation.authorizingGateStage = "dev-review";
      reservation.authorizingGateReservationId = authorizingGate.id;
      reservation.authorizingGateRunId = authorizingGate.sourceRunId;
      reservation.authorizingGateArtifactId = authorizingGate.sourceArtifactId;
      reservation.authorizingGateReservedAt = authorizingGate.reservedAt;
      reservation.authorizingGateWorkflowAttempt = 1;
      reservation.authorizingGateProvider = "claude";
      reservation.authorizingGateArtifactCreatedAt =
        draft.artifacts.find((artifact) => artifact.id === authorizingGate.sourceArtifactId)?.createdAt ??
        null;
      reservation.authorizingGateSnapshotDigest = "f".repeat(64);
      refreshGateFreshness(draft);
    });

    const before = await store.get(task.id);
    assert.equal(before.currentStage, "implement");
    assert.equal(before.gateFreshness["dev-review"].reasonCode, "repair_required");

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 200, JSON.stringify(await grantResponse.clone().json()));
    assert.deepEqual(await grantResponse.json(), { granted: true });

    const updated = (await (await fetch(`${origin}/api/tasks/${task.id}`)).json()).task;
    assert.equal(updated.stageRunLimits.implement, 4);
    assert.equal(updated.decisions.at(-1).authorizingGateStage, "dev-review");
  } finally {
    await cleanup(server, directory);
  }
});

test("grants an exhausted dev-review retry after a no-op repair left the implement reservation unrelated to the current revision", async () => {
  // Recorded live (AH-002): a repair whose newest failing gate needed no code change
  // (its own `<no-changes-needed>` marker, see `#runRepair`) correctly leaves the
  // candidate at its *existing* revision — but `stageRunReservations.implement` still
  // gets overwritten with that repair's own reservation, whose `candidateRevision`
  // targets the current (unchanged) revision rather than being the reservation that
  // originally produced it. `validCandidateProducerReservation` required an exact
  // identity match against the revision's *original* producer, so this legitimate,
  // well-formed no-op repair reservation made every later dev-review retry look like
  // "the candidate's lineage is corrupted" and permanently blocked granting one.
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "No-op repair leaves dev-review retry grantable",
      description: "A repair that changed nothing must not corrupt the producer lineage.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    let previousLimit;
    await store.update(task.id, (draft) => {
      draft.status = "ready-for-review";
      draft.currentStage = "dev-review";
      const candidate = attachAssemblyLineage(draft, {
        id: "C1",
        revisionNumber: 1,
        baseRevision: "target-base-r1",
        headRevision: "candidate-c1-r1",
        status: "ready_for_review",
      });
      draft.candidates.push(candidate);
      candidate.revisionNumber = 2;
      candidate.baseRevision = "target-base-r2";
      candidate.headRevision = "candidate-c1-r2";
      candidate.revisions.push({
        number: 2,
        headRevision: candidate.headRevision,
        reason: "target-refresh",
        previousBaseRevision: "target-base-r1",
        previousHeadRevision: "candidate-c1-r1",
        baseRevision: candidate.baseRevision,
        createdAt: "2026-08-04T00:04:00.000Z",
      });
      previousLimit = draft.stageRunLimits["dev-review"];
      attachExactCandidateGate(draft, candidate, {
        workflowAttempt: previousLimit,
        reservedAt: "2026-08-04T00:06:00.000Z",
      });
      draft.attemptsByStage["dev-review"] = previousLimit;
      // The no-op repair reservation: bound to the candidate's *current* (unchanged)
      // revision, reserved well after that revision was created — exactly what
      // `#runRepair` produces for a `<no-changes-needed>` outcome.
      const noOpRepairWorkflowAttempt = draft.attemptsByStage.implement + 1;
      draft.attemptsByStage.implement = noOpRepairWorkflowAttempt;
      draft.stageRunReservations.implement = {
        id: `reservation-${draft.id}-noop-repair`,
        stage: "implement",
        kind: "repair",
        workflowAttempt: noOpRepairWorkflowAttempt,
        candidateId: candidate.id,
        candidateRevision: candidate.revisionNumber,
        candidateHeadRevision: candidate.headRevision,
        authorizedRunScopes: [],
        reservedAt: "2026-08-04T00:05:00.000Z",
      };
      refreshGateFreshness(draft);
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 200, JSON.stringify(await grantResponse.clone().json()));
    assert.deepEqual(await grantResponse.json(), { granted: true });

    const updated = (await (await fetch(`${origin}/api/tasks/${task.id}`)).json()).task;
    assert.equal(updated.stageRunLimits["dev-review"], previousLimit + 1);
    assert.equal(updated.decisions.at(-1).grantedStage, "dev-review");
  } finally {
    await cleanup(server, directory);
  }
});

test("grants an exact review retry after a no-op repair is followed by target refresh", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "No-op repair then target refresh",
      description: "A mechanical refresh must preserve the latest valid no-op Implement reservation.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    let previousLimit;
    await store.update(task.id, (draft) => {
      draft.status = "review-retry-required";
      draft.currentStage = "dev-review";
      const candidate = attachAssemblyLineage(draft, {
        id: "C1",
        revisionNumber: 1,
        baseRevision: "target-base-r1",
        headRevision: "candidate-c1-r1",
        status: "review_retry_required",
      });
      draft.candidates.push(candidate);

      const noOpRepairWorkflowAttempt = draft.attemptsByStage.implement + 1;
      draft.attemptsByStage.implement = noOpRepairWorkflowAttempt;
      draft.stageRunReservations.implement = {
        id: `reservation-${draft.id}-noop-repair-before-refresh`,
        stage: "implement",
        kind: "repair",
        workflowAttempt: noOpRepairWorkflowAttempt,
        candidateId: candidate.id,
        candidateRevision: candidate.revisionNumber,
        candidateHeadRevision: candidate.headRevision,
        authorizedRunScopes: [],
        reservedAt: "2026-08-04T00:05:00.000Z",
      };

      candidate.revisionNumber = 2;
      candidate.baseRevision = "target-base-r2";
      candidate.headRevision = "candidate-c1-r2";
      candidate.revisions.push({
        number: 2,
        headRevision: candidate.headRevision,
        reason: "target-refresh",
        previousBaseRevision: "target-base-r1",
        previousHeadRevision: "candidate-c1-r1",
        baseRevision: candidate.baseRevision,
        createdAt: "2026-08-04T00:06:00.000Z",
      });

      previousLimit = draft.stageRunLimits["dev-review"];
      attachExactCandidateGate(draft, candidate, {
        workflowAttempt: previousLimit,
        reservedAt: "2026-08-04T00:07:00.000Z",
      });
      refreshGateFreshness(draft);
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 200, JSON.stringify(await grantResponse.clone().json()));
    assert.deepEqual(await grantResponse.json(), { granted: true });

    const updated = await store.get(task.id);
    assert.equal(updated.stageRunLimits["dev-review"], previousLimit + 1);
    assert.equal(updated.candidates.at(-1).revisionNumber, 2);
    assert.equal(updated.candidates.at(-1).revisions.at(-1).reason, "target-refresh");
    assert.equal(updated.stageRunReservations.implement.kind, "repair");
  } finally {
    await cleanup(server, directory);
  }
});

test("grants a failed Test repair after a later Review reservation follows a no-op repair", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Test repair after later review",
      description: "A later gate must not mask the persisted failing stage that still authorizes repair.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      const candidate = attachAssemblyLineage(draft, {
        id: "C1",
        revisionNumber: 1,
        headRevision: "candidate-c1-r1",
        status: "repair_required",
      });
      draft.candidates.push(candidate);
      const failedTest = attachExactCandidateGate(draft, candidate, {
        stage: "test",
        workflowAttempt: 1,
        reservedAt: "2026-08-04T00:02:00.000Z",
      });
      const testRun = draft.runs.find((run) => run.id === failedTest.sourceRunId);
      const testArtifact = draft.artifacts.find((artifact) => artifact.id === failedTest.sourceArtifactId);
      const failedRow = {
        id: "playwright-e2e",
        candidateId: candidate.id,
        candidateRevision: candidate.revisionNumber,
        bindingExplicit: true,
        command: "make e2e-native",
        status: "failed",
        durationMs: 5,
        title: "Real browser suite",
        artifactReferences: [],
        assertions: [{ label: "exit code", expected: "0", actual: "2" }],
        failureDetails: "A candidate-owned Playwright helper used an invalid API.",
      };
      const focusedTest = {
        candidateId: candidate.id,
        candidateRevision: candidate.revisionNumber,
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
      const noOpAttempt = 2;
      const noOpReservationId = `reservation-${draft.id}-noop-repair-${noOpAttempt}`;
      draft.attemptsByStage.implement = noOpAttempt;
      draft.stageRunLimits.implement = noOpAttempt;
      draft.stageRunReservations.implement = {
        id: noOpReservationId,
        stage: "implement",
        kind: "repair",
        workflowAttempt: noOpAttempt,
        candidateId: candidate.id,
        candidateRevision: candidate.revisionNumber,
        candidateHeadRevision: candidate.headRevision,
        authorizedRunScopes: [],
        reservedAt: "2026-08-04T00:05:00.000Z",
        authorizingGateStage: failedTest.stage,
        authorizingGateWorkflowAttempt: failedTest.workflowAttempt,
        authorizingGateReservationId: failedTest.id,
        authorizingGateReservedAt: failedTest.reservedAt,
        authorizingGateRunId: failedTest.sourceRunId,
        authorizingGateArtifactId: failedTest.sourceArtifactId,
      };
      const noOpRun = {
        id: `run-${noOpReservationId}`,
        stage: "implement",
        kind: "repair",
        role: "repair",
        status: "completed",
        workPackageId: null,
        candidateId: candidate.id,
        candidateRevision: candidate.revisionNumber,
        candidateHeadRevision: candidate.headRevision,
        attempt: 1,
        workflowAttempt: noOpAttempt,
        workflowReservationId: noOpReservationId,
        startedAt: "2026-08-04T00:05:01.000Z",
        completedAt: "2026-08-04T00:05:02.000Z",
      };
      attachLinkedArtifact(draft, noOpRun, {
        candidateId: candidate.id,
        candidateRevision: candidate.revisionNumber,
        createdAt: "2026-08-04T00:05:03.000Z",
      });
      draft.runs.push(noOpRun);

      const laterReview = attachExactCandidateGate(draft, candidate, {
        stage: "dev-review",
        workflowAttempt: 1,
        reservedAt: "2026-08-04T00:06:00.000Z",
      });
      const laterReviewRun = draft.runs.find((run) => run.id === laterReview.sourceRunId);
      laterReviewRun.gateResult.verdict = "PASS";
      laterReviewRun.gateResult.reportedVerdict = "PASS";
      laterReviewRun.gateResult.findings = [];
      laterReviewRun.gateResult.blockingReasons = [];
      const laterReviewArtifact = draft.artifacts.find(
        (artifact) => artifact.id === laterReview.sourceArtifactId,
      );
      laterReviewArtifact.gateResult = structuredClone(laterReviewRun.gateResult);

      draft.status = "repair-required";
      draft.currentStage = "test";
      candidate.status = "repair_required";
      refreshGateFreshness(draft);
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 200, JSON.stringify(await grantResponse.clone().json()));
    const updated = await store.get(task.id);
    assert.equal(updated.stageRunLimits.implement, 3);
    assert.equal(updated.decisions.at(-1).authorizingGateStage, "test");
  } finally {
    await cleanup(server, directory);
  }
});

test("grants AH-020 repair from the latest exact-candidate Test after prior no-op repairs exhaust Implement", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "AH-020 no-op repair lineage",
      description:
        "The latest exact-candidate Test remains the repair authorizer after earlier no-op repairs.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      const candidate = attachAssemblyLineage(draft, {
        id: "C1",
        revisionNumber: 1,
        headRevision: "candidate-c1-r1",
        status: "repair_required",
      });
      draft.candidates.push(candidate);
      const firstTest = attachExactCandidateGate(draft, candidate, {
        stage: "test",
        workflowAttempt: 1,
        reservationId: `reservation-${draft.id}-test-1`,
        reservedAt: "2026-08-04T00:02:00.000Z",
      });
      const attachFailedTestEvidence = (gate, rowId) => {
        const run = draft.runs.find((entry) => entry.id === gate.sourceRunId);
        const artifact = draft.artifacts.find((entry) => entry.id === gate.sourceArtifactId);
        const row = {
          id: rowId,
          candidateId: candidate.id,
          candidateRevision: candidate.revisionNumber,
          bindingExplicit: true,
          command: "node --test tests/api.test.mjs",
          status: "failed",
          durationMs: 5,
          title: "Exact candidate regression",
          artifactReferences: [],
          assertions: [{ label: "exit code", expected: "0", actual: "1" }],
          failureDetails: "The exact candidate requires one bounded repair.",
        };
        const focusedTest = {
          candidateId: candidate.id,
          candidateRevision: candidate.revisionNumber,
          bindingExplicit: true,
          command: row.command,
          status: "failed",
          startedAt: run.startedAt,
          completedAt: run.completedAt,
          durationMs: 1_000,
          rowCount: 1,
          failedRowIds: [row.id],
          rows: [row],
        };
        run.test = structuredClone(focusedTest);
        artifact.focusedTest = focusedTest;
      };
      attachFailedTestEvidence(firstTest, "first-test-failure");

      for (const [attempt, reservedAt] of [
        [2, "2026-08-04T00:05:00.000Z"],
        [3, "2026-08-04T00:06:00.000Z"],
      ]) {
        const reservationId = `reservation-${draft.id}-noop-repair-${attempt}`;
        draft.attemptsByStage.implement = attempt;
        draft.stageRunReservations.implement = {
          id: reservationId,
          stage: "implement",
          kind: "repair",
          workflowAttempt: attempt,
          candidateId: candidate.id,
          candidateRevision: candidate.revisionNumber,
          candidateHeadRevision: candidate.headRevision,
          authorizedRunScopes: [],
          reservedAt,
          authorizingGateStage: firstTest.stage,
          authorizingGateWorkflowAttempt: firstTest.workflowAttempt,
          authorizingGateReservationId: firstTest.id,
          authorizingGateReservedAt: firstTest.reservedAt,
          authorizingGateRunId: firstTest.sourceRunId,
          authorizingGateArtifactId: firstTest.sourceArtifactId,
        };
        const reservedAtMs = Date.parse(reservedAt);
        const run = {
          id: `run-${reservationId}`,
          stage: "implement",
          kind: "repair",
          role: "repair",
          status: "completed",
          workPackageId: null,
          candidateId: candidate.id,
          candidateRevision: candidate.revisionNumber,
          candidateHeadRevision: candidate.headRevision,
          attempt: attempt - 1,
          workflowAttempt: attempt,
          workflowReservationId: reservationId,
          startedAt: new Date(reservedAtMs + 1_000).toISOString(),
          completedAt: new Date(reservedAtMs + 2_000).toISOString(),
        };
        attachLinkedArtifact(draft, run, {
          candidateId: candidate.id,
          candidateRevision: candidate.revisionNumber,
          createdAt: new Date(reservedAtMs + 3_000).toISOString(),
        });
        draft.artifacts.at(-1).content =
          '<no-changes-needed>{"reason":"The exact candidate already contains the requested repair."}</no-changes-needed>';
        draft.runs.push(run);
      }
      draft.stageRunLimits.implement = 3;

      candidate.revisionNumber = 2;
      candidate.baseRevision = "target-base-r2";
      candidate.headRevision = "candidate-c1-r2";
      candidate.revisions.push({
        number: 2,
        headRevision: candidate.headRevision,
        reason: "target-refresh",
        previousBaseRevision: "target-base",
        previousHeadRevision: "candidate-c1-r1",
        baseRevision: candidate.baseRevision,
        createdAt: "2026-08-04T00:08:00.000Z",
      });

      const latestTest = attachExactCandidateGate(draft, candidate, {
        stage: "test",
        workflowAttempt: 2,
        reservationId: `reservation-${draft.id}-test-2`,
        reservedAt: "2026-08-04T00:10:00.000Z",
      });
      draft.runs.find((run) => run.id === latestTest.sourceRunId).attempt = 1;
      attachFailedTestEvidence(latestTest, "latest-test-failure");
      draft.status = "repair-required";
      draft.currentStage = "test";
      candidate.status = "repair_required";
      refreshGateFreshness(draft);
      assert.equal(draft.gateFreshness.test.sourceRunId, latestTest.sourceRunId);
      assert.equal(
        draft.gateFreshness.test.reasonCode,
        "repair_required",
        JSON.stringify(draft.gateFreshness.test),
      );
    });

    const before = await store.get(task.id);
    const retainedImplementRunIds = before.runs
      .filter((run) => run.stage === "implement")
      .map((run) => run.id);
    const detail = await (await fetch(`${origin}/api/tasks/${task.id}?view=core`)).json();
    assert.equal(detail.task.actionEligibility.actions.repair.allowed, false);
    assert.match(detail.task.actionEligibility.actions.repair.reason, /implement stage has exhausted/i);
    assert.equal(
      detail.task.actionEligibility.actions["grant-retry"].allowed,
      true,
      JSON.stringify(detail.task.actionEligibility.actions["grant-retry"]),
    );
    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 200, JSON.stringify(await grantResponse.clone().json()));
    const updated = await store.get(task.id);
    assert.equal(updated.stageRunLimits.implement, 4);
    assert.equal(updated.decisions.at(-1).authorizingGateStage, "test");
    assert.equal(updated.decisions.at(-1).authorizingGateWorkflowAttempt, 2);
    assert.equal(updated.decisions.at(-1).authorizingGateRunId, `run-reservation-${task.id}-test-2`);
    assert.deepEqual(
      updated.runs.filter((run) => run.stage === "implement").map((run) => run.id),
      retainedImplementRunIds,
      "the grant retains every original Implement and no-op repair run",
    );
  } finally {
    await cleanup(server, directory);
  }
});

test("grants repair after a candidate is assembled on the final implementation allowance", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Final implementation allowance",
      description: "Retain the candidate-producing reservation when assembly consumes the final allowance.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    let reservation;
    await store.update(task.id, (draft) => {
      draft.status = "repair-required";
      draft.currentStage = "dev-review";
      draft.attemptsByStage.implement = draft.stageRunLimits.implement;
      draft.workPackages = ["S1", "S2"].map((id) => ({
        id,
        status: "integrated",
        batch: 1,
        headRevision: `head-${id.toLowerCase()}`,
      }));
      reservation = {
        id: "reservation-assembly-only-3",
        stage: "implement",
        kind: "implementation",
        workflowAttempt: 3,
        candidateId: null,
        candidateRevision: null,
        candidateHeadRevision: null,
        authorizedRunScopes: [],
        reservedAt: "2026-08-04T00:02:00.000Z",
      };
      draft.stageRunReservations.implement = reservation;
      const candidate = {
        id: "C1",
        revisionNumber: 1,
        headRevision: "candidate-c1-r1",
        status: "repair_required",
        members: ["S1", "S2"].map((packageId, index) => ({
          packageId,
          headRevision: `head-${packageId.toLowerCase()}`,
          order: index + 1,
        })),
        sourceWorkflowAttempt: reservation.workflowAttempt,
        sourceWorkflowReservationId: reservation.id,
        revisions: [
          {
            number: 1,
            headRevision: "candidate-c1-r1",
            reason: "assembly",
            sourceWorkflowAttempt: reservation.workflowAttempt,
            sourceWorkflowReservationId: reservation.id,
            sourceWorkflowReservedAt: reservation.reservedAt,
            createdAt: "2026-08-04T00:03:00.000Z",
          },
        ],
      };
      draft.candidates.push(candidate);
      attachExactCandidateGate(draft, candidate, { reservedAt: "2026-08-04T00:04:00.000Z" });
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 200);
    assert.deepEqual(await grantResponse.json(), { granted: true });

    const updated = await store.get(task.id);
    assert.equal(updated.stageRunLimits.implement, 4);
    assert.equal(updated.decisions.at(-1).candidateId, "C1");
    assert.equal(updated.decisions.at(-1).candidateRevision, 1);
    assert.equal(updated.decisions.at(-1).candidateHeadRevision, "candidate-c1-r1");
    assert.equal(updated.decisions.at(-1).workflowAttempt, 3);
    assert.equal(updated.decisions.at(-1).workflowCandidateId, null);
    assert.equal(updated.decisions.at(-1).workflowCandidateRevision, null);
    assert.equal(updated.decisions.at(-1).workflowCandidateHeadRevision, null);
    assert.equal(updated.decisions.at(-1).workflowReservationId, reservation.id);
    assert.equal(updated.decisions.at(-1).sourceRunId, null);
    assert.deepEqual(updated.decisions.at(-1).sourceRunIds, []);
    assert.equal(
      updated.decisions.at(-1).authorizingGateReservationId,
      `reservation-${task.id}-dev-review-1`,
    );
  } finally {
    await cleanup(server, directory);
  }
});

test("grants repair after a completed structured Test failure on the final implementation allowance", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Repair completed Test failure",
      description: "A valid failed focused Test must authorize repair without another Implement allowance.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.status = "repair-required";
      draft.currentStage = "test";
      const candidate = attachAssemblyLineage(
        draft,
        {
          id: "C1",
          revisionNumber: 1,
          headRevision: "candidate-c1-r1",
          status: "repair_required",
        },
        {
          workflowAttempt: 3,
          reservationId: "reservation-c1-assembly-3",
        },
      );
      draft.candidates.push(candidate);
      const authorizer = attachExactCandidateGate(draft, candidate, {
        stage: "test",
        reservationId: "reservation-c1-test-1",
        reservedAt: "2026-08-04T00:02:00.000Z",
      });
      const testRun = draft.runs.find((run) => run.id === authorizer.sourceRunId);
      const testArtifact = draft.artifacts.find((artifact) => artifact.id === authorizer.sourceArtifactId);
      const row = {
        id: "test-row-failed",
        candidateId: "C1",
        candidateRevision: 1,
        bindingExplicit: true,
        command: "node --test tests/api.test.mjs",
        status: "failed",
        durationMs: 5,
        title: "Focused API contract",
        artifactReferences: [],
        assertions: [{ label: "exit code", expected: "0", actual: "1" }],
        failureDetails: "One focused assertion failed.",
      };
      const focusedTest = {
        candidateId: "C1",
        candidateRevision: 1,
        bindingExplicit: true,
        command: row.command,
        status: "failed",
        startedAt: testRun.startedAt,
        completedAt: testRun.completedAt,
        durationMs: 1_000,
        rowCount: 1,
        failedRowIds: [row.id],
        rows: [row],
      };
      testRun.test = {
        candidateId: "C1",
        candidateRevision: 1,
        command: focusedTest.command,
        status: "failed",
        startedAt: focusedTest.startedAt,
        completedAt: focusedTest.completedAt,
        durationMs: focusedTest.durationMs,
        rowCount: 1,
        failedRowIds: [row.id],
        rows: [row],
      };
      testArtifact.focusedTest = focusedTest;
      refreshGateFreshness(draft);
    });

    const before = await store.get(task.id);
    assert.equal(before.gateFreshness.test.reasonCode, "repair_required");
    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 200, JSON.stringify(await grantResponse.clone().json()));
    const updated = await store.get(task.id);
    assert.equal(updated.stageRunLimits.implement, 4);
    assert.equal(updated.decisions.at(-1).authorizingGateStage, "test");
  } finally {
    await cleanup(server, directory);
  }
});

test("grants one implementation retry after a failed candidate assembly", async () => {
  const { directory, origin, server, store, startedIdRef } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Retry failed assembly",
      description: "A failed candidate must not bind the next implementation reservation.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    let reservation;
    await store.update(task.id, (draft) => {
      draft.status = "blocked";
      draft.currentStage = "implement";
      draft.attemptsByStage.implement = draft.stageRunLimits.implement;
      draft.workPackages = [{ id: "S1", status: "failed" }];
      draft.runs.push(
        ...[1, 2, 3].map((attempt) => ({
          id: `run-failed-assembly-${attempt}`,
          stage: "implement",
          status: "failed",
        })),
      );
      reservation = bindLatestWorkflowAttempt(draft, "implement", "implementation");
      draft.candidates.push({
        id: "C3",
        revisionNumber: 1,
        headRevision: "failed-candidate-c3",
        status: "failed",
        sourceWorkflowAttempt: reservation.workflowAttempt,
        sourceWorkflowReservationId: reservation.id,
        revisions: [],
      });
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 200);
    assert.deepEqual(await grantResponse.json(), { granted: true });
    const granted = await store.get(task.id);
    assert.equal(granted.stageRunLimits.implement, 4);
    assert.equal(granted.decisions.at(-1).candidateId, null);
    assert.equal(granted.decisions.at(-1).candidateRevision, null);
    assert.equal(granted.decisions.at(-1).candidateHeadRevision, null);
    assert.equal(granted.decisions.at(-1).workflowCandidateId, null);
    assert.equal(granted.decisions.at(-1).workflowReservationId, reservation.id);

    const retryResponse = await fetch(`${origin}/api/tasks/${task.id}/implement`, { method: "POST" });
    assert.equal(retryResponse.status, 202);
    assert.deepEqual(await retryResponse.json(), { started: true });
    assert.equal(startedIdRef(), task.id);
  } finally {
    await cleanup(server, directory);
  }
});

test("starts repair when the failed gate is exhausted but implement has capacity", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Exhausted review repair",
      description: "Recover a repair-required candidate after the review allowance is exhausted.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.status = "repair-required";
      draft.currentStage = "dev-review";
      draft.attemptsByStage["dev-review"] = draft.stageRunLimits["dev-review"];
      draft.candidates.push({
        id: "C1",
        revisionNumber: 1,
        headRevision: "candidate-c1-r1",
        status: "repair_required",
      });
    });

    const repairResponse = await fetch(`${origin}/api/tasks/${task.id}/repair`, { method: "POST" });
    assert.equal(repairResponse.status, 202);
    assert.deepEqual(await repairResponse.json(), { started: true });

    const updated = (await (await fetch(`${origin}/api/tasks/${task.id}`)).json()).task;
    assert.equal(updated.stageRunLimits.implement, 3);
    assert.equal(updated.stageRunLimits["dev-review"], 3);
    assert.equal(updated.attemptsByStage["dev-review"], 3);
    assert.equal(updated.attemptsByStage.implement ?? 0, 0);
    assert.equal(updated.decisions.length, 0);
  } finally {
    await cleanup(server, directory);
  }
});

test("grants only implement and admits one repair when its budget is exhausted", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Exhausted implementation repair",
      description: "Grant the canonical mutation stage without changing the failed gate allowance.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.status = "repair-required";
      draft.currentStage = "dev-review";
      draft.attemptsByStage.implement = draft.stageRunLimits.implement;
      draft.attemptsByStage["dev-review"] = 1;
      const candidate = attachAssemblyLineage(draft, {
        id: "C1",
        revisionNumber: 1,
        headRevision: "candidate-c1-r1",
        status: "repair_required",
      });
      draft.candidates.push(candidate);
      attachExactCandidateGate(draft, candidate);
      draft.runs.push(
        ...[1, 2, 3].map((attempt) => ({
          id: `run-exhausted-repair-${attempt}`,
          stage: "implement",
          status: "failed",
        })),
      );
      bindLatestWorkflowAttempt(draft, "implement", "repair");
    });

    const blockedRepair = await fetch(`${origin}/api/tasks/${task.id}/repair`, { method: "POST" });
    assert.equal(blockedRepair.status, 409);
    assert.deepEqual(await blockedRepair.json(), {
      error: "The current stage has exhausted its retry allowance.",
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 200);
    assert.deepEqual(await grantResponse.json(), { granted: true });

    const granted = (await (await fetch(`${origin}/api/tasks/${task.id}`)).json()).task;
    assert.equal(granted.stageRunLimits.implement, 4);
    assert.equal(granted.stageRunLimits["dev-review"], 3);
    assert.equal(granted.decisions.at(-1).grantedStage, "implement");
    assert.equal(granted.events.at(-1).grantedStage, "implement");

    const repairResponse = await fetch(`${origin}/api/tasks/${task.id}/repair`, { method: "POST" });
    assert.equal(repairResponse.status, 202);
    assert.deepEqual(await repairResponse.json(), { started: true });
  } finally {
    await cleanup(server, directory);
  }
});

test("retains a committed slice when granting an exhausted implementation qualification retry", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Retain failed qualification",
      description: "Resume the committed slice instead of rebuilding it from the target.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.status = "blocked";
      draft.currentStage = "implement";
      draft.attemptsByStage.implement = draft.stageRunLimits.implement;
      draft.workPackages = [
        {
          id: "S1",
          title: "Qualified slice",
          description: "Repair only the focused qualification failure.",
          dependencies: [],
          batch: 1,
          ownedPaths: ["server/api.mjs"],
          verificationCommandIds: ["unit"],
          verificationRuns: [
            {
              headRevision: "slice-head-r1",
              status: "failed",
            },
          ],
          status: "failed",
          attempts: 1,
          branch: "agent-harness/retained-s1-a1",
          worktreePath: "/tmp/retained-s1-a1",
          baseRevision: "target-base-r1",
          headRevision: "slice-head-r1",
          files: ["server/api.mjs"],
          error: "S1 did not qualify: unit failed — formatter exited 1.",
          retainedContinuation: null,
          retainedForRequalification: false,
          retainedReplacementReason: null,
        },
      ];
      draft.runs.push(
        ...[1, 2, 3].map((attempt) => ({
          id: `run-failed-qualification-${attempt}`,
          stage: "implement",
          status: "failed",
        })),
      );
      bindLatestWorkflowAttempt(draft, "implement", "implementation");
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 200, JSON.stringify(await grantResponse.clone().json()));
    const updated = await store.get(task.id);
    assert.equal(updated.stageRunLimits.implement, 4);
    assert.deepEqual(updated.workPackages[0].retainedContinuation, {
      requestedAt: updated.workPackages[0].retainedContinuation.requestedAt,
      files: ["server/api.mjs"],
      outsideOwnership: [],
      qualificationFailure: "S1 did not qualify: unit failed — formatter exited 1.",
    });
    assert.match(updated.workPackages[0].retainedContinuation.requestedAt, /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    await cleanup(server, directory);
  }
});

test("grants one bounded stage attempt to a reservation-bound candidate at an exhausted ready gate", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Exhausted ready gate",
      description:
        "Allow a repaired candidate to re-enter review after its prior review allowance was exhausted.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.status = "ready-for-review";
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
          id: `run-ready-review-${attempt}`,
          stage: "dev-review",
          status: "failed",
        })),
      );
      bindLatestWorkflowAttempt(draft, "dev-review", "review");
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 200);
    assert.deepEqual(await grantResponse.json(), { granted: true });

    const updated = (await (await fetch(`${origin}/api/tasks/${task.id}`)).json()).task;
    assert.equal(updated.status, "failed");
    assert.equal(updated.stageRunLimits["dev-review"], 4);
    assert.equal(updated.stageRunLimits.implement, 3);
    assert.equal(updated.candidates.at(-1).status, "ready_for_review");
    assert.equal(updated.events.at(-1).title, "One stage attempt granted");
  } finally {
    await cleanup(server, directory);
  }
});

test("grants a fresh gate attempt after consecutive target refreshes without requiring repair lineage", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Target-refreshed exhausted gate",
      description: "A harness target refresh must not masquerade as candidate Repair.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.status = "ready-for-review";
      draft.currentStage = "dev-review";
      draft.attemptsByStage["dev-review"] = draft.stageRunLimits["dev-review"];
      const oldHead = "candidate-target-refresh-r1";
      const candidate = attachAssemblyLineage(draft, {
        id: "C1",
        revisionNumber: 1,
        baseRevision: "target-base-r1",
        headRevision: oldHead,
        status: "ready_for_review",
      });
      draft.candidates.push(candidate);
      draft.runs.push(
        ...[1, 2, 3].map((attempt) => ({
          id: `run-target-refresh-review-${attempt}`,
          stage: "dev-review",
          status: "failed",
        })),
      );
      bindLatestWorkflowAttempt(draft, "dev-review", "review");
      candidate.revisionNumber = 3;
      candidate.baseRevision = "target-base-r3";
      candidate.headRevision = "candidate-target-refresh-r3";
      candidate.revisions.push(
        {
          number: 2,
          headRevision: "candidate-target-refresh-r2",
          reason: "target-refresh",
          previousBaseRevision: "target-base-r1",
          previousHeadRevision: oldHead,
          baseRevision: "target-base-r2",
          createdAt: "2026-08-04T00:03:00.000Z",
        },
        {
          number: 3,
          headRevision: candidate.headRevision,
          reason: "target-refresh",
          previousBaseRevision: "target-base-r2",
          previousHeadRevision: "candidate-target-refresh-r2",
          baseRevision: candidate.baseRevision,
          createdAt: "2026-08-04T00:04:00.000Z",
        },
      );
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 200);
    const updated = await store.get(task.id);
    assert.equal(updated.stageRunLimits["dev-review"], 4);
    assert.deepEqual(
      updated.candidates[0].revisions.slice(1).map((revision) => revision.reason),
      ["target-refresh", "target-refresh"],
    );
    assert.equal(updated.candidates[0].sourceWorkflowAttempt, 1);
  } finally {
    await cleanup(server, directory);
  }
});

test("grants a fresh gate attempt to a rebuilt candidate after the prior candidate failed", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Rebuilt candidate exhausted gate",
      description: "A newly assembled candidate must not inherit an unusable prior-candidate reservation.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.status = "ready-for-review";
      draft.currentStage = "dev-review";
      draft.attemptsByStage["dev-review"] = draft.stageRunLimits["dev-review"];
      const priorCandidate = attachAssemblyLineage(draft, {
        id: "C1",
        revisionNumber: 1,
        baseRevision: "target-base-r1",
        headRevision: "candidate-c1-r1",
        status: "failed",
      });
      draft.candidates.push(priorCandidate);
      draft.runs.push(
        ...[1, 2, 3].map((attempt) => ({
          id: `run-superseded-review-${attempt}`,
          stage: "dev-review",
          status: "failed",
        })),
      );
      bindLatestWorkflowAttempt(draft, "dev-review", "review");

      const rebuiltCandidate = attachAssemblyLineage(
        draft,
        {
          id: "C2",
          revisionNumber: 1,
          baseRevision: "target-base-r2",
          headRevision: "candidate-c2-r1",
          status: "ready_for_review",
        },
        {
          workflowAttempt: 2,
          reservationId: `reservation-${draft.id}-assembly-2`,
          reservedAt: "2026-08-04T00:02:00.000Z",
          createdAt: "2026-08-04T00:03:00.000Z",
        },
      );
      draft.candidates.push(rebuiltCandidate);
      draft.attemptsByStage.implement = 2;
      const rebuiltProducerRun = draft.runs.find(
        (run) => run.workflowReservationId === rebuiltCandidate.sourceWorkflowReservationId,
      );
      rebuiltProducerRun.attempt = 2;
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    const grantBody = await grantResponse.json();
    assert.equal(grantResponse.status, 200, grantBody.error);
    const updated = await store.get(task.id);
    assert.equal(updated.stageRunLimits["dev-review"], 4);
    assert.equal(updated.candidates[0].status, "failed");
    assert.equal(updated.candidates[1].id, "C2");
    assert.equal(updated.candidates[1].sourceWorkflowAttempt, 2);
  } finally {
    await cleanup(server, directory);
  }
});

test("grants a fresh gate attempt to a repaired descendant of a rebuilt candidate", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Repaired rebuilt candidate exhausted gate",
      description: "A valid repair descendant must retain the rebuilt candidate's retry authority.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.status = "ready-for-test";
      draft.currentStage = "test";
      draft.attemptsByStage.test = draft.stageRunLimits.test;
      const priorCandidate = attachAssemblyLineage(draft, {
        id: "C1",
        revisionNumber: 1,
        baseRevision: "target-base-r1",
        headRevision: "candidate-c1-r1",
        status: "failed",
      });
      draft.candidates.push(priorCandidate);
      draft.runs.push(
        ...[1, 2, 3].map((attempt) => ({
          id: `run-superseded-test-${attempt}`,
          stage: "test",
          status: "failed",
        })),
      );
      const exhaustedReservation = bindLatestWorkflowAttempt(draft, "test", "test");

      const rebuiltCandidate = attachAssemblyLineage(
        draft,
        {
          id: "C2",
          revisionNumber: 1,
          baseRevision: "target-base-r2",
          headRevision: "candidate-c2-r1",
          status: "ready_for_test",
        },
        {
          workflowAttempt: 2,
          reservationId: `reservation-${draft.id}-assembly-2`,
          reservedAt: "2026-08-04T00:03:00.000Z",
          createdAt: "2026-08-04T00:04:00.000Z",
        },
      );
      draft.candidates.push(rebuiltCandidate);
      const rebuiltProducerRun = draft.runs.find(
        (run) => run.workflowReservationId === rebuiltCandidate.sourceWorkflowReservationId,
      );
      rebuiltProducerRun.attempt = 2;
      const repairRevision = {
        number: 2,
        headRevision: "candidate-c2-r2",
        reason: "repair",
        sourceWorkflowAttempt: 3,
        sourceWorkflowReservationId: `reservation-${draft.id}-repair-3`,
        sourceWorkflowReservedAt: "2026-08-04T00:06:00.000Z",
        createdAt: "2026-08-04T00:07:00.000Z",
      };
      rebuiltCandidate.revisionNumber = repairRevision.number;
      rebuiltCandidate.headRevision = repairRevision.headRevision;
      rebuiltCandidate.sourceWorkflowAttempt = repairRevision.sourceWorkflowAttempt;
      rebuiltCandidate.sourceWorkflowReservationId = repairRevision.sourceWorkflowReservationId;
      rebuiltCandidate.revisions.push(repairRevision);
      attachCandidateProducerEvidence(draft, rebuiltCandidate);
      draft.attemptsByStage.implement = 3;
      draft.stageRunReservations.implement = {
        id: repairRevision.sourceWorkflowReservationId,
        stage: "implement",
        kind: "repair",
        workflowAttempt: repairRevision.sourceWorkflowAttempt,
        candidateId: rebuiltCandidate.id,
        candidateRevision: 1,
        candidateHeadRevision: rebuiltCandidate.revisions[0].headRevision,
        authorizedRunScopes: [],
        reservedAt: repairRevision.sourceWorkflowReservedAt,
        authorizingGateStage: repairRevision.authorizingGateStage,
        authorizingGateWorkflowAttempt: repairRevision.authorizingGateWorkflowAttempt,
        authorizingGateReservationId: repairRevision.authorizingGateReservationId,
        authorizingGateReservedAt: repairRevision.authorizingGateReservedAt,
        authorizingGateRunId: repairRevision.authorizingGateRunId,
        authorizingGateArtifactId: repairRevision.authorizingGateArtifactId,
      };
      draft.attemptsByStage.test = draft.stageRunLimits.test;
      draft.stageRunReservations.test = exhaustedReservation;
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    const grantBody = await grantResponse.json();
    assert.equal(grantResponse.status, 200, grantBody.error);
    const updated = await store.get(task.id);
    assert.equal(updated.stageRunLimits.test, 4);
    assert.equal(updated.candidates[0].status, "failed");
    assert.equal(updated.candidates[1].id, "C2");
    assert.equal(updated.candidates[1].revisionNumber, 2);
    assert.equal(updated.candidates[1].sourceWorkflowAttempt, 3);
  } finally {
    await cleanup(server, directory);
  }
});

test("grants an exhausted repair after a mechanical target refresh", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Repair after target refresh",
      description: "Mechanical lineage must retain the prior implementation producer.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.status = "repair-required";
      draft.currentStage = "dev-review";
      const candidate = attachAssemblyLineage(draft, {
        id: "C1",
        revisionNumber: 1,
        baseRevision: "target-base-r1",
        headRevision: "candidate-c1-r1",
        status: "repair_required",
      });
      draft.candidates.push(candidate);
      const priorGate = attachExactCandidateGate(draft, candidate, {
        stage: "dev-review",
        workflowAttempt: 1,
        reservedAt: "2026-08-04T00:01:30.000Z",
      });
      const repairRevision = {
        number: 2,
        headRevision: "candidate-c1-r2",
        reason: "repair",
        sourceWorkflowAttempt: 2,
        sourceWorkflowReservationId: `reservation-${draft.id}-repair-2`,
        sourceWorkflowReservedAt: "2026-08-04T00:02:00.000Z",
        authorizingGateStage: priorGate.stage,
        authorizingGateWorkflowAttempt: priorGate.workflowAttempt,
        authorizingGateReservationId: priorGate.id,
        authorizingGateReservedAt: priorGate.reservedAt,
        authorizingGateRunId: priorGate.sourceRunId,
        authorizingGateArtifactId: priorGate.sourceArtifactId,
        createdAt: "2026-08-04T00:03:00.000Z",
      };
      candidate.revisionNumber = 2;
      candidate.headRevision = repairRevision.headRevision;
      candidate.sourceWorkflowAttempt = repairRevision.sourceWorkflowAttempt;
      candidate.sourceWorkflowReservationId = repairRevision.sourceWorkflowReservationId;
      candidate.revisions.push(repairRevision);
      attachCandidateProducerEvidence(draft, candidate);
      draft.attemptsByStage.implement = 2;
      draft.stageRunLimits.implement = 2;
      draft.stageRunReservations.implement = {
        id: repairRevision.sourceWorkflowReservationId,
        stage: "implement",
        kind: "repair",
        workflowAttempt: 2,
        candidateId: candidate.id,
        candidateRevision: 1,
        candidateHeadRevision: candidate.revisions[0].headRevision,
        authorizedRunScopes: [],
        reservedAt: repairRevision.sourceWorkflowReservedAt,
        authorizingGateStage: repairRevision.authorizingGateStage,
        authorizingGateWorkflowAttempt: repairRevision.authorizingGateWorkflowAttempt,
        authorizingGateReservationId: repairRevision.authorizingGateReservationId,
        authorizingGateReservedAt: repairRevision.authorizingGateReservedAt,
        authorizingGateRunId: repairRevision.authorizingGateRunId,
        authorizingGateArtifactId: repairRevision.authorizingGateArtifactId,
      };
      candidate.revisionNumber = 3;
      candidate.baseRevision = "target-base-r3";
      candidate.headRevision = "candidate-target-refresh-r3";
      candidate.revisions.push({
        number: 3,
        headRevision: candidate.headRevision,
        reason: "target-refresh",
        previousBaseRevision: "target-base-r2",
        previousHeadRevision: repairRevision.headRevision,
        baseRevision: candidate.baseRevision,
        createdAt: "2026-08-04T00:04:00.000Z",
      });
      const refreshedGate = attachExactCandidateGate(draft, candidate, {
        stage: "dev-review",
        workflowAttempt: 2,
        reservationId: `reservation-${draft.id}-dev-review-refresh-2`,
        reservedAt: "2026-08-04T00:05:00.000Z",
      });
      draft.runs.find((run) => run.id === refreshedGate.sourceRunId).attempt = 1;
      refreshGateFreshness(draft);
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 200, JSON.stringify(await grantResponse.clone().json()));
    const updated = await store.get(task.id);
    assert.equal(updated.stageRunLimits.implement, 3);
    assert.equal(updated.decisions.at(-1).candidateRevision, 3);
  } finally {
    await cleanup(server, directory);
  }
});

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

test("rejects exact-current gate grants when the retained candidate history or producer is impossible", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    for (const item of [
      {
        name: "invalid intermediate revision reason",
        mutate(candidate) {
          candidate.revisions[1].reason = "assembly";
        },
      },
      {
        name: "current review predates candidate revision",
        mutate(_candidate, draft) {
          draft.stageRunReservations["dev-review"].reservedAt = "2026-08-04T00:01:45.000Z";
        },
      },
      {
        name: "missing current producer reservation",
        mutate(_candidate, draft) {
          delete draft.stageRunReservations.implement;
        },
      },
      {
        name: "top-level producer mismatch",
        mutate(candidate) {
          candidate.sourceWorkflowReservationId = "different-current-producer";
        },
      },
      {
        name: "producer attempt differs from Implement counter",
        mutate(_candidate, draft) {
          draft.attemptsByStage.implement = 2;
        },
      },
      {
        name: "gate reservation reuses producer identity",
        mutate(candidate, draft) {
          draft.stageRunReservations["dev-review"].id = candidate.sourceWorkflowReservationId;
        },
      },
    ]) {
      const response = await createTask(origin, {
        title: `Reject exact-current ${item.name}`,
        description:
          "An exact current binding cannot bypass complete candidate history and producer validation.",
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
        attachCandidateProducerEvidence(draft, candidate);
        draft.stageRunReservations.implement = {
          id: "reservation-c1-r2-repair-3",
          stage: "implement",
          kind: "repair",
          workflowAttempt: 3,
          candidateId: "C1",
          candidateRevision: 2,
          candidateHeadRevision: "candidate-c1-r2",
          authorizedRunScopes: [],
          reservedAt: "2026-08-04T00:01:30.000Z",
        };
        draft.stageRunReservations["dev-review"] = {
          id: "reservation-c1-r3-review-3",
          stage: "dev-review",
          kind: "review",
          workflowAttempt: 3,
          candidateId: "C1",
          candidateRevision: 3,
          candidateHeadRevision: "candidate-c1-r3",
          authorizedRunScopes: [],
          reservedAt: "2026-08-04T00:03:00.000Z",
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
      const unchanged = await store.get(task.id);
      assert.equal(unchanged.stageRunLimits["dev-review"], 3, item.name);
      assert.equal(unchanged.decisions.length, 0, item.name);
    }
  } finally {
    await cleanup(server, directory);
  }
});

test("grants an exact-current repaired candidate only with distinct gate and current producer reservations", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Exact current repaired candidate",
      description:
        "Authorize a gate retry only when the current repair producer matches the Implement counter.",
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
      draft.candidates.push(candidate);
      attachCandidateProducerEvidence(draft, candidate);
      draft.stageRunReservations.implement = {
        id: "reservation-c1-r2-repair-3",
        stage: "implement",
        kind: "repair",
        workflowAttempt: 3,
        candidateId: "C1",
        candidateRevision: 2,
        candidateHeadRevision: "candidate-c1-r2",
        authorizedRunScopes: [],
        reservedAt: "2026-08-04T00:01:30.000Z",
      };
      draft.stageRunReservations["dev-review"] = {
        id: "reservation-c1-r3-review-3",
        stage: "dev-review",
        kind: "review",
        workflowAttempt: 3,
        candidateId: "C1",
        candidateRevision: 3,
        candidateHeadRevision: "candidate-c1-r3",
        authorizedRunScopes: [],
        reservedAt: "2026-08-04T00:03:00.000Z",
      };
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 200, JSON.stringify(await grantResponse.clone().json()));
    assert.deepEqual(await grantResponse.json(), { granted: true });
    const updated = await store.get(task.id);
    assert.equal(updated.stageRunLimits["dev-review"], 4);
    assert.equal(updated.decisions.at(-1).workflowReservationId, "reservation-c1-r3-review-3");
    assert.equal(updated.decisions.at(-1).candidateAuthorizerReservationIds.length, 2);
    assert.equal(updated.decisions.at(-1).candidateAuthorizerRunIds.length, 2);
    assert.equal(updated.decisions.at(-1).candidateAuthorizerArtifactIds.length, 2);
  } finally {
    await cleanup(server, directory);
  }
});

test("accepts the canonical initial producer ordinal after an earlier same-scope implementation failure", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Retried initial producer ordinal",
      description: "An implementation retry must retain the scope-local producer attempt ordinal.",
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
        revisionNumber: 1,
        headRevision: "candidate-c1-r1",
        status: "ready_for_review",
        sourceWorkflowAttempt: 2,
        sourceWorkflowReservationId: "reservation-c1-assembly-2",
        revisions: [
          {
            number: 1,
            headRevision: "candidate-c1-r1",
            reason: "assembly",
            sourceWorkflowAttempt: 2,
            sourceWorkflowReservationId: "reservation-c1-assembly-2",
            sourceWorkflowReservedAt: "2026-08-04T00:00:30.000Z",
            createdAt: "2026-08-04T00:01:00.000Z",
          },
        ],
      };
      draft.candidates.push(candidate);
      attachCandidateProducerEvidence(draft, candidate);
      const producerIndex = draft.runs.findIndex(
        (run) => run.workflowReservationId === candidate.sourceWorkflowReservationId,
      );
      draft.runs[producerIndex].attempt = 2;
      draft.runs.splice(producerIndex, 0, {
        id: "run-earlier-s1-failure",
        stage: "implement",
        kind: "implementation",
        role: "implement",
        status: "failed",
        workPackageId: "S1",
        candidateId: null,
        candidateRevision: null,
        candidateHeadRevision: null,
        attempt: 1,
        workflowAttempt: 1,
        workflowReservationId: "reservation-earlier-s1-failure",
      });
      draft.stageRunReservations.implement = {
        id: candidate.sourceWorkflowReservationId,
        stage: "implement",
        kind: "implementation",
        workflowAttempt: 2,
        candidateId: null,
        candidateRevision: null,
        candidateHeadRevision: null,
        authorizedRunScopes: ["S1"],
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
        reservedAt: "2026-08-04T00:02:00.000Z",
      };
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 200, JSON.stringify(await grantResponse.clone().json()));
    const updated = await store.get(task.id);
    assert.equal(updated.stageRunLimits["dev-review"], 4);
    assert.equal(updated.decisions.at(-1).candidateProducerRunIds.length, 1);
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects forged producer attempt ordinals and incomplete durable producer envelopes", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    for (const mutation of [
      "forged initial attempt",
      "missing repair run timestamps",
      "missing repair artifact timestamp",
      "repair artifact after revision",
    ]) {
      const response = await createTask(origin, {
        title: `Reject ${mutation}`,
        description: "Candidate producer evidence must be canonical, durable, and causally ordered.",
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
        const initialRun = draft.runs.find(
          (run) => run.workflowReservationId === candidate.revisions[0].sourceWorkflowReservationId,
        );
        const repairRun = draft.runs.find(
          (run) => run.workflowReservationId === candidate.sourceWorkflowReservationId,
        );
        const repairArtifact = draft.artifacts.find((artifact) => artifact.id === repairRun.artifactId);
        if (mutation === "forged initial attempt") initialRun.attempt = 999;
        if (mutation === "missing repair run timestamps") {
          delete repairRun.startedAt;
          delete repairRun.completedAt;
        }
        if (mutation === "missing repair artifact timestamp") delete repairArtifact.createdAt;
        if (mutation === "repair artifact after revision")
          repairArtifact.createdAt = "2026-08-04T00:01:01.000Z";
      });

      const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
      assert.equal(grantResponse.status, 409, mutation);
      assert.match(
        (await grantResponse.json()).error,
        /producer evidence|inconsistent workflow reservation/i,
        mutation,
      );
      const unchanged = await store.get(task.id);
      assert.equal(unchanged.stageRunLimits["dev-review"], 3, mutation);
      assert.equal(unchanged.decisions.length, 0, mutation);
    }
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects an exact-current gate when its initial candidate producer names a nonexistent package", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Reject fabricated candidate producer scope",
      description:
        "A current candidate gate must prove its initial producer used real planned package scopes.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.status = "ready-for-review";
      draft.currentStage = "dev-review";
      draft.attemptsByStage["dev-review"] = draft.stageRunLimits["dev-review"];
      const candidate = attachAssemblyLineage(draft, {
        id: "C1",
        revisionNumber: 1,
        headRevision: "candidate-c1-r1",
        status: "ready_for_review",
      });
      draft.candidates.push(candidate);
      draft.stageRunReservations.implement.authorizedRunScopes = ["S9"];
      const producerRun = draft.runs.find(
        (run) => run.workflowReservationId === candidate.sourceWorkflowReservationId,
      );
      producerRun.workPackageId = "S9";
      attachExactCandidateGate(draft, candidate);
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 409);
    assert.match((await grantResponse.json()).error, /inconsistent workflow reservation/i);
    const unchanged = await store.get(task.id);
    assert.equal(unchanged.stageRunLimits["dev-review"], 3);
    assert.equal(unchanged.decisions.length, 0);
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects failed repair reservations that reuse or fail to advance the current producer identity", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    for (const item of [
      {
        name: "reused producer reservation",
        reservationId: "reservation-c1-r2-repair-3",
        workflowAttempt: 3,
        repairReservedAt: "2026-08-04T00:03:00.000Z",
      },
      {
        name: "fresh ID with non-increasing attempt",
        reservationId: "reservation-failed-repair-3",
        workflowAttempt: 3,
        repairReservedAt: "2026-08-04T00:03:00.000Z",
      },
      {
        name: "repair predates and reuses retained gate reservation",
        reservationId: "reservation-c1-r3-review-1",
        workflowAttempt: 4,
        repairReservedAt: "2026-08-04T00:02:30.000Z",
        gateReservationId: "reservation-c1-r3-review-1",
        gateReservedAt: "2026-08-04T00:03:00.000Z",
      },
      {
        name: "retained gate attempt differs from its stage counter",
        reservationId: "reservation-failed-repair-4",
        workflowAttempt: 4,
        repairReservedAt: "2026-08-04T00:04:00.000Z",
        gateReservationId: "reservation-c1-r3-review-999",
        gateReservedAt: "2026-08-04T00:03:00.000Z",
        gateWorkflowAttempt: 999,
        gateStageCounter: 1,
      },
      {
        name: "retained gate has no authoritative source run",
        reservationId: "reservation-failed-repair-4",
        workflowAttempt: 4,
        repairReservedAt: "2026-08-04T00:04:00.000Z",
        gateReservationId: "reservation-c1-r3-review-1",
        gateReservedAt: "2026-08-04T00:03:00.000Z",
        removeGateRun: true,
      },
    ]) {
      const response = await createTask(origin, {
        title: `Reject ${item.name}`,
        description: "A failed repair attempt must be newer than and distinct from every candidate producer.",
        repositoryPath: directory,
        workflow: "implement",
      });
      const { task } = await response.json();
      await store.update(task.id, (draft) => {
        draft.status = "repair-required";
        draft.currentStage = "dev-review";
        draft.stageRunLimits.implement = item.workflowAttempt;
        draft.attemptsByStage.implement = item.workflowAttempt;
        const candidate = threeRevisionCandidate("repair_required");
        draft.candidates.push(candidate);
        attachCandidateProducerEvidence(draft, candidate);
        attachExactCandidateGate(draft, candidate, {
          reservationId: item.gateReservationId ?? "reservation-c1-r3-review-1",
          reservedAt: item.gateReservedAt ?? "2026-08-04T00:02:30.000Z",
          workflowAttempt: item.gateWorkflowAttempt,
        });
        if (item.gateStageCounter != null) draft.attemptsByStage["dev-review"] = item.gateStageCounter;
        if (item.removeGateRun) {
          draft.runs = draft.runs.filter((run) => run.workflowReservationId !== item.gateReservationId);
        }
        draft.stageRunReservations.implement = {
          id: item.reservationId,
          stage: "implement",
          kind: "repair",
          workflowAttempt: item.workflowAttempt,
          candidateId: "C1",
          candidateRevision: 3,
          candidateHeadRevision: "candidate-c1-r3",
          authorizedRunScopes: [],
          reservedAt: item.repairReservedAt,
        };
      });

      const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
      assert.equal(grantResponse.status, 409, item.name);
      assert.match(
        (await grantResponse.json()).error,
        /duplicate or inconsistent persisted identities|inconsistent workflow reservation/i,
        item.name,
      );
      const unchanged = await store.get(task.id);
      assert.equal(unchanged.stageRunLimits.implement, item.workflowAttempt, item.name);
      assert.equal(unchanged.decisions.length, 0, item.name);
    }
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects duplicate source runs for a singleton workflow reservation", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Duplicate singleton provenance",
      description: "A Plan retry must identify one exact source run at most.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.status = "blocked";
      draft.currentStage = "plan";
      draft.attemptsByStage.plan = draft.stageRunLimits.plan;
      draft.stageRunReservations.plan = {
        id: "reservation-plan-3",
        stage: "plan",
        kind: "planning",
        workflowAttempt: 3,
        candidateId: null,
        candidateRevision: null,
        candidateHeadRevision: null,
        reservedAt: "2026-08-04T00:00:00.000Z",
      };
      draft.runs.push(
        ...[1, 2].map((attempt) => ({
          id: `run-plan-duplicate-${attempt}`,
          stage: "plan",
          kind: "agent",
          role: "plan",
          status: "failed",
          candidateId: null,
          candidateRevision: null,
          candidateHeadRevision: null,
          workPackageId: null,
          attempt,
          workflowAttempt: 3,
          workflowReservationId: "reservation-plan-3",
        })),
      );
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 409);
    assert.match((await grantResponse.json()).error, /multiple source runs for a singleton stage/i);
    const unchanged = await store.get(task.id);
    assert.equal(unchanged.stageRunLimits.plan, 3);
    assert.equal(unchanged.decisions.length, 0);
  } finally {
    await cleanup(server, directory);
  }
});

test("persists every source run for a multi-package implementation reservation", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Multi-package implementation provenance",
      description: "An implementation retry retains every authorized slice run.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.status = "blocked";
      draft.currentStage = "implement";
      draft.attemptsByStage.implement = draft.stageRunLimits.implement;
      draft.workPackages = ["S1", "S2"].map((id) => ({ id, status: "failed" }));
      draft.stageRunReservations.implement = {
        id: "reservation-implement-3",
        stage: "implement",
        kind: "implementation",
        workflowAttempt: 3,
        candidateId: null,
        candidateRevision: null,
        candidateHeadRevision: null,
        authorizedRunScopes: ["S1", "S2"],
        reservedAt: "2026-08-04T00:00:00.000Z",
      };
      draft.runs.push(
        ...["S2", "S1"].map((workPackageId) => ({
          id: `run-implement-${workPackageId}`,
          stage: "implement",
          kind: "implementation",
          role: "implement",
          status: "failed",
          candidateId: null,
          candidateRevision: null,
          candidateHeadRevision: null,
          workPackageId,
          attempt: 1,
          workflowAttempt: 3,
          workflowReservationId: "reservation-implement-3",
        })),
      );
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 200);
    const updated = await store.get(task.id);
    assert.equal(updated.stageRunLimits.implement, 4);
    assert.equal(updated.decisions.at(-1).sourceRunId, "run-implement-S2");
    assert.deepEqual(updated.decisions.at(-1).sourceRunIds, ["run-implement-S1", "run-implement-S2"]);
    assert.equal(updated.events.at(-1).sourceRunId, "run-implement-S2");
    assert.deepEqual(updated.events.at(-1).sourceRunIds, ["run-implement-S1", "run-implement-S2"]);
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects duplicate or unauthorized scopes inside a multi-run reservation", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    for (const item of [
      {
        name: "unauthorized implementation package",
        stage: "implement",
        kind: "implementation",
        authorizedRunScopes: ["S1"],
        workPackageIds: ["S1"],
        scoutDispatch: null,
        runs: [
          {
            id: "run-implement-S9-1",
            kind: "implementation",
            role: "implement",
            workPackageId: "S9",
            attempt: 1,
          },
        ],
        error: /duplicate or unauthorized run scopes/i,
      },
      {
        name: "duplicate implementation package",
        stage: "implement",
        kind: "implementation",
        authorizedRunScopes: ["S1", "S2"],
        workPackageIds: ["S1", "S2"],
        scoutDispatch: null,
        runs: [1, 2].map((attempt) => ({
          id: `run-implement-S1-${attempt}`,
          kind: "implementation",
          role: "implement",
          workPackageId: "S1",
          attempt,
        })),
        error: /duplicate or unauthorized run scopes/i,
      },
      {
        name: "implementation scope absent from plan",
        stage: "implement",
        kind: "implementation",
        authorizedRunScopes: ["S9"],
        workPackageIds: ["S1"],
        scoutDispatch: null,
        runs: [
          {
            id: "run-implement-S9-planned",
            kind: "implementation",
            role: "implement",
            workPackageId: "S9",
            attempt: 1,
          },
        ],
        error: /does not match the persisted work-package plan/i,
      },
      {
        name: "unresolved planned package absent from scope snapshot",
        stage: "implement",
        kind: "implementation",
        authorizedRunScopes: ["S1"],
        workPackageIds: ["S1", "S2"],
        scoutDispatch: null,
        runs: [
          {
            id: "run-implement-S1-incomplete-snapshot",
            kind: "implementation",
            role: "implement",
            workPackageId: "S1",
            attempt: 1,
          },
        ],
        error: /does not match the persisted work-package plan/i,
      },
      {
        name: "duplicate selected scout",
        stage: "scouts",
        kind: "investigation",
        authorizedRunScopes: ["scout-code-path"],
        workPackageIds: [],
        scoutDispatch: {
          selected: [
            { name: "scout-code-path", focus: "Trace the API.", reason: "Needed.", status: "complete" },
          ],
          skipped: [],
          rationale: "One scout selected.",
          createdAt: "2026-08-04T00:00:00.000Z",
          completedAt: "2026-08-04T00:01:00.000Z",
        },
        runs: [1, 2].map((attempt) => ({
          id: `run-scout-code-path-${attempt}`,
          kind: "scout",
          role: "scout-code-path",
          workPackageId: null,
          attempt,
        })),
        error: /duplicate or unauthorized run scopes/i,
      },
      {
        name: "fabricated selected scout",
        stage: "scouts",
        kind: "investigation",
        authorizedRunScopes: ["scout-fabricated"],
        workPackageIds: [],
        scoutDispatch: {
          selected: [
            { name: "scout-fabricated", focus: "Invent evidence.", reason: "Invalid.", status: "complete" },
          ],
          skipped: [],
          rationale: "A fabricated scout must not become authority.",
          createdAt: "2026-08-04T00:00:00.000Z",
          completedAt: "2026-08-04T00:01:00.000Z",
        },
        runs: [
          {
            id: "run-scout-fabricated-1",
            kind: "scout",
            role: "scout-fabricated",
            workPackageId: null,
            attempt: 1,
          },
        ],
        error: /does not match its persisted dispatch/i,
      },
    ]) {
      const response = await createTask(origin, {
        title: `Reject ${item.name}`,
        description: "Each authorized multi-run scope may produce at most one run per reservation.",
        repositoryPath: directory,
        workflow: "implement",
      });
      const { task } = await response.json();
      await store.update(task.id, (draft) => {
        draft.status = "blocked";
        draft.currentStage = item.stage;
        draft.attemptsByStage[item.stage] = draft.stageRunLimits[item.stage];
        draft.scoutDispatch = item.scoutDispatch;
        draft.workPackages = item.workPackageIds.map((id) => ({ id, status: "failed" }));
        const reservationId = `reservation-${item.stage}-3`;
        draft.stageRunReservations[item.stage] = {
          id: reservationId,
          stage: item.stage,
          kind: item.kind,
          workflowAttempt: 3,
          candidateId: null,
          candidateRevision: null,
          candidateHeadRevision: null,
          authorizedRunScopes: item.authorizedRunScopes,
          reservedAt: "2026-08-04T00:00:00.000Z",
        };
        draft.runs.push(
          ...item.runs.map((run) => ({
            ...run,
            stage: item.stage,
            status: "failed",
            candidateId: null,
            candidateRevision: null,
            candidateHeadRevision: null,
            workflowAttempt: 3,
            workflowReservationId: reservationId,
          })),
        );
      });

      const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
      assert.equal(grantResponse.status, 409, item.name);
      assert.match((await grantResponse.json()).error, item.error, item.name);
      assert.equal((await store.get(task.id)).stageRunLimits[item.stage], 3, item.name);
    }
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects empty multi-run scope snapshots with exact, legacy, or absent run provenance", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    for (const item of [
      {
        name: "one exact Implementation run",
        stage: "implement",
        kind: "implementation",
        scoutDispatch: null,
        runs: [
          {
            id: "run-implement-S1-exact",
            kind: "implementation",
            role: "implement",
            workPackageId: "S1",
            attempt: 1,
            exact: true,
          },
        ],
        error: /missing an authorized work-package scope/i,
      },
      {
        name: "two legacy Implementation runs",
        stage: "implement",
        kind: "implementation",
        scoutDispatch: null,
        runs: ["S1", "S2"].map((workPackageId) => ({
          id: `run-implement-${workPackageId}-legacy`,
          kind: "implementation",
          role: "implement",
          workPackageId,
          attempt: 1,
          exact: false,
        })),
        error: /missing an authorized work-package scope/i,
      },
      {
        name: "selected Scout with no run",
        stage: "scouts",
        kind: "investigation",
        scoutDispatch: {
          selected: [
            { name: "scout-code-path", focus: "Trace the API.", reason: "Needed.", status: "complete" },
          ],
          skipped: [],
          rationale: "One scout selected.",
          createdAt: "2026-08-04T00:00:00.000Z",
          completedAt: "2026-08-04T00:01:00.000Z",
        },
        runs: [],
        error: /does not match its persisted dispatch/i,
      },
    ]) {
      const response = await createTask(origin, {
        title: `Reject ${item.name}`,
        description:
          "A multi-run reservation must snapshot its authorized scopes independently of emitted runs.",
        repositoryPath: directory,
        workflow: "implement",
      });
      const { task } = await response.json();
      await store.update(task.id, (draft) => {
        draft.status = "blocked";
        draft.currentStage = item.stage;
        draft.attemptsByStage[item.stage] = draft.stageRunLimits[item.stage];
        draft.scoutDispatch = item.scoutDispatch;
        const reservationId = `reservation-${item.stage}-empty-scopes-3`;
        draft.stageRunReservations[item.stage] = {
          id: reservationId,
          stage: item.stage,
          kind: item.kind,
          workflowAttempt: 3,
          candidateId: null,
          candidateRevision: null,
          candidateHeadRevision: null,
          authorizedRunScopes: [],
          reservedAt: "2026-08-04T00:00:00.000Z",
        };
        draft.runs.push(
          ...item.runs.map(({ exact, ...run }) => ({
            ...run,
            stage: item.stage,
            status: "failed",
            candidateId: null,
            candidateRevision: null,
            candidateHeadRevision: null,
            ...(exact ? { workflowAttempt: 3, workflowReservationId: reservationId } : {}),
          })),
        );
      });

      const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
      assert.equal(grantResponse.status, 409, item.name);
      assert.match((await grantResponse.json()).error, item.error, item.name);
      assert.equal((await store.get(task.id)).stageRunLimits[item.stage], 3, item.name);
    }
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects retry reservations without a valid persisted reservation timestamp", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    for (const [name, reservedAt] of [
      ["missing", undefined],
      ["invalid", "not-a-timestamp"],
      ["noncanonical", "2026-08-04"],
    ]) {
      const response = await createTask(origin, {
        title: `${name} reservation timestamp`,
        description: "Retry authority requires a durable reservation timestamp.",
        repositoryPath: directory,
        workflow: "implement",
      });
      const { task } = await response.json();
      await store.update(task.id, (draft) => {
        draft.status = "blocked";
        draft.currentStage = "plan";
        draft.attemptsByStage.plan = draft.stageRunLimits.plan;
        draft.stageRunReservations.plan = {
          id: `reservation-plan-${name}-3`,
          stage: "plan",
          kind: "planning",
          workflowAttempt: 3,
          candidateId: null,
          candidateRevision: null,
          candidateHeadRevision: null,
          ...(reservedAt === undefined ? {} : { reservedAt }),
        };
      });

      const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
      assert.equal(grantResponse.status, 409, name);
      assert.match((await grantResponse.json()).error, /inconsistent workflow reservation/i, name);
      assert.equal((await store.get(task.id)).stageRunLimits.plan, 3, name);
    }
  } finally {
    await cleanup(server, directory);
  }
});

test("grants exactly one retry to each exhausted blocked canonical stage", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const cases = [
      { stage: "triage", candidateStatus: null, status: "blocked" },
      { stage: "plan", candidateStatus: null, status: "blocked" },
      { stage: "plan", candidateStatus: null, status: "awaiting-plan-approval" },
      { stage: "dev-review", candidateStatus: "ready_for_review", status: "blocked" },
      { stage: "test", candidateStatus: "ready_for_test", status: "blocked" },
      { stage: "final-review", candidateStatus: "ready_for_final_review", status: "blocked" },
    ];
    for (const { stage, candidateStatus, status } of cases) {
      const response = await createTask(origin, {
        title: `${status} ${stage}`,
        description: `Grant only the exhausted ${stage} stage.`,
        repositoryPath: directory,
        workflow: "implement",
      });
      const { task } = await response.json();
      const sourceRunId = `run-${stage}-3`;
      await store.update(task.id, (draft) => {
        draft.status = status;
        draft.currentStage = stage;
        draft.attemptsByStage[stage] = draft.stageRunLimits[stage];
        draft.runs.push(
          ...[1, 2, 3].map((attempt) => ({
            id: `run-${stage}-${attempt}`,
            stage,
            status: "failed",
          })),
        );
        if (candidateStatus) {
          const candidate = attachAssemblyLineage(draft, {
            id: "C1",
            revisionNumber: 1,
            headRevision: "candidate-c1-r1",
            status: candidateStatus,
          });
          draft.candidates.push(candidate);
        }
        bindLatestWorkflowAttempt(
          draft,
          stage,
          {
            triage: "investigation",
            plan: "planning",
            "dev-review": "review",
            test: "test",
            "final-review": "final-review",
          }[stage],
        );
        if (status === "awaiting-plan-approval") draft.runs.at(-1).status = "completed";
      });
      const before = await store.get(task.id);

      const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
      assert.equal(grantResponse.status, 200, stage);
      assert.deepEqual(await grantResponse.json(), { granted: true });

      const updated = await store.get(task.id);
      assert.equal(updated.status, "failed", stage);
      assert.deepEqual(updated.attemptsByStage, before.attemptsByStage, `${stage} attempts remain unchanged`);
      for (const canonicalStage of CANONICAL_RUN_STAGES) {
        assert.equal(
          updated.stageRunLimits[canonicalStage],
          before.stageRunLimits[canonicalStage] + (canonicalStage === stage ? 1 : 0),
          `${stage} grant must not change ${canonicalStage}`,
        );
      }
      assert.deepEqual(
        {
          grantedStage: updated.decisions.at(-1).grantedStage,
          previousLimit: updated.decisions.at(-1).previousLimit,
          newLimit: updated.decisions.at(-1).newLimit,
          sourceRunId: updated.decisions.at(-1).sourceRunId,
        },
        { grantedStage: stage, previousLimit: 3, newLimit: 4, sourceRunId },
      );
      assert.deepEqual(
        {
          grantedStage: updated.events.at(-1).grantedStage,
          previousLimit: updated.events.at(-1).previousLimit,
          newLimit: updated.events.at(-1).newLimit,
          sourceRunId: updated.events.at(-1).sourceRunId,
          retryOfRunId: updated.events.at(-1).retryOfRunId,
        },
        { grantedStage: stage, previousLimit: 3, newLimit: 4, sourceRunId, retryOfRunId: sourceRunId },
      );

      const repeatedResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
      assert.equal(repeatedResponse.status, 409, `${stage} cannot receive a second grant before retrying`);
      const repeated = await store.get(task.id);
      assert.deepEqual(repeated.stageRunLimits, updated.stageRunLimits);
      assert.equal(repeated.decisions.length, updated.decisions.length);
    }
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects a retry grant when the reviewed exhaustion tuple changes before reservation", async () => {
  let taskId = null;
  const { directory, origin, server, store } = await createServer({
    async beforeTransition(targetStore, id) {
      if (id !== taskId) return;
      await targetStore.update(id, (draft) => {
        draft.attemptsByStage.plan += 1;
        draft.stageRunLimits.plan += 1;
        draft.runs.push({ id: "run-plan-4", stage: "plan", status: "failed" });
      });
    },
  });
  try {
    const response = await createTask(origin, {
      title: "Racing retry grant",
      description: "Reject a grant when the exact exhaustion snapshot changes before reservation.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    taskId = task.id;
    await store.update(task.id, (draft) => {
      draft.status = "blocked";
      draft.currentStage = "plan";
      draft.attemptsByStage.plan = draft.stageRunLimits.plan;
      draft.runs.push(
        ...[1, 2, 3].map((attempt) => ({
          id: `run-plan-${attempt}`,
          stage: "plan",
          status: "failed",
        })),
      );
      bindLatestWorkflowAttempt(draft, "plan", "planning");
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 409);
    assert.match((await grantResponse.json()).error, /state changed/i);
    const updated = await store.get(task.id);
    assert.equal(updated.attemptsByStage.plan, 4);
    assert.equal(updated.stageRunLimits.plan, 4);
    assert.equal(updated.decisions.length, 0);
  } finally {
    await cleanup(server, directory);
  }
});

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
