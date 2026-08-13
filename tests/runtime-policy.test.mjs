import test from "node:test";
import {
  assert,
  attachRepairAuthorizerFixture,
  buildRepairRequest,
  buildStageRequest,
  createTask,
  JsonTaskStore,
  makeGateFreshness,
  mkdtemp,
  normalizeModelId,
  os,
  parseGateEvidence,
  path,
  priceUsage,
  React,
  renderToStaticMarkup,
  rm,
  runtimeTaskToRecentTask,
  TaskOrchestrator,
  waitUntil,
  withWorkspace,
} from "./runtime-test-support.mjs";

test("calculates an API-rate estimate after cached-input discounts", () => {
  assert.equal(normalizeModelId("GPT-5.4-mini \u00b7 ChatGPT plan"), "gpt-5.4-mini");
  assert.equal(
    priceUsage("gpt-5.6-sol", {
      inputTokens: 1_000,
      cachedInputTokens: 800,
      cacheWriteTokens: 0,
      outputTokens: 500,
    }),
    0.0164,
  );
});

test("planning corrections receive the retained qualification failure and affected ownership", () => {
  const task = createTask({
    status: "blocked",
    currentStage: "plan",
    error: "S1 did not qualify: backend-test failed in tests/unit/test_contract.py.",
    workPackages: [
      {
        id: "S1",
        status: "failed",
        error: "tests/unit/test_contract.py expected the old response schema",
        ownedPaths: ["backend/router.py"],
        verificationCommandIds: ["backend-test"],
      },
    ],
  });
  const request = buildStageRequest(task, "plan");
  assert.match(request.prompt, /Retained plan-correction evidence/);
  assert.match(request.prompt, /tests\/unit\/test_contract\.py/);
  assert.match(request.prompt, /Explicitly own every source or test path/);
  assert.match(request.prompt, /smallest focused manifest commands/);
  assert.match(request.prompt, /Every package, including documentation-only or configuration-only packages/);
  assert.match(request.prompt, /never emit an empty array or None/);
});

test("repair requests carry complete typed gate findings and current-candidate repair lineage", () => {
  const completeDetail = `Complete persisted finding detail.\n${"D".repeat(8_000)}`;
  const newestFindings = [
    {
      severity: "P1",
      title: "Newest gate finding",
      detail: completeDetail,
      file: "server/orchestrator.mjs",
      line: 453,
      blocking: true,
      acceptanceCriterion: "The complete repair detail is retained.",
      reproductionEvidence: "Inspect the persisted current-candidate Test gate result.",
      candidateId: "C1",
      candidateRevision: 3,
      bindingExplicit: true,
    },
    {
      severity: "P2",
      title: "Second newest finding",
      detail: "Retain every finding, not only the first one.",
      file: null,
      line: null,
      blocking: false,
      acceptanceCriterion: null,
      reproductionEvidence: null,
      candidateId: "C1",
      candidateRevision: 3,
      bindingExplicit: true,
    },
  ];
  const task = createTask({
    artifacts: [
      {
        id: "spec",
        stage: "specification",
        name: "task-specification.md",
        content: "Approved specification.",
      },
      { id: "plan", stage: "plan", name: "implementation-plan.md", content: "Approved plan." },
      {
        id: "implementation",
        stage: "implement",
        name: "implementation-candidate.md",
        content: "Candidate summary.",
      },
      { id: "review", stage: "dev-review", name: "dev-review.md", content: "MISLEADING OLD REVIEW PROSE" },
      { id: "test", stage: "test", name: "test-evidence.md", content: "M".repeat(7_000) },
    ],
    runs: [
      {
        id: "run-old-review",
        stage: "dev-review",
        status: "completed",
        candidateId: "C1",
        candidateRevision: 3,
        gateResult: {
          stage: "dev-review",
          candidateId: "C1",
          candidateRevision: 3,
          verdict: "REPAIR",
          findings: [
            {
              severity: "P1",
              title: "Older finding",
              detail: "Do not select this gate.",
              file: "old.js",
              line: 1,
            },
          ],
        },
      },
      {
        id: "run-new-test",
        stage: "test",
        status: "completed",
        candidateId: "C1",
        candidateRevision: 3,
        test: {
          status: "failed",
          rows: [
            {
              id: "playwright-e2e",
              title: "Real browser suite",
              command: "make e2e-native",
              exitCode: 2,
              status: "failed",
              failureDetails:
                "TypeError: response.request is not a function at e2e/tests/04-upload.spec.ts:355",
              assertions: [
                {
                  label: "playwright-json report",
                  actual: "2 unexpected",
                  expected: "no unexpected or flaky results",
                },
              ],
              artifactReferences: [
                {
                  name: "playwright-e2e report",
                  kind: "playwright-json",
                  path: "e2e/playwright-report/results.json",
                },
              ],
            },
          ],
        },
        gateResult: {
          stage: "test",
          candidateId: "C1",
          candidateRevision: 3,
          verdict: "REPAIR",
          findings: newestFindings,
          blockingReasons: ["Typed failure"],
        },
      },
    ],
  });
  const candidate = {
    id: "C1",
    revisionNumber: 3,
    baseRevision: "a".repeat(40),
    headRevision: "c".repeat(40),
    revisions: [
      { number: 1, headRevision: "a".repeat(40), reason: "assembly" },
      {
        number: 2,
        headRevision: "b".repeat(40),
        reason: "repair",
        requestedFindings: [
          {
            severity: "P1",
            title: "Prior repair",
            detail: "Already attempted.",
            file: "old.js",
            line: 7,
            blocking: true,
            acceptanceCriterion: null,
            reproductionEvidence: null,
          },
        ],
      },
      {
        number: 3,
        headRevision: "c".repeat(40),
        reason: "repair",
        requestedFindings: [
          {
            severity: "P2",
            title: "Second prior repair",
            detail: "Keep this lineage.",
            file: null,
            line: null,
            blocking: false,
            acceptanceCriterion: null,
            reproductionEvidence: null,
          },
        ],
      },
    ],
  };

  const request = buildRepairRequest(task, candidate);
  const evidenceMatch = request.prompt.match(/<repair-evidence>\s*([\s\S]*?)\s*<\/repair-evidence>/);
  assert.ok(evidenceMatch, "repair prompt includes a structured evidence envelope");
  const evidence = JSON.parse(evidenceMatch[1]);
  assert.deepEqual(evidence.activeCandidate, { id: "C1", revisionNumber: 3, headRevision: "c".repeat(40) });
  assert.equal(evidence.newestFailingGate.runId, "run-new-test");
  assert.equal(evidence.newestFailingGate.stage, "test");
  assert.deepEqual(evidence.newestFailingGate.gateResult.findings, newestFindings);
  assert.equal(evidence.newestFailingGate.gateResult.findings[0].detail, completeDetail);
  assert.deepEqual(evidence.newestFailingGate.failedTestRows, [
    {
      id: "playwright-e2e",
      title: "Real browser suite",
      command: "make e2e-native",
      exitCode: 2,
      status: "failed",
      failureDetails: "TypeError: response.request is not a function at e2e/tests/04-upload.spec.ts:355",
      assertions: [
        {
          label: "playwright-json report",
          actual: "2 unexpected",
          expected: "no unexpected or flaky results",
        },
      ],
      artifactReferences: [
        {
          name: "playwright-e2e report",
          kind: "playwright-json",
          path: "e2e/playwright-report/results.json",
        },
      ],
    },
  ]);
  assert.match(request.prompt, /an empty blockingFindings list is not evidence for a no-op/);
  assert.deepEqual(evidence.repairLineage, [
    { number: 1, headRevision: "a".repeat(40), reason: "assembly" },
    {
      number: 2,
      headRevision: "b".repeat(40),
      reason: "repair",
      requestedFindings: [
        {
          kind: "candidate-defect",
          severity: "P1",
          title: "Prior repair",
          detail: "Already attempted.",
          file: "old.js",
          line: 7,
          blocking: true,
          acceptanceCriterion: null,
          reproductionEvidence: null,
        },
      ],
    },
    {
      number: 3,
      headRevision: "c".repeat(40),
      reason: "repair",
      requestedFindings: [
        {
          kind: "candidate-defect",
          severity: "P2",
          title: "Second prior repair",
          detail: "Keep this lineage.",
          file: null,
          line: null,
          blocking: false,
          acceptanceCriterion: null,
          reproductionEvidence: null,
        },
      ],
    },
  ]);
  assert.equal(request.contextManifest.promptCharacters, request.prompt.length);
  assert.equal(
    request.contextManifest.sources.find((source) => source.kind === "structured-evidence").truncated,
    false,
  );
  assert.equal(request.contextManifest.sources.find((source) => source.id === "test").truncated, true);

  const changedMarkdown = buildRepairRequest(
    {
      ...task,
      artifacts: task.artifacts.map((artifact) => ({
        ...artifact,
        content: "A DIFFERENT MISLEADING ARTIFACT",
      })),
    },
    candidate,
  );
  assert.deepEqual(
    changedMarkdown.repairEvidence,
    request.repairEvidence,
    "typed repair evidence is independent of Markdown prose",
  );
});

test("persists typed findings requested by the gate on each repair revision", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-repair-findings-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Persist repair findings",
      description: "Retain the typed evidence that authorized a repair.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
    });
    const findings = [
      {
        severity: "P1",
        title: "Persist this finding",
        detail: "The repair must retain this exact detail.",
        file: "server/prompts.mjs",
        line: 241,
        blocking: true,
        acceptanceCriterion: "The repair must retain the exact finding.",
        reproductionEvidence: "Inspect the exact candidate gate result persisted before repair.",
        candidateId: "C1",
        candidateRevision: 1,
        bindingExplicit: true,
      },
    ];
    await store.update(task.id, (draft) => {
      draft.status = "repair-required";
      draft.currentStage = "dev-review";
      draft.stageRunLimits = { implement: 2, "dev-review": 3, test: 3, "final-review": 3 };
      draft.candidates = [
        {
          id: "C1",
          revisionNumber: 1,
          baseRevision: "a".repeat(40),
          headRevision: "b".repeat(40),
          branch: "agent-harness/repair-findings-c1",
          repositoryRoot: directory,
          worktreePath: directory,
          status: "repair_required",
          revisions: [{ number: 1, headRevision: "b".repeat(40), reason: "assembly" }],
        },
      ];
      attachRepairAuthorizerFixture(draft, draft.candidates[0], findings);
    });
    let repairPrompt = "";
    const orchestrator = new TaskOrchestrator(store, {
      getStatus: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
      runCodex: async ({ prompt }) => {
        repairPrompt = prompt;
        return {
          finalText: "## Outcome\n\nRepaired",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      },
      worktreeManager: {
        verifyCandidate: async () => {},
        commit: async () => ({
          headRevision: "c".repeat(40),
          files: ["server/prompts.mjs"],
          summary: "1 file changed",
        }),
      },
    });

    assert.equal(await orchestrator.start(task.id, "repair"), true);
    await waitUntil(() => !orchestrator.isRunning(task.id));
    const repaired = await store.get(task.id);
    assert.deepEqual(repaired.candidates[0].revisions[1].requestedFindings, [
      {
        kind: "candidate-defect",
        severity: "P1",
        title: "Persist this finding",
        detail: "The repair must retain this exact detail.",
        file: "server/prompts.mjs",
        line: 241,
        blocking: true,
        acceptanceCriterion: "The repair must retain the exact finding.",
        reproductionEvidence: "Inspect the exact candidate gate result persisted before repair.",
      },
    ]);
    assert.match(repairPrompt, /<repair-evidence>/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("preserves complete parsed gate findings through persistence and the repair request", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-complete-repair-findings-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Complete repair findings",
      description: "Retain oversized typed findings without using Markdown artifacts as evidence.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
    });
    const candidate = {
      id: "C1",
      revisionNumber: 1,
      baseRevision: "a".repeat(40),
      headRevision: "b".repeat(40),
      branch: "agent-harness/complete-findings-c1",
      repositoryRoot: directory,
      worktreePath: directory,
      status: "repair_required",
      revisions: [{ number: 1, headRevision: "b".repeat(40), reason: "assembly" }],
    };
    const title = `Oversized title ${"t".repeat(600)}`;
    const detail = `Complete detail ${"d".repeat(8_000)}`;
    const file = `nested/${"f".repeat(1_100)}.mjs`;
    const gateResult = parseGateEvidence(
      `<gate-evidence>${JSON.stringify({
        candidateId: "C1",
        candidateRevision: 1,
        verdict: "REPAIR",
        summary: "Typed gate result",
        findings: [
          {
            kind: "candidate-defect",
            severity: "P1",
            title,
            detail,
            file,
            line: 209,
            blocking: true,
            acceptanceCriterion: "All blocking finding fields survive persistence.",
            reproductionEvidence: "Parse, persist, and rebuild the exact candidate repair request.",
            candidateId: "C1",
            candidateRevision: 1,
          },
        ],
      })}</gate-evidence>`,
      candidate,
      "dev-review",
    );
    await store.update(task.id, (draft) => {
      draft.status = "repair-required";
      draft.currentStage = "dev-review";
      draft.candidates = [candidate];
      draft.artifacts = [
        {
          id: "misleading-review",
          stage: "dev-review",
          name: "dev-review.md",
          kind: "markdown",
          content: "DIFFERENT TRUNCATED MARKDOWN CONTENT",
        },
      ];
      draft.runs = [
        {
          id: "run-complete-findings",
          kind: "review",
          stage: "dev-review",
          status: "completed",
          candidateId: "C1",
          candidateRevision: 1,
          gateResult,
        },
      ];
    });

    const persisted = await store.get(task.id);
    const request = buildRepairRequest(persisted, persisted.candidates[0]);
    const finding = request.repairEvidence.newestFailingGate.gateResult.findings[0];
    assert.equal(finding.title, title);
    assert.equal(finding.detail, detail);
    assert.equal(finding.file, file);
    assert.equal(finding.line, 209);
    assert.equal(request.prompt.includes(detail), true);
    assert.equal(
      request.contextManifest.sources.find((source) => source.kind === "structured-evidence").truncated,
      false,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("persists tasks and recovers interrupted runs", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-store-"));
  try {
    const filePath = path.join(directory, "tasks.json");
    const store = new JsonTaskStore(filePath);
    await store.init();
    const task = await store.create({
      title: "Inspect auth",
      description: "Confirm the runtime uses ChatGPT login.",
      repositoryPath: directory,
      workflow: "investigate",
      priority: "medium",
    });
    await store.update(task.id, (draft) => {
      draft.status = "running";
    });
    const reloaded = new JsonTaskStore(filePath);
    await reloaded.init();
    const recovered = await reloaded.get(task.id);
    assert.equal(recovered.status, "failed");
    assert.match(recovered.error, /stopped while this task was running/i);
    assert.equal(recovered.stageRunLimits.triage, 4, "a harness restart preserves the human retry allowance");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("cancellation wins when an implementation agent completes after abort", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-cancel-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Cancel race",
      description: "Do not commit a result returned after cancellation.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
    });
    await store.update(task.id, (draft) => {
      draft.status = "ready-for-implementation";
      draft.currentStage = "implement";
      draft.workPackages = [
        {
          id: "S1",
          title: "Cancel race",
          description: "Exercise cancellation.",
          dependencies: [],
          batch: 1,
          ownedPaths: ["feature.txt"],
          verification: [],
          verificationCommandIds: ["test"],
          status: "planned",
          attempts: 0,
          branch: null,
          worktreePath: null,
          baseRevision: null,
          headRevision: null,
          files: [],
          error: null,
        },
      ];
    });

    let finishAgent;
    let commitCalled = false;
    const candidate = {
      id: "C1",
      revisionNumber: 1,
      baseRevision: "base",
      baseBranch: "main",
      headRevision: null,
      branch: "agent-harness/cancel-race",
      repositoryRoot: directory,
      worktreePath: directory,
      status: "implementing",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      revisions: [],
    };
    const orchestrator = new TaskOrchestrator(store, {
      runCodex: () =>
        new Promise((resolve) => {
          finishAgent = () =>
            resolve({
              finalText:
                "## Outcome\nDone\n## Changes\nScoped\n## Verification\nFocused\n## Remaining risks\nNone",
              usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
            });
        }),
      worktreeManager: {
        base: async () => ({ repositoryRoot: directory, baseRevision: "base", baseBranch: "main" }),
        prepare: async () => structuredClone(candidate),
        commit: async () => {
          commitCalled = true;
          return { headRevision: "head", files: ["feature.txt"], summary: "", diff: "" };
        },
      },
    });

    assert.equal(await orchestrator.start(task.id, "implementation"), true);
    await waitUntil(() => typeof finishAgent === "function");
    assert.equal(await orchestrator.cancel(task.id), true);
    assert.equal((await store.get(task.id)).status, "cancelling");
    assert.equal(await orchestrator.start(task.id, "implementation"), false);
    finishAgent();
    await waitUntil(() => !orchestrator.isRunning(task.id));

    const cancelled = await store.get(task.id);
    assert.equal(cancelled.status, "cancelled");
    assert.equal(cancelled.candidates.length, 0);
    assert.equal(cancelled.workPackages[0].status, "failed");
    assert.equal(commitCalled, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("resolves selected Repository scouts by fallback identity and shares the aggregate across surfaces", () => {
  return withWorkspace(
    async ({ AgentsScreen, RuntimeTaskWorkspace, SkillsScreen, resolveScoutUsage, stageUsage }) => {
      const scoutArtifact = ({
        id,
        name,
        agentRole = null,
        runId = null,
        inputTokens,
        cachedInputTokens,
        cacheWriteTokens = 0,
        outputTokens,
        totalTokens,
        cost,
        credits,
      }) => ({
        id,
        runId,
        stage: "scouts",
        kind: "markdown",
        name,
        content: `# ${name}`,
        createdAt: "2026-08-01T12:00:00.000Z",
        model: "gpt-5.6-luna",
        reasoning: "xhigh",
        agentRole,
        usage: {
          inputTokens,
          cachedInputTokens,
          cacheWriteTokens,
          outputTokens,
          totalTokens,
          cost,
          credits,
        },
      });
      const selected = [
        {
          name: "scout-code-path",
          focus: "Trace the historical route.",
          reason: "The route identity is only retained on its run.",
          status: "complete",
        },
        {
          name: "scout-pattern",
          focus: "Compare the nearby patterns.",
          reason: "Check the overlapping historical identity.",
          status: "complete",
        },
        {
          name: "scout-schema",
          focus: "Trace the persisted boundary.",
          reason: "The report name is the only retained identity.",
          status: "complete",
        },
        {
          name: "scout-user-journey",
          focus: "Walk the operator journey.",
          reason: "The current role identifies this report.",
          status: "complete",
        },
        {
          name: "scout-test-inventory",
          focus: "Find focused coverage.",
          reason: "No historical report was retained.",
          status: "queued",
        },
      ];
      const overlapMatchedByRun = scoutArtifact({
        id: "historical-code",
        name: "historical-code-report.md",
        agentRole: "scout-pattern",
        runId: "RUN-CODE-HISTORY",
        inputTokens: 100,
        cachedInputTokens: 40,
        cacheWriteTokens: 5,
        outputTokens: 20,
        totalTokens: 120,
        cost: 1.1,
        credits: 0.4,
      });
      const runMatched = scoutArtifact({
        id: "historical-code-run",
        name: "historical-code-run.md",
        runId: "RUN-CODE-HISTORY",
        inputTokens: 60,
        cachedInputTokens: 20,
        outputTokens: 10,
        totalTokens: 70,
        cost: 0.6,
        credits: 0.2,
      });
      const roleMatchedSchema = scoutArtifact({
        id: "historical-schema-current",
        name: "historical-schema-current.md",
        agentRole: "scout-schema",
        inputTokens: 25,
        cachedInputTokens: 5,
        outputTokens: 5,
        totalTokens: 30,
        cost: 0.3,
        credits: 0.1,
      });
      const nameMatched = scoutArtifact({
        id: "historical-schema",
        name: "scout-schema.md",
        inputTokens: 200,
        cachedInputTokens: 50,
        outputTokens: 30,
        totalTokens: 230,
        cost: 2.2,
        credits: 0.7,
      });
      const nameMatchedRetry = scoutArtifact({
        id: "historical-schema-retry",
        name: "scout-schema.md",
        inputTokens: 50,
        cachedInputTokens: 10,
        outputTokens: 5,
        totalTokens: 55,
        cost: 0.5,
        credits: 0.2,
      });
      const roleMatched = scoutArtifact({
        id: "historical-journey",
        name: "legacy-journey-report.md",
        agentRole: "scout-user-journey",
        inputTokens: 300,
        cachedInputTokens: 100,
        outputTokens: 40,
        totalTokens: 340,
        cost: null,
        credits: null,
      });
      const handoff = scoutArtifact({
        id: "repository-handoff",
        name: "artifacts/repository-scout.md",
        agentRole: "scout-schema",
        runId: "RUN-HANDOFF-LIKE",
        inputTokens: 9_000,
        cachedInputTokens: 8_000,
        outputTokens: 7_000,
        totalTokens: 16_000,
        cost: 99,
        credits: 50,
      });
      const task = createTask({
        currentStage: "scouts",
        status: "awaiting-grill",
        completedStages: ["triage", "scouts"],
        scoutDispatch: {
          selected,
          skipped: ["scout-dependency"],
          rationale: "Triage retained the smallest evidence set needed for this task.",
          createdAt: "2026-08-01T11:59:00.000Z",
          completedAt: "2026-08-01T12:01:00.000Z",
        },
        runs: [{ id: "RUN-CODE-HISTORY", stage: "scouts", role: "scout-code-path", artifactId: null }],
        // Deliberately scrambled: resolution must follow dispatch order, not artifact order.
        artifacts: [
          roleMatched,
          nameMatched,
          overlapMatchedByRun,
          nameMatchedRetry,
          runMatched,
          roleMatchedSchema,
          handoff,
        ],
      });

      const resolved = resolveScoutUsage(task);
      assert.deepEqual(
        resolved.perScout.map((entry) => entry.scout.name),
        selected.map((scout) => scout.name),
      );
      assert.deepEqual(
        resolved.perScout.map((entry) => entry.matchedBy),
        ["run-id", "agent-role", "agent-role", "agent-role", null],
      );
      assert.deepEqual(
        resolved.perScout.map((entry) => entry.state),
        ["matched", "matched", "matched", "matched", "unmatched"],
      );
      assert.deepEqual(
        resolved.perScout.map((entry) => entry.usage.totalTokens),
        [70, 120, 315, 340, 0],
      );
      assert.deepEqual(
        resolved.matchedArtifacts.map((artifact) => artifact.id),
        [
          "historical-code-run",
          "historical-code",
          "historical-schema-current",
          "historical-schema",
          "historical-schema-retry",
          "historical-journey",
        ],
      );
      assert.deepEqual(
        resolved.unmatched.map((entry) => entry.scout.name),
        ["scout-test-inventory"],
      );
      assert.equal(resolved.aggregate.runs, 6);
      assert.equal(resolved.aggregate.inputTokens, 735);
      assert.equal(resolved.aggregate.cachedInputTokens, 225);
      assert.equal(resolved.aggregate.cacheWriteTokens, 5);
      assert.equal(resolved.aggregate.outputTokens, 110);
      assert.equal(resolved.aggregate.totalTokens, 845);
      assert.equal(resolved.aggregate.cost, 4.7);
      assert.equal(resolved.aggregate.credits, 1.6);
      assert.equal(
        resolveScoutUsage(task).matchedArtifacts.filter((artifact) => artifact.id === "historical-code")
          .length,
        1,
      );
      assert.equal(
        resolveScoutUsage(task).matchedArtifacts.some((artifact) => artifact.id === handoff.id),
        false,
      );

      const parentUsage = stageUsage([task], "scouts");
      assert.equal(parentUsage.runs, 6);
      assert.equal(parentUsage.inputTokens, 735);
      assert.equal(parentUsage.outputTokens, 110);
      assert.equal(parentUsage.cost, 4.7);
      assert.deepEqual(
        parentUsage.artifacts.map((artifact) => artifact.id),
        [
          "historical-code-run",
          "historical-code",
          "historical-schema-current",
          "historical-schema",
          "historical-schema-retry",
          "historical-journey",
        ],
      );
      assert.equal(stageUsage([task], "scout-pattern").runs, 1);
      assert.equal(stageUsage([task], "scout-code-path").runs, 1);

      const workspaceMarkup = renderToStaticMarkup(
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
      assert.match(workspaceMarkup, /5 dispatched · 1 skipped · 735 in \/ 110 out/);
      assert.match(workspaceMarkup, /scout-code-path/);
      assert.match(workspaceMarkup, /60 in · 10 out/);
      assert.match(workspaceMarkup, /scout-pattern/);
      assert.match(workspaceMarkup, /100 in · 20 out/);
      assert.match(workspaceMarkup, /scout-schema/);
      assert.match(workspaceMarkup, /275 in · 40 out/);
      assert.match(workspaceMarkup, /scout-user-journey/);
      assert.match(workspaceMarkup, /300 in · 40 out/);
      assert.equal(workspaceMarkup.match(/0 in · 0 out · No recorded child scout run/g)?.length, 1);
      const renderedScoutPositions = selected.map((scout) =>
        workspaceMarkup.indexOf(`<strong>${scout.name}</strong>`),
      );
      assert.equal(
        renderedScoutPositions.every(
          (position, index) => index === 0 || position > renderedScoutPositions[index - 1],
        ),
        true,
      );
      assert.match(workspaceMarkup, /Downstream handoff · deterministic aggregation/);
      assert.match(workspaceMarkup, /Inputs: child scout reports \(6 retained\); no additional model call/);
      assert.match(workspaceMarkup, /Stage telemetry/);
      assert.match(workspaceMarkup, /735 input · 225 cached · 110 output/);
      assert.match(workspaceMarkup, /Viewed downstream handoff/);
      assert.match(workspaceMarkup, /Child scout reports/);
      assert.match(workspaceMarkup, /Child scout runs/);
      assert.match(workspaceMarkup, /6 recorded/);
      assert.doesNotMatch(workspaceMarkup, /Viewed agent run/);

      const skillsMarkup = renderToStaticMarkup(
        React.createElement(SkillsScreen, {
          runtimeTasks: [task],
          selectedId: "scouts",
          onSelect: () => {},
        }),
      );
      assert.match(skillsMarkup, /Recorded model runs<\/span><strong>6<\/strong>/);
      assert.match(skillsMarkup, /Recorded tokens<\/span><strong>845<\/strong>/);
      assert.match(skillsMarkup, /Approx\. API-rate cost<\/span><strong>\$4\.70<\/strong>/);

      const runtimeStatus = {
        model: "gpt-5.6-luna",
        reasoning: "xhigh",
        settings: {
          allowedModels: ["gpt-5.6-luna"],
          defaultModel: "gpt-5.6-luna",
          defaultReasoning: "xhigh",
          stagePolicies: { scouts: { model: "gpt-5.6-luna", reasoning: "xhigh" } },
        },
      };
      const agentsMarkup = renderToStaticMarkup(
        React.createElement(AgentsScreen, {
          runtimeTasks: [task],
          runtimeStatus,
          selectedId: "scouts",
          onSelect: () => {},
          onSave: async () => ({}),
        }),
      );
      assert.match(agentsMarkup, /Recorded runs<\/span><strong>6<\/strong>/);
      assert.match(agentsMarkup, /Input \/ output<\/span><strong>735 \/ 110<\/strong>/);
      assert.match(agentsMarkup, /Approx\. cost<\/span><strong>\$4\.70<\/strong>/);
      assert.doesNotMatch(agentsMarkup, /repository-handoff/);

      const patternAgentMarkup = renderToStaticMarkup(
        React.createElement(AgentsScreen, {
          runtimeTasks: [task],
          runtimeStatus,
          selectedId: "scout-pattern",
          onSelect: () => {},
          onSave: async () => ({}),
        }),
      );
      assert.match(patternAgentMarkup, /Recorded runs<\/span><strong>1<\/strong>/);
      assert.match(patternAgentMarkup, /historical-code-report/);
    },
  );
});

test("surfaces the merged candidate, target ref, and a copy-only promotion command for a merged-to-target task", () => {
  return withWorkspace(async ({ RuntimeTaskWorkspace, isStageComplete, toTaskRunState }) => {
    const task = createTask({
      status: "merged-to-target",
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
        "approval",
      ],
      candidates: [
        {
          id: "C1",
          revisionNumber: 3,
          status: "merged",
          baseRevision: "a".repeat(40),
          headRevision: "b".repeat(40),
          baseBranch: "codex/vertical-slice",
          branch: "agent-harness/ah-999-c1",
          revisions: [],
        },
      ],
      mergeIntent: {
        candidateId: "C1",
        candidateRevision: 3,
        baseRevision: "a".repeat(40),
        headRevision: "b".repeat(40),
        targetRef: "refs/heads/codex/vertical-slice",
        note: "",
        status: "completed",
        startedAt: "2026-08-01T12:04:00.000Z",
        completedAt: "2026-08-01T12:05:00.000Z",
        error: null,
      },
      gateFreshness: {
        "dev-review": makeGateFreshness("dev-review", { fresh: true, candidateRevision: 3 }),
        test: makeGateFreshness("test", { fresh: true, candidateRevision: 3 }),
        "final-review": makeGateFreshness("final-review", { fresh: true, candidateRevision: 3 }),
      },
    });

    assert.equal(
      isStageComplete(task, "approval"),
      true,
      "the fast-forward merge completes the approval stage before promotion",
    );
    assert.equal(toTaskRunState(task.status), "merged-to-target");

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

    assert.match(markup, /Merged to target/);
    assert.match(markup, /C1 r3/);
    assert.match(markup, new RegExp(`Merged head SHA[\\s\\S]*${"b".repeat(40)}`));
    assert.match(markup, /refs\/heads\/codex\/vertical-slice/);
    assert.match(markup, new RegExp(`git push origin ${"b".repeat(40)}:codex/vertical-slice`));
    assert.match(markup, /Copy command/);
    assert.match(markup, /Mark completed/);
  });
});

test("offers an implementation continuation only for completed investigations", () => {
  return withWorkspace(async ({ RuntimeCommandBar, nextAction }) => {
    const task = createTask({
      workflow: "investigate",
      status: "completed",
      currentStage: "specification",
      completedStages: ["triage", "scouts", "grill", "specification"],
    });
    assert.equal(nextAction(task).action, "continue-implementation");
    assert.equal(nextAction(task).label, "Continue to implementation");

    const markup = renderToStaticMarkup(
      React.createElement(RuntimeCommandBar, {
        task,
        viewedStageId: "specification",
        onRun: async () => {},
        onAction: async () => {},
        onFinishGrill: async () => {},
      }),
    );
    assert.match(markup, />Continue to implementation</);
    assert.match(markup, /separate implementation task/);

    const linked = { ...task, continuedByTaskId: "AH-012" };
    assert.equal(nextAction(linked).label, "Open implementation task");
    assert.match(nextAction(linked).title, /AH-012/);
    assert.equal(runtimeTaskToRecentTask(linked).status, "Continued");
  });
});

test("disables task closure while merge reconciliation is pending", () => {
  return withWorkspace(async ({ RuntimeTaskWorkspace }) => {
    const task = createTask({
      status: "merging",
      currentStage: "approval",
      mergeIntent: {
        status: "pending",
        candidateId: "C1",
        candidateRevision: 1,
        candidateHeadRevision: "candidate-c1-r1",
        targetBranch: "main",
        targetHeadRevision: "target-r1",
        mergeMethod: "fast-forward",
        requestedAt: "2026-08-04T00:00:00.000Z",
      },
    });
    const markup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task,
        onBack: async () => {},
        onRun: async () => {},
        onCancel: async () => {},
        onAction: async () => {},
        onDecision: async () => {},
        onCloseTask: async () => {},
      }),
    );
    assert.match(
      markup,
      /disabled=""[^>]*title="Wait for the pending GitHub PR lifecycle before closing this task\."[^>]*>.*Close task/s,
    );
  });
});
