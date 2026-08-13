import test from "node:test";
import {
  assert,
  buildRepairRequest,
  createTask,
  JsonTaskStore,
  mkdtemp,
  os,
  parseGateEvidence,
  path,
  React,
  renderToStaticMarkup,
  rm,
  TaskOrchestrator,
  waitUntil,
  withWorkspace,
} from "./runtime-test-support.mjs";

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
