import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { fixtureProjects, makeFixtureTasks } from "../src/frontier/fixtures/scenarios.ts";

async function renderJournal(tasks) {
  const vite = await createServer({
    configFile: false,
    logLevel: "error",
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false, ws: false },
  });
  try {
    const { TaskJournal } = await vite.ssrLoadModule("/src/frontier/views/TaskJournal.tsx");
    return renderToStaticMarkup(
      React.createElement(TaskJournal, {
        tasks,
        projects: fixtureProjects,
        onInspect: () => undefined,
        onLocate: () => undefined,
        onNew: () => undefined,
      }),
    );
  } finally {
    await vite.close();
  }
}

test("task journal renders priced cost beside tokens for the shared filtered table", async () => {
  const task = makeFixtureTasks().find((item) => item.id === "PC-142");
  const markup = await renderJournal([
    {
      ...task,
      usage: { ...task.usage, cost: 0.123456, pricingVersion: "card-1" },
    },
  ]);

  assert.match(markup, /<th>Tokens<\/th><th>Approx\. cost<\/th><th>Elapsed<\/th>/);
  assert.match(markup, /<td>144K<\/td><td>\$0\.1235<\/td>/);
});

test("task journal keeps cost unavailable when task pricing metadata is absent", async () => {
  const task = makeFixtureTasks().find((item) => item.id === "PC-142");
  const markup = await renderJournal([
    {
      ...task,
      usage: { ...task.usage, cost: 0.12, pricingVersion: null },
    },
  ]);

  assert.match(markup, /<th>Approx\. cost<\/th>/);
  assert.match(markup, /<td>144K<\/td><td>—<\/td>/);
});
