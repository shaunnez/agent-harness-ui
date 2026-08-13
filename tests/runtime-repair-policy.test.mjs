import test from "node:test";
import {
  assert,
  attachRepairAuthorizerFixture,
  buildRepairRequest,
  buildStageRequest,
  createTask,
  JsonTaskStore,
  mkdtemp,
  normalizeModelId,
  os,
  path,
  priceUsage,
  rm,
  TaskOrchestrator,
  waitUntil,
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
