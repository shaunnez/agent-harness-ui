import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

test("welcome preserves direct links and shows setup or at most three active projects", async () => {
  const vite = await createServer({
    configFile: false,
    logLevel: "error",
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false, ws: false },
  });
  try {
    const { Welcome, WelcomePanel, shouldShowWelcome } = await vite.ssrLoadModule(
      "/src/frontier/views/Welcome.tsx",
    );
    assert.equal(shouldShowWelcome("", ""), true);
    assert.equal(shouldShowWelcome("?mode=live", ""), true);
    assert.equal(shouldShowWelcome("?mode=fixture", ""), false);
    for (const hash of ["#world", "#project/one", "#agent/AH-001/run", "#task/AH-001", "#project-setup"])
      assert.equal(shouldShowWelcome("", hash), false);
    const snapshot = {
      projects: [],
      connection: "offline",
      updatedAt: null,
      error: "Connection unavailable",
    };
    const props = {
      snapshot,
      onRetry() {},
      onHelp() {},
      onAdd() {},
      onNew() {},
      onProjects() {},
      onEnter() {},
      onWorld() {},
    };
    const render = (value) =>
      renderToStaticMarkup(React.createElement(WelcomePanel, { ...props, snapshot: value }));
    const offline = render(snapshot);
    assert.match(offline, /Connect companion/);
    assert.match(offline, /Add your first project/);
    assert.match(offline, /Create a task/);
    assert.match(offline, /Companion not connected/);
    assert.match(offline, /Retry connection/);
    assert.match(offline, /href="\?mode=fixture#world"/);
    assert.doesNotMatch(offline, /Last synced|Last checked/);
    const projects = ["Archived", "One", "Two", "Three", "Four"].map((name, index) => ({
      id: name,
      name,
      repositoryPath: `/repos/${name}`,
      archivedAt: index === 0 ? "2026-09-20" : null,
    }));
    const existing = render({ ...snapshot, projects, connection: "connected", updatedAt: Date.now() });
    for (const name of ["One", "Two", "Three"])
      assert.match(existing, new RegExp(`<strong>${name}</strong>`));
    assert.doesNotMatch(existing, /Archived|Four|welcome-step-number/);
    assert.match(existing, /View all/);
    assert.match(existing, /Companion connected/);
    assert.match(existing, /Last synced/);
    assert.match(render({ ...snapshot, projects }), /Last known projects/);
    assert.match(render({ ...snapshot, connection: "connecting" }), /Connecting to companion/);
    assert.match(render({ ...snapshot, connection: "connected" }), /Add a project to create your first base/);
    const reduced = renderToStaticMarkup(React.createElement(Welcome, { ...props, reduced: true }));
    assert.match(reduced, /Welcome to your workspace/);
    assert.doesNotMatch(reduced, /<video|Skip intro/);
    const intro = renderToStaticMarkup(React.createElement(Welcome, { ...props, reduced: false }));
    assert.match(intro, /arrival-poster.jpg/);
    assert.match(intro, /arrival.mp4/);
    assert.match(intro, /Skip intro/);
    assert.match(intro, /Enable sound/);
    assert.doesNotMatch(intro, /Welcome to your workspace/);
  } finally {
    await vite.close();
  }
});
