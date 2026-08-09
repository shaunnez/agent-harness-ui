import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { JsonTaskStore } from "../server/store.mjs";

async function seedLegacyMergedCompletion(store, { id, promoted = false } = {}) {
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
    draft.candidates = [{
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
    }];
    if (promoted) {
      draft.approvals.push({ id: "A-promotion", stage: "promotion", note: "Promoted onward.", createdAt: "2026-08-01T12:06:00.000Z" });
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
    assert.equal(migrated.completedAt, "2026-08-01T12:05:00.000Z", "historical completion evidence is not rewritten");
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
    assert.equal(afterSecondBoot.status, "merged-to-target", "a second boot must not move the task any further");
    assert.deepEqual(afterSecondBoot, afterFirstBoot, "repeated migrations converge without drift");

    const changedOnSecondPass = await secondBoot.recoverInterrupted();
    assert.equal(changedOnSecondPass, false, "recovering an already-migrated store reports no further change");
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
    assert.equal(task.status, "completed", "an explicit promotion decision must not be reverted by the migration");
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
