import assert from "node:assert/strict";
import test from "node:test";
import { applyTaskRolePolicy } from "../../../server/companion-actions.mjs";
import { resolveRolePolicyLifecycleEligibility } from "../../../server/role-policy-eligibility.mjs";
import { recordWorkflowProfile } from "../../../server/workflow-profiles.mjs";
import { createFixtureGateway } from "../../../src/frontier/fixtures/gateway.ts";

test("future role choice survives profile escalation while historical evidence is immutable", async () => {
  const gateway = createFixtureGateway();
  const original = await gateway.core("PC-153");
  const task = { ...structuredClone(original), runs: (await gateway.runs(original.id)).items };
  const runs = structuredClone(task.runs),
    artifacts = structuredClone(task.artifacts);
  const policy = { model: "gpt-5.6-sol", reasoning: "xhigh" };
  assert.equal(resolveRolePolicyLifecycleEligibility(task, "implement").ok, true);
  applyTaskRolePolicy(task, "implement", policy);
  recordWorkflowProfile(task, "high-risk", "New repository evidence requires review", "automatic-escalation");
  assert.deepEqual(task.agentConfig.stagePolicies.implement, policy);
  assert.equal(task.agentConfig.rolePolicySources.implement, "future-role-override");
  assert.deepEqual(task.runs, runs);
  assert.deepEqual(task.artifacts, artifacts);
  assert.equal(resolveRolePolicyLifecycleEligibility(task, "grill").ok, false);
  task.status = "completed";
  assert.equal(resolveRolePolicyLifecycleEligibility(task, "final-review").ok, false);
  assert.equal((await gateway.core(original.id)).agentConfig.rolePolicySources.implement, "settings-default");
});
