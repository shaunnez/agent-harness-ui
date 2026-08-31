import assert from "node:assert/strict";
import test from "node:test";
import {
  assertTrustedActionCard,
  createTrustedActionCard,
  isTrustedActionCard,
  validateActionCard,
} from "../src/companion/catalog.ts";
import { contextualAnswer, deriveCompanionContext } from "../src/companion/context.ts";
import {
  companionGateStages,
  confirmActionProposal,
  createActionProposal,
  dismissActionProposal,
  executeActionProposal,
  retainProposalDenial,
} from "../src/companion/contracts.ts";
import { parseCompanionIntent } from "../src/companion/intentParser.ts";

const eligibility = {
  eligible: true,
  rationale: "The current task has the required persisted evidence.",
  evidence: ["Repository authority is bound.", "The candidate worktree is clean."],
};

function promotionProposal(overrides = {}) {
  return createActionProposal({
    id: "proposal-1",
    actionType: "promote-gate",
    summary: "Promote AH-001 to Dev Review",
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

test("derives task and latest candidate context without conflating active and viewed stages", () => {
  const context = deriveCompanionContext({
    route: "#/tasks/OPS-2147/dev-review",
    task: {
      id: "OPS-2147",
      currentStage: "implement",
      candidates: [{ id: "C1", revisionNumber: 4 }],
    },
    viewedStage: "dev-review",
  });

  assert.deepEqual(context, {
    route: "#/tasks/OPS-2147/dev-review",
    taskId: "OPS-2147",
    activeStage: "implement",
    viewedStage: "dev-review",
    candidateId: "C1",
    candidateRevision: 4,
  });

  const answer = contextualAnswer(context);
  assert.match(answer, /Route: #\/tasks\/OPS-2147\/dev-review/);
  assert.match(answer, /Selected task: OPS-2147/);
  assert.match(answer, /Active runtime stage: Implement/);
  assert.match(answer, /Viewed stage: Dev review \(future inspection; runtime remains Implement\)/);
  assert.match(answer, /Candidate: C1 at revision 4/);
  assert.doesNotMatch(answer, /Active runtime stage: Dev review/);
});

test("derives an unselected context without inventing task or candidate state", () => {
  const context = deriveCompanionContext({ route: "#/tasks" });
  assert.deepEqual(context, {
    route: "#/tasks",
    activeStage: null,
    viewedStage: null,
  });
  assert.match(contextualAnswer(context), /Selected task: none selected/);
  assert.match(contextualAnswer(context), /Candidate: none recorded/);
});

test("parses supported natural language into a closed hybrid intent set", () => {
  assert.deepEqual(parseCompanionIntent("What am I looking at?"), {
    status: "accepted",
    intent: { kind: "context" },
  });
  assert.deepEqual(parseCompanionIntent("Take me to Tasks"), {
    status: "accepted",
    intent: { kind: "navigate", target: "tasks" },
  });
  assert.deepEqual(parseCompanionIntent("Open OPS-2147"), {
    status: "accepted",
    intent: { kind: "navigate", target: "task", taskId: "OPS-2147" },
  });
  assert.deepEqual(parseCompanionIntent("Create a new task"), {
    status: "accepted",
    intent: { kind: "create-task" },
  });
  assert.deepEqual(parseCompanionIntent("Change the implementation model to Sol High"), {
    status: "accepted",
    intent: {
      kind: "change-role-model",
      role: "implement",
      model: "gpt-5.6-sol",
      reasoning: "high",
    },
  });
  assert.deepEqual(parseCompanionIntent("Promote this to Dev Review"), {
    status: "accepted",
    intent: { kind: "promote-gate", nextStage: "dev-review" },
  });
  assert.deepEqual(companionGateStages, ["dev-review", "test", "final-review", "approval"]);
});

test("rejects ambiguous compound requests while keeping navigation read-only", () => {
  assert.deepEqual(parseCompanionIntent("Open tasks"), {
    status: "accepted",
    intent: { kind: "navigate", target: "tasks" },
  });
  assert.deepEqual(parseCompanionIntent("Open TASKS"), {
    status: "accepted",
    intent: { kind: "navigate", target: "tasks" },
  });

  for (const request of ["Change the implementation and test model", "Promote this to Dev Review or Test"]) {
    const result = parseCompanionIntent(request);
    assert.equal(result.status, "rejected");
    assert.equal(result.reasonCode, "ambiguous-intent");
    assert.equal(result.intent, null);
  }
});

test("unknown, ambiguous, and unsafe typed input never becomes an executable fallback", () => {
  const unknown = parseCompanionIntent("Run whatever tool is needed");
  assert.equal(unknown.status, "rejected");
  assert.equal(unknown.reasonCode, "unknown-intent");
  assert.equal(unknown.intent, null);
  assert.ok(unknown.examples.length >= 3);

  const ambiguous = parseCompanionIntent("Change the model");
  assert.equal(ambiguous.status, "rejected");
  assert.equal(ambiguous.reasonCode, "ambiguous-intent");
  assert.equal(ambiguous.intent, null);

  const extraField = parseCompanionIntent({ kind: "context", endpoint: "/api/tasks" });
  assert.equal(extraField.status, "rejected");
  assert.equal(extraField.reasonCode, "invalid-typed-intent");
  assert.equal(extraField.intent, null);

  const arbitraryHandler = parseCompanionIntent({
    kind: "promote-gate",
    nextStage: "dev-review",
    handler: "fetch('/api')",
  });
  assert.equal(arbitraryHandler.status, "rejected");
  assert.equal(arbitraryHandler.intent, null);
});

test("proposals remain inert until explicit confirmation, then require execution acknowledgement", () => {
  const proposed = promotionProposal();
  assert.equal(proposed.state, "proposed");
  assert.equal(proposed.confirmationRequired, true);
  assert.equal("endpoint" in proposed, false);
  assert.equal("handler" in proposed, false);

  const confirmed = confirmActionProposal(proposed, { at: "2026-08-31T00:01:00.000Z" });
  assert.equal(confirmed.state, "confirmed");
  assert.equal(confirmed.confirmedAt, "2026-08-31T00:01:00.000Z");
  assert.equal(proposed.state, "proposed");

  const executed = executeActionProposal(confirmed, "2026-08-31T00:02:00.000Z");
  assert.equal(executed.state, "executed");
  assert.equal(executed.executedAt, "2026-08-31T00:02:00.000Z");
  assert.throws(() => executeActionProposal(proposed), /Only confirmed/);
});

test("dismissal and failed confirmation retain a non-executed audit state", () => {
  const proposed = promotionProposal();
  const dismissed = dismissActionProposal(proposed, {
    reason: "Operator wants to inspect the artifact first.",
    at: "2026-08-31T00:03:00.000Z",
  });
  assert.equal(dismissed.state, "dismissed");
  assert.equal(dismissed.dismissedReason, "Operator wants to inspect the artifact first.");
  assert.equal(dismissed.executedAt, undefined);

  const denied = retainProposalDenial(proposed, {
    code: "stale-candidate",
    reason: "Candidate C1 revision 4 is no longer current.",
    at: "2026-08-31T00:04:00.000Z",
  });
  assert.equal(denied.state, "proposed");
  assert.deepEqual(denied.failure, {
    code: "stale-candidate",
    reason: "Candidate C1 revision 4 is no longer current.",
    retainedAt: "2026-08-31T00:04:00.000Z",
  });
  assert.throws(
    () =>
      confirmActionProposal(
        createActionProposal({
          id: "ineligible",
          actionType: "promote-gate",
          summary: "Blocked promotion",
          eligibility: {
            eligible: false,
            rationale: "The candidate is stale.",
            evidence: ["Revision drift."],
          },
          target: promotionProposal().target,
          createdAt: "2026-08-31T00:00:00.000Z",
        }),
      ),
    /not eligible/,
  );
});

test("catalogue accepts only fixed action cards and rejects executable or unknown data", () => {
  const card = createTrustedActionCard(promotionProposal());
  assert.equal(validateActionCard(card), true);
  assert.equal(isTrustedActionCard(card), true);
  assert.doesNotThrow(() => assertTrustedActionCard(card));

  assert.equal(isTrustedActionCard({ type: "unknown-card", proposal: card.proposal }), false);
  assert.equal(
    isTrustedActionCard({
      type: "promote-gate",
      proposal: card.proposal,
      handler: () => undefined,
    }),
    false,
  );
  assert.equal(
    isTrustedActionCard({
      type: "promote-gate",
      proposal: { ...card.proposal, endpoint: "/api/tasks/AH-001/action" },
    }),
    false,
  );
  assert.equal(
    isTrustedActionCard({
      type: "promote-gate",
      proposal: { ...card.proposal, target: { ...card.proposal.target, url: "https://example.invalid" } },
    }),
    false,
  );
  assert.throws(
    () =>
      assertTrustedActionCard({
        type: "change-role-model",
        proposal: card.proposal,
      }),
    /type must match/,
  );

  assert.equal(
    isTrustedActionCard({
      ...card,
      proposal: { ...card.proposal, state: "proposed", confirmedAt: "2026-08-31T00:01:00.000Z" },
    }),
    false,
  );
});

test("proposal construction rejects runtime extras before a card can be rendered", () => {
  const input = {
    id: "unsafe-proposal",
    actionType: "promote-gate",
    summary: "Promote AH-001 to Dev Review",
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
  };
  assert.throws(
    () => createActionProposal({ ...input, endpoint: "/api/tasks/AH-001/action" }),
    /unknown or missing field/,
  );
  assert.throws(
    () =>
      createActionProposal({
        ...input,
        target: { ...input.target, handler: "execute" },
      }),
    /Gate proposals require exact task/,
  );
});

test("catalogue preserves exact task snapshot and candidate scopes", () => {
  const modelProposal = createActionProposal({
    id: "model-proposal",
    actionType: "change-role-model",
    summary: "Use Sol High for this task's Implement agent.",
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
  assert.equal(isTrustedActionCard(createTrustedActionCard(modelProposal)), true);
  assert.equal(modelProposal.target.scope, "task_snapshot");
  assert.equal(modelProposal.target.taskId, "AH-001");
  assert.equal(modelProposal.target.role, "implement");
  assert.equal(modelProposal.target.model, "gpt-5.6-sol");

  const createTaskProposal = createActionProposal({
    id: "create-proposal",
    actionType: "create-task",
    summary: "Create the reviewed task draft.",
    eligibility: {
      eligible: true,
      rationale: "The draft is complete and will be revalidated by the task endpoint.",
      evidence: ["Title, description, repository, workflow, and priority are present."],
    },
    target: {
      kind: "new-task",
      draft: {
        title: "Add task priority",
        description: "Expose task priority.",
        repositoryPath: "/workspace/project",
        workflow: "implement",
        priority: "medium",
      },
    },
    createdAt: "2026-08-31T00:00:00.000Z",
  });
  assert.equal(isTrustedActionCard(createTrustedActionCard(createTaskProposal)), true);
});
