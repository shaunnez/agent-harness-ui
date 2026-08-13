import test from "node:test";
import {
  assert,
  attachAssemblyLineage,
  attachExactCandidateGate,
  attachLinkedArtifact,
  bindLatestWorkflowAttempt,
  cleanup,
  createServer,
  createTask,
  fetch,
  refreshGateFreshness,
} from "./api-test-support.mjs";

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
