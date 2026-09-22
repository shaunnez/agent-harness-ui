import assert from "node:assert/strict";
import test from "node:test";
import { createFixtureGateway } from "../../src/frontier/fixtures/gateway.ts";
import { RefreshCoordinator } from "../../src/frontier/runtime/coordinator.ts";
import { stageUsage } from "../../src/frontier/runtime/usage.ts";

test("workspace paging removes partial usage only after all retained runs load and survives refresh", async () => {
  const gateway = createFixtureGateway(undefined, true, false, false, true);
  const runtime = new RefreshCoordinator(gateway);
  runtime.start();
  try {
    runtime.select("QA-206");
    await runtime.synchronize();
    let evidence = runtime.getSnapshot().selected;
    assert.equal(evidence.runs.items.length, 50);
    assert.equal(stageUsage(evidence, "specification", Date.now()).partialHistory, true);
    const taskTokens = evidence.core.usage.totalTokens;
    await runtime.more("runs");
    await runtime.synchronize();
    evidence = runtime.getSnapshot().selected;
    assert.equal(evidence.runs.items.length, 55);
    assert.equal(new Set(evidence.runs.items.map((run) => run.id)).size, 55);
    const usage = stageUsage(evidence, "specification", Date.now());
    assert.equal(usage.partialHistory, false);
    assert.equal(usage.tokens.value, taskTokens);
    assert.equal(evidence.core.stageDispositions.scouts.status, "not-required");
    assert.equal(evidence.core.candidates.length, 0);
  } finally {
    runtime.stop();
  }
});

test("unavailable retained evidence preserves the task and does not start execution", async () => {
  const gateway = createFixtureGateway(undefined, true, false, false, true);
  const before = await gateway.core("QA-207");
  await assert.rejects(
    gateway.artifact("QA-207", "QA-207-unavailable"),
    /Sample retained evidence is unavailable/,
  );
  const { actionEligibility: beforeEligibility, ...beforeCore } = before;
  const { actionEligibility: afterEligibility, ...afterCore } = await gateway.core("QA-207");
  assert.deepEqual(afterCore, beforeCore);
  assert.deepEqual(afterEligibility.actions, beforeEligibility.actions);
  assert.deepEqual(before.activeRunIds, []);
});
