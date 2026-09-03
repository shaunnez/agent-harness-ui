import test from "node:test";
import {
  maybeAutoApprovePlan,
  maybeAutoApproveSpecification,
  specificationCleanliness,
} from "../server/orchestrator-task-helpers.mjs";
import { assert, cleanup, createServer, createTask, fetch } from "./api-test-support.mjs";
import {
  JsonTaskStore,
  mkdtemp,
  os,
  path,
  PLAN_OUTPUT,
  rm,
  TaskOrchestrator,
  waitForStatus,
} from "./orchestrator-test-support.mjs";

const KNOWN_CHANGE_TITLE = "Known bounded change";
const KNOWN_CHANGE_DESCRIPTION = "No unresolved product decision remains.";

function fakeVerificationManifest() {
  return async () => ({
    source: ".agent-harness/verification.json",
    commands: [
      { id: "test", command: ["npm", "test"] },
      { id: "typecheck", command: ["npm", "run", "typecheck"] },
    ],
  });
}

function fakeInvestigationCodex() {
  return async ({ prompt }) => {
    const finalText = /Classify the task/.test(prompt)
      ? `<scout-dispatch>{"scouts":[],"rationale":"No additional scout evidence is needed."}</scout-dispatch>`
      : /Separate repository facts/.test(prompt)
        ? `<grill-questions>{"questions":[]}</grill-questions>`
        : /Turn the approved specification/.test(prompt)
          ? PLAN_OUTPUT
          : "## Specification\n\nThe bounded change is ready for approval.";
    return { finalText, usage: { inputTokens: 10, cachedInputTokens: 5, outputTokens: 5, totalTokens: 15 } };
  };
}

test("manual gate policy parks at each gate exactly as before, recording human-actor approvals", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-gate-policy-manual-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: KNOWN_CHANGE_TITLE,
      description: KNOWN_CHANGE_DESCRIPTION,
      repositoryPath: directory,
      workflow: "implement",
      priority: "low",
    });
    assert.deepEqual(task.gatePolicy, { specification: "manual", plan: "manual" });
    const orchestrator = new TaskOrchestrator(store, {
      getStatus: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
      readVerificationManifest: fakeVerificationManifest(),
      runCodex: fakeInvestigationCodex(),
    });

    assert.equal(await orchestrator.start(task.id), true);
    let finished = await waitForStatus(store, task.id, "awaiting-spec-approval");
    assert.equal(finished.approvals.length, 0, "the manual specification gate must not approve itself");

    await orchestrator.approveSpecification(task.id, "Looks good.");
    finished = await waitForStatus(store, task.id, "awaiting-plan-approval");
    const specApproval = finished.approvals.find((approval) => approval.stage === "specification");
    assert.ok(specApproval);
    assert.deepEqual(specApproval.actor, { kind: "human" });

    const beforePlanApproval = await store.get(task.id);
    assert.equal(
      beforePlanApproval.approvals.some((approval) => approval.stage === "plan"),
      false,
      "the manual plan gate must not approve itself",
    );
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("auto-on-clean at the specification gate records a policy approval and reaches planning without an API call", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-gate-policy-spec-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: KNOWN_CHANGE_TITLE,
      description: KNOWN_CHANGE_DESCRIPTION,
      repositoryPath: directory,
      workflow: "implement",
      priority: "low",
      gatePolicy: { specification: "auto-on-clean", plan: "manual" },
    });
    const orchestrator = new TaskOrchestrator(store, {
      getStatus: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
      readVerificationManifest: fakeVerificationManifest(),
      runCodex: fakeInvestigationCodex(),
    });

    // The task never calls approveSpecification itself — reaching planning proves the
    // orchestrator advanced on its own, through the same code path a human approval uses.
    assert.equal(await orchestrator.start(task.id), true);
    const finished = await waitForStatus(store, task.id, "awaiting-plan-approval");
    const specApproval = finished.approvals.find((approval) => approval.stage === "specification");
    assert.ok(specApproval, "expected an automatic specification approval");
    assert.deepEqual(specApproval.actor, { kind: "policy", policy: "auto-on-clean" });
    // Reaching planning at all (never mind completing it) is the point of this test: the
    // orchestrator advanced past specification on its own, with no approve-spec API call.
    assert.deepEqual(finished.completedStages, ["triage", "scouts", "grill", "specification", "plan"]);
    assert.equal(
      finished.events.some((event) => event.title === "Task specification approved"),
      true,
    );
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("specification cleanliness requires the artifact, a completed run, and every Grill question answered", () => {
  assert.deepEqual(specificationCleanliness({ artifacts: [], runs: [], grillSession: null }), {
    clean: false,
    reason: "No specification artifact has been recorded yet.",
  });
  assert.equal(
    specificationCleanliness({
      artifacts: [{ stage: "specification", runId: "R1" }],
      runs: [{ id: "R1", status: "failed" }],
      grillSession: null,
    }).clean,
    false,
  );
  assert.equal(
    specificationCleanliness({
      artifacts: [{ stage: "specification", runId: "R1" }],
      runs: [{ id: "R1", status: "completed" }],
      grillSession: { questions: [{ answer: null }] },
    }).clean,
    false,
  );
  assert.deepEqual(
    specificationCleanliness({
      artifacts: [{ stage: "specification", runId: "R1" }],
      runs: [{ id: "R1", status: "completed" }],
      grillSession: { questions: [{ answer: "Preserve it" }] },
    }),
    { clean: true, reason: null },
  );
});

test("auto-on-clean at the plan gate parks and logs the reason when repository authority is stale", async () => {
  const events = [];
  const fakeStore = {
    async get(id) {
      return { id, status: "awaiting-plan-approval", gatePolicy: { specification: "manual", plan: "auto-on-clean" } };
    },
    async update(id, updater) {
      const draft = { id, events };
      updater(draft);
      return draft;
    },
  };
  const staleMessage = "Repository authority changed or could not be verified. Revalidate the retained plan.";
  const approvePlan = async () => {
    throw new Error(staleMessage);
  };

  const applied = await maybeAutoApprovePlan(fakeStore, "AH-777", approvePlan);

  assert.equal(applied, false);
  assert.equal(events.length, 1);
  assert.equal(events[0].title, "Automatic plan approval did not apply");
  assert.equal(events[0].detail, staleMessage);
  assert.equal(events[0].tone, "warning");
});

test("the auto-approve helpers are no-ops when the gate policy is manual or the status has already moved on", async () => {
  let approveSpecificationCalls = 0;
  let approvePlanCalls = 0;
  const manualStore = {
    async get() {
      return { status: "awaiting-spec-approval", gatePolicy: { specification: "manual", plan: "manual" } };
    },
    async update() {
      throw new Error("must not log an event when the policy never applies");
    },
  };
  assert.equal(
    await maybeAutoApproveSpecification(manualStore, "AH-1", async () => {
      approveSpecificationCalls += 1;
    }),
    false,
  );
  assert.equal(approveSpecificationCalls, 0);

  const alreadyAdvancedStore = {
    async get() {
      return { status: "ready-for-implementation", gatePolicy: { specification: "auto-on-clean", plan: "auto-on-clean" } };
    },
    async update() {
      throw new Error("must not log an event when the status already moved on");
    },
  };
  assert.equal(
    await maybeAutoApprovePlan(alreadyAdvancedStore, "AH-1", async () => {
      approvePlanCalls += 1;
    }),
    false,
  );
  assert.equal(approvePlanCalls, 0);
});

test("a persisted approval with no actor is reported as human after migration", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-gate-policy-actor-"));
  try {
    const filePath = path.join(directory, "tasks.json");
    const store = new JsonTaskStore(filePath);
    await store.init();
    const task = await store.create({
      title: "Legacy approval carrier",
      description: "Simulates an approval recorded before actor provenance existed.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
    });
    await store.update(task.id, (draft) => {
      draft.approvals.push({
        id: "legacy-approval",
        stage: "specification",
        note: "Approved before actor provenance was recorded.",
        createdAt: "2026-01-01T00:00:00.000Z",
        artifactId: null,
      });
    });
    await store.close();

    const reopened = new JsonTaskStore(filePath);
    await reopened.init();
    const migrated = await reopened.get(task.id);
    const legacyApproval = migrated.approvals.find((approval) => approval.id === "legacy-approval");
    assert.ok(legacyApproval);
    assert.deepEqual(legacyApproval.actor, { kind: "human" });
    await reopened.close();
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("POST /api/tasks rejects an attempt to automate the candidate or merge gate", async () => {
  const { directory, origin, server } = await createServer();
  try {
    const candidateResponse = await createTask(origin, {
      title: "Reject unsupported gate automation",
      description: "Candidate and merge must stay manual.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
      gatePolicy: { candidate: "auto-on-clean" },
    });
    assert.equal(candidateResponse.status, 400);
    const candidateBody = await candidateResponse.json();
    assert.match(candidateBody.error, /candidate.*must stay manual/i);

    const mergeResponse = await createTask(origin, {
      title: "Reject unsupported gate automation",
      description: "Candidate and merge must stay manual.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
      gatePolicy: { merge: "auto-on-clean" },
    });
    assert.equal(mergeResponse.status, 400);
    const mergeBody = await mergeResponse.json();
    assert.match(mergeBody.error, /merge.*must stay manual/i);
  } finally {
    await cleanup(server, directory);
  }
});

test("PUT /api/settings validates gate policy values and new tasks snapshot the saved policy", async () => {
  const { directory, origin, server } = await createServer();
  try {
    const invalid = await fetch(`${origin}/api/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        allowedModels: ["gpt-5.6-sol", "gpt-5.6-luna", "claude-opus-5"],
        defaultModel: "gpt-5.6-sol",
        defaultReasoning: "xhigh",
        gatePolicy: { specification: "always" },
      }),
    });
    assert.equal(invalid.status, 400);

    const valid = await fetch(`${origin}/api/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        allowedModels: ["gpt-5.6-sol", "gpt-5.6-luna", "claude-opus-5"],
        defaultModel: "gpt-5.6-sol",
        defaultReasoning: "xhigh",
        gatePolicy: { specification: "auto-on-clean", plan: "manual" },
      }),
    });
    assert.equal(valid.status, 200);
    const settings = (await valid.json()).settings;
    assert.deepEqual(settings.gatePolicy, { specification: "auto-on-clean", plan: "manual" });

    const createResponse = await createTask(origin, {
      title: "Snapshot the settings gate policy",
      description: "New tasks default to the settings gate policy.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
    });
    assert.equal(createResponse.status, 201);
    const task = (await createResponse.json()).task;
    assert.deepEqual(task.gatePolicy, { specification: "auto-on-clean", plan: "manual" });
  } finally {
    await cleanup(server, directory);
  }
});
