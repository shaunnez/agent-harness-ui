import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createServer as createViteServer } from "vite";
import { deriveCompanionContext } from "../src/companion/context.ts";
import { createActionProposal } from "../src/companion/contracts.ts";
import { createTask, React, renderToStaticMarkup, withWorkspace } from "./runtime-test-support.mjs";

async function withApi(run) {
  const vite = await createViteServer({
    configFile: false,
    logLevel: "error",
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false, host: "127.0.0.1", ws: false },
  });
  try {
    return await run(await vite.ssrLoadModule("/src/api.ts"));
  } finally {
    await vite.close();
  }
}

test("companion API helpers keep CSRF, task-policy, and exact candidate scope at the boundary", async () => {
  await withApi(async ({ getRuntimeStatus, updateTaskRolePolicy, promoteTaskThroughGate }) => {
    const originalFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (input, init) => {
      calls.push({ path: String(input), init });
      if (String(input) === "/api/runtime/status") {
        return new Response(JSON.stringify({ csrfToken: "s4-csrf" }), { status: 200 });
      }
      return new Response(JSON.stringify({ task: { id: "AH-001" }, started: true, scope: "task_snapshot" }), {
        status: 200,
      });
    };
    try {
      await getRuntimeStatus();
      await updateTaskRolePolicy("AH-001", {
        role: "implement",
        model: "gpt-5.6-sol",
        reasoning: "high",
      });
      await promoteTaskThroughGate("AH-001", "review", {
        candidateId: "cand-9f2ac7",
        candidateRevision: 4,
        candidateHeadRevision: "4ce91b2",
      });

      assert.deepEqual(JSON.parse(calls[1].init.body), {
        role: "implement",
        model: "gpt-5.6-sol",
        reasoning: "high",
      });
      assert.deepEqual(JSON.parse(calls[2].init.body), {
        note: "",
        candidateId: "cand-9f2ac7",
        candidateRevision: 4,
        candidateHeadRevision: "4ce91b2",
      });
      assert.equal(calls[1].init.headers["x-agent-harness-csrf"], "s4-csrf");
      assert.equal(calls[2].init.headers["x-agent-harness-csrf"], "s4-csrf");
      assert.equal(calls[1].path, "/api/tasks/AH-001/agent-policy");
      assert.equal(calls[2].path, "/api/tasks/AH-001/review");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("companion API retains a stale-candidate denial instead of presenting success", async () => {
  await withApi(async ({ getRuntimeStatus, promoteTaskThroughGate, RuntimeApiError }) => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      if (String(input) === "/api/runtime/status") {
        return new Response(JSON.stringify({ csrfToken: "s4-csrf" }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          error: "The candidate changed after this action was proposed.",
          code: "stale-candidate",
          evidence: ["Current candidate: cand-new revision 5."],
        }),
        { status: 409 },
      );
    };
    try {
      await getRuntimeStatus();
      await assert.rejects(
        () =>
          promoteTaskThroughGate("AH-001", "review", {
            candidateId: "cand-old",
            candidateRevision: 4,
            candidateHeadRevision: "old-head",
          }),
        (error) => {
          assert.equal(error instanceof RuntimeApiError, true);
          assert.equal(error.code, "stale-candidate");
          assert.deepEqual(error.evidence, ["Current candidate: cand-new revision 5."]);
          return true;
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("companion task creation fails closed on stale CSRF without retrying or creating a task", async () => {
  await withApi(async ({ createTask, RuntimeApiError }) => {
    const originalFetch = globalThis.fetch;
    const calls = [];
    let taskCreationCalls = 0;
    globalThis.fetch = async (input) => {
      const path = String(input);
      calls.push(path);
      if (path === "/api/runtime/status") {
        return new Response(JSON.stringify({ csrfToken: "fresh-csrf" }), { status: 200 });
      }
      if (path === "/api/tasks") {
        taskCreationCalls += 1;
        return new Response(JSON.stringify({ error: "The CSRF token is stale." }), { status: 403 });
      }
      return new Response(JSON.stringify({ task: { id: "unexpected" } }), { status: 201 });
    };
    try {
      await assert.rejects(
        () => createTask({}, { retryOnCsrf: false }),
        (error) => {
          assert.equal(error instanceof RuntimeApiError, true);
          assert.equal(error.status, 403);
          assert.match(error.message, /csrf token/i);
          return true;
        },
      );
      assert.deepEqual(calls, ["/api/tasks"]);
      assert.equal(taskCreationCalls, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("companion API retains a stale-CSRF denial without retrying the mutation", async () => {
  await withApi(
    async ({ getRuntimeStatus, updateTaskRolePolicy, promoteTaskThroughGate, RuntimeApiError }) => {
      const originalFetch = globalThis.fetch;
      const calls = [];
      globalThis.fetch = async (input) => {
        calls.push(String(input));
        if (String(input) === "/api/runtime/status") {
          return new Response(JSON.stringify({ csrfToken: "s4-csrf" }), { status: 200 });
        }
        return new Response(JSON.stringify({ error: "The CSRF token is stale." }), { status: 403 });
      };
      try {
        await getRuntimeStatus();
        for (const attempt of [
          () =>
            updateTaskRolePolicy("AH-001", {
              role: "implement",
              model: "gpt-5.6-sol",
              reasoning: "high",
            }),
          () =>
            promoteTaskThroughGate("AH-001", "review", {
              candidateId: "cand-9f2ac7",
              candidateRevision: 4,
              candidateHeadRevision: "4ce91b2",
            }),
        ]) {
          await assert.rejects(attempt, (error) => {
            assert.equal(error instanceof RuntimeApiError, true);
            assert.equal(error.status, 403);
            assert.match(error.message, /csrf token/i);
            return true;
          });
        }
        assert.deepEqual(calls, [
          "/api/runtime/status",
          "/api/tasks/AH-001/agent-policy",
          "/api/tasks/AH-001/review",
        ]);
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  );
});

test("workspace keeps the universal inspector separate from the global companion", async () => {
  await withWorkspace(async ({ RuntimeTaskWorkspace }) => {
    const task = createTask({ id: "AH-001", currentStage: "dev-review", status: "ready-for-review" });
    const context = deriveCompanionContext({
      route: "#/tasks/AH-001/implement",
      task: { id: task.id, currentStage: task.currentStage, candidates: [{ id: "C1", revisionNumber: 4 }] },
      viewedStage: "implement",
    });
    const proposal = createActionProposal({
      id: "promotion",
      actionType: "promote-gate",
      summary: "Promote the exact candidate to Dev Review.",
      eligibility: {
        eligible: true,
        rationale: "The server will revalidate this exact candidate after confirmation.",
        evidence: ["Candidate C1 revision 4 is shown for review."],
      },
      target: {
        kind: "candidate-gate",
        scope: "candidate",
        taskId: task.id,
        candidateId: "C1",
        candidateRevision: 4,
        nextStage: "dev-review",
      },
    });
    const markup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task,
        companionContext: context,
        companionMessages: [
          {
            id: "welcome",
            role: "assistant",
            content: "Active runtime stage: Dev review\nViewed stage: Implement (stale).",
          },
        ],
        companionProposals: [proposal],
        onCompanionSubmitText: async () => {},
        onCompanionConfirmAction: async () => {},
        onCompanionDismissAction: async () => {},
        onBack: () => {},
        onRun: async () => {},
        onCancel: async () => {},
        onCloseTask: async () => {},
        onArchiveTask: async () => {},
        onEvaluate: async () => {},
        onAction: async () => {},
        onDecision: async () => {},
        onGrillAnswer: async () => {},
        onFinishGrill: async () => {},
        onSelectDesign: async () => {},
        onRetryDesigns: async () => {},
        onRemoveWorktree: async () => {},
        onProfileChange: async () => {},
      }),
    );
    assert.match(markup, /class="stage-inspector runtime-inspector"/);
    assert.doesNotMatch(markup, /Evidence Gate companion/);
    assert.doesNotMatch(markup, /data-proposal-state="proposed"/);
  });
});

async function withShell(run) {
  const vite = await createViteServer({
    configFile: false,
    logLevel: "error",
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false, host: "127.0.0.1", ws: false },
  });
  try {
    return await run(await vite.ssrLoadModule("/src/components/companion/CompanionShell.tsx"));
  } finally {
    await vite.close();
  }
}

test("the shell renders one global companion surface and a labelled launcher", async () => {
  await withShell(async ({ CompanionShell }) => {
    const markup = renderToStaticMarkup(
      React.createElement(CompanionShell, {
        open: true,
        onOpen: () => {},
        onClose: () => {},
        context: baseShellContext("#/tasks/AH-001/implement"),
        messages: [{ id: "message", role: "assistant", content: "Retained message" }],
        proposals: [],
        onConfirmAction: async () => {},
        onDismissAction: async () => {},
      }),
    );
    assert.equal((markup.match(/Evidence Gate companion/g) ?? []).length, 1);
    assert.match(markup, /Open contextual companion|Close contextual companion/);
    assert.match(markup, /aria-controls="companion-surface"/);
    assert.match(markup, /aria-keyshortcuts="Control\+K Meta\+K"/);
    assert.match(markup, /Retained message/);
  });
});

test("companion context refreshes by route and viewed stage without changing the retained thread contract", () => {
  const taskContext = baseShellContext("#/tasks/AH-001/implement");
  const settingsContext = deriveCompanionContext({ route: "#/settings", viewedStage: null });
  assert.equal(taskContext.taskId, "AH-001");
  assert.equal(taskContext.viewedStage, "implement");
  assert.equal(settingsContext.taskId, undefined);
  assert.equal(settingsContext.viewedStage, null);
});

test("companion has one internal scroll owner and no workspace support-column reservation", async () => {
  const styles = await readFile(
    new URL("../src/components/companion/companion.css", import.meta.url),
    "utf8",
  );
  assert.match(styles, /\.companion-panel__scroll[\s\S]*?overflow: auto/);
  assert.doesNotMatch(styles, /\.companion-thread\s*\{[\s\S]*?overflow:\s*(?:auto|scroll)/);
  assert.doesNotMatch(styles, /gridTemplateRows/);
  const workspace = await readFile(
    new URL("../src/components/RuntimeTaskWorkspace.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(workspace, /CompanionPanel|companionContext|onCompanion/);
});

test("App owns retention and the shell owns keyboard, focus, and narrow-sheet boundaries", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const shell = await readFile(
    new URL("../src/components/companion/CompanionShell.tsx", import.meta.url),
    "utf8",
  );
  assert.equal((app.match(/<CompanionShell\b/g) ?? []).length, 1);
  assert.match(app, /const \[companionDraft, setCompanionDraft\] = useState\(""\)/);
  assert.match(app, /setCompanionDraft\(""\)/);
  assert.doesNotMatch(
    app.match(/if \(primaryRoute\.kind !== "task"\) \{([\s\S]*?)return;/)?.[1] ?? "",
    /setCompanionMessages|setCompanionProposals/,
  );
  assert.match(shell, /isCompanionFocusShortcut/);
  assert.match(shell, /event\.key !== "Escape"/);
  assert.match(shell, /getFocusableElements/);
  assert.match(shell, /aria-modal=\{narrow \? true : undefined\}/);
  assert.match(shell, /setAttribute\("aria-hidden", "true"\)/);
  assert.match(shell, /composerRef\.current\?\.focus\(\)/);
  assert.match(shell, /launcherRef\.current\?\.focus\(\)/);
});

function baseShellContext(route) {
  return deriveCompanionContext({
    route,
    task: {
      id: "AH-001",
      currentStage: "dev-review",
      candidates: [{ id: "C1", revisionNumber: 4 }],
    },
    viewedStage: "implement",
  });
}
