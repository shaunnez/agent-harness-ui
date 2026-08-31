import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { JsonTaskStore } from "../server/store.mjs";

function continuationInput(source) {
  return {
    title: `Implement: ${source.title}`,
    description: source.description,
    repositoryPath: source.repositoryPath,
    workflow: "implement",
    priority: source.priority,
    continuation: {
      sourceTaskId: source.id,
      sourceApprovedAt: "2026-08-31T00:00:00.000Z",
      sourceApprovalId: "approval-specification",
      artifacts: [],
      decisions: [],
      attachments: [],
      stageDispositions: {},
    },
  };
}

test("creates and links exactly one JSON continuation under concurrent requests", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-store-continuation-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const source = await store.create({
      title: "Investigate continuation",
      description: "Carry approved evidence into one implementation task.",
      repositoryPath: "/repo",
      workflow: "investigate",
      priority: "medium",
    });
    const input = continuationInput(source);
    const [first, second] = await Promise.all([
      store.createContinuation(source.id, input, { expectedUpdatedAt: source.updatedAt }),
      store.createContinuation(source.id, input, { expectedUpdatedAt: source.updatedAt }),
    ]);

    assert.equal([first, second].filter((result) => result.created).length, 1);
    assert.equal(first.task.id, second.task.id);
    assert.equal((await store.get(source.id)).continuedByTaskId, first.task.id);
    assert.equal((await store.list()).length, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

async function seedLegacyMergedCompletion(store, { promoted = false } = {}) {
  const task = await store.create({
    title: "Legacy merged completion",
    description: "A pre-fix task that merged and completed in a single step.",
    repositoryPath: "/repo",
    workflow: "implement",
    priority: "medium",
  });
  await store.update(task.id, (draft) => {
    draft.status = "completed";
    draft.completedAt = "2026-08-01T12:05:00.000Z";
    draft.candidates = [
      {
        id: "C1",
        revisionNumber: 1,
        status: "merged",
        baseRevision: "a".repeat(40),
        headRevision: "b".repeat(40),
        baseBranch: "main",
        branch: "agent-harness/c1",
        worktreePath: "/repo/C1",
        repositoryRoot: "/repo",
        createdAt: "2026-08-01T12:00:00.000Z",
        updatedAt: "2026-08-01T12:05:00.000Z",
        revisions: [],
      },
    ];
    if (promoted) {
      draft.approvals.push({
        id: "A-promotion",
        stage: "promotion",
        note: "Promoted onward.",
        createdAt: "2026-08-01T12:06:00.000Z",
      });
    }
  });
  return task.id;
}

test("migrates a legacy completed task with a merged candidate to merged-to-target on the next boot", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-store-migration-"));
  try {
    const filePath = path.join(directory, "tasks.json");
    const seedingStore = new JsonTaskStore(filePath);
    await seedingStore.init();
    const legacyId = await seedLegacyMergedCompletion(seedingStore);

    const rebootedStore = new JsonTaskStore(filePath);
    await rebootedStore.init();
    const migrated = await rebootedStore.get(legacyId);
    assert.equal(migrated.status, "merged-to-target");
    assert.equal(migrated.candidates.at(-1).status, "merged", "the migration only relabels task status");
    assert.equal(
      migrated.completedAt,
      "2026-08-01T12:05:00.000Z",
      "historical completion evidence is not rewritten",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("store migration is idempotent across repeated boots", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-store-migration-idempotent-"));
  try {
    const filePath = path.join(directory, "tasks.json");
    const seedingStore = new JsonTaskStore(filePath);
    await seedingStore.init();
    const legacyId = await seedLegacyMergedCompletion(seedingStore);

    const firstBoot = new JsonTaskStore(filePath);
    await firstBoot.init();
    const afterFirstBoot = await firstBoot.get(legacyId);
    assert.equal(afterFirstBoot.status, "merged-to-target");

    const secondBoot = new JsonTaskStore(filePath);
    await secondBoot.init();
    const afterSecondBoot = await secondBoot.get(legacyId);
    assert.equal(
      afterSecondBoot.status,
      "merged-to-target",
      "a second boot must not move the task any further",
    );
    assert.deepEqual(afterSecondBoot, afterFirstBoot, "repeated migrations converge without drift");

    const changedOnSecondPass = await secondBoot.recoverInterrupted();
    assert.equal(
      changedOnSecondPass,
      false,
      "recovering an already-migrated store reports no further change",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("repository-authority migration keeps completed tasks readable and marks active plans for revalidation", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-authority-migration-"));
  try {
    const filePath = path.join(directory, "tasks.json");
    const seedingStore = new JsonTaskStore(filePath);
    await seedingStore.init();
    const active = await seedingStore.create({
      title: "Legacy active plan",
      description: "A plan from before repository authority was persisted.",
      repositoryPath: "/repo",
      workflow: "implement",
      priority: "medium",
    });
    const completed = await seedingStore.create({
      title: "Legacy completed task",
      description: "Historical evidence remains readable.",
      repositoryPath: "/repo",
      workflow: "implement",
      priority: "medium",
    });
    await seedingStore.update(active.id, (draft) => {
      draft.status = "awaiting-plan-approval";
      draft.currentStage = "plan";
    });
    await seedingStore.update(completed.id, (draft) => {
      draft.status = "completed";
    });
    const legacy = JSON.parse(await readFile(filePath, "utf8"));
    legacy.schemaVersion = 9;
    for (const task of legacy.tasks) {
      delete task.repositoryAuthority;
      delete task.repositoryAuthorityHistory;
      delete task.repositoryAuthorityStatus;
      delete task.planResult;
      delete task.planRevalidation;
    }
    await writeFile(filePath, `${JSON.stringify(legacy, null, 2)}\n`);

    const migratedStore = new JsonTaskStore(filePath);
    await migratedStore.init();
    const migratedActive = await migratedStore.get(active.id);
    const migratedCompleted = await migratedStore.get(completed.id);
    assert.equal(migratedActive.repositoryAuthorityStatus, "legacy-unbound");
    assert.equal(migratedActive.repositoryAuthority, null);
    assert.deepEqual(migratedActive.repositoryAuthorityHistory, []);
    assert.equal(migratedCompleted.repositoryAuthorityStatus, "legacy-readable");
    assert.equal(migratedCompleted.status, "completed");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("does not relabel a task that was explicitly promoted to completed", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-store-migration-promoted-"));
  try {
    const filePath = path.join(directory, "tasks.json");
    const seedingStore = new JsonTaskStore(filePath);
    await seedingStore.init();
    const promotedId = await seedLegacyMergedCompletion(seedingStore, { promoted: true });

    const rebootedStore = new JsonTaskStore(filePath);
    await rebootedStore.init();
    const task = await rebootedStore.get(promotedId);
    assert.equal(
      task.status,
      "completed",
      "an explicit promotion decision must not be reverted by the migration",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("does not relabel a completed investigate-only task without a candidate", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-store-migration-investigate-"));
  try {
    const filePath = path.join(directory, "tasks.json");
    const seedingStore = new JsonTaskStore(filePath);
    await seedingStore.init();
    const task = await seedingStore.create({
      title: "Investigate only",
      description: "No candidate is ever produced for this workflow.",
      repositoryPath: "/repo",
      workflow: "investigate",
      priority: "medium",
    });
    await seedingStore.update(task.id, (draft) => {
      draft.status = "completed";
      draft.completedAt = "2026-08-01T12:00:00.000Z";
    });

    const rebootedStore = new JsonTaskStore(filePath);
    await rebootedStore.init();
    const untouched = await rebootedStore.get(task.id);
    assert.equal(untouched.status, "completed");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rebuilds task usage from each artifact's recorded model and preserves synthetic origins", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-store-usage-"));
  try {
    const filePath = path.join(directory, "tasks.json");
    const store = new JsonTaskStore(filePath);
    await store.init();
    const task = await store.create({
      title: "Mixed model accounting",
      description: "Keep model-specific credits when task policies use multiple models.",
      repositoryPath: "/repo",
      workflow: "implement",
      priority: "medium",
    });
    await store.update(task.id, (draft) => {
      draft.usage = {
        inputTokens: 2_000,
        cachedInputTokens: 500,
        outputTokens: 200,
        totalTokens: 2_200,
        cost: 0,
        credits: 999,
      };
      draft.artifacts = [
        {
          id: "luna",
          runId: "run-luna",
          stage: "triage",
          name: "triage.md",
          kind: "markdown",
          content: "# Triage",
          createdAt: "2026-08-01T12:00:00.000Z",
          model: "gpt-5.6-luna",
          reasoning: "xhigh",
          usage: { inputTokens: 1_000, cachedInputTokens: 500, outputTokens: 100, totalTokens: 1_100 },
        },
        {
          id: "sol",
          runId: "run-sol",
          stage: "plan",
          name: "implementation-plan.md",
          kind: "markdown",
          content: "# Plan",
          createdAt: "2026-08-01T12:01:00.000Z",
          model: "gpt-5.6-sol",
          reasoning: "high",
          usage: { inputTokens: 1_000, cachedInputTokens: 0, outputTokens: 100, totalTokens: 1_100 },
        },
        {
          id: "assembly",
          stage: "implement",
          name: "candidate-assembly.md",
          kind: "markdown",
          content: "# Candidate assembly",
          createdAt: "2026-08-01T12:02:00.000Z",
          model: null,
          reasoning: null,
          usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0 },
        },
      ];
    });

    const rebooted = new JsonTaskStore(filePath);
    await rebooted.init();
    const restored = await rebooted.get(task.id);
    assert.equal(
      restored.artifacts[2].model,
      null,
      "a harness-generated artifact must not inherit the task model on boot",
    );
    assert.equal(restored.usage.inputTokens, 2_000);
    assert.equal(restored.usage.outputTokens, 200);
    assert.equal(
      restored.usage.credits,
      Math.round((restored.artifacts[0].usage.credits + restored.artifacts[1].usage.credits) * 1_000_000) /
        1_000_000,
      "task credits sum the rates of the actual artifact models",
    );
    assert.notEqual(restored.usage.credits, 999);
    assert.equal(
      restored.usage.cost,
      Math.round((restored.artifacts[0].usage.cost + restored.artifacts[1].usage.cost) * 1_000_000) /
        1_000_000,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("records Anthropic provenance for tasks whose stage policies use Claude", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-store-provider-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Claude policy",
      description: "Retain the configured execution provider in the task model snapshot.",
      repositoryPath: "/repo",
      workflow: "implement",
      priority: "medium",
      stagePolicies: { triage: { model: "claude-sonnet-5", reasoning: "high" } },
    });
    assert.deepEqual(task.models, [{ provider: "anthropic", model: "claude-sonnet-5" }]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("migrates existing task state to the compatibility-safe standard workflow profile", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-store-profile-migration-"));
  try {
    const filePath = path.join(directory, "tasks.json");
    const store = new JsonTaskStore(filePath);
    await store.init();
    const task = await store.create({
      title: "Legacy profile",
      description: "Created before workflow profiles existed.",
      repositoryPath: "/repo",
      workflow: "implement",
      priority: "medium",
    });
    await store.update(task.id, (draft) => {
      delete draft.workflowProfile;
      delete draft.stageDispositions;
      delete draft.reviewRetries;
      delete draft.automaticRepairCycles;
      delete draft.agentConfig.profileStagePolicies;
      draft.agentConfig.policySnapshotVersion = 1;
    });

    const rebooted = new JsonTaskStore(filePath);
    await rebooted.init();
    const migrated = await rebooted.get(task.id);
    assert.equal(migrated.workflowProfile.selected, "standard");
    assert.equal(migrated.workflowProfile.source, "migration");
    assert.deepEqual(migrated.stageDispositions, {});
    assert.deepEqual(migrated.reviewRetries, []);
    assert.equal(migrated.automaticRepairCycles, 0);
    assert.deepEqual(migrated.agentConfig.stagePolicies, migrated.agentConfig.profileStagePolicies.standard);
    assert.equal(migrated.agentConfig.policySnapshotVersion, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("migrates legacy Grill state to manual policy without inventing human provenance", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-store-grill-migration-"));
  try {
    const filePath = path.join(directory, "tasks.json");
    const store = new JsonTaskStore(filePath);
    await store.init();
    const task = await store.create({
      title: "Legacy Grill",
      description: "Created before Grill policy snapshots and completion provenance.",
      repositoryPath: "/repo",
      workflow: "investigate",
      priority: "medium",
    });
    await store.update(task.id, (draft) => {
      delete draft.grillPolicy;
      draft.grillSession = {
        status: "completed",
        questions: [
          {
            id: "Q1",
            question: "Preserve compatibility?",
            whyItMatters: "Clients depend on it.",
            options: [
              { id: "Q1-O1", label: "Preserve it", description: "Keep clients working.", recommended: true },
            ],
            allowCustom: true,
            answer: "Preserve it",
            answerSource: "accepted-assumption",
            resolvedAt: "2026-08-01T12:01:00.000Z",
          },
        ],
        createdAt: "2026-08-01T12:00:00.000Z",
        completedAt: "2026-08-01T12:01:00.000Z",
        completionReason: "Finished by the user with 1 recommended assumption accepted.",
      };
    });
    await store.updateSettings((draft) => {
      delete draft.grillPolicy;
    });

    const rebooted = new JsonTaskStore(filePath);
    await rebooted.init();
    const migrated = await rebooted.get(task.id);
    assert.equal((await rebooted.settings()).grillPolicy, "manual");
    assert.equal(migrated.grillPolicy, "manual");
    assert.equal(migrated.grillSession.policySnapshot, "manual");
    assert.equal(migrated.grillSession.completionSource, "legacy-unverified");
    assert.equal(migrated.grillSession.acceptedRecommendationCount, 1);
    assert.equal(
      migrated.grillSession.completionReason,
      "Finished by the user with 1 recommended assumption accepted.",
      "historical copy remains intact while new metadata marks its origin unverified",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
