import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer as createViteServer } from "vite";
import { createTrustedActionCard } from "../src/companion/catalog.ts";
import { deriveCompanionContext } from "../src/companion/context.ts";
import {
  confirmActionProposal,
  createActionProposal,
  dismissActionProposal,
  executeActionProposal,
  retainProposalDenial,
} from "../src/companion/contracts.ts";

const eligibility = {
  eligible: true,
  rationale: "The current task carries the required persisted evidence.",
  evidence: ["Repository authority is bound.", "The exact candidate worktree is clean."],
};

function roleModelProposal() {
  return createActionProposal({
    id: "model-proposal",
    actionType: "change-role-model",
    summary: "Use Sol High for the Implement agent on this task.",
    eligibility,
    target: {
      kind: "task-agent-policy",
      scope: "task_snapshot",
      taskId: "AH-001",
      role: "implement",
      model: "gpt-5.6-sol",
      reasoning: "high",
    },
    createdAt: "2026-08-31T00:00:00.000Z",
  });
}

function promotionProposal(overrides = {}) {
  return createActionProposal({
    id: "promotion-proposal",
    actionType: "promote-gate",
    summary: "Promote AH-001 from Implement to Dev review.",
    eligibility,
    target: {
      kind: "candidate-gate",
      scope: "candidate",
      taskId: "AH-001",
      candidateId: "C1",
      candidateRevision: 4,
      nextStage: "dev-review",
    },
    createdAt: "2026-08-31T00:00:00.000Z",
    ...overrides,
  });
}

function createTaskProposal() {
  return createActionProposal({
    id: "create-proposal",
    actionType: "create-task",
    summary: "Create the validated task draft for the operator.",
    eligibility,
    target: {
      kind: "new-task",
      draft: {
        title: "Improve task routing",
        description: "Route task requests through the governed companion.",
        repositoryPath: "/work/agent-harness",
        workflow: "implement",
        priority: "medium",
        model: "gpt-5.6-luna",
        reasoning: "xhigh",
      },
    },
    createdAt: "2026-08-31T00:00:00.000Z",
  });
}

async function withCompanion(run) {
  const vite = await createViteServer({
    configFile: false,
    logLevel: "error",
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false, host: "127.0.0.1", ws: false },
  });
  try {
    const panel = await vite.ssrLoadModule("/src/components/companion/CompanionPanel.tsx");
    const catalog = await vite.ssrLoadModule("/src/components/companion/ActionCardCatalog.tsx");
    const composer = await vite.ssrLoadModule("/src/components/companion/CompanionComposer.tsx");
    return await run({ ...panel, ...catalog, ...composer });
  } finally {
    await vite.close();
  }
}

function baseContext() {
  return deriveCompanionContext({
    route: "#/tasks/AH-001/implement",
    task: {
      id: "AH-001",
      currentStage: "dev-review",
      candidates: [{ id: "C1", revisionNumber: 4 }],
    },
    viewedStage: "implement",
  });
}

function callbackProps(overrides = {}) {
  return {
    onConfirmAction: () => {},
    onDismissAction: () => {},
    ...overrides,
  };
}

test("renders the context ribbon and default answer with active/viewed evidence", async () => {
  await withCompanion(async ({ CompanionPanel }) => {
    const markup = render(
      React.createElement(CompanionPanel, { context: baseContext(), ...callbackProps() }),
    );

    assert.match(markup, /Current workflow context/);
    assert.match(markup, /#\/tasks\/AH-001\/implement/);
    assert.match(markup, /AH-001/);
    assert.match(markup, /Dev review/);
    assert.match(markup, /Implement/);
    assert.match(markup, /Stale inspection/);
    assert.match(markup, /C1 · r4/);
    assert.match(markup, /Active runtime stage: Dev review/);
    assert.match(markup, /Viewed stage: Implement \(stale inspection/);
    assert.match(markup, /aria-label="Companion conversation"/);
  });
});

test("renders all supported mutations as fixed, reviewable proposed cards without invoking callbacks", async () => {
  let confirms = 0;
  let dismissals = 0;
  await withCompanion(async ({ CompanionPanel }) => {
    const markup = render(
      React.createElement(CompanionPanel, {
        context: baseContext(),
        proposals: [createTaskProposal(), roleModelProposal(), promotionProposal()],
        onConfirmAction: () => {
          confirms += 1;
        },
        onDismissAction: () => {
          dismissals += 1;
        },
      }),
    );

    assert.equal(confirms, 0);
    assert.equal(dismissals, 0);
    assert.equal((markup.match(/data-proposal-state="proposed"/g) ?? []).length, 3);
    assert.match(markup, /Create a new task/);
    assert.match(markup, /Improve task routing/);
    assert.match(markup, /Task snapshot only/);
    assert.match(markup, /gpt-5\.6-sol/);
    assert.match(markup, /Global settings/);
    assert.match(markup, /Exact candidate revision/);
    assert.match(markup, /C1 · r4/);
    assert.match(markup, /Explicit confirmation is required/);
    assert.equal((markup.match(/>Confirm</g) ?? []).length, 3);
    assert.equal((markup.match(/>Dismiss</g) ?? []).length, 3);
    assert.doesNotMatch(markup, /endpoint|handler|fetch\(/i);
  });
});

test("renders lifecycle and denial evidence without inventing execution", async () => {
  const executed = executeActionProposal(
    confirmActionProposal(promotionProposal(), { at: "2026-08-31T00:01:00.000Z" }),
    "2026-08-31T00:02:00.000Z",
  );
  const dismissed = dismissActionProposal(roleModelProposal(), {
    reason: "Inspect the current policy first.",
    at: "2026-08-31T00:03:00.000Z",
  });
  const denied = retainProposalDenial(createTaskProposal(), {
    code: "invalid-policy",
    reason: "The selected model is not in the discovered allowlist.",
    at: "2026-08-31T00:04:00.000Z",
  });

  await withCompanion(async ({ ActionCardCatalog }) => {
    const markup = render(
      React.createElement(ActionCardCatalog, {
        proposals: [executed, dismissed, denied],
        ...callbackProps(),
      }),
    );

    assert.match(markup, /data-proposal-state="executed"/);
    assert.match(markup, /Executed after server confirmation/);
    assert.match(markup, /Dismissed — Inspect the current policy first\./);
    assert.match(markup, /Confirmation not executed\./);
    assert.match(markup, /selected model is not in the discovered allowlist/);
    assert.doesNotMatch(markup, /data-proposal-state="confirmed"[\s\S]*>Confirm</);
  });
});

test("rejects untrusted card payloads without exposing executable data", async () => {
  const trusted = createTrustedActionCard(promotionProposal());
  const unsafe = {
    ...trusted.proposal,
    endpoint: "/api/tasks/AH-001/action",
    target: { ...trusted.proposal.target, repositoryPath: "/outside/worktree" },
  };

  await withCompanion(async ({ ActionCardCatalog }) => {
    const markup = render(
      React.createElement(ActionCardCatalog, {
        proposals: [unsafe],
        ...callbackProps(),
      }),
    );
    assert.match(markup, /rejected because it is not in the trusted catalogue/);
    assert.doesNotMatch(markup, /\/api\/tasks|outside\/worktree/);
    assert.doesNotMatch(markup, /data-proposal-state/);
  });
});

test("keeps keyboard submission, multiline, and companion focus shortcut explicit", async () => {
  await withCompanion(
    async ({ CompanionComposer, CompanionPanel, shouldSubmitCompanionKey, isCompanionFocusShortcut }) => {
      assert.equal(shouldSubmitCompanionKey({ key: "Enter", shiftKey: false, isComposing: false }), true);
      assert.equal(shouldSubmitCompanionKey({ key: "Enter", shiftKey: true, isComposing: false }), false);
      assert.equal(shouldSubmitCompanionKey({ key: "Enter", shiftKey: false, isComposing: true }), false);
      assert.equal(isCompanionFocusShortcut({ key: "k", metaKey: true, ctrlKey: false }), true);
      assert.equal(isCompanionFocusShortcut({ key: "K", metaKey: false, ctrlKey: true }), true);
      assert.equal(isCompanionFocusShortcut({ key: "k", metaKey: false, ctrlKey: false }), false);

      const composerMarkup = render(
        React.createElement(CompanionComposer, {
          onSubmit: () => {},
          defaultValue: "What am I looking at?",
        }),
      );
      assert.match(composerMarkup, /Enter to send · Shift\+Enter for a new line/);
      assert.match(composerMarkup, /aria-keyshortcuts="Enter Shift\+Enter"/);
      assert.match(composerMarkup, /Message Agent Harness/);

      const panelMarkup = render(
        React.createElement(CompanionPanel, { context: baseContext(), ...callbackProps() }),
      );
      assert.match(panelMarkup, /aria-keyshortcuts="Control\+K Meta\+K"/);
      assert.match(panelMarkup, /role="status"/);
    },
  );
});

function render(element) {
  return renderToStaticMarkup(element);
}
