import test from "node:test";
import {
  React,
  assert,
  createTask,
  createViteServer,
  makeGateFreshness,
  renderToStaticMarkup,
} from "./runtime-test-support.mjs";

const packageFixture = (overrides = {}) => ({
  id: "S1",
  title: "Shared contracts",
  description: "Add the typed runtime projection.",
  dependencies: [],
  batch: 1,
  ownedPaths: ["src/contracts.ts"],
  verification: ["npm run typecheck"],
  status: "planned",
  attempts: 0,
  branch: null,
  worktreePath: null,
  baseRevision: null,
  headRevision: null,
  files: [],
  error: null,
  ...overrides,
});

const artifactFixture = (stage, overrides = {}) => ({
  id: `artifact-${stage}`,
  runId: `run-${stage}`,
  stage,
  name: `${stage}.md`,
  kind: "markdown",
  content: `# ${stage}`,
  createdAt: "2026-08-01T12:00:00.000Z",
  model: "gpt-5.6-luna",
  reasoning: "xhigh",
  usage: {
    inputTokens: 800,
    cachedInputTokens: 200,
    outputTokens: 200,
    totalTokens: 1_000,
    cost: 0.01,
  },
  ...overrides,
});

async function withOperatorModules(run) {
  const vite = await createViteServer({
    configFile: false,
    logLevel: "error",
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false },
  });
  try {
    const viewModel = await vite.ssrLoadModule("/src/components/runtime/operatorViewModel.ts");
    const workspace = await vite.ssrLoadModule("/src/components/RuntimeTaskWorkspace.tsx");
    const packageFlow = await vite.ssrLoadModule("/src/components/runtime/RuntimeOperatorPackageFlow.tsx");
    return await run({ ...viewModel, ...workspace, ...packageFlow });
  } finally {
    await vite.close();
  }
}

test("operator view model treats one package as a truthful single-package path", async () => {
  await withOperatorModules(({ buildOperatorViewModel }) => {
    const task = createTask({
      status: "awaiting-plan-approval",
      currentStage: "plan",
      workPackages: [packageFixture()],
    });
    const model = buildOperatorViewModel(task, "plan");
    assert.equal(model.packageBatches.length, 1);
    assert.equal(model.packageBatches[0].packages.length, 1);
    assert.equal(model.facts.find((fact) => fact.label === "Packages")?.detail, "Single-package path.");
  });
});

test("operator package flow renders one honest zero-package state", async () => {
  await withOperatorModules(({ RuntimeOperatorPackageFlow }) => {
    const empty = renderToStaticMarkup(
      React.createElement(RuntimeOperatorPackageFlow, {
        batches: [],
        stageFailed: false,
        stageError: null,
      }),
    );
    const failed = renderToStaticMarkup(
      React.createElement(RuntimeOperatorPackageFlow, {
        batches: [],
        stageFailed: true,
        stageError: "Package plan failed schema validation.",
      }),
    );
    assert.match(empty, /No work packages produced/);
    assert.doesNotMatch(empty, /healthy|qualified/i);
    assert.match(failed, /Package plan unavailable/);
    assert.match(failed, /Package plan failed schema validation/);
  });
});

test("operator package batches retain dependency order and parallel membership", async () => {
  await withOperatorModules(({ groupPackagesByBatch }) => {
    const batches = groupPackagesByBatch([
      packageFixture({ id: "S4", batch: 3, dependencies: ["S2", "S3"] }),
      packageFixture({ id: "S2", batch: 2, dependencies: ["S1"] }),
      packageFixture({ id: "S1", batch: 1 }),
      packageFixture({ id: "S3", batch: 2, dependencies: ["S1"] }),
    ]);
    assert.deepEqual(
      batches.map((batch) => batch.batch),
      [1, 2, 3],
    );
    assert.deepEqual(
      batches[1].packages.map((item) => item.id),
      ["S2", "S3"],
    );
  });
});

test("operator view surfaces package failure and its persisted reason", async () => {
  await withOperatorModules(({ buildOperatorViewModel }) => {
    const task = createTask({
      status: "failed",
      currentStage: "implement",
      error: "Implementation stopped after package qualification failed.",
      workPackages: [
        packageFixture({
          status: "failed",
          attempts: 2,
          error: "The manifest typecheck command failed.",
          worktreePath: "/tmp/retained-s1",
        }),
      ],
    });
    const model = buildOperatorViewModel(task, "implement");
    assert.equal(model.alert?.tone, "red");
    assert.match(model.alert?.detail ?? "", /qualification failed/i);
    assert.equal(model.now.value, "Failed");
  });
});

test("operator package flow retains continuation and requalification evidence", async () => {
  await withOperatorModules(({ RuntimeTaskWorkspace }) => {
    const task = createTask({
      status: "failed",
      currentStage: "implement",
      error: "The retained package exceeded its run allowance.",
      workPackages: [
        packageFixture({
          status: "failed",
          worktreePath: "/tmp/retained-s1",
          retainedForRequalification: true,
          retainedContinuation: {
            requestedAt: "2026-08-01T12:00:00.000Z",
            files: ["src/contracts.ts"],
            outsideOwnership: [],
            qualificationFailure: "npm run typecheck failed",
          },
        }),
      ],
    });
    const noop = async () => {};
    const html = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task,
        initialViewMode: "operator",
        onBack: () => {},
        onRun: noop,
        onCancel: noop,
        onCloseTask: noop,
        onArchiveTask: noop,
        onEvaluate: noop,
        onAction: noop,
        onDecision: noop,
        onGrillAnswer: noop,
        onFinishGrill: noop,
        onRemoveWorktree: noop,
        onProfileChange: noop,
      }),
    );
    assert.match(html, /Retained continuation/);
    assert.match(html, /requalification required: npm run typecheck failed/);
  });
});

test("design comparison and inspector render the task-snapshotted model provenance", async () => {
  await withOperatorModules(({ RuntimeTaskWorkspace }) => {
    const policies = {
      "claude-design": {
        provider: "claude",
        model: "claude-opus-5",
        reasoning: "high",
        provenance: "task-selection",
      },
      "codex-design": {
        provider: "codex",
        model: "gpt-5.6-sol",
        reasoning: "high",
        provenance: "task-selection",
      },
    };
    const task = createTask({
      status: "generating-designs",
      currentStage: "specification",
      designRequest: {
        requested: true,
        status: "generating",
        requestedAt: "2026-08-01T12:00:00.000Z",
        startedAt: "2026-08-01T12:00:01.000Z",
        completedAt: null,
        selectedVariantId: null,
        selectedAt: null,
        selectedBy: null,
        policies,
        error: null,
        variants: Object.entries(policies).map(([generator, policy], index) => ({
          id: `variant-${index + 1}`,
          revision: 1,
          generator,
          provider: policy.provider,
          policy,
          status: "queued",
          title: `${policy.provider} direction`,
          summary: "",
          previewUrl: null,
          externalUrl: null,
          bundleHash: null,
          model: policy.model,
          reasoning: policy.reasoning,
          createdAt: "2026-08-01T12:00:01.000Z",
          completedAt: null,
          error: null,
          usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0 },
          contextManifest: null,
        })),
      },
    });
    const noop = async () => {};
    const html = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task,
        initialViewMode: "evidence",
        onBack: () => {},
        onRun: noop,
        onCancel: noop,
        onCloseTask: noop,
        onArchiveTask: noop,
        onEvaluate: noop,
        onAction: noop,
        onDecision: noop,
        onGrillAnswer: noop,
        onFinishGrill: noop,
        onRemoveWorktree: noop,
        onProfileChange: noop,
        onSelectDesign: noop,
        onRetryDesigns: noop,
      }),
    );
    assert.match(html, /claude-opus-5 · High · task selection/);
    assert.match(html, /gpt-5\.6-sol · High · task selection/);
    assert.match(html, /Exact snapshot retained · no automatic substitution/);
  });
});

test("operator view distinguishes stale gates from gates that never started", async () => {
  await withOperatorModules(({ buildOperatorViewModel }) => {
    const task = createTask({
      status: "repair-required",
      currentStage: "dev-review",
      candidates: [{ id: "C1", revisionNumber: 2, headRevision: "abc12345" }],
      gateFreshness: {
        "dev-review": makeGateFreshness("dev-review", {
          reasonCode: "candidate_superseded",
          reasonCopy: "Candidate revision 2 superseded the reviewed revision.",
        }),
        test: makeGateFreshness("test"),
        "final-review": makeGateFreshness("final-review"),
      },
    });
    const model = buildOperatorViewModel(task, "dev-review");
    assert.deepEqual(
      model.staleGates.map((gate) => gate.stageId),
      ["dev-review"],
    );
    assert.equal(model.alert?.tone, "amber");
    assert.match(model.alert?.detail ?? "", /superseded/i);
  });
});

test("operator state projection covers active, stopped, repair, terminal, and future states", async () => {
  await withOperatorModules(({ buildOperatorViewModel }) => {
    const cases = [
      [{ status: "queued", currentStage: "triage" }, "Queued"],
      [{ status: "running", currentStage: "triage", activeRunKind: "triage" }, "Running"],
      [{ status: "cancelling", currentStage: "triage" }, "Cancelling"],
      [
        {
          status: "blocked",
          currentStage: "triage",
          blocker: { code: "authority", detail: "Revision changed.", detectedAt: "2026-08-01T12:00:00.000Z" },
        },
        "Blocked",
      ],
      [{ status: "failed", currentStage: "triage", error: "Agent failed." }, "Failed"],
      [{ status: "cancelled", currentStage: "triage", error: "Operator cancelled." }, "Cancelled"],
      [{ status: "repair-required", currentStage: "implement" }, "Repair required"],
      [{ status: "completed", currentStage: "approval" }, "Completed"],
      [{ status: "closed", currentStage: "approval" }, "Closed"],
      [{ status: "archived", currentStage: "approval" }, "Archived"],
    ];
    for (const [overrides, expected] of cases) {
      const task = createTask(overrides);
      const model = buildOperatorViewModel(task, task.currentStage);
      assert.equal(model.now.value, expected);
    }

    const future = buildOperatorViewModel(
      createTask({ status: "awaiting-plan-approval", currentStage: "plan" }),
      "approval",
    );
    assert.equal(future.temporalState, "future");
    assert.equal(future.now.value, "Not started");
  });
});

test("every workflow stage has a concise real-state signal", async () => {
  await withOperatorModules(({ buildOperatorViewModel }) => {
    const stages = [
      "triage",
      "scouts",
      "grill",
      "specification",
      "plan",
      "implement",
      "dev-review",
      "test",
      "final-review",
      "approval",
    ];
    const task = createTask({ status: "awaiting-human-approval", currentStage: "approval" });
    for (const stageId of stages) {
      const model = buildOperatorViewModel(task, stageId);
      assert.equal(model.now.key, "now");
      assert.equal(model.next.key, "next");
      assert.ok(model.signals.length >= 1 && model.signals.length <= 3);
      assert.equal(model.facts.length, 3);
      assert.ok(model.summary.title);
    }
  });
});

test("a direct future-stage route remains inert and resolves to the current stage", async () => {
  await withOperatorModules(({ RuntimeTaskWorkspace }) => {
    const task = createTask({ status: "queued", currentStage: "triage" });
    const noop = async () => {};
    const html = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task,
        initialViewMode: "operator",
        initialViewedStageId: "plan",
        onBack: () => {},
        onRun: noop,
        onCancel: noop,
        onCloseTask: noop,
        onArchiveTask: noop,
        onEvaluate: noop,
        onAction: noop,
        onDecision: noop,
        onGrillAnswer: noop,
        onFinishGrill: noop,
        onRemoveWorktree: noop,
        onProfileChange: noop,
      }),
    );
    assert.match(html, /Triage is not ready yet/);
    assert.doesNotMatch(html, /Implementation plan is not ready yet/);
  });
});

test("final review summarizes every prior stage with recorded usage and no invented cost", async () => {
  await withOperatorModules(({ buildOperatorFinalReviewRows, RuntimeTaskWorkspace }) => {
    const artifacts = [
      artifactFixture("triage"),
      artifactFixture("specification", {
        usage: {
          inputTokens: 400,
          cachedInputTokens: 0,
          outputTokens: 100,
          totalTokens: 500,
          cost: null,
        },
      }),
    ];
    const task = createTask({
      status: "ready-for-final-review",
      currentStage: "final-review",
      completedStages: ["triage", "scouts", "grill", "specification", "plan", "implement"],
      artifacts,
    });
    const rows = buildOperatorFinalReviewRows(task);
    assert.equal(rows.length, 8);
    assert.equal(rows[0].tokens, 1_000);
    assert.equal(rows[0].apiEstimate, 0.01);
    assert.equal(rows.find((row) => row.stageId === "specification")?.apiEstimate, null);

    const noop = async () => {};
    const html = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task,
        initialViewMode: "operator",
        onBack: () => {},
        onRun: noop,
        onCancel: noop,
        onCloseTask: noop,
        onArchiveTask: noop,
        onEvaluate: noop,
        onAction: noop,
        onDecision: noop,
        onGrillAnswer: noop,
        onFinishGrill: noop,
        onRemoveWorktree: noop,
        onProfileChange: noop,
      }),
    );
    assert.match(html, /Every prior stage/);
    assert.match(html, /API-rate estimate/);
    assert.match(html, /API-rate estimate[^<]*partial/);
    assert.doesNotMatch(html, /<span>Unavailable<\/span>/);
  });
});

test("calm briefing omits neutral health and uses the command bar as the only next-action region", async () => {
  await withOperatorModules(({ RuntimeTaskWorkspace }) => {
    const task = createTask({
      status: "awaiting-plan-approval",
      currentStage: "plan",
      workPackages: [packageFixture()],
    });
    const noop = async () => {};
    const html = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task,
        initialViewMode: "operator",
        onBack: () => {},
        onRun: noop,
        onCancel: noop,
        onCloseTask: noop,
        onArchiveTask: noop,
        onEvaluate: noop,
        onAction: noop,
        onDecision: noop,
        onGrillAnswer: noop,
        onFinishGrill: noop,
        onRemoveWorktree: noop,
        onProfileChange: noop,
      }),
    );
    assert.match(html, />Now</);
    assert.match(html, />Output</);
    assert.doesNotMatch(html, /No recorded issue/);
    assert.equal((html.match(/Approve the dependency-ordered plan/g) ?? []).length, 1);
  });
});

test("approval renders one decision receipt with exact candidate, target, gates, and PR state", async () => {
  await withOperatorModules(({ RuntimeTaskWorkspace }) => {
    const task = createTask({
      status: "awaiting-human-approval",
      currentStage: "approval",
      candidates: [
        {
          id: "C2",
          revisionNumber: 1,
          headRevision: "abc12345def",
          baseBranch: "main",
          revisions: [],
        },
      ],
      gateFreshness: {
        "dev-review": makeGateFreshness("dev-review", {
          fresh: true,
          candidateId: "C2",
          candidateRevision: 1,
        }),
        test: makeGateFreshness("test", { fresh: true, candidateId: "C2", candidateRevision: 1 }),
        "final-review": makeGateFreshness("final-review", {
          fresh: true,
          candidateId: "C2",
          candidateRevision: 1,
        }),
      },
    });
    const noop = async () => {};
    const html = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task,
        initialViewMode: "operator",
        onBack: () => {},
        onRun: noop,
        onCancel: noop,
        onCloseTask: noop,
        onArchiveTask: noop,
        onEvaluate: noop,
        onAction: noop,
        onDecision: noop,
        onGrillAnswer: noop,
        onFinishGrill: noop,
        onRemoveWorktree: noop,
        onProfileChange: noop,
      }),
    );
    assert.match(html, /Decision receipt/);
    assert.match(html, /C2 r1/);
    assert.match(html, /Exact head abc12345 · target branch main/);
    assert.match(html, /3 \/ 3/);
    assert.match(html, /Pull request/);
  });
});

test("operator error matrix preserves exact target, PR, and merge reconciliation failures", async () => {
  await withOperatorModules(({ buildOperatorViewModel }) => {
    const cases = [
      {
        blocker: {
          code: "target-diverged",
          detail: "Target main moved from abc123 to def456.",
          detectedAt: "2026-08-01T12:00:00.000Z",
        },
        action: "refresh-candidate",
        expected: /Target main moved/,
      },
      {
        blocker: {
          code: "pull-request-identity-drift",
          detail: "PR #42 now points at a different head branch.",
          detectedAt: "2026-08-01T12:00:00.000Z",
        },
        action: "reconcile-pr",
        expected: /different head branch/,
      },
      {
        blocker: {
          code: "merge-reconciliation",
          detail: "The recorded merge commit is not on the target branch.",
          detectedAt: "2026-08-01T12:00:00.000Z",
        },
        action: "reconcile-merge",
        expected: /not on the target branch/,
        mergeIntent: { status: "failed" },
      },
    ];
    for (const item of cases) {
      const task = createTask({
        status: "blocked",
        currentStage: "approval",
        blocker: item.blocker,
        mergeIntent: item.mergeIntent,
        actionEligibility: {
          generatedAt: "2026-08-01T12:00:00.000Z",
          actions: { [item.action]: { allowed: true, reason: null } },
        },
      });
      const model = buildOperatorViewModel(task, "approval");
      assert.match(model.alert?.detail ?? "", item.expected);
    }
  });
});

test("read-only Evidence hides or disables every mutation surface", async () => {
  await withOperatorModules(({ RuntimeTaskWorkspace }) => {
    const task = createTask({
      status: "blocked",
      currentStage: "approval",
      worktreeInventory: [
        {
          id: "candidate-C1",
          kind: "candidate",
          label: "Candidate C1",
          worktreePath: "/tmp/candidate-c1",
          branch: "candidate/c1",
          baseRevision: "base123",
          headRevision: "head123",
          taskId: "AH-999",
          workPackageId: null,
          lifecycleState: "retained",
          gitExists: true,
          gitHeadRevision: "head123",
          gitClean: true,
          retainedRequired: false,
          cleanupReady: true,
        },
      ],
    });
    const noop = async () => {};
    const html = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task,
        readOnlyPreview: true,
        initialViewMode: "evidence",
        initialSelectedWorktreeId: "candidate-C1",
        onBack: () => {},
        onRun: noop,
        onCancel: noop,
        onCloseTask: noop,
        onArchiveTask: noop,
        onEvaluate: noop,
        onAction: noop,
        onDecision: noop,
        onGrillAnswer: noop,
        onFinishGrill: noop,
        onRemoveWorktree: noop,
        onProfileChange: noop,
      }),
    );
    assert.match(html, /Prototype fixture · read-only/);
    assert.match(html, /Hosted preview is read-only/);
    assert.match(html, /Remove worktree/);
    assert.doesNotMatch(html, /Record decision/);
  });
});

test("real task workspace defaults to Operator and retains Evidence as a switchable view", async () => {
  await withOperatorModules(({ RuntimeTaskWorkspace }) => {
    const task = createTask({
      status: "awaiting-plan-approval",
      currentStage: "plan",
      workPackages: [packageFixture()],
    });
    const noop = async () => {};
    const html = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task,
        initialViewMode: "operator",
        onBack: () => {},
        onRun: noop,
        onCancel: noop,
        onCloseTask: noop,
        onArchiveTask: noop,
        onEvaluate: noop,
        onAction: noop,
        onDecision: noop,
        onGrillAnswer: noop,
        onFinishGrill: noop,
        onRemoveWorktree: noop,
        onProfileChange: noop,
        onLoadMoreArtifacts: noop,
        onLoadArtifact: noop,
      }),
    );
    assert.match(html, /Operator briefing/);
    assert.match(html, /Single work package/);
    assert.match(html, /aria-pressed="true">Operator/);
    assert.match(html, /aria-pressed="false">Evidence/);
    assert.doesNotMatch(html, /universal task inspector/i);
  });
});
