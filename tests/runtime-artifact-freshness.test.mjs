import test from "node:test";
import {
  assert,
  createTask,
  makeGateFreshness,
  React,
  renderToStaticMarkup,
  withWorkspace,
} from "./runtime-test-support.mjs";

test("renders zero-dispatch scouts as a retained rationale and deterministic handoff", () => {
  return withWorkspace(async ({ RuntimeTaskWorkspace, resolveScoutUsage, stageUsage }) => {
    const handoff = {
      id: "zero-dispatch-handoff",
      runId: "RUN-ZERO-HANDOFF-LIKE",
      stage: "scouts",
      kind: "markdown",
      name: "repository-scout.md",
      content: "# Repository evidence\n\nNo child reports were required.",
      createdAt: "2026-08-01T12:01:00.000Z",
      model: "gpt-5.6-luna",
      reasoning: "xhigh",
      agentRole: "scouts",
      usage: {
        inputTokens: 8_000,
        cachedInputTokens: 7_000,
        outputTokens: 6_000,
        totalTokens: 14_000,
        cost: 80,
        credits: 40,
      },
    };
    const task = createTask({
      currentStage: "scouts",
      status: "awaiting-grill",
      completedStages: ["triage", "scouts"],
      scoutDispatch: {
        selected: [],
        skipped: ["scout-code-path", "scout-pattern"],
        rationale: "Triage found enough repository evidence and explicitly requested no scouts.",
        createdAt: "2026-08-01T11:59:00.000Z",
        completedAt: "2026-08-01T12:01:00.000Z",
      },
      artifacts: [handoff],
    });

    const resolved = resolveScoutUsage(task);
    assert.deepEqual(resolved.perScout, []);
    assert.deepEqual(resolved.unmatched, []);
    assert.deepEqual(resolved.matchedArtifacts, []);
    assert.equal(resolved.aggregate.runs, 0);
    assert.equal(resolved.aggregate.totalTokens, 0);
    assert.equal(stageUsage([task], "scouts").runs, 0);
    assert.equal(stageUsage([task], "scouts").artifacts.includes(handoff), false);

    const markup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task,
        initialViewedStageId: "scouts",
        onBack: async () => {},
        onRun: async () => {},
        onCancel: async () => {},
        onAction: async () => {},
        onDecision: async () => {},
      }),
    );
    assert.match(markup, /No scouts dispatched/);
    assert.match(markup, /Triage found enough repository evidence and explicitly requested no scouts\./);
    assert.match(markup, /Downstream handoff · deterministic aggregation/);
    assert.match(markup, /Inputs: none dispatched; no additional model call/);
    assert.match(markup, /Viewed downstream handoff/);
    assert.match(markup, /Child scout runs/);
    assert.match(markup, /0 recorded/);
    assert.match(markup, /0 input · 0 cached · 0 output/);
    assert.doesNotMatch(markup, /Viewed agent run/);
    assert.doesNotMatch(markup, /No recorded child scout run/);
    assert.doesNotMatch(markup, /zero-token|token usage failure|model run failed/i);
  });
});

test("renders artifact copy affordance and normalizes clipboard outcomes", () => {
  return withWorkspace(
    async ({ RuntimeArtifactViewer, copyArtifactContent, shouldApplyArtifactCopyFeedback }) => {
      const artifact = {
        id: "artifact-1",
        stage: "specification",
        kind: "markdown",
        name: "Specification",
        content: "# Spec\n\nRetained text.",
        createdAt: "2026-08-01T11:00:00.000Z",
        model: "GPT-5.4-mini",
        usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
      };
      const markup = renderToStaticMarkup(
        React.createElement(RuntimeArtifactViewer, { artifact, onClose: async () => {} }),
      );
      assert.match(markup, /Copy artifact/);
      assert.match(markup, /Real agent output \u00b7 read-only/);

      const writes = [];
      await assert.doesNotReject(
        copyArtifactContent(artifact.content, {
          writeText: async (text) => {
            writes.push(text);
          },
        }),
      );
      assert.deepEqual(writes, [artifact.content]);

      assert.deepEqual(
        await copyArtifactContent(artifact.content, {
          writeText: async () => {
            throw new Error("blocked");
          },
        }),
        { ok: false, message: "Clipboard access failed. The browser blocked copying this artifact." },
      );
      assert.deepEqual(await copyArtifactContent(artifact.content, null), {
        ok: false,
        message: "Clipboard access failed. Your browser did not expose clipboard write support.",
      });
      assert.equal(shouldApplyArtifactCopyFeedback("artifact-1", "artifact-1"), true);
      assert.equal(shouldApplyArtifactCopyFeedback("artifact-1", "artifact-2"), false);
    },
  );
});

test("keeps focused test evidence attached to the persisted Markdown artifact in the runtime workspace", () => {
  return withWorkspace(async ({ RuntimeTaskWorkspace }) => {
    const focusedTest = {
      candidateId: "C1",
      candidateRevision: 2,
      command: "npm.cmd run test:runtime",
      status: "passed",
      startedAt: "2026-08-01T12:00:00.000Z",
      completedAt: "2026-08-01T12:00:00.900Z",
      durationMs: 900,
      rows: [
        {
          id: "row-1",
          candidateId: "C1",
          candidateRevision: 2,
          command: "npm.cmd run test:runtime",
          status: "passed",
          durationMs: 900,
          title: "runtime.test.mjs",
          artifactReferences: [
            { name: "Markdown test artifact", kind: "markdown", path: "artifacts/test.md" },
          ],
          assertions: [
            { label: "workspace renders the test artifact", actual: "present", expected: "present" },
          ],
          failureDetails: null,
        },
      ],
    };
    const markup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task: createTask({
          status: "ready-for-final-review",
          currentStage: "test",
          completedStages: [
            "triage",
            "scouts",
            "grill",
            "specification",
            "plan",
            "implement",
            "dev-review",
            "test",
          ],
          candidates: [
            {
              id: "C1",
              revisionNumber: 2,
              status: "ready_for_final_review",
              baseRevision: "a".repeat(40),
              headRevision: "b".repeat(40),
              baseBranch: "main",
              branch: "agent-harness/ah-999-c1",
              revisions: [],
            },
          ],
          artifacts: [
            {
              id: "artifact-1",
              stage: "test",
              kind: "markdown",
              name: "test-c1-r2.md",
              content:
                'PASS\n\n<focused-test-evidence>\n{"candidateId":"C1","candidateRevision":2,"command":"npm.cmd run test:runtime","status":"passed","durationMs":900,"rows":[{"id":"row-1","candidateId":"C1","candidateRevision":2,"command":"npm.cmd run test:runtime","status":"passed","durationMs":900,"title":"runtime.test.mjs","artifactReferences":[{"name":"Markdown test artifact","kind":"markdown","path":"artifacts/test.md"}],"assertions":[{"label":"workspace renders the test artifact","actual":"present","expected":"present"}],"failureDetails":null}]}\n</focused-test-evidence>',
              createdAt: "2026-08-01T12:00:00.000Z",
              model: "GPT-5.4-mini",
              usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
              candidateId: "C1",
              candidateRevision: 2,
              focusedTest,
            },
          ],
          gateFreshness: {
            test: makeGateFreshness("test", {
              fresh: true,
              sourceRunId: "run-1",
              sourceArtifactId: "artifact-1",
              focusedTest,
            }),
          },
        }),
        onBack: async () => {},
        onRun: async () => {},
        onCancel: async () => {},
        onAction: async () => {},
        onDecision: async () => {},
        onGrillAnswer: async () => {},
        onFinishGrill: async () => {},
      }),
    );
    assert.match(markup, /test-c1-r2\.md/);
    assert.match(markup, /Viewing/);
    assert.match(markup, /Candidate-bound structured evidence/);
    assert.match(markup, /workspace renders the test artifact/);
  });
});

test("renders exact-candidate failed Test rows while the gate remains rerun-required", () => {
  return withWorkspace(async ({ RuntimeTaskWorkspace, getRuntimeFocusedTest }) => {
    const failedFocusedTest = {
      candidateId: "C1",
      candidateRevision: 2,
      bindingExplicit: true,
      command: "npm test",
      status: "failed",
      durationMs: 740,
      rows: [
        {
          id: "row-failed",
          candidateId: "C1",
          candidateRevision: 2,
          bindingExplicit: true,
          command: "npm test",
          status: "failed",
          durationMs: 740,
          title: "candidate-bound regression",
          artifactReferences: [],
          assertions: [{ label: "authoritative candidate", actual: "failed", expected: "passed" }],
          failureDetails: "The exact-candidate assertion failed.",
        },
      ],
    };
    const task = createTask({
      status: "repair-required",
      currentStage: "test",
      completedStages: ["triage", "scouts", "grill", "specification", "plan", "implement", "dev-review"],
      candidates: [
        {
          id: "C1",
          revisionNumber: 2,
          status: "repair_required",
          baseRevision: "a".repeat(40),
          headRevision: "b".repeat(40),
          baseBranch: "main",
          branch: "agent-harness/ah-999-c1",
          revisions: [],
        },
      ],
      gateFreshness: {
        test: makeGateFreshness("test", {
          sourceRunId: "run-test-failed",
          reasonCode: "failed_execution",
          reasonCopy: "The authoritative run did not complete successfully.",
          focusedTest: failedFocusedTest,
        }),
      },
    });

    assert.equal(getRuntimeFocusedTest(task)?.rows[0].id, "row-failed");
    const markup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task,
        initialViewedStageId: "test",
        onBack: async () => {},
        onRun: async () => {},
        onCancel: async () => {},
        onAction: async () => {},
        onDecision: async () => {},
        onGrillAnswer: async () => {},
        onFinishGrill: async () => {},
      }),
    );
    assert.match(markup, /0 passed.*1 failed.*C1 r2/);
    assert.match(markup, /candidate-bound regression/);
    assert.match(markup, /failed/);
  });
});

test("treats missing and mismatched candidate bindings as stale in navigation and approval counts", () => {
  return withWorkspace(async ({ RuntimeTaskWorkspace }) => {
    const candidate = {
      id: "C1",
      revisionNumber: 2,
      status: "awaiting_human_approval",
      baseRevision: "a".repeat(40),
      headRevision: "b".repeat(40),
      baseBranch: "main",
      branch: "agent-harness/ah-999-c1",
      revisions: [
        {
          number: 1,
          headRevision: "c".repeat(40),
          reason: "assembly",
          createdAt: "2026-08-01T11:00:00.000Z",
        },
        { number: 2, headRevision: "b".repeat(40), reason: "repair", createdAt: "2026-08-01T12:00:00.000Z" },
      ],
    };
    const gateArtifact = (stage, revision, withBinding = true, blockingReasons = []) => ({
      id: `${stage}-${revision}`,
      stage,
      kind: "markdown",
      name: `${stage}-c1-r${revision}.md`,
      content: "PASS",
      createdAt: "2026-08-01T12:00:00.000Z",
      model: "gpt-5.6-sol",
      usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
      ...(withBinding ? { candidateId: "C1", candidateRevision: revision } : {}),
      gateResult: withBinding
        ? {
            verdict: "PASS",
            candidateId: "C1",
            candidateRevision: revision,
            evaluatedAt: "2026-08-01T12:00:00.000Z",
            blockingReasons,
          }
        : null,
    });
    const markup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task: createTask({
          status: "awaiting-human-approval",
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
          ],
          candidates: [candidate],
          artifacts: [
            gateArtifact("dev-review", 2, true, ["A contradictory blocker remains."]),
            gateArtifact("test", 1),
            gateArtifact("test", 2, false),
            gateArtifact("final-review", 2),
          ],
          gateFreshness: {
            "dev-review": makeGateFreshness("dev-review", {
              sourceRunId: "run-dev-review",
              sourceArtifactId: "dev-review-2",
              reasonCode: "contradictory_evidence",
              reasonCopy: "Candidate evidence contains contradictory result fields.",
            }),
            test: makeGateFreshness("test", {
              sourceRunId: "run-test",
              sourceArtifactId: "test-2",
              reasonCode: "missing_binding",
              reasonCopy: "Candidate evidence is missing explicit candidateId and candidateRevision fields.",
            }),
            "final-review": makeGateFreshness("final-review", {
              fresh: true,
              sourceRunId: "run-final-review",
              sourceArtifactId: "final-review-2",
            }),
          },
        }),
        initialViewedStageId: "approval",
        onBack: async () => {},
        onRun: async () => {},
        onCancel: async () => {},
        onAction: async () => {},
        onDecision: async () => {},
        onGrillAnswer: async () => {},
        onFinishGrill: async () => {},
      }),
    );
    assert.match(markup, /1 of 3 candidate-bound gates fresh/);
    assert.match(markup, /rerun required/);
    assert.match(markup, /test-c1-r2\.md/);
  });
});

test("resolves same-revision superseded artifacts with authoritative stale reason copy", () => {
  return withWorkspace(async ({ getRuntimeArtifactFreshness, isArtifactFresh }) => {
    const candidate = {
      id: "C1",
      revisionNumber: 2,
      status: "under_review",
      baseRevision: "a".repeat(40),
      headRevision: "b".repeat(40),
      baseBranch: "main",
      branch: "agent-harness/ah-999-c1",
      revisions: [],
    };
    const usage = { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 };
    const artifact = (id, runId, createdAt) => ({
      id,
      runId,
      stage: "dev-review",
      kind: "markdown",
      name: `${id}.md`,
      content: "PASS",
      createdAt,
      model: "gpt-5.6-sol",
      usage,
      candidateId: "C1",
      candidateRevision: 2,
      gateResult: {
        verdict: "PASS",
        candidateId: "C1",
        candidateRevision: 2,
        evaluatedAt: createdAt,
        blockingReasons: [],
      },
    });
    const run = (id, artifactId, attempt, freshness) => ({
      id,
      kind: "review",
      status: "completed",
      stage: "dev-review",
      role: "dev-review",
      model: "gpt-5.6-sol",
      reasoning: "high",
      startedAt: "2026-08-01T12:00:00.000Z",
      completedAt: "2026-08-01T12:01:00.000Z",
      durationMs: 60_000,
      artifactId,
      usage,
      credits: null,
      apiEstimate: null,
      candidateId: "C1",
      candidateRevision: 2,
      workPackageId: null,
      attempt,
      retryOfRunId: null,
      repairOfRunId: null,
      toolCalls: [],
      test: null,
      evidenceError: null,
      freshness,
      gateResult: {
        verdict: "PASS",
        candidateId: "C1",
        candidateRevision: 2,
        evaluatedAt: "2026-08-01T12:01:00.000Z",
        blockingReasons: [],
      },
      error: null,
      source: "codex-jsonl",
    });
    const superseded = makeGateFreshness("dev-review", {
      sourceRunId: "RUN-OLD",
      sourceArtifactId: "ART-OLD",
      reasonCode: "superseded_attempt",
      reasonCopy: "A later terminal attempt superseded this historical evidence.",
    });
    const authoritative = makeGateFreshness("dev-review", {
      fresh: true,
      sourceRunId: "RUN-CURRENT",
      sourceArtifactId: "ART-CURRENT",
    });
    const oldArtifact = artifact("ART-OLD", "RUN-OLD", "2026-08-01T12:01:00.000Z");
    const currentArtifact = artifact("ART-CURRENT", "RUN-CURRENT", "2026-08-01T12:02:00.000Z");
    oldArtifact.freshness = superseded;
    currentArtifact.freshness = authoritative;
    const task = createTask({
      candidates: [candidate],
      artifacts: [oldArtifact, currentArtifact],
      runs: [run("RUN-OLD", "ART-OLD", 1, superseded), run("RUN-CURRENT", "ART-CURRENT", 2, authoritative)],
      gateFreshness: { "dev-review": authoritative },
    });

    const oldFreshness = getRuntimeArtifactFreshness(task, oldArtifact);
    const currentFreshness = getRuntimeArtifactFreshness(task, currentArtifact);
    assert.equal(oldFreshness.reasonCode, "superseded_attempt");
    assert.equal(oldFreshness.reasonCopy, "A later terminal attempt superseded this historical evidence.");
    assert.equal(isArtifactFresh(oldArtifact, candidate), false);
    assert.equal(isArtifactFresh(currentArtifact, candidate), true);
    assert.equal(isArtifactFresh(oldArtifact, candidate, oldFreshness), false);
    assert.equal(isArtifactFresh(currentArtifact, candidate, currentFreshness), true);
    assert.equal(
      getRuntimeArtifactFreshness(
        createTask({
          candidates: [candidate],
          artifacts: [oldArtifact],
          runs: [],
          gateFreshness: { "dev-review": authoritative },
        }),
        oldArtifact,
      ).reasonCode,
      "superseded_attempt",
    );
  });
});
