import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { createFixtureGateway } from "../../src/frontier/fixtures/gateway.ts";
import { testAttempts } from "../../src/frontier/runtime/test-evidence.ts";

async function views(run) {
  const vite = await createServer({
    configFile: false,
    logLevel: "error",
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false, ws: false },
  });
  try {
    const modules = {};
    for (const name of [
      "TaskUsage",
      "ReviewEvidence",
      "TestEvidence",
      "JourneyEvidence",
      "DeliveryEvidence",
      "StageSummary",
    ])
      Object.assign(modules, await vite.ssrLoadModule(`/src/frontier/views/${name}.tsx`));
    await run(modules);
  } finally {
    await vite.close();
  }
}
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));
async function evidenceFor(gateway, id) {
  return { core: await gateway.core(id), runs: await gateway.runs(id), activity: await gateway.activity(id) };
}

test("stage inspector separates unknown stage measurements from recorded task totals", async () =>
  views(async ({ TaskUsage }) => {
    const gateway = createFixtureGateway(undefined, true);
    const evidence = await evidenceFor(gateway, "AH-051");
    const markup = render(TaskUsage, { evidence, stage: "implement", onMore() {} });
    const stage = markup.split('aria-label="Task total usage"')[0];
    assert.match(stage, /Stage usage — Implement/);
    assert.match(stage, /Execution time<\/dt><dd>Unavailable/);
    assert.match(stage, /Input tokens<\/dt><dd>Unavailable/);
    assert.match(markup, /Task elapsed/);
    assert.match(markup, /API-rate estimate/);
    evidence.runs.nextCursor = "older";
    assert.match(render(TaskUsage, { evidence, stage: "test", onMore() {} }), /partial/);
  }));

test("test attempts remain separate across retries and candidate identities", async () => {
  const gateway = createFixtureGateway(undefined, true);
  const evidence = await evidenceFor(gateway, "AH-051");
  const first = evidence.runs.items[0];
  const retry = structuredClone(first);
  retry.id = "retry";
  retry.attempt = 2;
  retry.test.rows = retry.test.rows.map((row) => ({ ...row, status: "passed" }));
  evidence.runs.items.unshift(retry);
  let attempts = testAttempts(evidence);
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].rows.filter((row) => row.status === "failed").length, 0);
  assert.equal(attempts[1].rows.filter((row) => row.status === "failed").length, 1);
  evidence.core.candidates[0].verificationRuns = [
    {
      ...first.test,
      headRevision: "different",
      candidateId: "other",
      rows: first.test.rows.map((row) => ({ ...row, candidateId: "other" })),
    },
  ];
  attempts = testAttempts(evidence);
  assert.equal(attempts.length, 3);
  assert.equal(attempts[2].candidateId, "other");
  assert.equal(attempts[2].headRevision, "different");
});

test("retained review for a mismatched candidate cannot display current freshness", async () =>
  views(async ({ ReviewEvidence }) => {
    const gateway = createFixtureGateway(undefined, true, false, false, true);
    const task = await gateway.core("QA-205");
    const metadata = task.artifacts.find((item) => item.stage === "dev-review");
    const artifact = await gateway.artifact(task.id, metadata.id);
    artifact.gateResult.candidateId = "old-candidate";
    const markup = render(ReviewEvidence, { task, artifact, onArtifact() {} });
    assert.match(markup, /Previous or unbound candidate/);
    assert.doesNotMatch(markup, />Fresh</);
    assert.match(markup, /Open review report/);
  }));

test("historical Final Review still shows eight prior stages with labelled partial usage", async () =>
  views(async ({ JourneyEvidence }) => {
    const gateway = createFixtureGateway(undefined, true, false, false, true);
    const evidence = await evidenceFor(gateway, "QA-205");
    evidence.runs.nextCursor = "older";
    const markup = render(JourneyEvidence, { evidence, stage: "final-review", onStage() {} });
    assert.match(markup, /8 prior stages/);
    assert.doesNotMatch(markup, />Final review<\/button>/);
    assert.match(markup, /partial/);
  }));

test("delivery stays incomplete for closed or drifted PRs and requires exact completed state", async () =>
  views(async ({ DeliveryEvidence }) => {
    for (const outcome of ["closed", "drift", "merged"]) {
      const gateway = createFixtureGateway(undefined, true);
      gateway.setDeliveryOutcome("MS-091", outcome);
      const task = await gateway.core("MS-091");
      const markup = render(DeliveryEvidence, { task });
      if (outcome === "merged") assert.match(markup, /Delivery completed/);
      else {
        assert.match(markup, /Delivery blocked/);
        assert.doesNotMatch(markup, />Delivery completed</);
      }
    }
  }));

test("investigation approval does not promise candidate publication", async () =>
  views(async ({ StageSummary }) => {
    const gateway = createFixtureGateway(undefined, true, false, false, true);
    const task = await gateway.core("QA-205");
    task.workflow = "investigate";
    const markup = render(StageSummary, { task, stage: "approval" });
    assert.match(markup, /Approve the retained specification/);
    assert.doesNotMatch(markup, /publishes|pull request/);
  }));
