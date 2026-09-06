import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";
import { createFixtureGateway } from "../../src/frontier/fixtures/gateway.ts";
import { sampleHead } from "../../src/frontier/fixtures/workflow.ts";
import { RefreshCoordinator } from "../../src/frontier/runtime/coordinator.ts";

const scope = (task) => {
  const c = task.candidates.at(-1);
  return { candidateId: c.id, candidateRevision: c.revisionNumber, candidateHeadRevision: c.headRevision };
};
test("sample full workflow keeps creation, approvals, assembly, gates and PR merge separate", async () => {
  const gateway = createFixtureGateway(undefined, true);
  await gateway.answer("PC-153", "Q2", "Normalise labels");
  await gateway.finishGrill("PC-153");
  assert.equal((await gateway.core("PC-153")).status, "awaiting-spec-approval");
  await gateway.action("PC-153", "approve-spec");
  let task = await gateway.core("PC-153");
  assert.equal(task.status, "awaiting-plan-approval");
  assert.equal(task.workPackages.length, 4);
  assert.equal(task.candidates.length, 0);
  await gateway.action(task.id, "approve-plan");
  assert.equal((await gateway.core(task.id)).status, "ready-for-implementation");
  await gateway.action(task.id, "implement");
  task = await gateway.core(task.id);
  assert.equal(task.status, "ready-for-review");
  assert.equal(
    task.workPackages.every((p) => p.status === "integrated"),
    true,
  );
  await assert.rejects(
    gateway.action(task.id, "review", "", { ...scope(task), candidateHeadRevision: sampleHead(999) }),
    /candidate changed/,
  );
  for (const action of ["review", "test", "final-review"])
    await gateway.action(task.id, action, "", scope(await gateway.core(task.id)));
  task = await gateway.core(task.id);
  assert.equal(task.status, "awaiting-human-approval");
  assert.equal(
    Object.values(task.gateFreshness).every((g) => g.fresh),
    true,
  );
  await gateway.action(task.id, "open-pr", "Sample approval", scope(task));
  task = await gateway.core(task.id);
  assert.equal(task.status, "awaiting-pr-merge");
  assert.equal(task.completedAt, null);
  await gateway.action(task.id, "reconcile-pr");
  assert.equal((await gateway.core(task.id)).status, "awaiting-pr-merge");
  gateway.setDeliveryOutcome(task.id, "merged");
  assert.equal((await gateway.core(task.id)).status, "completed");
});
test("sample closed and identity-drifted PRs retain the candidate and remain incomplete", async () => {
  for (const outcome of ["closed", "drift"]) {
    const gateway = createFixtureGateway(undefined, true);
    const before = await gateway.core("MS-091");
    gateway.setDeliveryOutcome("MS-091", outcome);
    const after = await gateway.core("MS-091");
    assert.equal(after.status, "blocked");
    assert.equal(after.completedAt, null);
    assert.deepEqual(after.candidates, before.candidates);
    assert.match(after.blocker.code, /pull-request-(closed|drift)/);
  }
});
test("provider retry retains its original policy and successful sibling", async () => {
  const gateway = createFixtureGateway(undefined, true);
  const before = (await gateway.core("AH-053")).designRequest;
  await gateway.retryDesign("AH-053");
  const after = (await gateway.core("AH-053")).designRequest;
  assert.deepEqual(after.variants[0], before.variants[0]);
  assert.equal(after.variants.length, 3);
  assert.deepEqual(after.variants[2].policy, before.variants[1].policy);
  assert.equal(after.variants[1].status, "failed");
  await gateway.selectDesign("AH-053", after.variants[2].id);
  assert.equal((await gateway.core("AH-053")).status, "awaiting-spec-approval");
});
test("sample test retry retains failed evidence and the exact unchanged candidate", async () => {
  const gateway = createFixtureGateway(undefined, true);
  const before = await gateway.core("AH-051");
  await assert.rejects(
    gateway.action(before.id, "retry-test", "", { ...scope(before), candidateHeadRevision: sampleHead(999) }),
    /candidate changed/,
  );
  await gateway.action(before.id, "retry-test", "", scope(before));
  const after = await gateway.core(before.id);
  assert.deepEqual(scope(after), scope(before));
  assert.equal(after.status, "ready-for-final-review");
  assert.equal(after.error, null);
  const runs = (await gateway.runs(after.id)).items;
  assert.equal(
    runs.some((run) => run.status === "failed"),
    true,
  );
  assert.equal(
    runs.some((run) => run.test?.status === "passed"),
    true,
  );
});
test("repair retains prior findings and exact historical diffs", async () => {
  const gateway = createFixtureGateway(undefined, true);
  const before = await gateway.core("PC-148");
  await gateway.action("PC-148", "repair");
  const after = await gateway.core("PC-148");
  assert.equal(after.candidates[0].revisionNumber, 2);
  assert.deepEqual(after.artifacts[0], before.artifacts[0]);
  assert.equal(after.gateFreshness["dev-review"].fresh, false);
  const old = await gateway.diff(after.id, before.candidates[0].id, before.candidates[0].headRevision);
  assert.equal(old.revisionNumber, 1);
  await assert.rejects(gateway.diff(after.id, "unknown", sampleHead(1)), /not found/);
});
test("candidate display fails closed on mismatched binding; future stages stay inert", async () => {
  const vite = await createServer({
    configFile: false,
    logLevel: "error",
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false },
  });
  try {
    const { gateView, stageRecorded, executable, proposedAction } = await vite.ssrLoadModule(
      "/src/frontier/runtime/workflow.ts",
    );
    const gateway = createFixtureGateway(undefined, true);
    const core = await gateway.core("PC-148");
    core.gateFreshness["dev-review"].fresh = true;
    core.gateFreshness["dev-review"].candidateRevision = 99;
    assert.equal(gateView(core, "dev-review").fresh, false);
    assert.equal(gateView(core, "test").label, "Not started");
    assert.equal(
      stageRecorded(
        {
          core,
          runs: { items: [], total: 0, nextCursor: null },
          activity: { items: [], total: 0, nextCursor: null },
        },
        "approval",
      ),
      false,
    );
    core.actionEligibility = {
      actions: { review: { allowed: true, mode: "preflight-only", reason: "Check readiness" } },
    };
    assert.equal(executable(core, "review"), false);
    const failedTest = await gateway.core("AH-051");
    assert.equal(proposedAction(failedTest).action, "retry-test");
    failedTest.actionEligibility.actions.test = { allowed: true, mode: "execute" };
    assert.equal(proposedAction(failedTest).action, "test");
  } finally {
    await vite.close();
  }
});
test("late artifact paging cannot enter another selected task", async () => {
  const gateway = createFixtureGateway();
  const original = gateway.core;
  gateway.core = async (id) => ({ ...(await original(id)), artifactNextCursor: "older" });
  let release;
  gateway.artifacts = async () =>
    new Promise((resolve) => {
      release = () => resolve({ items: [{ id: "late" }], total: 2, nextCursor: null });
    });
  const runtime = new RefreshCoordinator(gateway);
  const until = async (fn) => {
    for (let i = 0; i < 100; i++) {
      if (fn()) return;
      await new Promise((r) => setTimeout(r, 5));
    }
    assert.fail("timed out");
  };
  try {
    runtime.start();
    await until(() => runtime.getSnapshot().connection === "connected");
    runtime.select("PC-153");
    await until(() => runtime.getSnapshot().selected?.core.id === "PC-153");
    const pending = runtime.more("artifacts");
    await until(() => release);
    runtime.select("PC-148");
    release();
    await pending;
    await until(() => runtime.getSnapshot().selected?.core.id === "PC-148");
    assert.equal(
      runtime.getSnapshot().selected.core.artifacts.some((a) => a.id === "late"),
      false,
    );
  } finally {
    runtime.stop();
  }
});
