import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { createFixtureGateway } from "../../src/frontier/fixtures/gateway.ts";

async function withFrontierViews(run) {
  const vite = await createServer({
    configFile: false,
    logLevel: "error",
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false, ws: false },
  });
  try {
    const workflowCommand = await vite.ssrLoadModule("/src/frontier/views/WorkflowCommand.tsx");
    const grill = await vite.ssrLoadModule("/src/frontier/views/Grill.tsx");
    return await run({ ...workflowCommand, ...grill });
  } finally {
    await vite.close();
  }
}

function workflowProps(task, gateway, overrides = {}) {
  return {
    task,
    gateway,
    busy: false,
    connected: true,
    command: async () => {},
    onGrill: () => {},
    onContinue: () => {},
    ...overrides,
  };
}

test("reason-capable shared actions expose an accessible menu trigger without an initial note field", async () => {
  await withFrontierViews(async ({ WorkflowCommand }) => {
    const gateway = createFixtureGateway(undefined, true);
    const task = await gateway.core("PC-148");
    const markup = renderToStaticMarkup(React.createElement(WorkflowCommand, workflowProps(task, gateway)));

    assert.match(markup, /aria-haspopup="menu"/);
    assert.match(markup, /aria-expanded="false"/);
    assert.match(markup, /aria-controls="workflow-action-menu-PC-148"/);
    assert.doesNotMatch(markup, /role="menu"/);
    assert.doesNotMatch(markup, />Operator note</);
  });
});

test("busy, disconnected, and ineligible shared actions remain disabled", async () => {
  await withFrontierViews(async ({ WorkflowCommand }) => {
    const gateway = createFixtureGateway(undefined, true);
    const task = await gateway.core("PC-148");
    const busyMarkup = renderToStaticMarkup(
      React.createElement(WorkflowCommand, workflowProps(task, gateway, { busy: true })),
    );
    const disconnectedMarkup = renderToStaticMarkup(
      React.createElement(WorkflowCommand, workflowProps(task, gateway, { connected: false })),
    );
    const ineligibleTask = {
      ...task,
      actionEligibility: {
        ...task.actionEligibility,
        actions: {
          ...task.actionEligibility.actions,
          repair: { allowed: false, mode: "execute", reason: "Repair is no longer eligible." },
        },
      },
    };
    const ineligibleMarkup = renderToStaticMarkup(
      React.createElement(WorkflowCommand, workflowProps(ineligibleTask, gateway)),
    );

    assert.match(busyMarkup, /<button[^>]*disabled[^>]*aria-haspopup="menu"/);
    assert.match(disconnectedMarkup, /<button[^>]*disabled[^>]*aria-haspopup="menu"/);
    assert.match(ineligibleMarkup, /Repair is no longer eligible\./);
    assert.match(ineligibleMarkup, /<button[^>]*disabled[^>]*aria-haspopup="menu"/);
  });
});

test("continue-implementation bypasses the reason menu", async () => {
  await withFrontierViews(async ({ WorkflowCommand }) => {
    const gateway = createFixtureGateway(undefined, true);
    const task = await gateway.core("PC-131");
    const markup = renderToStaticMarkup(React.createElement(WorkflowCommand, workflowProps(task, gateway)));

    assert.match(markup, />Continue to implementation/);
    assert.doesNotMatch(markup, /aria-haspopup="menu"/);
    assert.doesNotMatch(markup, /workflow-action-menu-PC-131/);
    assert.doesNotMatch(markup, /Proceed with reason/);
  });
});

test("Grill keeps its independent answer and specification controls", async () => {
  await withFrontierViews(async ({ Grill }) => {
    const gateway = createFixtureGateway(undefined, true);
    const task = await gateway.core("PC-153");
    const markup = renderToStaticMarkup(
      React.createElement(Grill, {
        task,
        busy: false,
        error: null,
        connected: true,
        onAnswer: () => {},
        onFinish: () => {},
        onArtifact: () => {},
        answers: {},
        onDraft: () => {},
      }),
    );

    assert.match(markup, /Record answer &amp; next/);
    assert.doesNotMatch(markup, /Proceed with reason/);
  });
});
