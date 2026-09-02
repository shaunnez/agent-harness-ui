import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer as createViteServer } from "vite";
import {
  companionPolicyRoleIds,
  companionRoleOptions,
  createTrustedActionCard,
  isExactRolePolicyRequest,
  isTrustedRolePolicyRequest,
  resetInvalidRolePolicyReasoning,
  selectableRolePolicyModels,
} from "../src/companion/catalog.ts";
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

const modelCatalog = [
  {
    id: "gpt-5.6-luna",
    label: "GPT-5.6 Luna",
    description: "Discovered Luna model.",
    defaultReasoning: "xhigh",
    reasoningLevels: ["medium", "high", "xhigh"],
    pricing: null,
    provider: "codex",
    provenance: "discovered",
    availability: "discovered",
    editable: true,
  },
  {
    id: "gpt-5.6-sol",
    label: "GPT-5.6 Sol",
    description: "Discovered Sol model.",
    defaultReasoning: "high",
    reasoningLevels: ["high", "xhigh"],
    pricing: null,
    provider: "codex",
    provenance: "discovered",
    availability: "discovered",
    editable: true,
  },
  {
    id: "gpt-configured-only",
    label: "Configured only",
    description: "Not discovered.",
    defaultReasoning: "high",
    reasoningLevels: ["high"],
    pricing: null,
    provider: "codex",
    provenance: "configured",
    availability: "configured",
    editable: false,
  },
  {
    id: "gpt-unsupported",
    label: "Unsupported",
    description: "Not selectable.",
    defaultReasoning: "high",
    reasoningLevels: ["high"],
    pricing: null,
    provider: null,
    provenance: "bundled-fallback",
    availability: "unsupported",
    editable: false,
  },
  {
    id: "https://untrusted.invalid/render",
    label: "Untrusted endpoint",
    description: "Must never become a control.",
    defaultReasoning: "high",
    reasoningLevels: ["high"],
    pricing: null,
    provider: "codex",
    provenance: "discovered",
    availability: "discovered",
    editable: true,
  },
];

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
        designRequested: true,
        designPolicies: {
          "claude-design": { provider: "claude", model: "claude-opus-5", reasoning: "high" },
          "codex-design": { provider: "codex", model: "gpt-5.6-sol", reasoning: "high" },
        },
        workflowProfile: "high-risk",
        model: "gpt-5.6-luna",
        reasoning: "xhigh",
        experiment: {
          groupId: "companion-suite",
          variantId: "governed-card",
          frozenBaseSha: "base-sha",
          acceptanceCriteria: ["Card shows exact draft"],
          verificationCommands: ["npm run typecheck"],
        },
        attachments: [{ name: "brief.md", type: "text/markdown", size: 4, data: "ZGF0" }],
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
    const rolePolicy = await vite.ssrLoadModule("/src/components/companion/RolePolicyActionCard.tsx");
    return await run({ ...panel, ...catalog, ...composer, ...rolePolicy });
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
    assert.match(markup, /high-risk/);
    assert.match(markup, /Requested/);
    assert.match(markup, /Claude Design/);
    assert.match(markup, /claude-opus-5 · high/);
    assert.match(markup, /Codex Design/);
    assert.match(markup, /gpt-5\.6-luna/);
    assert.match(markup, /xhigh/);
    assert.match(markup, /companion-suite/);
    assert.match(markup, /governed-card/);
    assert.match(markup, /brief\.md/);
    assert.match(markup, /text\/markdown/);
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

test("projects only discovered editable allowlisted models and resets unsupported reasoning", () => {
  const selectable = selectableRolePolicyModels(modelCatalog, [
    "gpt-5.6-luna",
    "gpt-5.6-sol",
    "gpt-configured-only",
    "gpt-unsupported",
    "https://untrusted.invalid/render",
  ]);
  assert.deepEqual(
    selectable.map((model) => model.id),
    ["gpt-5.6-luna", "gpt-5.6-sol"],
  );
  assert.equal(resetInvalidRolePolicyReasoning(selectable[1], "max"), "high");
  assert.equal(resetInvalidRolePolicyReasoning(selectable[1], "xhigh"), "xhigh");
  assert.equal(
    isTrustedRolePolicyRequest(
      { role: "implement", model: "gpt-configured-only", reasoning: "high" },
      companionRoleOptions,
      selectable,
      ["gpt-configured-only"],
    ),
    false,
  );
  assert.equal(
    isTrustedRolePolicyRequest(
      { role: "implement", model: "gpt-5.6-sol", reasoning: "high" },
      companionRoleOptions,
      selectable,
      ["gpt-5.6-sol"],
    ),
    true,
  );
  assert.equal(
    isExactRolePolicyRequest(
      { model: "gpt-5.6-sol", reasoning: "high" },
      {
        role: "implement",
        model: "gpt-5.6-sol",
        reasoning: "high",
      },
    ),
    false,
  );
  assert.equal(companionPolicyRoleIds.includes("approval"), false);
  assert.equal(companionPolicyRoleIds.includes("scout-code-path"), false);
  assert.equal(
    companionRoleOptions.some((role) => role.id === "implement"),
    true,
  );
  assert.equal(
    isTrustedRolePolicyRequest(
      { role: "approval", model: "gpt-5.6-sol", reasoning: "high" },
      companionRoleOptions,
      selectable,
      ["gpt-5.6-sol"],
    ),
    false,
  );
  assert.equal(
    isTrustedRolePolicyRequest(
      { role: "scout-code-path", model: "gpt-5.6-sol", reasoning: "high" },
      companionRoleOptions,
      selectable,
      ["gpt-5.6-sol"],
    ),
    false,
  );
  assert.deepEqual(selectableRolePolicyModels(null, null), []);
});

test("renders the role policy as a trusted exact-request form", async () => {
  await withCompanion(async ({ RolePolicyActionCard }) => {
    const markup = render(
      React.createElement(RolePolicyActionCard, {
        proposal: roleModelProposal(),
        models: modelCatalog,
        allowedModels: ["gpt-5.6-luna", "gpt-5.6-sol", "gpt-configured-only"],
        currentPolicy: { model: "gpt-5.6-luna", reasoning: "high" },
        onConfirm: () => {},
        onDismiss: () => {},
      }),
    );

    assert.match(markup, /data-role-policy-form="trusted"/);
    assert.match(markup, /name="role"/);
    assert.match(markup, /name="model"/);
    assert.match(markup, /name="reasoning"/);
    assert.match(markup, /Known workflow role/);
    assert.match(markup, /Current policy/);
    assert.match(markup, /gpt-5\.6-luna · high/);
    assert.match(markup, /Requested policy/);
    assert.match(markup, /gpt-5\.6-sol · high/);
    assert.match(markup, /GPT-5\.6 Sol · gpt-5\.6-sol/);
    assert.doesNotMatch(markup, /Configured only|Unsupported/);
    assert.match(markup, /data-request-exact="true"/);
    assert.match(markup, /data-request-eligible="true"/);
    const confirmButton = markup.match(/<button[^>]*>[\s\S]*?Confirm<\/button>/)?.[0];
    assert.ok(confirmButton);
    assert.doesNotMatch(confirmButton, /disabled/);
  });
});

test("disables confirmation when the request is unchanged and makes draft capture explicit", async () => {
  await withCompanion(async ({ RolePolicyActionCard, ActionCardCatalog }) => {
    const unchanged = render(
      React.createElement(RolePolicyActionCard, {
        proposal: roleModelProposal(),
        models: modelCatalog,
        allowedModels: ["gpt-5.6-luna", "gpt-5.6-sol"],
        currentPolicy: { model: "gpt-5.6-sol", reasoning: "high" },
        onConfirm: () => {},
        onDismiss: () => {},
      }),
    );
    assert.match(unchanged, /data-request-exact="false"/);
    assert.match(unchanged, /The requested policy must differ from the current policy/);
    const unchangedConfirmButton = unchanged.match(/<button[^>]*>[\s\S]*?Confirm<\/button>/)?.[0];
    assert.ok(unchangedConfirmButton);
    assert.match(unchangedConfirmButton, /disabled/);

    const draftless = createActionProposal({
      id: "draftless-capture",
      actionType: "create-task",
      summary: "Prepare a new task draft for explicit confirmation.",
      eligibility: {
        eligible: false,
        rationale: "A complete draft must be captured before confirmation.",
        evidence: ["Capture attaches data to the proposal only."],
      },
      target: { kind: "new-task", draft: null },
    });
    const captureMarkup = render(
      React.createElement(ActionCardCatalog, {
        proposals: [draftless],
        ...callbackProps(),
      }),
    );
    assert.match(captureMarkup, /Capture only attaches a draft to this proposal/);
    assert.match(captureMarkup, /no task is created until you confirm/);
    assert.match(captureMarkup, /data-proposal-state="proposed"/);
    const captureConfirmButton = captureMarkup.match(/<button[^>]*>[\s\S]*?Confirm<\/button>/)?.[0];
    assert.ok(captureConfirmButton);
    assert.match(captureConfirmButton, /disabled/);
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
