import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test from "node:test";
import { createIsolatedApi } from "../../../scripts/frontier/isolated-api.mjs";
import { recordWorkflowProfile } from "../../../server/workflow-profiles.mjs";

test("creation persists exact per-role overrides across profiles and rejects invalid matrices atomically", async () => {
  const api = await createIsolatedApi();
  try {
    const status = await (await fetch(`${api.origin}/api/runtime/status`)).json();
    const headers = {
      origin: "http://127.0.0.1:5199",
      "content-type": "application/json",
      "x-agent-harness-csrf": status.csrfToken,
    };
    const draft = {
      title: "Update the small label",
      description: "Adjust the wording",
      workflow: "investigate",
      repositoryPath: api.repositoryPath,
      workflowProfile: "fast",
    };
    const send = (input) =>
      fetch(`${api.origin}/api/tasks`, {
        method: "POST",
        headers,
        body: JSON.stringify({ ...draft, ...input }),
      });
    const policy = { model: "gpt-5.6-sol", reasoning: "high" };
    const before = await api.store.settings();
    const response = await send({ rolePolicyOverrides: { triage: policy, grill: policy } });
    assert.equal(response.status, 201, await response.clone().text());
    const { task } = await response.json();
    assert.equal(task.status, "queued");
    assert.equal(task.runs.length, 0);
    for (const profile of ["fast", "standard", "high-risk"]) {
      assert.deepEqual(task.agentConfig.profileStagePolicies[profile].triage, policy);
      assert.deepEqual(task.agentConfig.profileStagePolicies[profile].grill, policy);
      assert.deepEqual(
        task.agentConfig.profileStagePolicies[profile].implement,
        before.profileStagePolicies[profile].implement,
      );
    }
    assert.equal(task.agentConfig.rolePolicySources.triage, "task-override");
    assert.equal(task.agentConfig.rolePolicySources.implement, "settings-default");
    await api.store.update(task.id, (current) =>
      recordWorkflowProfile(current, "high-risk", "Test escalation"),
    );
    assert.deepEqual((await api.store.get(task.id)).agentConfig.stagePolicies.triage, policy);
    await api.store.updateSettings((settings) => {
      settings.profileStagePolicies.fast.triage.reasoning = "low";
    });
    const persisted = await (await fetch(`${api.origin}/api/tasks/${task.id}?view=core`)).json();
    assert.deepEqual(persisted.task.agentConfig.profileStagePolicies.fast.triage, policy);
    for (const input of [
      { rolePolicyOverrides: null },
      { rolePolicyOverrides: [] },
      { rolePolicyOverrides: { "scout-code-path": policy } },
      { rolePolicyOverrides: { triage: { model: "not-a-model", reasoning: "high" } } },
      { rolePolicyOverrides: { triage: { ...policy, reasoning: "unlimited" } } },
      { rolePolicyOverrides: { triage: { ...policy, ignored: true } } },
      { rolePolicyOverrides: { triage: policy }, model: policy.model },
      { rolePolicyOverrides: {}, reasoning: "high" },
      { rolePolicyOverrides: JSON.parse('{"__proto__":{"model":"gpt-5.6-sol","reasoning":"high"}}') },
    ]) {
      const rejected = await send(input);
      assert.equal(rejected.status, 400, await rejected.clone().text());
      assert.equal((await api.store.list()).length, 1);
    }
    const legacy = await (await send({ model: policy.model, reasoning: policy.reasoning })).json();
    assert.ok(
      Object.values(legacy.task.agentConfig.stagePolicies).every(
        (value) => value.model === policy.model && value.reasoning === policy.reasoning,
      ),
    );
    assert.equal(legacy.task.agentConfig.rolePolicySources.plan, "legacy-task-override");
    const inherited = await (await send({})).json();
    assert.deepEqual(
      inherited.task.agentConfig.stagePolicies,
      (await api.store.settings()).profileStagePolicies.fast,
    );
  } finally {
    await api.close();
    await rm(api.root, { recursive: true, force: true });
  }
});
