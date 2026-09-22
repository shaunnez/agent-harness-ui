import assert from "node:assert/strict";
import test from "node:test";
import { createFixtureGateway } from "../../src/frontier/fixtures/gateway.ts";
import { fixtureRun, fixtureTask } from "../../src/frontier/fixtures/scenarios.ts";
import { parseDiff } from "../../src/frontier/runtime/diff.ts";
import { settingsInput } from "../../src/frontier/runtime/settings.ts";
import { runTime, sumRecorded, taskWallTime, usageTotals } from "../../src/frontier/runtime/usage.ts";

test("usage preserves unknowns and reconciles cached input with recorded rates", () => {
  const known = {
    inputTokens: 1000,
    cachedInputTokens: 600,
    outputTokens: 100,
    totalTokens: 1100,
    cost: 0.04,
    pricingVersion: "card-1",
  };
  const totals = usageTotals([
    known,
    { ...known, inputTokens: 500, cachedInputTokens: 200, cost: null },
    null,
  ]);
  assert.deepEqual(totals.input, { value: 1500, known: 2, total: 3 });
  assert.equal(totals.cacheRate, null);
  assert.equal(totals.cost.value, 0.04);
  assert.equal(totals.cost.known, 1);
  assert.equal(usageTotals([known]).cacheRate, 0.6);
  assert.equal(usageTotals([{ ...known, pricingVersion: null }]).cost.value, null);
  assert.deepEqual(sumRecorded([0, null, NaN, -1]), { value: 0, known: 1, total: 4 });
  assert.equal(sumRecorded([]).value, null);
});
test("task wall time is independent of overlapping runs, and historical unknown duration does not tick", () => {
  const task = fixtureTask("A", "Timing", "/demo", {
    startedAt: "2026-09-01T10:00:00Z",
    completedAt: "2026-09-01T10:10:00Z",
    status: "completed",
  });
  const run = {
    ...fixtureRun("A", "implement", "completed"),
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    durationMs: 600000,
  };
  assert.equal(taskWallTime(task, Date.now()), 600000);
  assert.equal(sumRecorded([runTime(run, Date.now()), runTime(run, Date.now())]).value, 1200000);
  assert.equal(
    runTime({ ...run, durationMs: null, completedAt: null, status: "running" }, Date.now(), false),
    null,
  );
  assert.equal(taskWallTime({ ...task, completedAt: null }, Date.now()), null);
});
test("saved defaults affect new tasks only and failed settings validation preserves configuration", async () => {
  const gateway = createFixtureGateway(undefined, true);
  const before = await gateway.core("PC-153");
  const original = await gateway.status();
  const settings = settingsInput(original.settings);
  settings.profileStagePolicies.standard.grill = { model: "gpt-6-sol", reasoning: "high" };
  settings.stagePolicies = structuredClone(settings.profileStagePolicies.standard);
  settings.grillPolicy = "auto-accept-recommendations";
  settings.repairLimits = { package: 3, candidate: { fast: 0, standard: 4, "high-risk": 5 } };
  settings.gatePolicies = { ...settings.gatePolicies, "dev-review": "auto-accept-recommendations" };
  await gateway.saveSettings(settings);
  const after = await gateway.core("PC-153");
  assert.deepEqual(after.agentConfig, before.agentConfig);
  assert.equal(after.grillPolicy, before.grillPolicy);
  assert.deepEqual(after.repairLimits, before.repairLimits);
  const task = await gateway.create({
    title: "New defaults",
    description: "Fixture",
    repositoryPath: "/demo/eversor-plancheck",
    workflow: "investigate",
    priority: "medium",
    workflowProfile: "standard",
  });
  assert.deepEqual(task.agentConfig.stagePolicies.grill, settings.stagePolicies.grill);
  assert.equal(task.grillPolicy, "auto-accept-recommendations");
  assert.deepEqual(task.repairLimits, settings.repairLimits);
  assert.equal((await gateway.status()).settings.gatePolicies?.["dev-review"], "auto-accept-recommendations");
  assert.equal((await gateway.status()).settings.gatePolicies?.test ?? "manual", "manual");
  await assert.rejects(gateway.saveSettings({ ...settings, allowedModels: [] }), /allowed/);
  assert.deepEqual((await gateway.status()).settings.allowedModels, settings.allowedModels);
});
test("unified diff line numbers follow source hunks across additions, removals and files", () => {
  const files = parseDiff(
    "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -10,2 +20,3 @@\n keep\n-old\n+new\n+added\ndiff --git a/b.ts b/b.ts\n@@ -0,0 +1 @@\n+first\n",
  );
  assert.equal(files.length, 2);
  assert.deepEqual(
    files[0].lines
      .filter((line) => line.old !== null || line.next !== null)
      .map((line) => [line.old, line.next]),
    [
      [10, 20],
      [11, null],
      [null, 21],
      [null, 22],
    ],
  );
  assert.equal(files[1].lines.at(-1).next, 1);
  assert.equal(files[1].lines.at(-1).text, "+first");
});

test("stage usage includes retries, preserves missing/zero measurements and marks paged subtotals", async () => {
  const { stageUsage } = await import("../../src/frontier/runtime/usage.ts");
  const run = (id, stage, usage, durationMs) => ({ id, stage, usage, durationMs, status: "completed" });
  const usage = {
    inputTokens: 100,
    outputTokens: 20,
    totalTokens: 120,
    cachedInputTokens: 50,
    cost: 0.2,
    pricingVersion: "test-rate",
  };
  const evidence = {
    core: { activeRunIds: [] },
    runs: {
      items: [
        run("first", "implement", usage, 2000),
        run("retry", "implement", usage, 3000),
        run("review", "dev-review", usage, 4000),
      ],
      total: 3,
      nextCursor: null,
    },
  };
  let result = stageUsage(evidence, "implement", 0);
  assert.equal(result.tokens.value, 240);
  assert.equal(result.execution.value, 5000);
  assert.equal(result.cost.value, 0.4);
  assert.equal(result.cacheRate, 0.5);
  assert.equal(result.partialHistory, false);
  assert.equal(stageUsage(evidence, "test", 0).tokens.value, null);
  evidence.runs.items.push(run("unknown", "implement", null, null));
  evidence.runs.total = 8;
  evidence.runs.nextCursor = "older";
  result = stageUsage(evidence, "implement", 0);
  assert.equal(result.partialHistory, true);
  assert.equal(result.tokens.known, 2);
  assert.equal(result.tokens.total, 3);
  assert.equal(result.cacheRate, null);
  evidence.runs = {
    items: [
      run(
        "zero",
        "implement",
        { ...usage, inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0, cost: 0 },
        0,
      ),
    ],
    total: 1,
    nextCursor: null,
  };
  result = stageUsage(evidence, "implement", 0);
  assert.equal(result.tokens.value, 0);
  assert.equal(result.execution.value, 0);
  assert.equal(result.cost.value, 0);
  assert.equal(result.cacheRate, null);
});
