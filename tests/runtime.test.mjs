import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer as createViteServer } from "vite";
import { buildCodexEnvironment, parseCodexEvent, runProcess, selectCodexCandidate } from "../server/codex-runtime.mjs";
import { normalizeModelId, priceUsage, readCodexModelCatalog, withConfiguredModels } from "../server/model-catalog.mjs";
import { buildExecutionRequest, buildStageRequest, buildWorkPackageRequest } from "../server/prompts.mjs";
import { buildScoutRequest } from "../server/scouts.mjs";
import { JsonTaskStore } from "../server/store.mjs";
import { TaskOrchestrator } from "../server/orchestrator.mjs";
import { formatApprovalStage, formatApprovalTimestamp, getApprovalHistory } from "../src/components/runtimeApprovalHistory.js";

test("parses Codex final messages and usage", () => {
  assert.deepEqual(
    parseCodexEvent(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Ready" } })),
    { type: "message", text: "Ready" },
  );
  assert.equal(
    parseCodexEvent(
      JSON.stringify({ type: "item.completed", item: { type: "command_execution", command: "npm test", exit_code: 1 } }),
    ).commandFailed,
    true,
  );
  assert.deepEqual(
    parseCodexEvent(
      JSON.stringify({ type: "turn.completed", usage: { input_tokens: 10, cached_input_tokens: 4, output_tokens: 5 } }),
    ),
    { type: "usage", usage: { inputTokens: 10, cachedInputTokens: 4, cacheWriteTokens: 0, outputTokens: 5, totalTokens: 15 } },
  );
});

test("prefers a Windows Codex runtime with its sandbox helper", () => {
  const candidates = ["C:\\standalone\\codex.exe", "C:\\desktop\\codex.exe"];
  const selected = selectCodexCandidate(candidates, (candidate) =>
    candidate.endsWith("desktop\\codex-windows-sandbox-setup.exe"),
  );
  assert.equal(selected, process.platform === "win32" ? candidates[1] : candidates[0]);
});

test("rejects an already-aborted process before spawning", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-aborted-process-"));
  const marker = path.join(directory, "spawned.txt");
  try {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      () => runProcess(process.execPath, ["-e", `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'spawned')`], { signal: controller.signal }),
      /before launch/i,
    );
    await assert.rejects(() => access(marker));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("cancellation terminates descendants before the process reservation settles", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-process-tree-"));
  const marker = path.join(directory, "writes.txt");
  const childScript = `const fs=require('node:fs');setInterval(()=>fs.appendFileSync(${JSON.stringify(marker)},'x'),15);`;
  const parentScript = `const {spawn}=require('node:child_process');spawn(process.execPath,['-e',${JSON.stringify(childScript)}],{stdio:'ignore'});setInterval(()=>{},1000);`;
  try {
    const controller = new AbortController();
    const running = runProcess(process.execPath, ["-e", parentScript], { signal: controller.signal, timeoutMs: 5_000 });
    await waitUntil(async () => (await readFile(marker, "utf8").catch(() => "")).length > 1);
    controller.abort();
    await assert.rejects(() => running, /cancelled/i);
    const sizeAfterClose = (await readFile(marker, "utf8")).length;
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.equal((await readFile(marker, "utf8")).length, sizeAfterClose);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("timeout terminates descendants before allowing a retry", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-process-timeout-"));
  const marker = path.join(directory, "writes.txt");
  const childScript = `const fs=require('node:fs');setInterval(()=>fs.appendFileSync(${JSON.stringify(marker)},'x'),15);`;
  const parentScript = `const {spawn}=require('node:child_process');spawn(process.execPath,['-e',${JSON.stringify(childScript)}],{stdio:'ignore'});setInterval(()=>{},1000);`;
  try {
    await assert.rejects(
      () => runProcess(process.execPath, ["-e", parentScript], { timeoutMs: 120 }),
      /exceeded/i,
    );
    const sizeAfterClose = (await readFile(marker, "utf8").catch(() => "")).length;
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.equal((await readFile(marker, "utf8").catch(() => "")).length, sizeAfterClose);
    const retry = await runProcess(process.execPath, ["-e", "process.stdout.write('retry')"], { timeoutMs: 1_000 });
    assert.equal(retry.stdout, "retry");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("builds a minimal Codex environment without inherited credentials", () => {
  const environment = buildCodexEnvironment({
    PATH: "C:\\Windows\\System32",
    USERPROFILE: "C:\\Users\\agent",
    LOCALAPPDATA: "C:\\Users\\agent\\AppData\\Local",
    CODEX_HOME: "C:\\Users\\agent\\.codex",
    GH_TOKEN: "secret-github-token",
    AWS_SECRET_ACCESS_KEY: "secret-aws-key",
    DATABASE_URL: "postgres://secret",
    OPENAI_API_KEY: "secret-openai-key",
    ARBITRARY_SECRET: "secret-value",
  }, "C:\\tmp\\agent-harness-runtime");
  assert.equal(environment.PATH, "C:\\Windows\\System32");
  assert.equal(environment.CODEX_HOME, "C:\\Users\\agent\\.codex");
  assert.equal(environment.TEMP, "C:\\tmp\\agent-harness-runtime");
  assert.equal(environment.GH_TOKEN, undefined);
  assert.equal(environment.AWS_SECRET_ACCESS_KEY, undefined);
  assert.equal(environment.DATABASE_URL, undefined);
  assert.equal(environment.OPENAI_API_KEY, undefined);
  assert.equal(environment.ARBITRARY_SECRET, undefined);
});

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

test("distinguishes discovered, configured, fallback, and unsupported model provenance", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-model-catalog-"));
  const previousCodexHome = process.env.CODEX_HOME;
  try {
    process.env.CODEX_HOME = directory;
    await writeFile(path.join(directory, "models_cache.json"), JSON.stringify({
      fetched_at: "2026-08-03T00:00:00.000Z",
      models: [{
        slug: "gpt-5.6-luna",
        display_name: "GPT-5.6-Luna",
        description: "Local cache entry",
        visibility: "list",
        default_reasoning_level: "xhigh",
        supported_reasoning_levels: [{ effort: "high" }, { effort: "xhigh" }],
      }],
    }));
    const discovered = await readCodexModelCatalog();
    assert.equal(discovered.models[0].provenance, "discovered");
    assert.equal(discovered.models[0].editable, true);

    await writeFile(path.join(directory, "models_cache.json"), JSON.stringify({ models: [] }));
    const fallback = await readCodexModelCatalog();
    assert.equal(fallback.models.every((model) => model.provenance === "bundled-fallback"), true);
    assert.equal(fallback.models.every((model) => model.availability === "unsupported" && !model.editable), true);
    const configured = withConfiguredModels(fallback, {
      allowedModels: ["gpt-5.6-luna"],
      defaultModel: "gpt-5.6-luna",
      defaultReasoning: "xhigh",
      stagePolicies: { triage: { model: "gpt-5.6-luna", reasoning: "xhigh" } },
    });
    assert.equal(configured.models.find((model) => model.id === "gpt-5.6-luna").provenance, "configured");
    assert.equal(configured.models.find((model) => model.id === "gpt-5.6-sol").availability, "unsupported");
  } finally {
    if (previousCodexHome == null) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
    await rm(directory, { recursive: true, force: true });
  }
});

test("records the exact prior artifacts and repository permission supplied to an agent", () => {
  const task = createTask({
    artifacts: [
      {
        id: "artifact-triage",
        stage: "triage",
        name: "triage.md",
        content: "Grounded triage evidence.",
        createdAt: "2026-08-02T00:00:00.000Z",
        model: "gpt-5.6-luna",
        usage: { inputTokens: 10, cachedInputTokens: 8, outputTokens: 2, totalTokens: 12 },
      },
    ],
  });
  const request = buildStageRequest(task, "scouts");
  assert.match(request.prompt, /Grounded triage evidence/);
  assert.equal(request.contextManifest.repositoryAccess, "read-only");
  assert.equal(request.contextManifest.sources.some((source) => source.id === "artifact-triage"), true);
  assert.equal(request.contextManifest.sources.find((source) => source.id === "artifact-triage").includedCharacters, 25);
});

test("context manifests count the exact capped task text supplied to every prompt shape", () => {
  for (const length of [5_999, 6_000, 6_001, 10_000, 10_001]) {
    const marker = "__TASK_CONTEXT_SENTINEL__";
    const description = `${"x".repeat(length - marker.length)}${marker}`;
    const task = createTask({
      id: "AH-CONTEXT",
      title: "T".repeat(320),
      description,
      workflow: "implement",
      priority: "high",
      artifacts: [],
      decisions: [],
      attachments: [],
    });
    const candidate = {
      id: "C1",
      revisionNumber: 3,
      baseRevision: "a".repeat(40),
      headRevision: "b".repeat(40),
    };
    const workPackage = {
      id: "S1",
      title: "Context",
      description: "Keep accounting exact.",
      dependencies: [],
      ownedPaths: ["server/prompts.mjs"],
      verification: ["npm test"],
    };
    const requests = [
      buildStageRequest(task, "triage"),
      buildExecutionRequest(task, "dev-review", candidate),
      buildWorkPackageRequest(task, workPackage, { baseRevision: candidate.baseRevision }),
      buildScoutRequest(
        task,
        { name: "scout-code-path", focus: "Trace prompt construction.", reason: "Verify accounting." },
        null,
      ),
    ];
    for (const request of requests) {
      const source = request.contextManifest.sources.find((item) => item.kind === "task");
      const expectedDescriptionLength = Math.min(length, 6_000);
      const includesWorkflow = source.label.includes("workflow");
      const expectedIncluded =
        task.id.length + 300 + expectedDescriptionLength + task.priority.length + (includesWorkflow ? task.workflow.length : 0);
      const expectedOriginal =
        task.id.length + task.title.length + description.length + task.priority.length + (includesWorkflow ? task.workflow.length : 0);
      assert.equal(source.includedCharacters, expectedIncluded);
      assert.equal(source.originalCharacters, expectedOriginal);
      assert.equal(source.truncated, length > 6_000 || task.title.length > 300);
      assert.equal(request.contextManifest.promptCharacters, request.prompt.length);
      assert.equal(request.prompt.includes(marker), length <= 6_000);
    }
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
              finalText: "## Outcome\nDone\n## Changes\nScoped\n## Verification\nFocused\n## Remaining risks\nNone",
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

test("renders approvals history in the runtime task inspector", () => {
  return withWorkspace(async ({ RuntimeTaskWorkspace }) => {
    const taskWithApprovals = createTask({
      approvals: [
        { id: "A1", stage: "specification", note: "Specification approved.", createdAt: "2026-08-01T10:15:00.000Z" },
        { id: "A2", stage: "plan", note: "", createdAt: "2026-08-01T10:20:00.000Z" },
      ],
    });
    const populatedMarkup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task: taskWithApprovals,
        onBack: async () => {},
        onRun: async () => {},
        onCancel: async () => {},
        onAction: async () => {},
        onDecision: async () => {},
      }),
    );

    assert.match(populatedMarkup, /<strong>Approvals<\/strong>/);
    assert.match(populatedMarkup, /Task specification/);
    assert.match(populatedMarkup, /Specification approved\./);
    assert.match(populatedMarkup, /Approved without a note\./);
    assert.doesNotMatch(populatedMarkup, /No approvals recorded yet\./);

    const emptyMarkup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task: createTask({ approvals: [] }),
        onBack: async () => {},
        onRun: async () => {},
        onCancel: async () => {},
        onAction: async () => {},
        onDecision: async () => {},
      }),
    );
    assert.match(emptyMarkup, /<strong>Approvals<\/strong>/);
    assert.match(emptyMarkup, /No approvals recorded yet\./);
  });
});

test("renders the retained worktree inventory with drill-in detail and a return path", () => {
  return withWorkspace(async ({ RuntimeTaskWorkspace }) => {
    const task = createTask({
      worktreeInventory: [
        {
          id: "slice-S1",
          kind: "slice",
          label: "S1 slice worktree",
          worktreePath: "C:/worktrees/AH-015-S2-A1-S1",
          branch: "agent-harness/AH-015-S2-A1-S1",
          baseRevision: "a".repeat(40),
          headRevision: "b".repeat(40),
          taskId: "AH-015",
          workPackageId: "S1",
          lifecycleState: "retained",
          gitExists: true,
          gitHeadRevision: "b".repeat(40),
          gitClean: true,
          cleanupReady: true,
        },
        {
          id: "candidate-C1",
          kind: "candidate",
          label: "Candidate C1 worktree",
          worktreePath: "C:/worktrees/AH-015-C1",
          branch: "agent-harness/AH-015-C1",
          baseRevision: "c".repeat(40),
          headRevision: null,
          taskId: "AH-015",
          workPackageId: null,
          lifecycleState: "active",
          gitExists: true,
          gitHeadRevision: "d".repeat(40),
          gitClean: false,
          cleanupReady: false,
        },
      ],
    });

    const listMarkup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task,
        onBack: async () => {},
        onRun: async () => {},
        onCancel: async () => {},
        onAction: async () => {},
        onDecision: async () => {},
        initialSelectedWorktreeId: null,
      }),
    );

    assert.match(listMarkup, /Isolated worktrees/);
    assert.match(listMarkup, /slice \u00b7 retained/i);
    assert.match(listMarkup, /candidate \u00b7 active/i);
    assert.match(listMarkup, /S1 slice worktree/);
    assert.match(listMarkup, /Candidate C1 worktree/);
    assert.match(listMarkup, /cleanup ready/);
    assert.match(listMarkup, /keep retained/);

    const detailMarkup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task,
        onBack: async () => {},
        onRun: async () => {},
        onCancel: async () => {},
        onAction: async () => {},
        onDecision: async () => {},
        initialSelectedWorktreeId: "candidate-C1",
      }),
    );

    assert.match(detailMarkup, /Return to inventory list/);
    assert.match(detailMarkup, /candidate \u00b7 active/i);
    assert.match(detailMarkup, /Kind/);
    assert.match(detailMarkup, /Cleanup/);
    assert.match(detailMarkup, /Return to the inventory list/);
  });
});

test("fetches candidate diffs by active candidate identity and surfaces stale failures", async () => {
  return withWorkspace(async ({ loadApiModule }) => {
    const { getCandidateDiff } = await loadApiModule();
    const requests = [];
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async (input, init) => {
        requests.push({ input: String(input), init });
        return new Response(
          JSON.stringify({
            candidateId: "C1",
            revisionNumber: 2,
            headRevision: "c".repeat(40),
            worktreePath: "C:/worktrees/C1",
            diff: "diff --git a/file.txt b/file.txt\n+change",
            truncated: false,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      };

      const diff = await getCandidateDiff("TASK-1", "C1", "c".repeat(40));
      assert.equal(diff.candidateId, "C1");
      assert.equal(diff.headRevision, "c".repeat(40));
      assert.match(requests[0].input, /\/api\/tasks\/TASK-1\/candidates\/C1\/diff\?headRevision=/);
      assert.match(requests[0].input, /headRevision=c{40}/);

      globalThis.fetch = async () => new Response(JSON.stringify({ error: "stale" }), { status: 409 });
      await assert.rejects(() => getCandidateDiff("TASK-1", "C1", "d".repeat(40)), /stale/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("fetches the live inventory endpoint and renders the returned rows in the runtime workspace", async () => {
  return withWorkspace(async ({ RuntimeTaskWorkspace, loadApiModule }) => {
    const { getRuntimeWorktreeInventory } = await loadApiModule();
    const requests = [];
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async (input, init) => {
        requests.push({ input: String(input), init });
        return new Response(
          JSON.stringify({
            rows: [
              {
                id: "slice-S1",
                kind: "slice",
                label: "S1 slice worktree",
                worktreePath: "C:/worktrees/AH-015-S2-A1-S1",
                branch: "agent-harness/AH-015-S2-A1-S1",
                baseRevision: "a".repeat(40),
                headRevision: "b".repeat(40),
                taskId: "AH-015",
                workPackageId: "S1",
                lifecycleState: "retained",
                gitExists: true,
                gitHeadRevision: "b".repeat(40),
                gitClean: true,
                cleanupReady: true,
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      };

      const inventory = await getRuntimeWorktreeInventory();
      assert.equal(inventory.rows.length, 1);
      assert.equal(requests[0].input, "/api/runtime/worktrees");
      assert.deepEqual(
        (({ gitExists, gitHeadRevision, gitClean, cleanupReady }) => ({ gitExists, gitHeadRevision, gitClean, cleanupReady }))(
          inventory.rows[0],
        ),
        {
          gitExists: true,
          gitHeadRevision: "b".repeat(40),
          gitClean: true,
          cleanupReady: true,
        },
      );

      const markup = renderToStaticMarkup(
        React.createElement(RuntimeTaskWorkspace, {
          task: createTask({ worktreeInventory: inventory.rows }),
          onBack: async () => {},
          onRun: async () => {},
          onCancel: async () => {},
          onAction: async () => {},
          onDecision: async () => {},
        }),
      );

      assert.match(markup, /Isolated worktrees/);
      assert.match(markup, /slice/);
      assert.match(markup, /retained/);
      assert.match(markup, /S1 slice worktree/);
      assert.match(markup, /cleanup ready/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("renders the candidate diff overlay with the current identity and return control", () => {
  return withWorkspace(async ({ CandidateDiffViewer }) => {
    let closed = 0;
    const markup = renderToStaticMarkup(
      React.createElement(CandidateDiffViewer, {
        candidateIdentity: "C1 \u00b7 deadbeef",
        taskId: "TASK-1",
        diff: {
          candidateId: "C1",
          revisionNumber: 2,
          headRevision: "c".repeat(40),
          worktreePath: "C:/worktrees/C1",
          diff: "diff --git a/file.txt b/file.txt\n+change",
          truncated: false,
        },
        onClose: () => {
          closed += 1;
        },
      }),
    );

    assert.match(markup, /Candidate diff/);
    assert.match(markup, /C1 \u00b7 deadbeef/);
    assert.match(markup, /Task TASK-1/);
    assert.match(markup, /Return to inspector/);
    assert.match(markup, /Close candidate diff/);
    assert.equal(closed, 0);
  });
});

test("rejects late task and candidate-diff responses after identity changes", () => {
  return withWorkspace(async ({ isCurrentRequest, matchesCandidateDiffResponse }) => {
    const requestA = { identity: "AH-A", generation: 1 };
    const requestB = { identity: "AH-B", generation: 2 };
    assert.equal(isCurrentRequest(requestA, requestB), false);
    assert.equal(isCurrentRequest(requestB, requestB), true);
    const requested = { id: "C2", revisionNumber: 3, headRevision: "b".repeat(40) };
    assert.equal(matchesCandidateDiffResponse(requested, {
      candidateId: "C2",
      revisionNumber: 2,
      headRevision: "a".repeat(40),
    }), false);
    assert.equal(matchesCandidateDiffResponse(requested, {
      candidateId: "C2",
      revisionNumber: 3,
      headRevision: "b".repeat(40),
    }), true);
  });
});

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
      (({ kicker, detail, sandbox }) => ({ kicker, detail, sandbox }))(getAccessBoundaryCopy(createTask({ currentStage: "plan" }))),
      (({ kicker, detail, sandbox }) => ({ kicker, detail, sandbox }))(getAccessBoundaryCopy(createTask({ currentStage: "specification" }))),
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
    assert.doesNotMatch(viewedStageMarkup, /<small>Agent<\/small><strong class="">Task specification agent<\/strong>/);
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
          status: "awaiting-spec-approval",
          currentStage: "specification",
          completedStages: ["triage", "scouts", "grill", "specification"],
          grillSession: {
            status: "completed",
            questions: [
              {
                ...question,
                answer: "Preserve it",
                answerSource: "user",
                resolvedAt: "2026-08-01T12:05:00.000Z",
              },
            ],
            createdAt: "2026-08-01T12:00:00.000Z",
            completedAt: "2026-08-01T12:05:00.000Z",
            completionReason: "All material questions were answered.",
          },
        }),
      }),
    );
    assert.match(completedMarkup, /All material questions were answered/);
    assert.match(completedMarkup, /Your answer/);
    assert.doesNotMatch(completedMarkup, /Confirm answer/);
    assert.doesNotMatch(completedMarkup, /Finish with 1 recommendation/);
  });
});

test("renders artifact copy affordance and normalizes clipboard outcomes", () => {
  return withWorkspace(async ({ RuntimeArtifactViewer, copyArtifactContent, shouldApplyArtifactCopyFeedback }) => {
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
    assert.deepEqual(
      await copyArtifactContent(artifact.content, null),
      { ok: false, message: "Clipboard access failed. Your browser did not expose clipboard write support." },
    );
    assert.equal(shouldApplyArtifactCopyFeedback("artifact-1", "artifact-1"), true);
    assert.equal(shouldApplyArtifactCopyFeedback("artifact-1", "artifact-2"), false);
  });
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
          completedStages: ["triage", "scouts", "grill", "specification", "plan", "implement", "dev-review", "test"],
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
                "PASS\n\n<focused-test-evidence>\n{\"candidateId\":\"C1\",\"candidateRevision\":2,\"command\":\"npm.cmd run test:runtime\",\"status\":\"passed\",\"durationMs\":900,\"rows\":[{\"id\":\"row-1\",\"candidateId\":\"C1\",\"candidateRevision\":2,\"command\":\"npm.cmd run test:runtime\",\"status\":\"passed\",\"durationMs\":900,\"title\":\"runtime.test.mjs\",\"artifactReferences\":[{\"name\":\"Markdown test artifact\",\"kind\":\"markdown\",\"path\":\"artifacts/test.md\"}],\"assertions\":[{\"label\":\"workspace renders the test artifact\",\"actual\":\"present\",\"expected\":\"present\"}],\"failureDetails\":null}]}\n</focused-test-evidence>",
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
      revisions: [{ number: 1, headRevision: "c".repeat(40), reason: "assembly", createdAt: "2026-08-01T11:00:00.000Z" }, { number: 2, headRevision: "b".repeat(40), reason: "repair", createdAt: "2026-08-01T12:00:00.000Z" }],
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
        ? { verdict: "PASS", candidateId: "C1", candidateRevision: revision, evaluatedAt: "2026-08-01T12:00:00.000Z", blockingReasons }
        : null,
    });
    const markup = renderToStaticMarkup(React.createElement(RuntimeTaskWorkspace, {
      task: createTask({
        status: "awaiting-human-approval",
        currentStage: "approval",
        completedStages: ["triage", "scouts", "grill", "specification", "plan", "implement", "dev-review", "test", "final-review"],
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
    }));
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
      runs: [
        run("RUN-OLD", "ART-OLD", 1, superseded),
        run("RUN-CURRENT", "ART-CURRENT", 2, authoritative),
      ],
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
    assert.equal(getRuntimeArtifactFreshness(
      createTask({
        candidates: [candidate],
        artifacts: [oldArtifact],
        runs: [],
        gateFreshness: { "dev-review": authoritative },
      }),
      oldArtifact,
    ).reasonCode, "superseded_attempt");
  });
});

test("renders workspace artifact freshness from persisted run evidence", () => {
  return withWorkspace(async ({ RuntimeTaskWorkspace, isArtifactFresh }) => {
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
    const artifact = (id, runId, createdAt, freshness) => ({
      id,
      runId,
      stage: "dev-review",
      kind: "markdown",
      name: `${id}.md`,
      content: "# Candidate-bound review",
      createdAt,
      model: "gpt-5.6-sol",
      usage,
      candidateId: "C1",
      candidateRevision: 2,
      freshness,
    });
    const staleReason = "A later terminal attempt superseded this historical evidence.";
    const oldFreshness = makeGateFreshness("dev-review", {
      sourceRunId: "RUN-OLD",
      sourceArtifactId: "ART-OLD",
      reasonCode: "superseded_attempt",
      reasonCopy: staleReason,
    });
    const currentFreshness = makeGateFreshness("dev-review", {
      fresh: true,
      sourceRunId: "RUN-CURRENT",
      sourceArtifactId: "ART-CURRENT",
    });
    const markup = renderToStaticMarkup(React.createElement(RuntimeTaskWorkspace, {
      task: createTask({
        status: "awaiting-human-approval",
        currentStage: "dev-review",
        completedStages: ["triage", "scouts", "grill", "specification", "plan", "implement"],
        candidates: [candidate],
        artifacts: [
          artifact("ART-OLD", "RUN-OLD", "2026-08-01T12:01:00.000Z", oldFreshness),
          artifact("ART-CURRENT", "RUN-CURRENT", "2026-08-01T12:02:00.000Z", currentFreshness),
        ],
        runs: [
          { id: "RUN-OLD", artifactId: "ART-OLD", freshness: oldFreshness },
          { id: "RUN-CURRENT", artifactId: "ART-CURRENT", freshness: currentFreshness },
        ],
        gateFreshness: { "dev-review": currentFreshness },
      }),
      initialViewedStageId: "dev-review",
      onBack: async () => {},
      onRun: async () => {},
      onCancel: async () => {},
      onAction: async () => {},
      onDecision: async () => {},
      onGrillAnswer: async () => {},
      onFinishGrill: async () => {},
    }));

    assert.doesNotMatch(markup, /Stale after repair/);
    assert.match(markup, /ART-CURRENT\.md/);
    assert.match(markup, new RegExp(`ART-OLD\\.md[\\s\\S]*Rerun required[\\s\\S]*${staleReason.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.equal(isArtifactFresh(
      { ...artifact("ART-OLD", "RUN-OLD", "2026-08-01T12:01:00.000Z", oldFreshness) },
      candidate,
    ), false);
    assert.equal(oldFreshness.reasonCopy, staleReason);
  });
});

test("renders the exact persisted reason for a stale viewed-stage artifact", () => {
  return withWorkspace(async ({ RuntimeTaskWorkspace }) => {
    const candidate = {
      id: "C1",
      revisionNumber: 7,
      status: "under_review",
      baseRevision: "a".repeat(40),
      headRevision: "b".repeat(40),
      baseBranch: "main",
      branch: "agent-harness/ah-005-c1",
      revisions: [],
    };
    const staleReason = "Candidate evidence belongs to a previous candidate revision.";
    const freshness = makeGateFreshness("dev-review", {
      sourceRunId: "RUN-R6",
      sourceArtifactId: "ART-R6",
      reasonCode: "revision_change",
      reasonCopy: staleReason,
    });
    const artifact = {
      id: "ART-R6",
      runId: "RUN-R6",
      stage: "dev-review",
      kind: "markdown",
      name: "dev-review-c1-r6.md",
      content: "# Prior review",
      createdAt: "2026-08-04T12:00:00.000Z",
      model: "gpt-5.6-sol",
      usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
      candidateId: "C1",
      candidateRevision: 6,
      freshness,
    };
    const markup = renderToStaticMarkup(React.createElement(RuntimeTaskWorkspace, {
      task: createTask({
        status: "ready-for-review",
        currentStage: "dev-review",
        completedStages: ["triage", "scouts", "grill", "specification", "plan", "implement"],
        candidates: [candidate],
        artifacts: [artifact],
        runs: [{ id: "RUN-R6", artifactId: "ART-R6", freshness }],
        gateFreshness: { "dev-review": freshness },
      }),
      initialViewedStageId: "dev-review",
      onBack: async () => {},
      onRun: async () => {},
      onCancel: async () => {},
      onAction: async () => {},
      onDecision: async () => {},
      onGrillAnswer: async () => {},
      onFinishGrill: async () => {},
    }));

    assert.match(markup, /Rerun required/);
    assert.match(markup, new RegExp(staleReason.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(markup, /Stale after repair/);
  });
});

test("renders dependency batches and package status during implementation", () => {
  return withWorkspace(async ({ RuntimeTaskWorkspace }) => {
    const markup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task: createTask({
          status: "running",
          currentStage: "implement",
          completedStages: ["triage", "scouts", "grill", "specification", "plan"],
          workPackages: [
            {
              id: "S1",
              title: "Runtime contract",
              description: "Add the API behavior.",
              dependencies: [],
              batch: 1,
              ownedPaths: ["server/api.mjs"],
              verification: ["npm test"],
              status: "ready_for_integration",
              attempts: 1,
              branch: "agent-harness/ah-999-s1-a1",
              worktreePath: "C:/worktrees/S1-A1",
              baseRevision: "a".repeat(40),
              headRevision: "b".repeat(40),
              files: ["server/api.mjs"],
              error: null,
            },
            {
              id: "S2",
              title: "Runtime UI",
              description: "Render the API result.",
              dependencies: ["S1"],
              batch: 2,
              ownedPaths: ["src/App.tsx"],
              verification: ["npm run typecheck"],
              status: "running",
              attempts: 1,
              branch: "agent-harness/ah-999-s2-a1",
              worktreePath: "C:/worktrees/S2-A1",
              baseRevision: "a".repeat(40),
              headRevision: null,
              files: [],
              error: null,
            },
          ],
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
    assert.match(markup, /2 packages \u00b7 2 batches/);
    assert.match(markup, /Runtime contract/);
    assert.match(markup, /Runtime UI/);
    assert.match(markup, /dependencies unlock/);
  });
});

test("renders a truthful completion summary for historical merges without an approval artifact", () => {
  return withWorkspace(async ({ RuntimeTaskWorkspace }) => {
    const markup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task: createTask({
          status: "completed",
          currentStage: "approval",
          completedStages: ["triage", "scouts", "grill", "specification", "plan", "implement", "dev-review", "test", "final-review", "approval"],
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
        }),
        onBack: async () => {},
        onRun: async () => {},
        onCancel: async () => {},
        onAction: async () => {},
        onDecision: async () => {},
      }),
    );

    assert.match(markup, /Candidate merged successfully/);
    assert.match(markup, /C1 revision 3 merged/);
    assert.match(markup, /Human approval gate/);
    assert.doesNotMatch(markup, /Human approval is not ready yet/);
  });
});

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
      usage: { inputTokens: 100, cachedInputTokens: 80, outputTokens: 20, totalTokens: 120, credits: 0.25, cost: 0.002 },
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
      gateResult: { verdict: "PASS", candidateId: "C1", candidateRevision: 2, evaluatedAt: "2026-08-01T12:00:03.000Z", blockingReasons: [] },
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
          toolCalls: [{ id: "cmd-1", name: "command_execution", category: "repository-command", phase: "completed", result: "Exit code 0" }],
          test: { candidateId: "C1", candidateRevision: 2, status: "passed", command: "npm.cmd test", durationMs: 900, rowCount: 1, failedRowIds: [] },
        },
      ],
      artifacts: [{
        id: "artifact-test",
        runId: "RUN-TEST",
        stage: "test",
        name: "test.md",
        kind: "markdown",
        content: "PASS",
        createdAt: "2026-08-01T12:00:03.000Z",
        model: "gpt-5.6-sol",
        usage: runBase.usage,
      }],
      events: [
        { id: "E1", at: "2026-08-01T12:00:00.000Z", category: "agent", tone: "info", stage: "dev-review", title: "Review started", detail: "Fresh context", runId: "RUN-REVIEW" },
        { id: "E2", at: "2026-08-01T12:00:01.000Z", category: "tool", tone: "success", stage: "test", title: "Repository command completed", detail: "npm.cmd test", runId: "RUN-TEST", toolCall: { id: "cmd-1", name: "command_execution", category: "repository-command", phase: "completed", result: "Exit code 0" } },
        { id: "E3", at: "2026-08-01T12:00:02.000Z", category: "decision", tone: "success", stage: "approval", title: "Approved", detail: "Proceed", approvalId: "A1" },
      ],
    });

    assert.equal(filterRunActivity(task, "activity").length, 3);
    assert.deepEqual(filterRunActivity(task, "agent").map((item) => item.run.id), ["RUN-REVIEW"]);
    assert.deepEqual(filterRunActivity(task, "test").map((item) => item.run.id), ["RUN-TEST"]);
    assert.deepEqual(filterRunActivity(task, "decision").map((item) => item.event.id), ["E3"]);
    assert.deepEqual(filterRunActivity(task, "tool").map((item) => item.event.id), ["E2"]);

    const markup = renderToStaticMarkup(React.createElement(RunActivity, {
      task,
      initialFilter: "test",
      initialSelectedId: "run:RUN-TEST",
      onOpenArtifact: () => {},
    }));
    assert.match(markup, /Tool calls/);
    assert.match(markup, /Run drilldown/);
    assert.match(markup, /RUN-TEST/);
    assert.match(markup, /Focused tests/);
    assert.match(markup, /Open test\.md/);
    assert.match(markup, /API-rate estimate/);
  });
});

test("renders stale evidence in the mounted Run Activity views with exact persisted reasons", () => {
  return withWorkspace(async ({ RunActivity, filterRunActivity }) => {
    const revisionReason = "Candidate evidence belongs to a previous candidate revision.";
    const failureReason = "The terminal run failed, so its evidence is not fresh.";
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
    const task = createTask({ runs: [reviewRun, testRun], events: [linkedStagePass, persistedStaleEvent] });

    const activityItems = filterRunActivity(task, "activity");
    const linkedItem = activityItems.find((item) => item.event.id === linkedStagePass.id);
    assert.equal(linkedItem.tone, "warning");
    assert.match(linkedItem.title, /Rerun required/);
    assert.match(linkedItem.detail, new RegExp(revisionReason.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    const persistedItem = activityItems.find((item) => item.event.id === persistedStaleEvent.id);
    assert.equal(persistedItem.tone, "warning");
    assert.match(persistedItem.detail, new RegExp(failureReason.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

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
    ]) {
      const markup = renderToStaticMarkup(React.createElement(RunActivity, { task, initialFilter, initialSelectedId: selectedId }));
      assert.match(markup, /runtime-activity-row--warning/);
      assert.match(markup, /Rerun required/);
      assert.match(markup, new RegExp(reason.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });
});

async function waitUntil(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for condition.");
}

function createTask(overrides = {}) {
  const now = "2026-08-01T12:00:00.000Z";
  return {
    id: "AH-999",
    title: "Approval history",
    description: "Render approval history in the inspector.",
    repositoryPath: "C:/repo/task",
    workflow: "implement",
    priority: "medium",
    status: "awaiting-spec-approval",
    currentStage: "specification",
    completedStages: [],
    stageRun: 1,
    stageRunLimit: 3,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
    error: null,
    activeRunKind: null,
    activeRunIds: [],
    attemptsByStage: {},
    models: [{ provider: "openai", model: "GPT-5.4-mini" }],
    usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2, cost: null },
    artifacts: [],
    decisions: [],
    grillSession: null,
    approvals: [],
    workPackages: [],
    candidates: [],
    runs: [],
    events: [],
    ...overrides,
  };
}

function makeGateFreshness(stage, {
  fresh = false,
  sourceRunId = null,
  sourceArtifactId = null,
  reasonCode = fresh ? "fresh" : "missing_authoritative_summary",
  reasonCopy = fresh
    ? "The latest terminal run is authoritative for the active candidate."
    : "No authoritative persisted terminal run summary is available for this gate.",
  focusedTest = null,
} = {}) {
  const reason = { code: reasonCode, copy: reasonCopy };
  return {
    stage,
    candidateId: "C1",
    candidateRevision: 2,
    target: { candidateId: "C1", candidateRevision: 2 },
    state: fresh ? "fresh" : "stale",
    fresh,
    sourceRunId,
    sourceArtifactId,
    reasonCode,
    reasonCopy,
    reason,
    staleReasonCode: fresh ? null : reasonCode,
    staleReasonCopy: fresh ? null : reasonCopy,
    staleReason: fresh ? null : reason,
    focusedTest,
    focusedTestRows: focusedTest?.rows ?? [],
  };
}

async function withWorkspace(run) {
  const vite = await createViteServer({
    configFile: false,
    logLevel: "error",
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false },
  });
  try {
    const module = await vite.ssrLoadModule("/src/components/RuntimeTaskWorkspace.tsx");
    const candidateDiffViewer = await vite.ssrLoadModule("/src/components/CandidateDiffViewer.tsx");
    const runActivity = await vite.ssrLoadModule("/src/components/RunActivity.tsx");
    const runtimeInspector = await vite.ssrLoadModule("/src/components/runtime/RuntimeInspectorPanels.tsx");
    const runtimeWorkflow = await vite.ssrLoadModule("/src/components/runtime/workflow.ts");
    const requestIdentity = await vite.ssrLoadModule("/src/requestIdentity.ts");
    return await run({ ...module, ...candidateDiffViewer, ...runActivity, ...runtimeInspector, ...runtimeWorkflow, ...requestIdentity, loadApiModule: () => vite.ssrLoadModule("/src/api.ts") });
  } finally {
    await vite.close();
  }
}
