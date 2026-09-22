import assert from "node:assert/strict";
import test from "node:test";
import {
  EFFECTIVE_POLICY_VERSION,
  effectivePolicyFromReservation,
  resolveEffectiveRunPolicy,
} from "../server/effective-policy.mjs";
import { defaultProfileStagePolicies, defaultRuntimeSettings } from "../server/model-catalog.mjs";
import { snapshotTaskPolicies } from "../server/task-policy-snapshot.mjs";
import { recordWorkflowProfile } from "../server/workflow-profiles.mjs";

function task(overrides = {}) {
  const codex = defaultProfileStagePolicies("codex");
  return {
    workflowProfile: { selected: "standard" },
    agentConfig: {
      stagePolicies: structuredClone(codex.standard),
      profileStagePolicies: structuredClone(codex),
      rolePolicySources: Object.fromEntries(
        Object.keys(codex.standard).map((role) => [role, "settings-default"]),
      ),
      rolePolicyOverrides: {},
      repairEscalationPolicies: { standard: structuredClone(codex.standard.plan) },
      providerConstraint: null,
    },
    candidates: [],
    runs: [],
    attemptsByStage: {},
    workPackages: [],
    ...overrides,
  };
}

function materialRepairEvidence(provider = "codex") {
  const candidate = { id: "C1", revisionNumber: 2, headRevision: "a".repeat(40) };
  return {
    candidate,
    run: {
      stage: "dev-review",
      candidateId: candidate.id,
      candidateRevision: candidate.revisionNumber,
      gateResult: {
        verdict: "REPAIR",
        findings: [
          {
            kind: "candidate-defect",
            blocking: true,
            severity: "P1",
            title: `${provider} candidate corrupts persisted state`,
          },
        ],
      },
    },
  };
}

test("a custom repair pin is the exact policy persisted at reservation and execution", () => {
  const current = task();
  current.agentConfig.stagePolicies.repair = { model: "gpt-5.6-terra", reasoning: "max" };
  current.agentConfig.rolePolicyOverrides.repair = structuredClone(current.agentConfig.stagePolicies.repair);
  current.agentConfig.rolePolicySources.repair = "task-override";
  const evidence = materialRepairEvidence();
  current.candidates = [evidence.candidate];
  current.runs = [evidence.run];

  const effectivePolicy = resolveEffectiveRunPolicy(current, "repair");
  const reservation = { provider: effectivePolicy.provider, effectivePolicy };
  assert.equal(reservation.provider, "codex");
  assert.deepEqual(effectivePolicy, {
    policyVersion: EFFECTIVE_POLICY_VERSION,
    profile: "standard",
    role: "repair",
    source: "task-override",
    providerConstraint: null,
    selectedProvider: "codex",
    selectedModel: "gpt-5.6-terra",
    selectedReasoning: "max",
    provider: "codex",
    model: "gpt-5.6-terra",
    reasoning: "max",
    escalationReason: null,
  });

  current.agentConfig.stagePolicies.repair = { model: "claude-opus-5-5", reasoning: "high" };
  assert.deepEqual(effectivePolicyFromReservation(reservation, "repair"), reservation.effectivePolicy);
});

test("verified material repair escalation stays inside an inherited provider constraint", () => {
  const claude = defaultProfileStagePolicies("claude");
  const evidence = materialRepairEvidence("claude");
  const current = task({
    workflowProfile: { selected: "standard" },
    candidates: [evidence.candidate],
    runs: [evidence.run],
  });
  current.agentConfig = {
    stagePolicies: structuredClone(claude.standard),
    profileStagePolicies: structuredClone(claude),
    rolePolicySources: Object.fromEntries(
      Object.keys(claude.standard).map((role) => [role, "provider-preset"]),
    ),
    rolePolicyOverrides: {},
    repairEscalationPolicies: { standard: structuredClone(claude.standard.plan) },
    providerConstraint: "claude",
  };

  const policy = resolveEffectiveRunPolicy(current, "repair");
  assert.equal(policy.selectedModel, "claude-sonnet-5");
  assert.equal(policy.model, "claude-opus-5-5");
  assert.equal(policy.provider, "claude");
  assert.match(policy.escalationReason, /Verified P1 candidate defect/);
});

test("infrastructure failures and pinned roles never trigger reasoning escalation", () => {
  const evidence = materialRepairEvidence();
  const infrastructure = task({
    candidates: [evidence.candidate],
    runs: [{ ...evidence.run, gateResult: null, status: "failed" }],
  });
  assert.equal(resolveEffectiveRunPolicy(infrastructure, "repair").model, "gpt-6-luna");

  const pinned = task({ candidates: [evidence.candidate], runs: [evidence.run] });
  pinned.agentConfig.rolePolicySources.repair = "future-role-override";
  assert.equal(resolveEffectiveRunPolicy(pinned, "repair").model, "gpt-6-luna");
});

test("provider presets remain profile-aware while individual roles stay pinned", () => {
  const settings = defaultRuntimeSettings();
  const knownModels = new Map(
    [
      ["gpt-6-luna", ["low", "medium", "high", "xhigh", "max"]],
      ["gpt-6-sol", ["low", "medium", "high", "xhigh", "max", "ultra"]],
      ["claude-sonnet-5", ["low", "medium", "high", "xhigh", "max"]],
      ["claude-opus-5-5", ["low", "medium", "high", "xhigh", "max"]],
    ].map(([id, reasoningLevels]) => [id, { id, label: id, reasoningLevels }]),
  );
  settings.allowedModels = [...knownModels.keys()];
  const pinned = { model: "claude-opus-5-5", reasoning: "max" };
  const snapshot = snapshotTaskPolicies(
    { providerConstraint: "claude", rolePolicyOverrides: { grill: pinned } },
    settings,
    knownModels,
    { selected: "fast" },
    null,
  );
  const defaults = defaultProfileStagePolicies("claude");
  assert.deepEqual(snapshot.profileStagePolicies.fast.triage, defaults.fast.triage);
  assert.deepEqual(snapshot.profileStagePolicies.standard.triage, defaults.standard.triage);
  for (const matrix of Object.values(snapshot.profileStagePolicies)) assert.deepEqual(matrix.grill, pinned);
  assert.equal(snapshot.rolePolicySources.triage, "provider-preset");
  assert.equal(snapshot.rolePolicySources.grill, "task-override");
  assert.equal(snapshot.providerConstraint, "claude");

  const profiledTask = {
    workflowProfile: { selected: "fast", history: [] },
    agentConfig: structuredClone(snapshot),
  };
  assert.equal(recordWorkflowProfile(profiledTask, "standard", "Material scope discovered."), true);
  assert.deepEqual(profiledTask.agentConfig.stagePolicies.grill, pinned);
  assert.ok(profiledTask.workflowProfile.policyImpact.changedRoles.includes("triage"));
  assert.deepEqual(profiledTask.workflowProfile.policyImpact.pinnedRoles, ["grill"]);
});

test("a provider constraint fails closed instead of silently substituting another provider", () => {
  const current = task();
  current.agentConfig.providerConstraint = "claude";
  assert.throws(
    () => resolveEffectiveRunPolicy(current, "repair"),
    /outside this task's claude-only constraint/i,
  );
});
