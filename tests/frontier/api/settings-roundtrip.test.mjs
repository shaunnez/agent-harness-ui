import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test from "node:test";
import { createIsolatedApi } from "../../../scripts/frontier/isolated-api.mjs";

test("execution defaults round-trip through the real API without rewriting existing task or run policies", async () => {
  const api = await createIsolatedApi();
  try {
    const status = await (await fetch(`${api.origin}/api/runtime/status`)).json();
    const headers = {
      origin: "http://127.0.0.1:5199",
      "content-type": "application/json",
      "x-agent-harness-csrf": status.csrfToken,
    };
    const send = (url, body = {}, method = "POST") =>
      fetch(`${api.origin}${url}`, { method, headers, body: JSON.stringify(body) });
    const draft = {
      title: "Settings snapshot",
      description: "Investigate revision comparison without changes",
      workflow: "investigate",
      workflowProfile: "standard",
      priority: "medium",
      repositoryPath: api.repositoryPath,
    };
    const created = await send("/api/tasks", draft);
    assert.equal(created.status, 201);
    const { task } = await created.json();
    assert.equal((await send(`/api/tasks/${task.id}/run`)).status, 202);
    for (let index = 0; index < 200; index++) {
      if ((await api.store.get(task.id)).status === "awaiting-grill" && !api.orchestrator.isRunning(task.id))
        break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const prior = await api.store.get(task.id);
    assert.equal(prior.status, "awaiting-grill");
    assert.ok(prior.runs.length > 0);
    const settings = structuredClone(await api.store.settings());
    const policy = { model: "gpt-5.6-sol", reasoning: "high" };
    settings.profileStagePolicies.standard.grill = policy;
    settings.stagePolicies = structuredClone(settings.profileStagePolicies.standard);
    settings.grillPolicy = "auto-accept-recommendations";
    settings.gatePolicies = { "dev-review": "auto-accept-recommendations" };
    const saved = await send("/api/settings", settings, "PUT");
    assert.equal(saved.status, 200, await saved.clone().text());
    assert.deepEqual(await api.store.get(task.id), prior);
    const fresh = await send("/api/tasks", { ...draft, title: "New snapshot" });
    assert.equal(fresh.status, 201);
    const next = (await fresh.json()).task;
    assert.deepEqual(next.agentConfig.stagePolicies.grill, policy);
    assert.equal(next.grillPolicy, "auto-accept-recommendations");
    assert.equal(next.status, "queued");
    assert.equal(next.runs.length, 0);
    const read = await (await fetch(`${api.origin}/api/settings`)).json();
    assert.deepEqual(read.settings.profileStagePolicies.standard.grill, policy);
    assert.equal(read.settings.gatePolicies?.["dev-review"], "auto-accept-recommendations");
    assert.equal(read.settings.gatePolicies?.test ?? "manual", "manual");
    const rejected = await send("/api/settings", { ...settings, defaultReasoning: "unsupported" }, "PUT");
    assert.ok(rejected.status >= 400);
    assert.deepEqual(await api.store.settings(), read.settings);
  } finally {
    await api.close();
    await rm(api.root, { recursive: true, force: true });
  }
});
