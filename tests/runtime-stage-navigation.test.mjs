import test from "node:test";
import { assert, createTask, React, renderToStaticMarkup, withWorkspace } from "./runtime-test-support.mjs";

test("renders truthful active-stage access boundaries", () => {
  return withWorkspace(async ({ RuntimeTaskWorkspace, getAccessBoundaryCopy }) => {
    const renderWorkspace = (task) =>
      renderToStaticMarkup(
        React.createElement(RuntimeTaskWorkspace, {
          task,
          onBack: async () => {},
          onRun: async () => {},
          onCancel: async () => {},
          onAction: async () => {},
          onDecision: async () => {},
        }),
      );

    const readOnlyMarkup = renderWorkspace(createTask({ currentStage: "plan", status: "running" }));
    assert.match(readOnlyMarkup, /Read-only boundary/);
    assert.match(readOnlyMarkup, /plan is read-only/i);
    assert.match(readOnlyMarkup, /Read-only/);
    assert.deepEqual(
      (({ kicker, detail, sandbox }) => ({ kicker, detail, sandbox }))(
        getAccessBoundaryCopy(createTask({ currentStage: "plan" })),
      ),
      (({ kicker, detail, sandbox }) => ({ kicker, detail, sandbox }))(
        getAccessBoundaryCopy(createTask({ currentStage: "specification" })),
      ),
    );

    const implementMarkup = renderWorkspace(createTask({ currentStage: "implement", status: "running" }));
    assert.match(implementMarkup, /Worktree write scope/);
    assert.match(implementMarkup, /isolated candidate worktree/i);
    assert.match(implementMarkup, /Isolated candidate worktree/);

    const testMarkup = renderWorkspace(createTask({ currentStage: "test", status: "running" }));
    assert.match(testMarkup, /Candidate cleanliness boundary/);
    assert.match(testMarkup, /temporary files/i);
    assert.match(testMarkup, /must be left clean/i);

    const repairRequiredMarkup = renderWorkspace(
      createTask({
        currentStage: "test",
        status: "repair-required",
        error: "The test gate failed.",
      }),
    );
    assert.match(repairRequiredMarkup, /Worktree write scope/);
    assert.match(repairRequiredMarkup, /isolated candidate worktree/i);
    assert.match(repairRequiredMarkup, /repair the retained candidate/i);

    const activeTask = createTask({
      currentStage: "implement",
      status: "running",
      artifacts: [
        {
          id: "artifact-1",
          stage: "specification",
          kind: "markdown",
          name: "Specification",
          content: "# Spec",
          createdAt: "2026-08-01T11:00:00.000Z",
          model: "GPT-5.4-mini",
          usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
        },
      ],
    });
    const viewedStageMarkup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task: activeTask,
        initialViewedStageId: "specification",
        onBack: async () => {},
        onRun: async () => {},
        onCancel: async () => {},
        onAction: async () => {},
        onDecision: async () => {},
      }),
    );
    const sameActiveDifferentViewedMarkup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task: activeTask,
        initialViewedStageId: "plan",
        onBack: async () => {},
        onRun: async () => {},
        onCancel: async () => {},
        onAction: async () => {},
        onDecision: async () => {},
      }),
    );

    assert.match(viewedStageMarkup, /Viewing/);
    assert.match(viewedStageMarkup, /Active/);
    assert.match(viewedStageMarkup, /<small>Agent<\/small><strong class="">Implement agent<\/strong>/);
    assert.doesNotMatch(
      viewedStageMarkup,
      /<small>Agent<\/small><strong class="">Task specification agent<\/strong>/,
    );
    assert.match(viewedStageMarkup, /Worktree write scope/);
    assert.match(viewedStageMarkup, /isolated candidate worktree/i);
    assert.match(sameActiveDifferentViewedMarkup, /Worktree write scope/);
    assert.match(sameActiveDifferentViewedMarkup, /isolated candidate worktree/i);
    assert.equal(
      viewedStageMarkup.match(/<small>Sandbox<\/small><strong class="">([^<]+)<\/strong>/)?.[1],
      sameActiveDifferentViewedMarkup.match(/<small>Sandbox<\/small><strong class="">([^<]+)<\/strong>/)?.[1],
    );
  });
});

test("renders an open Grill session as active decisions and completed Grill as history", () => {
  return withWorkspace(async ({ RuntimeTaskWorkspace }) => {
    const question = {
      id: "Q1",
      question: "Preserve the existing API contract?",
      whyItMatters: "The answer changes compatibility behavior.",
      options: [
        { id: "Q1-O1", label: "Preserve it", description: "Keep clients working.", recommended: true },
        { id: "Q1-O2", label: "Break it", description: "Adopt the new shape.", recommended: false },
      ],
      allowCustom: true,
      answer: null,
      answerSource: null,
      resolvedAt: null,
    };
    const sharedProps = {
      onBack: async () => {},
      onRun: async () => {},
      onCancel: async () => {},
      onAction: async () => {},
      onDecision: async () => {},
      onGrillAnswer: async () => {},
      onFinishGrill: async () => {},
    };
    const openMarkup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        ...sharedProps,
        task: createTask({
          status: "awaiting-grill",
          currentStage: "grill",
          completedStages: ["triage", "scouts"],
          grillSession: {
            status: "open",
            questions: [question],
            createdAt: "2026-08-01T12:00:00.000Z",
            completedAt: null,
            completionReason: null,
          },
        }),
      }),
    );
    assert.match(openMarkup, /Preserve the existing API contract/);
    assert.match(openMarkup, /Custom answer/);
    assert.match(openMarkup, /Finish with 1 recommendation/);

    const completedMarkup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        ...sharedProps,
        initialViewedStageId: "grill",
        task: createTask({
          grillPolicy: "manual",
          status: "awaiting-spec-approval",
          currentStage: "specification",
          completedStages: ["triage", "scouts", "grill", "specification"],
          grillSession: {
            status: "completed",
            questions: [
              {
                ...question,
                answer: "Preserve it",
                answerSource: "operator-answer",
                resolvedAt: "2026-08-01T12:05:00.000Z",
              },
            ],
            createdAt: "2026-08-01T12:00:00.000Z",
            completedAt: "2026-08-01T12:05:00.000Z",
            completionReason: "All material questions were answered by the operator.",
            completionSource: "operator",
            policySnapshot: "manual",
            acceptedRecommendationCount: 0,
          },
        }),
      }),
    );
    assert.match(completedMarkup, /All material questions were answered by the operator/);
    assert.match(completedMarkup, /Operator answer/);
    assert.match(completedMarkup, /Manual policy/);
    assert.doesNotMatch(completedMarkup, /Confirm answer/);
    assert.doesNotMatch(completedMarkup, /Finish with 1 recommendation/);

    const automaticMarkup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        ...sharedProps,
        initialViewedStageId: "grill",
        task: createTask({
          grillPolicy: "auto-accept-recommendations",
          status: "awaiting-spec-approval",
          currentStage: "specification",
          completedStages: ["triage", "scouts", "grill", "specification"],
          grillSession: {
            status: "completed",
            questions: [
              {
                ...question,
                answer: "Preserve it",
                answerSource: "automation-policy",
                resolvedAt: "2026-08-01T12:05:00.000Z",
              },
            ],
            createdAt: "2026-08-01T12:00:00.000Z",
            completedAt: "2026-08-01T12:05:00.000Z",
            completionReason:
              "Automatically accepted 1 recommended assumption under the task's Grill policy.",
            completionSource: "automation-policy",
            policySnapshot: "auto-accept-recommendations",
            acceptedRecommendationCount: 1,
          },
        }),
      }),
    );
    assert.match(automaticMarkup, /Automatic policy/);
    assert.match(automaticMarkup, /Recommendation accepted automatically/);
  });
});

test("renders a compact completed Grill state when investigation leaves no material questions", () => {
  return withWorkspace(async ({ RuntimeTaskWorkspace }) => {
    const markup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task: createTask({
          status: "awaiting-spec-approval",
          currentStage: "specification",
          completedStages: ["triage", "scouts", "grill", "specification"],
          grillSession: {
            status: "completed",
            questions: [],
            createdAt: "2026-08-01T12:00:00.000Z",
            completedAt: "2026-08-01T12:00:01.000Z",
            completionReason: "No material product decisions remained after repository investigation.",
          },
        }),
        initialViewedStageId: "grill",
        onBack: async () => {},
        onRun: async () => {},
        onCancel: async () => {},
        onAction: async () => {},
        onDecision: async () => {},
      }),
    );
    assert.match(markup, /runtime-grill-empty/);
    assert.match(markup, /No material questions remained/);
    assert.doesNotMatch(markup, /runtime-grill__reason/);
    assert.doesNotMatch(markup, /runtime-stage-empty/);
  });
});

test("renders prior stage attempts and strips machine payloads from visible Markdown", () => {
  return withWorkspace(async ({ RuntimeTaskWorkspace, stripStructuredArtifactPayloads }) => {
    const first = {
      id: "plan-1",
      runId: "run-1",
      stage: "plan",
      kind: "markdown",
      name: "implementation-plan.md",
      content: '# Recommended route\n\nReadable route.\n\n<scout-dispatch>{"scouts":[]}</scout-dispatch>',
      createdAt: "2026-08-01T12:00:00.000Z",
      model: "gpt-5.6-sol",
      reasoning: "high",
      usage: {
        inputTokens: 100,
        cachedInputTokens: 40,
        outputTokens: 20,
        totalTokens: 120,
        cost: 0.1,
        credits: 0.2,
      },
    };
    const second = {
      ...first,
      id: "plan-2",
      runId: "run-2",
      name: "implementation-plan-r2.md",
      createdAt: "2026-08-01T12:05:00.000Z",
    };
    const markup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task: createTask({
          status: "ready-to-implement",
          currentStage: "plan",
          completedStages: ["triage", "scouts", "grill", "specification", "plan"],
          artifacts: [first, second],
        }),
        onBack: async () => {},
        onRun: async () => {},
        onCancel: async () => {},
        onAction: async () => {},
        onDecision: async () => {},
      }),
    );
    assert.match(markup, /Stage history/);
    assert.match(markup, /Attempt 1/);
    assert.match(markup, /implementation-plan-r2\.md/);
    assert.match(markup, /Latest shown/);
    assert.equal(stripStructuredArtifactPayloads(first.content), "# Recommended route\n\nReadable route.");
  });
});
