import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { createFixtureGateway } from "../../src/frontier/fixtures/gateway.ts";

async function views(run) {
  const vite = await createServer({
    configFile: false,
    logLevel: "error",
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false, ws: false },
  });
  try {
    return await run({
      ...(await vite.ssrLoadModule("/src/frontier/views/Grill.tsx")),
      ...(await vite.ssrLoadModule("/src/frontier/views/TaskPanel.tsx")),
      ...(await vite.ssrLoadModule("/src/frontier/runtime/workflow.ts")),
      ...(await vite.ssrLoadModule("/src/frontier/views/InvestigationEvidence.tsx")),
      ...(await vite.ssrLoadModule("/src/frontier/views/WorkPackages.tsx")),
    });
  } finally {
    await vite.close();
  }
}

test("embedded Grill preserves custom drafts and disables mutation controls when unavailable", async () =>
  views(async ({ Grill, GrillActions }) => {
    const gateway = createFixtureGateway(undefined, true, false, false, true);
    const task = await gateway.core("PC-153");
    const props = {
      task,
      busy: false,
      connected: true,
      error: null,
      answers: { "PC-153:Q2": "Preserve the entered custom rule" },
      onDraft: () => {},
      onAnswer: () => {},
      onFinish: () => {},
      onArtifact: () => {},
    };
    const body = renderToStaticMarkup(React.createElement(Grill, { ...props, embedded: true }));
    assert.match(body, /Preserve the entered custom rule/);
    assert.match(body, /scouts.md/);
    assert.doesNotMatch(body, /Record answer &amp; next/);
    for (const override of [
      { busy: true },
      { connected: false },
      { task: { ...task, status: "awaiting-spec-approval" } },
    ]) {
      const buttons = renderToStaticMarkup(React.createElement(GrillActions, { ...props, ...override }));
      assert.match(buttons, /<button[^>]*class="primary"[^>]*disabled=""[^>]*>/);
      const disabledBody = renderToStaticMarkup(
        React.createElement(Grill, { ...props, ...override, embedded: true }),
      );
      assert.match(disabledBody, /<fieldset[^>]*disabled=""/);
      assert.match(disabledBody, /<textarea[^>]*disabled=""/);
    }
  }));

test("a queued scout never borrows an unrelated running stage worker or its Inspect action", async () =>
  views(async ({ InvestigationEvidence }) => {
    const gateway = createFixtureGateway(undefined, true, false, false, true);
    const task = await gateway.core("AH-052");
    const runs = await gateway.runs(task.id);
    const evidence = { core: task, runs, activity: { items: [], nextCursor: null } };
    const queued = renderToStaticMarkup(
      React.createElement(InvestigationEvidence, { evidence, stage: "scouts", onWatch: () => {} }),
    );
    assert.match(queued, />queued</);
    assert.match(queued, /No individual run loaded/);
    assert.doesNotMatch(queued, />Inspect<|>running</);
    const failed = await gateway.core("QA-201");
    const markup = renderToStaticMarkup(
      React.createElement(InvestigationEvidence, {
        evidence: {
          core: failed,
          runs: await gateway.runs(failed.id),
          activity: { items: [], nextCursor: null },
        },
        stage: "scouts",
        onWatch: () => {},
      }),
    );
    assert.match(markup, /Sample scout could not read/);
    assert.equal((markup.match(/>Inspect<\/button>/g) ?? []).length, 1);
  }));

test("Plan labels unstarted packages as planned while Implement retains dependency eligibility", async () =>
  views(async ({ WorkPackages }) => {
    const gateway = createFixtureGateway(undefined, true, false, false, true);
    const task = await gateway.core("MS-092");
    const props = { taskId: task.id, packages: task.workPackages, runs: [], onWatch: () => {} };
    const plan = renderToStaticMarkup(React.createElement(WorkPackages, { ...props, stage: "plan" }));
    assert.match(plan, /Plan overview/);
    assert.match(plan, />Planned</);
    assert.doesNotMatch(plan, /Ready to start|Waiting on S1|Ready to integrate/);
    const implement = renderToStaticMarkup(
      React.createElement(WorkPackages, { ...props, stage: "implement" }),
    );
    assert.match(implement, /Ready to start/);
    assert.match(implement, /Waiting on S1/);
    assert.match(implement, /Retained worktree/);
  }));

test("historical stage commands follow selection without exposing active-stage shortcuts", async () =>
  views(async ({ TaskPanel }) => {
    const gateway = createFixtureGateway(undefined, true);
    const task = await gateway.core("PC-153");
    const markup = renderToStaticMarkup(
      React.createElement(TaskPanel, {
        evidence: {
          core: task,
          runs: await gateway.runs(task.id),
          activity: { items: [], nextCursor: null },
        },
        initialStage: "scouts",
        gateway,
        busy: false,
        connected: true,
        error: null,
        grill: { answers: {}, onDraft() {}, onAnswer() {}, onFinish() {} },
        command() {},
        onAction() {},
        onWatch() {},
        onArtifact() {},
        onPolicies() {},
        onManage() {},
        onDiff() {},
        onMore() {},
        onContinue() {},
      }),
    );
    const command = markup.match(/<section[^>]*aria-label="Viewed stage actions"[\s\S]*?<\/section>/)?.[0];
    assert.ok(command);
    assert.match(command, /<strong>Scouts<\/strong>/);
    assert.match(command, /Open retained artifact/);
    assert.doesNotMatch(command, /Answer questions|Inspect active run|<strong>Grill/);
  }));

test("workflow samples carry inspectable prior evidence without unlocking real future stages", async () =>
  views(async ({ stageRecorded, stageHasError }) => {
    const gateway = createFixtureGateway(undefined, true);
    for (const id of ["AH-054", "AH-051"]) {
      const core = await gateway.core(id);
      const evidence = { core, runs: await gateway.runs(id), activity: { items: [], nextCursor: null } };
      for (const stage of ["triage", "scouts", "grill", "specification", "plan"]) {
        assert.ok(stageRecorded(evidence, stage));
        const artifact = core.artifacts.find((item) => item.stage === stage);
        assert.ok(artifact);
        assert.match((await gateway.artifact(id, artifact.id)).content, /Retained demonstration history/);
      }
      assert.equal(stageRecorded(evidence, "approval"), false);
      assert.equal(stageHasError(evidence, core.currentStage), true);
      if (id === "AH-051") {
        for (const member of core.candidates.at(-1).members) {
          const workPackage = core.workPackages.find((item) => item.id === member.packageId);
          assert.equal(workPackage.status, "integrated");
          assert.equal(workPackage.headRevision, member.headRevision);
        }
      }
    }
    const core = await gateway.core("PC-153");
    const evidence = { core, runs: await gateway.runs(core.id), activity: { items: [], nextCursor: null } };
    assert.equal(stageRecorded(evidence, "specification"), false);
  }));

test("candidate gates with unavailable verdicts never retain green completion markers", async () =>
  views(async ({ TaskPanel }) => {
    const gateway = createFixtureGateway(undefined, true, false, false, true);
    const core = await gateway.core("QA-205");
    const props = {
      evidence: { core, runs: await gateway.runs(core.id), activity: await gateway.activity(core.id) },
      gateway,
      busy: false,
      connected: true,
      error: null,
      grill: { answers: {}, onDraft() {}, onAnswer() {}, onFinish() {} },
      command() {},
      onAction() {},
      onWatch() {},
      onArtifact() {},
      onPolicies() {},
      onManage() {},
      onDiff() {},
      onMore() {},
      onContinue() {},
    };
    const marker = (markup, stage) =>
      markup.match(new RegExp(`<button[^>]*title="${stage} · [^"]*"[^>]*>`))?.[0];
    const fresh = renderToStaticMarkup(React.createElement(TaskPanel, props));
    for (const stage of ["Dev review", "Test", "Final review"])
      assert.match(marker(fresh, stage), /class="[^"]*completed/);
    core.candidates[0].revisionNumber++;
    core.candidates[0].headRevision = "b".repeat(40);
    core.gateFreshness = null;
    const unavailable = renderToStaticMarkup(React.createElement(TaskPanel, props));
    for (const stage of ["Dev review", "Test", "Final review"]) {
      assert.match(marker(unavailable, stage), /Verdict unavailable/);
      assert.doesNotMatch(marker(unavailable, stage), /class="[^"]*completed/);
    }
  }));
