import test from "node:test";
import {
  assert,
  createTask,
  React,
  renderToStaticMarkup,
  runtimeTaskToRecentTask,
  withWorkspace,
} from "./runtime-test-support.mjs";

test("resolves the current-stage retry allowance with zero and legacy fallbacks", () => {
  return withWorkspace(async ({ getCurrentStageRunLimit }) => {
    assert.equal(
      getCurrentStageRunLimit(
        createTask({
          currentStage: "implement",
          stageRunLimit: 3,
          stageRunLimits: { implement: 0, plan: 9 },
        }),
      ),
      0,
    );
    assert.equal(
      getCurrentStageRunLimit(
        createTask({
          currentStage: "implement",
          stageRunLimit: 3,
          stageRunLimits: { implement: null },
        }),
      ),
      3,
    );
    assert.equal(
      getCurrentStageRunLimit(
        createTask({
          currentStage: "implement",
          stageRunLimit: 3,
          stageRunLimits: {},
        }),
      ),
      3,
    );
  });
});

test("renders and dispatches the bounded specification retry action", () => {
  return withWorkspace(async ({ RuntimeCommandBar, RuntimeWorkflowActionButton, nextAction }) => {
    const baseProps = {
      onRun: async () => {},
      onAction: async () => {},
      onFinishGrill: async () => {},
    };
    const failedSpecification = createTask({
      status: "failed",
      currentStage: "specification",
      attemptsByStage: { specification: 1 },
      error: "Synthesis timed out.",
    });
    const retryAction = nextAction(failedSpecification);
    assert.equal(retryAction.action, "specification");
    assert.equal(retryAction.label, "Retry specification");
    assert.equal(nextAction({ ...failedSpecification, status: "cancelled" }).action, "specification");

    const failedDesign = createTask({
      status: "failed",
      currentStage: "specification",
      designRequest: {
        requested: true,
        status: "failed",
        variants: [],
        error: "Claude Design did not return a published URL.",
      },
    });
    const designRetryAction = nextAction(failedDesign);
    assert.equal(designRetryAction.action, "specification");
    assert.equal(designRetryAction.label, "Retry failed design");
    assert.match(designRetryAction.detail, /published URL/);

    const retryMarkup = renderToStaticMarkup(
      React.createElement(RuntimeCommandBar, {
        ...baseProps,
        task: failedSpecification,
        viewedStageId: "specification",
      }),
    );
    assert.match(retryMarkup, />Retry specification</);
    assert.doesNotMatch(retryMarkup, /Run investigation/);

    const dispatchedActions = [];
    const retryButton = RuntimeWorkflowActionButton({
      action: retryAction.action,
      label: retryAction.label,
      pending: false,
      approvalBlocked: false,
      onInvoke: async (action) => dispatchedActions.push(action),
    });
    await retryButton.props.onClick();
    assert.deepEqual(dispatchedActions, ["specification"]);

    const blockedTask = createTask({
      status: "blocked",
      currentStage: "specification",
      attemptsByStage: { specification: 3 },
      stageRunLimits: { specification: 3 },
      actionEligibility: {
        generatedAt: "2026-08-01T12:01:00.000Z",
        actions: { "grant-retry": { allowed: true, reason: null } },
      },
    });
    assert.equal(nextAction(blockedTask).action, "grant-retry");
    const blockedMarkup = renderToStaticMarkup(
      React.createElement(RuntimeCommandBar, {
        ...baseProps,
        task: blockedTask,
        viewedStageId: "specification",
      }),
    );
    assert.match(blockedMarkup, />Grant one stage attempt</);
    assert.doesNotMatch(blockedMarkup, /Retry specification/);

    const postGrantTask = createTask({
      status: "failed",
      currentStage: "specification",
      attemptsByStage: { specification: 3 },
      stageRunLimits: { specification: 4 },
    });
    assert.equal(nextAction(postGrantTask).action, "specification");
    const postGrantMarkup = renderToStaticMarkup(
      React.createElement(RuntimeCommandBar, {
        ...baseProps,
        task: postGrantTask,
        viewedStageId: "specification",
      }),
    );
    assert.match(postGrantMarkup, />Retry specification</);
    assert.doesNotMatch(postGrantMarkup, /Grant one stage attempt/);
  });
});

test("keeps plan approval primary while exposing evidence-backed revision", () => {
  return withWorkspace(async ({ RuntimeCommandBar, nextAction }) => {
    const task = createTask({
      status: "awaiting-plan-approval",
      currentStage: "plan",
      attemptsByStage: { plan: 1 },
    });
    assert.equal(nextAction(task).action, "approve-plan");
    const markup = renderToStaticMarkup(
      React.createElement(RuntimeCommandBar, {
        task,
        viewedStageId: "plan",
        onRun: async () => {},
        onAction: async () => {},
        onFinishGrill: async () => {},
      }),
    );
    assert.match(markup, />Revise plan</);
    assert.match(markup, />Approve plan</);
    assert.match(markup, /Record the required correction as a task decision before revising/);

    const exhausted = createTask({
      status: "awaiting-plan-approval",
      currentStage: "plan",
      attemptsByStage: { plan: 3 },
      stageRunLimits: { plan: 3 },
    });
    assert.equal(nextAction(exhausted).action, "grant-retry");
    const exhaustedMarkup = renderToStaticMarkup(
      React.createElement(RuntimeCommandBar, {
        task: exhausted,
        viewedStageId: "plan",
        onRun: async () => {},
        onAction: async () => {},
        onFinishGrill: async () => {},
      }),
    );
    assert.match(exhaustedMarkup, />Grant one Plan attempt</);
    assert.doesNotMatch(exhaustedMarkup, />Revise plan</);
    assert.doesNotMatch(exhaustedMarkup, />Approve plan</);
  });
});

test("offers revision revalidation and human-controlled already-satisfied closure", () => {
  return withWorkspace(async ({ RuntimeCommandBar, RuntimeWorkflowActionButton, nextAction }) => {
    const baseProps = {
      onRun: async () => {},
      onAction: async () => {},
      onFinishGrill: async () => {},
    };
    const stalePlan = createTask({
      status: "blocked",
      currentStage: "plan",
      repositoryAuthorityStatus: "bound",
      blocker: {
        code: "stale-plan",
        detail: "main advanced after planning.",
        detectedAt: "2026-08-01T12:01:00.000Z",
      },
    });
    assert.equal(nextAction(stalePlan).action, "revalidate-plan");
    assert.match(
      renderToStaticMarkup(
        React.createElement(RuntimeCommandBar, {
          ...baseProps,
          task: stalePlan,
          viewedStageId: "plan",
        }),
      ),
      />Revalidate plan against current target</,
    );

    const alreadySatisfied = createTask({
      status: "awaiting-already-satisfied",
      currentStage: "plan",
      repositoryAuthorityStatus: "bound",
      planResult: {
        disposition: "already-satisfied",
        evidence: [{ path: "server/example.mjs", detail: "The requested behavior is present." }],
        changesRemainNecessary: false,
      },
    });
    const closeAction = nextAction(alreadySatisfied);
    assert.equal(closeAction.action, "close-already-satisfied");
    assert.match(
      renderToStaticMarkup(
        React.createElement(RuntimeCommandBar, {
          ...baseProps,
          task: alreadySatisfied,
          viewedStageId: "plan",
        }),
      ),
      />Close — already implemented</,
    );

    const dispatched = [];
    const button = RuntimeWorkflowActionButton({
      action: closeAction.action,
      label: closeAction.label,
      pending: false,
      approvalBlocked: false,
      onInvoke: async (action) => dispatched.push(action),
    });
    await button.props.onClick();
    assert.deepEqual(dispatched, ["close-already-satisfied"]);
  });
});

test("renders only backend-authorized failed Plan recovery and names the failed stage", () => {
  return withWorkspace(async ({ RuntimeCommandBar, RuntimeTaskWorkspace, nextAction }) => {
    const baseProps = {
      onRun: async () => {},
      onAction: async () => {},
      onFinishGrill: async () => {},
    };
    const failedPlan = createTask({
      status: "failed",
      currentStage: "plan",
      attemptsByStage: { plan: 1 },
      stageRunLimits: { plan: 3 },
      error: "Every work package needs at least one repository manifest command ID.",
      actionEligibility: {
        generatedAt: "2026-08-11T00:58:24.901Z",
        actions: { plan: { allowed: true, reason: null } },
      },
    });
    assert.equal(nextAction(failedPlan).action, "plan");
    const retryMarkup = renderToStaticMarkup(
      React.createElement(RuntimeCommandBar, {
        ...baseProps,
        task: failedPlan,
        viewedStageId: "plan",
      }),
    );
    assert.match(retryMarkup, />Retry Impl plan</);
    assert.doesNotMatch(retryMarkup, /No safe retry available/);

    const workspaceMarkup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task: failedPlan,
        onBack: async () => {},
        onRun: async () => {},
        onCancel: async () => {},
        onAction: async () => {},
        onDecision: async () => {},
        onCloseTask: async () => {},
      }),
    );
    assert.match(workspaceMarkup, /Implementation plan failed/);
    assert.doesNotMatch(workspaceMarkup, /Test failed/);

    const deniedPlan = {
      ...failedPlan,
      actionEligibility: {
        generatedAt: "2026-08-11T00:59:24.901Z",
        actions: { plan: { allowed: false, reason: "The plan stage has exhausted its retry allowance." } },
      },
    };
    const deniedMarkup = renderToStaticMarkup(
      React.createElement(RuntimeCommandBar, {
        ...baseProps,
        task: deniedPlan,
        viewedStageId: "plan",
      }),
    );
    assert.match(deniedMarkup, /No safe action available/);
    assert.match(deniedMarkup, /plan stage has exhausted its retry allowance/);
    assert.doesNotMatch(deniedMarkup, />Retry Impl plan</);
  });
});

test("offers recovery actions that match target drift, invalid plans, and retryable Test failures", () => {
  return withWorkspace(async ({ RuntimeCommandBar, nextAction }) => {
    const baseProps = {
      onRun: async () => {},
      onAction: async () => {},
      onFinishGrill: async () => {},
    };
    const candidate = {
      id: "C1",
      revisionNumber: 2,
      baseRevision: "a".repeat(40),
      baseBranch: "main",
      headRevision: "b".repeat(40),
      branch: "agent-harness/ah-999-c1",
      repositoryRoot: "C:/repo/task",
      worktreePath: "C:/worktrees/AH-999/C1",
      status: "repair_required",
      createdAt: "2026-08-01T12:00:00.000Z",
      updatedAt: "2026-08-01T12:00:00.000Z",
      revisions: [],
    };
    const diverged = createTask({
      status: "blocked",
      currentStage: "approval",
      error: "The recorded target ref diverged while recovering a pending merge.",
      blocker: { code: "target-diverged", detail: "main advanced", detectedAt: "2026-08-01T12:00:00.000Z" },
      candidates: [{ ...candidate, status: "awaiting_human_approval" }],
    });
    assert.equal(nextAction(diverged).action, "refresh-candidate");
    assert.match(
      renderToStaticMarkup(
        React.createElement(RuntimeCommandBar, {
          ...baseProps,
          task: diverged,
          viewedStageId: "approval",
        }),
      ),
      />Refresh candidate from main</,
    );

    const refreshConflict = createTask({
      status: "blocked",
      currentStage: "test",
      error: "Candidate refresh conflicted while replaying it onto main.",
      blocker: { code: "target-refresh-conflict", detail: "overlap", detectedAt: "2026-08-01T12:00:00.000Z" },
      candidates: [{ ...candidate, status: "ready_for_test" }],
    });
    assert.equal(nextAction(refreshConflict).action, "rebuild-candidate");
    assert.match(nextAction(refreshConflict).label, /Rebuild from latest target/);

    const implementationDrift = createTask({
      status: "blocked",
      currentStage: "implement",
      blocker: {
        code: "implementation-target-diverged",
        detail: "main advanced",
        detectedAt: "2026-08-01T12:00:00.000Z",
      },
    });
    assert.equal(nextAction(implementationDrift).action, "restart-implementation");
    assert.match(nextAction(implementationDrift).label, /Restart from latest target/);

    const invalidPlan = createTask({
      status: "blocked",
      currentStage: "implement",
      error: "S1: Focused package verification requires at least one repository manifest command id.",
    });
    assert.equal(nextAction(invalidPlan).action, "plan");
    assert.match(nextAction(invalidPlan).label, /Correct implementation plan/);

    const failedQualification = createTask({
      status: "blocked",
      currentStage: "implement",
      error: "S1 did not qualify: backend-test failed.",
    });
    assert.equal(nextAction(failedQualification).action, "plan");

    const failedVerification = {
      candidateId: "C1",
      candidateRevision: 2,
      headRevision: candidate.headRevision,
      command: ".agent-harness/verification.json: test",
      status: "failed",
      durationMs: 100,
      rows: [],
      executionKind: "full-manifest",
    };
    const retryableTest = createTask({
      status: "repair-required",
      currentStage: "test",
      candidates: [candidate],
      artifacts: [
        {
          id: "test-c1-r2",
          stage: "test",
          name: "test-c1-r2.md",
          kind: "markdown",
          content: "Failed unrelated verification.",
          createdAt: "2026-08-01T12:00:00.000Z",
          candidateId: "C1",
          candidateRevision: 2,
          focusedTest: failedVerification,
          gateResult: { verdict: "REPAIR", findings: [] },
        },
      ],
    });
    assert.equal(nextAction(retryableTest).action, "retry-test");
    assert.match(nextAction(retryableTest).label, /Retry Test on C1 r2/);
    assert.equal(
      nextAction({
        ...retryableTest,
        sameCandidateTestRetries: [
          {
            id: "retry-1",
            candidateId: "C1",
            candidateRevision: 2,
            candidateHeadRevision: candidate.headRevision,
            failedVerificationCompletedAt: null,
            requestedAt: "2026-08-01T12:01:00.000Z",
          },
        ],
      }).action,
      "repair",
    );
  });
});

test("uses the authoritative current-stage allowance for workspace attempts and retry actions", () => {
  return withWorkspace(async ({ RuntimeTaskWorkspace }) => {
    const task = createTask({
      status: "failed",
      currentStage: "implement",
      stageRunLimit: 3,
      stageRunLimits: { implement: 0, plan: 9 },
      attemptsByStage: { implement: 0 },
      candidates: [
        {
          id: "C1",
          revisionNumber: 1,
          status: "repair_required",
          baseRevision: "a".repeat(40),
          headRevision: "b".repeat(40),
          baseBranch: "main",
          branch: "agent-harness/ah-999-c1",
          repositoryRoot: "C:/repo/task",
          worktreePath: "C:/worktrees/ah-999-c1",
          createdAt: "2026-08-01T12:00:00.000Z",
          updatedAt: "2026-08-01T12:00:00.000Z",
          revisions: [],
        },
      ],
    });
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

    assert.match(markup, /0 \/ 0/);
    assert.match(markup, /0 of 0/);
    assert.match(markup, /Grant one repair attempt/);
    assert.doesNotMatch(markup, /0 \/ 9|0 of 9/);

    const historicalMarkup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task,
        initialViewedStageId: "plan",
        onBack: async () => {},
        onRun: async () => {},
        onCancel: async () => {},
        onAction: async () => {},
        onDecision: async () => {},
      }),
    );
    assert.match(historicalMarkup, /0 \/ 0/);
    assert.match(historicalMarkup, /0 of 0/);
    assert.doesNotMatch(historicalMarkup, /Grant one repair attempt/);
  });
});

test("uses the Implement repair allowance when the failing gate remains the viewed stage", () => {
  return withWorkspace(async ({ RuntimeTaskWorkspace }) => {
    const candidate = {
      id: "C1",
      revisionNumber: 1,
      status: "repair_required",
      baseRevision: "a".repeat(40),
      headRevision: "b".repeat(40),
      baseBranch: "main",
      branch: "agent-harness/ah-999-c1",
      repositoryRoot: "C:/repo/task",
      worktreePath: "C:/worktrees/ah-999-c1",
      createdAt: "2026-08-01T12:00:00.000Z",
      updatedAt: "2026-08-01T12:00:00.000Z",
      revisions: [],
    };
    const repairReady = createTask({
      status: "repair-required",
      currentStage: "final-review",
      stageRunLimit: 3,
      stageRunLimits: { implement: 3, "final-review": 3 },
      attemptsByStage: { implement: 1, "final-review": 3 },
      candidates: [candidate],
    });
    const markup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task: repairReady,
        onBack: async () => {},
        onRun: async () => {},
        onCancel: async () => {},
        onAction: async () => {},
        onDecision: async () => {},
      }),
    );
    assert.match(markup, /1 \/ 3/);
    assert.match(markup, /1 of 3/);
    assert.match(markup, /Implement repair attempts/);
    assert.match(markup, /Implement repair run/);
    assert.match(markup, /Implement repair is confined to the isolated candidate worktree/);
    assert.match(markup, /failed Final review gate remains the workflow position/);
    assert.match(markup, /Repair candidate/);
    assert.doesNotMatch(markup, /Grant one repair attempt/);
    assert.deepEqual(
      {
        stageRun: runtimeTaskToRecentTask(repairReady).stageRun,
        stageRunLimit: runtimeTaskToRecentTask(repairReady).stageRunLimit,
        stage: runtimeTaskToRecentTask(repairReady).stage,
        stageRunLabel: runtimeTaskToRecentTask(repairReady).stageRunLabel,
      },
      { stageRun: 1, stageRunLimit: 3, stage: "Final review", stageRunLabel: "Implement repair budget run" },
    );

    const afterGrant = {
      ...repairReady,
      stageRunLimits: { ...repairReady.stageRunLimits, implement: 4 },
      attemptsByStage: { ...repairReady.attemptsByStage, implement: 3 },
    };
    const afterGrantMarkup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task: afterGrant,
        onBack: async () => {},
        onRun: async () => {},
        onCancel: async () => {},
        onAction: async () => {},
        onDecision: async () => {},
      }),
    );
    assert.match(afterGrantMarkup, /3 \/ 4/);
    assert.match(afterGrantMarkup, /Implement repair attempts/);
    assert.match(afterGrantMarkup, /Repair candidate/);
    assert.doesNotMatch(afterGrantMarkup, /Grant one repair attempt/);
  });
});

test("renders retry grant provenance in activity and decision surfaces without fabricating legacy audit", () => {
  return withWorkspace(async ({ RuntimeTaskWorkspace, RuntimeActivity, RunActivity }) => {
    const auditEvent = {
      id: "grant-event",
      at: "2026-08-01T12:00:01.000Z",
      category: "decision",
      tone: "success",
      stage: "dev-review",
      title: "Retry allowance granted",
      detail: "A human granted one retry.",
      grantedStage: "implement",
      previousLimit: 3,
      newLimit: 4,
      sourceRunId: "run-source",
      sourceRunIds: ["run-source-S1", "run-source-S2"],
      candidateId: "C1",
      candidateRevision: 2,
      candidateHeadRevision: "candidate-c1-r2",
      authorizingGateCandidateId: "C1",
      authorizingGateCandidateRevision: 2,
      authorizingGateCandidateHeadRevision: "candidate-c1-r2",
      authorizingGateArtifactId: "artifact-review-3",
      authorizingGateKind: "review",
      authorizingGateReservedAt: "2026-08-01T11:59:00.000Z",
      authorizingGateReservationId: "reservation-review-3",
      authorizingGateRunId: "run-review-3",
      authorizingGateStage: "dev-review",
      authorizingGateWorkflowAttempt: 3,
      candidateAuthorizerArtifactIds: ["artifact-authorizer-r1"],
      candidateAuthorizerReservationIds: ["reservation-authorizer-r1"],
      candidateAuthorizerRunIds: ["run-authorizer-r1"],
      candidateProducerArtifactIds: ["artifact-assembly-S1", "artifact-repair-2"],
      candidateProducerRunIds: ["run-assembly-S1", "run-repair-2"],
      workflowAttempt: 3,
      workflowCandidateId: "C1",
      workflowCandidateRevision: 1,
      workflowCandidateHeadRevision: "candidate-c1-r1",
      workflowReservationId: "reservation-implement-3",
    };
    const task = createTask({
      decisions: [
        {
          id: "grant-decision",
          question: "Retry grant",
          answer: "Granted for repair.",
          createdAt: "2026-08-01T12:00:01.000Z",
          grantedStage: "implement",
          previousLimit: 3,
          newLimit: 4,
          sourceRunId: "run-source",
          sourceRunIds: ["run-source-S1", "run-source-S2"],
          candidateId: "C1",
          candidateRevision: 2,
          candidateHeadRevision: "candidate-c1-r2",
          authorizingGateCandidateId: "C1",
          authorizingGateCandidateRevision: 2,
          authorizingGateCandidateHeadRevision: "candidate-c1-r2",
          authorizingGateArtifactId: "artifact-review-3",
          authorizingGateKind: "review",
          authorizingGateReservedAt: "2026-08-01T11:59:00.000Z",
          authorizingGateReservationId: "reservation-review-3",
          authorizingGateRunId: "run-review-3",
          authorizingGateStage: "dev-review",
          authorizingGateWorkflowAttempt: 3,
          candidateAuthorizerArtifactIds: ["artifact-authorizer-r1"],
          candidateAuthorizerReservationIds: ["reservation-authorizer-r1"],
          candidateAuthorizerRunIds: ["run-authorizer-r1"],
          candidateProducerArtifactIds: ["artifact-assembly-S1", "artifact-repair-2"],
          candidateProducerRunIds: ["run-assembly-S1", "run-repair-2"],
          workflowAttempt: 3,
          workflowCandidateId: "C1",
          workflowCandidateRevision: 1,
          workflowCandidateHeadRevision: "candidate-c1-r1",
          workflowReservationId: "reservation-implement-3",
        },
      ],
      events: [auditEvent],
    });

    const workspaceMarkup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task,
        onBack: async () => {},
        onRun: async () => {},
        onCancel: async () => {},
        onAction: async () => {},
        onDecision: async () => {},
      }),
    );
    assert.match(workspaceMarkup, /Retry grant audit/);
    assert.match(workspaceMarkup, /Granted stage/);
    assert.match(workspaceMarkup, /Implement \(implement\)/);
    assert.match(workspaceMarkup, /3 → 4/);
    assert.match(workspaceMarkup, /Source run IDs/);
    assert.match(workspaceMarkup, /run-source-S1, run-source-S2/);
    assert.match(workspaceMarkup, /C1 revision 2/);
    assert.match(workspaceMarkup, /candidate-c1-r2/);
    assert.match(workspaceMarkup, /Authorizing gate/);
    assert.match(workspaceMarkup, /Dev review · review · attempt 3/);
    assert.match(workspaceMarkup, /reservation-review-3/);
    assert.match(workspaceMarkup, /run-review-3/);
    assert.match(workspaceMarkup, /artifact-review-3/);
    assert.match(workspaceMarkup, /2026-08-01T11:59:00.000Z/);
    assert.match(workspaceMarkup, /Candidate repair authorizers/);
    assert.match(workspaceMarkup, /reservation-authorizer-r1/);
    assert.match(workspaceMarkup, /Candidate authorizer runs/);
    assert.match(workspaceMarkup, /run-authorizer-r1/);
    assert.match(workspaceMarkup, /Candidate authorizer artifacts/);
    assert.match(workspaceMarkup, /artifact-authorizer-r1/);
    assert.match(workspaceMarkup, /Candidate producer runs/);
    assert.match(workspaceMarkup, /run-assembly-S1, run-repair-2/);
    assert.match(workspaceMarkup, /Candidate producer artifacts/);
    assert.match(workspaceMarkup, /artifact-assembly-S1, artifact-repair-2/);
    assert.match(workspaceMarkup, /Workflow attempt/);
    assert.match(workspaceMarkup, /Workflow candidate binding/);
    assert.match(workspaceMarkup, /C1 revision 1/);
    assert.match(workspaceMarkup, /candidate-c1-r1/);
    assert.match(workspaceMarkup, /reservation-implement-3/);

    const legacyMarkup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task: createTask({
          events: [
            {
              ...auditEvent,
              grantedStage: undefined,
              previousLimit: undefined,
              newLimit: undefined,
              sourceRunId: undefined,
              sourceRunIds: undefined,
              candidateId: undefined,
              candidateRevision: undefined,
              candidateHeadRevision: undefined,
              authorizingGateCandidateId: undefined,
              authorizingGateCandidateRevision: undefined,
              authorizingGateCandidateHeadRevision: undefined,
              authorizingGateArtifactId: undefined,
              authorizingGateKind: undefined,
              authorizingGateReservedAt: undefined,
              authorizingGateReservationId: undefined,
              authorizingGateRunId: undefined,
              authorizingGateStage: undefined,
              authorizingGateWorkflowAttempt: undefined,
              candidateAuthorizerArtifactIds: undefined,
              candidateAuthorizerReservationIds: undefined,
              candidateAuthorizerRunIds: undefined,
              candidateProducerArtifactIds: undefined,
              candidateProducerRunIds: undefined,
              workflowAttempt: undefined,
              workflowCandidateId: undefined,
              workflowCandidateRevision: undefined,
              workflowCandidateHeadRevision: undefined,
              workflowReservationId: undefined,
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
    assert.doesNotMatch(legacyMarkup, /Retry grant audit/);
    assert.doesNotMatch(legacyMarkup, /No persisted source run/);

    const nullAudit = { ...auditEvent, sourceRunId: null, sourceRunIds: [] };
    const nullMarkup = renderToStaticMarkup(React.createElement(RuntimeActivity, { events: [nullAudit] }));
    assert.match(nullMarkup, /No persisted source runs/);
    const nullRunActivityMarkup = renderToStaticMarkup(
      React.createElement(RunActivity, {
        task: createTask({ events: [nullAudit] }),
        initialFilter: "activity",
        initialSelectedId: "event:grant-event",
      }),
    );
    assert.match(nullRunActivityMarkup, /No persisted source runs/);
  });
});

test("renders merge reconciliation as Needs input without investigation or running copy", () => {
  return withWorkspace(async ({ RuntimeCommandBar, nextAction, toTaskRunState }) => {
    const task = createTask({
      status: "merging",
      currentStage: "approval",
      mergeIntent: {
        status: "pending",
        candidateId: "C1",
        candidateRevision: 1,
        baseRevision: "a".repeat(40),
        headRevision: "b".repeat(40),
        targetRef: "refs/heads/main",
        note: "Approved exact candidate.",
        startedAt: "2026-08-04T00:00:00.000Z",
        completedAt: null,
        error: null,
      },
      actionEligibility: {
        generatedAt: "2026-08-04T00:01:00.000Z",
        actions: { "reconcile-merge": { allowed: true, reason: null } },
      },
    });
    assert.equal(toTaskRunState(task.status), "needs-input");
    assert.equal(runtimeTaskToRecentTask(task).status, "Needs input");
    assert.equal(nextAction(task).action, "reconcile-merge");
    const markup = renderToStaticMarkup(
      React.createElement(RuntimeCommandBar, {
        task,
        viewedStageId: "approval",
        onRun: async () => {},
        onAction: async () => {},
        onFinishGrill: async () => {},
      }),
    );
    assert.match(markup, /Merge intent requires reconciliation/);
    assert.match(markup, /Reconcile retained merge/);
    assert.doesNotMatch(markup, /Start the read-only investigation/);
    assert.doesNotMatch(markup, /spin/);
  });
});
