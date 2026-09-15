import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { createFixtureGateway } from "../../src/frontier/fixtures/gateway.ts";

test("compact HUD retains decisions, inspection, recorded details and real artifacts", async () => {
  const vite = await createServer({
    configFile: false,
    logLevel: "error",
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false, ws: false },
  });
  try {
    const { AttentionQueue, SelectionHud } = await vite.ssrLoadModule("/src/frontier/views/WorldHud.tsx");
    const { WorldNavigation } = await vite.ssrLoadModule("/src/frontier/views/WorldNavigation.tsx");
    const gateway = createFixtureGateway(undefined, true);
    const tasks = await gateway.summaries();
    const props = {
      onAction() {},
      onInspect() {},
      onWatch() {},
      onClose() {},
      onArtifact() {},
      loading: false,
      connected: true,
    };
    const queue = renderToStaticMarkup(
      React.createElement(AttentionQueue, { tasks, projects: await gateway.projects(), onSelect() {} }),
    );
    assert.match(queue, /Show all 8 decisions/);
    assert.doesNotMatch(queue, /queue-reason|Next:|Wait age/);
    const empty = renderToStaticMarkup(
      React.createElement(AttentionQueue, { tasks: [], projects: [], onSelect() {} }),
    );
    assert.match(empty, /No decisions/);
    const blocked = await gateway.core("PC-148");
    const dock = renderToStaticMarkup(React.createElement(SelectionHud, { ...props, task: blocked }));
    assert.match(dock, /Recorded details/);
    assert.match(dock, /Revision history can fail/);
    assert.match(dock, /Review findings/);
    assert.match(dock, />Inspect</);
    assert.match(dock, /Clear selection/);
    const running = await gateway.core("PC-142");
    const compact = renderToStaticMarkup(
      React.createElement(SelectionHud, {
        ...props,
        task: { ...running, artifacts: [] },
        run: (await gateway.runs("PC-142")).items.at(-1),
      }),
    );
    assert.doesNotMatch(compact, /selection-artifacts|Build revision checks/);
    assert.match(compact, /tokens/);
    assert.match(compact, /Watch agent/);
    const artifact = renderToStaticMarkup(
      React.createElement(SelectionHud, {
        ...props,
        task: { ...running, artifacts: [{ id: "real", name: "Recorded plan" }] },
      }),
    );
    assert.match(artifact, /Recorded plan/);
    const disconnected = renderToStaticMarkup(
      React.createElement(SelectionHud, { ...props, connected: false, task: blocked }),
    );
    assert.match(disconnected, /Last known · Repair required/);
    const menu = renderToStaticMarkup(
      React.createElement(WorldNavigation, { onWorld() {}, onOpen() {}, onBriefing() {} }),
    );
    assert.match(menu, /popover="auto"[\s\S]*While you were away/);
    assert.doesNotMatch(menu, /Watch list/);
  } finally {
    await vite.close();
  }
});
