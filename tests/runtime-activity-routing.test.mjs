import test from "node:test";
import {
  assert,
  createTask,
  makeGateFreshness,
  React,
  renderToStaticMarkup,
  withWorkspace,
} from "./runtime-test-support.mjs";

test("filters structured activity and renders test run and artifact drilldown", () => {
  return withWorkspace(async ({ RunActivity, filterRunActivity }) => {
    const runBase = {
      status: "completed",
      role: "dev-review",
      model: "gpt-5.6-sol",
      reasoning: "high",
      startedAt: "2026-08-01T12:00:00.000Z",
      completedAt: "2026-08-01T12:00:03.000Z",
      durationMs: 3_000,
      artifactId: null,
      usage: {
        inputTokens: 100,
        cachedInputTokens: 80,
        outputTokens: 20,
        totalTokens: 120,
        credits: 0.25,
        cost: 0.002,
      },
      credits: 0.25,
      apiEstimate: 0.002,
      candidateId: "C1",
      candidateRevision: 2,
      workPackageId: null,
      attempt: 1,
      retryOfRunId: null,
      repairOfRunId: null,
      toolCalls: [],
      test: null,
      gateResult: {
        verdict: "PASS",
        candidateId: "C1",
        candidateRevision: 2,
        evaluatedAt: "2026-08-01T12:00:03.000Z",
        blockingReasons: [],
      },
      error: null,
      source: "codex-jsonl",
    };
    const task = createTask({
      runs: [
        { ...runBase, id: "RUN-REVIEW", kind: "review", stage: "dev-review" },
        {
          ...runBase,
          id: "RUN-TEST",
          kind: "test",
          stage: "test",
          role: "test",
          artifactId: "artifact-test",
          retryOfRunId: "RUN-REVIEW",
          toolCalls: [
            {
              id: "cmd-1",
              name: "command_execution",
              category: "repository-command",
              phase: "completed",
              result: "Exit code 0",
            },
          ],
          test: {
            candidateId: "C1",
            candidateRevision: 2,
            status: "passed",
            command: "npm.cmd test",
            durationMs: 900,
            rowCount: 1,
            failedRowIds: [],
          },
        },
      ],
      artifacts: [
        {
          id: "artifact-test",
          runId: "RUN-TEST",
          stage: "test",
          name: "test.md",
          kind: "markdown",
          content: "PASS",
          createdAt: "2026-08-01T12:00:03.000Z",
          model: "gpt-5.6-sol",
          usage: runBase.usage,
        },
      ],
      events: [
        {
          id: "E1",
          at: "2026-08-01T12:00:00.000Z",
          category: "agent",
          tone: "info",
          stage: "dev-review",
          title: "Review started",
          detail: "Fresh context",
          runId: "RUN-REVIEW",
        },
        {
          id: "E2",
          at: "2026-08-01T12:00:01.000Z",
          category: "tool",
          tone: "success",
          stage: "test",
          title: "Repository command completed",
          detail: "npm.cmd test",
          runId: "RUN-TEST",
          toolCall: {
            id: "cmd-1",
            name: "command_execution",
            category: "repository-command",
            phase: "completed",
            result: "Exit code 0",
          },
        },
        {
          id: "E3",
          at: "2026-08-01T12:00:02.000Z",
          category: "decision",
          tone: "success",
          stage: "approval",
          title: "Approved",
          detail: "Proceed",
          approvalId: "A1",
        },
      ],
    });

    assert.equal(filterRunActivity(task, "activity").length, 3);
    assert.deepEqual(
      filterRunActivity(task, "agent").map((item) => item.run.id),
      ["RUN-REVIEW"],
    );
    assert.deepEqual(
      filterRunActivity(task, "test").map((item) => item.run.id),
      ["RUN-TEST"],
    );
    assert.deepEqual(
      filterRunActivity(task, "decision").map((item) => item.event.id),
      ["E3"],
    );
    assert.deepEqual(
      filterRunActivity(task, "tool").map((item) => item.event.id),
      ["E2"],
    );

    const markup = renderToStaticMarkup(
      React.createElement(RunActivity, {
        task,
        initialFilter: "test",
        initialSelectedId: "run:RUN-TEST",
        onOpenArtifact: () => {},
      }),
    );
    assert.match(markup, /Tool calls/);
    assert.match(markup, /Run drilldown/);
    assert.match(markup, /RUN-TEST/);
    assert.match(markup, /Focused tests/);
    assert.match(markup, /Open test\.md/);
    assert.match(markup, /API-rate estimate/);
  });
});

test("renders retained malformed Test metadata without crashing Run Activity", () => {
  return withWorkspace(async ({ RunActivity }) => {
    const freshness = makeGateFreshness("test", {
      sourceRunId: "RUN-TEST-MALFORMED",
      reasonCode: "malformed_binding",
      reasonCopy: "Persisted candidate evidence has a malformed candidate binding.",
    });
    const task = createTask({
      runs: [
        {
          id: "RUN-TEST-MALFORMED",
          kind: "test",
          status: "completed",
          stage: "test",
          role: "test",
          model: "gpt-5.6-luna",
          reasoning: "xhigh",
          startedAt: "2026-08-01T12:00:00.000Z",
          completedAt: "2026-08-01T12:00:01.000Z",
          durationMs: 1_000,
          artifactId: null,
          usage: null,
          credits: null,
          apiEstimate: null,
          candidateId: "C1",
          candidateRevision: 2,
          workPackageId: null,
          attempt: 1,
          retryOfRunId: null,
          repairOfRunId: null,
          toolCalls: [],
          test: {
            candidateId: "C1",
            candidateRevision: 2,
            status: "failed",
            command: "npm test",
            durationMs: 1_000,
            rowCount: 1,
            failedRowIds: "row-failed",
            rows: [],
          },
          gateResult: null,
          evidenceError: null,
          freshness,
          error: null,
          source: "codex-jsonl",
        },
      ],
    });

    const markup = renderToStaticMarkup(
      React.createElement(RunActivity, {
        task,
        initialFilter: "test",
        initialSelectedId: "run:RUN-TEST-MALFORMED",
      }),
    );
    assert.match(markup, /failed count unavailable/);
    assert.match(markup, /Rerun required/);
    assert.match(markup, /Persisted candidate evidence has a malformed candidate binding\./);
  });
});

test("renders stale evidence in the mounted Run Activity views with exact persisted reasons", () => {
  return withWorkspace(async ({ RunActivity, filterRunActivity }) => {
    const revisionReason = "Candidate evidence belongs to a previous candidate revision.";
    const failureReason = "The terminal run failed, so its evidence is not fresh.";
    const missingBindingReason =
      "Candidate evidence is missing explicit candidateId and candidateRevision fields.";
    const run = (overrides) => ({
      id: "RUN-REVIEW-STALE",
      kind: "review",
      status: "completed",
      stage: "dev-review",
      role: "dev-review",
      model: "gpt-5.6-sol",
      reasoning: "high",
      startedAt: "2026-08-01T12:00:00.000Z",
      completedAt: "2026-08-01T12:00:03.000Z",
      durationMs: 3_000,
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
      toolCalls: [],
      test: null,
      gateResult: null,
      evidenceError: null,
      error: null,
      source: "codex-jsonl",
      freshness: makeGateFreshness("dev-review", {
        sourceRunId: "RUN-REVIEW-STALE",
        reasonCode: "revision_change",
        reasonCopy: revisionReason,
      }),
      ...overrides,
    });
    const reviewRun = run({});
    const testRun = run({
      id: "RUN-TEST-STALE",
      kind: "test",
      stage: "test",
      role: "test",
      freshness: makeGateFreshness("test", {
        sourceRunId: "RUN-TEST-STALE",
        reasonCode: "failed_execution",
        reasonCopy: failureReason,
      }),
    });
    const freshReviewRun = run({
      id: "RUN-REVIEW-FRESH",
      candidateRevision: 2,
      freshness: makeGateFreshness("dev-review", {
        fresh: true,
        sourceRunId: "RUN-REVIEW-FRESH",
      }),
    });
    const linkedStagePass = {
      id: "EVENT-STAGE-PASS",
      at: "2026-08-01T12:01:00.000Z",
      category: "decision",
      tone: "success",
      stage: "dev-review",
      title: "Development Review passed",
      detail: "C1 revision 1 advanced to the next gate.",
      runId: reviewRun.id,
    };
    const persistedStaleEvent = {
      id: "EVENT-PERSISTED-STALE",
      at: "2026-08-01T12:02:00.000Z",
      category: "agent",
      tone: "success",
      stage: "test",
      title: "Focused Test completed",
      detail: "Historical status: completed",
      freshness: testRun.freshness,
    };
    const legacyUnlinkedStagePass = {
      id: "EVENT-LEGACY-UNLINKED-PASS",
      at: "2026-08-01T12:03:00.000Z",
      category: "decision",
      tone: "success",
      stage: "dev-review",
      title: "Development Review passed",
      detail: "Historical C1 revision 1 gate result.",
      freshness: makeGateFreshness("dev-review", {
        sourceRunId: null,
        reasonCode: "missing_binding",
        reasonCopy: missingBindingReason,
      }),
    };
    const persistedStaleWithFreshLink = {
      id: "EVENT-PERSISTED-STALE-FRESH-LINK",
      at: "2026-08-01T12:04:00.000Z",
      category: "decision",
      tone: "success",
      stage: "dev-review",
      title: "Development Review passed",
      detail: "Historical gate event with invalid linkage.",
      runId: freshReviewRun.id,
      freshness: makeGateFreshness("dev-review", {
        sourceRunId: null,
        reasonCode: "missing_binding",
        reasonCopy: missingBindingReason,
      }),
    };
    const task = createTask({
      runs: [freshReviewRun, reviewRun, testRun],
      events: [linkedStagePass, persistedStaleEvent, legacyUnlinkedStagePass, persistedStaleWithFreshLink],
    });

    const activityItems = filterRunActivity(task, "activity");
    const linkedItem = activityItems.find((item) => item.event.id === linkedStagePass.id);
    assert.equal(linkedItem.tone, "warning");
    assert.match(linkedItem.title, /Rerun required/);
    assert.match(linkedItem.detail, new RegExp(revisionReason.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    const persistedItem = activityItems.find((item) => item.event.id === persistedStaleEvent.id);
    assert.equal(persistedItem.tone, "warning");
    assert.match(persistedItem.detail, new RegExp(failureReason.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    const legacyItem = activityItems.find((item) => item.event.id === legacyUnlinkedStagePass.id);
    assert.equal(legacyItem.tone, "warning");
    assert.match(legacyItem.title, /Rerun required/);
    assert.match(legacyItem.detail, new RegExp(missingBindingReason.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    const invalidLinkItem = activityItems.find((item) => item.event.id === persistedStaleWithFreshLink.id);
    assert.equal(invalidLinkItem.tone, "warning");
    assert.match(invalidLinkItem.title, /Rerun required/);
    assert.match(
      invalidLinkItem.detail,
      new RegExp(missingBindingReason.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );

    const agentItem = filterRunActivity(task, "agent")[0];
    assert.equal(agentItem.tone, "warning");
    assert.match(agentItem.title, /Rerun required/);
    assert.match(agentItem.detail, /completed/);
    assert.match(agentItem.detail, new RegExp(revisionReason.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    const testItem = filterRunActivity(task, "test")[0];
    assert.equal(testItem.tone, "warning");
    assert.match(testItem.detail, new RegExp(failureReason.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

    for (const [initialFilter, selectedId, reason] of [
      ["activity", `event:${linkedStagePass.id}`, revisionReason],
      ["agent", `run:${reviewRun.id}`, revisionReason],
      ["test", `run:${testRun.id}`, failureReason],
      ["decision", `event:${linkedStagePass.id}`, revisionReason],
      ["decision", `event:${legacyUnlinkedStagePass.id}`, missingBindingReason],
      ["decision", `event:${persistedStaleWithFreshLink.id}`, missingBindingReason],
    ]) {
      const markup = renderToStaticMarkup(
        React.createElement(RunActivity, { task, initialFilter, initialSelectedId: selectedId }),
      );
      assert.match(markup, /runtime-activity-row--warning/);
      assert.match(markup, /Rerun required/);
      assert.match(markup, new RegExp(reason.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });
});
