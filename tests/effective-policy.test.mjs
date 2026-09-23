import assert from "node:assert/strict";
import test from "node:test";
import {
  EFFECTIVE_POLICY_VERSION,
  effectivePolicyFromReservation,
  resolveEffectiveRunPolicy,
} from "../server/effective-policy.mjs";
import { defaultProfileStagePolicies, defaultRuntimeSettings } from "../server/model-catalog.mjs";
import { snapshotTaskPolicies } from "../server/task-policy-snapshot.mjs";
import { canStartRun } from "../server/orchestrator-run-policy.mjs";
import { validateRepairEscalationPolicies } from "../server/repair-escalation-policy.mjs";
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
      repairEscalationPolicies: { standard: { model: "gpt-6-sol", reasoning: "xhigh" } },
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
    authorizer: {
      authorizingGateStage: "dev-review",
      authorizingGateFreshnessReasonCode: "repair_required",
      authorizingGateRunId: "gate-run",
      authorizingGateReservationId: "gate-reservation",
      authorizingGateArtifactId: "gate-artifact",
    },
    run: {
      id: "gate-run",
      stage: "dev-review",
      status: "completed",
      workflowReservationId: "gate-reservation",
      artifactId: "gate-artifact",
      candidateId: candidate.id,
      candidateRevision: candidate.revisionNumber,
      candidateHeadRevision: candidate.headRevision,
      gateResult: {
        verdict: "REPAIR",
        findings: [
          {
            kind: "candidate-defect",
            blocking: true,
            bindingExplicit: true,
            severity: "P1",
            candidateId: candidate.id,
            candidateRevision: candidate.revisionNumber,
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
    escalationGate: null,
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

  const policy = resolveEffectiveRunPolicy(current, "repair", evidence.authorizer);
  assert.equal(policy.selectedModel, "claude-sonnet-5");
  assert.equal(policy.model, "claude-opus-5-5");
  assert.equal(policy.provider, "claude");
  assert.match(policy.escalationReason, /Verified P1 candidate defect/);
  assert.deepEqual(policy.escalationGate, {
    stage: "dev-review",
    runId: "gate-run",
    artifactId: "gate-artifact",
    candidateId: "C1",
    candidateRevision: 2,
    severity: "P1",
  });
});

test("infrastructure failures and pinned roles never trigger reasoning escalation", () => {
  const evidence = materialRepairEvidence();
  const infrastructure = task({
    candidates: [evidence.candidate],
    runs: [{ ...evidence.run, gateResult: null, status: "failed" }],
  });
  assert.equal(resolveEffectiveRunPolicy(infrastructure, "repair").model, "gpt-6-sol");

  const pinned = task({ candidates: [evidence.candidate], runs: [evidence.run] });
  pinned.agentConfig.rolePolicySources.repair = "future-role-override";
  assert.equal(resolveEffectiveRunPolicy(pinned, "repair").model, "gpt-6-sol");
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
  assert.deepEqual(snapshot.repairEscalationPolicies.standard, {
    model: "claude-opus-5-5",
    reasoning: "high",
  });

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

test("only the exact completed P0/P1 candidate gate can escalate Repair", () => {
  const evidence = materialRepairEvidence();
  const valid = task({ candidates: [evidence.candidate], runs: [evidence.run] });
  const policies = [
    ["exact P1", valid, evidence.authorizer, true],
    [
      "exact P0",
      task({
        candidates: [evidence.candidate],
        runs: [
          {
            ...evidence.run,
            gateResult: {
              ...evidence.run.gateResult,
              findings: [{ ...evidence.run.gateResult.findings[0], severity: "P0" }],
            },
          },
        ],
      }),
      evidence.authorizer,
      true,
    ],
    ["no validated authorizer", valid, null, false],
    [
      "exceptional stale gate",
      valid,
      { ...evidence.authorizer, authorizingGateFreshnessReasonCode: "missing_binding" },
      false,
    ],
    ["wrong gate", valid, { ...evidence.authorizer, authorizingGateRunId: "another" }, false],
    [
      "stale revision",
      task({ candidates: [{ ...evidence.candidate, revisionNumber: 3 }], runs: [evidence.run] }),
      evidence.authorizer,
      false,
    ],
    [
      "wrong head",
      task({ candidates: [{ ...evidence.candidate, headRevision: "b".repeat(40) }], runs: [evidence.run] }),
      evidence.authorizer,
      false,
    ],
    [
      "timeout",
      task({ candidates: [evidence.candidate], runs: [{ ...evidence.run, status: "timed-out" }] }),
      evidence.authorizer,
      false,
    ],
    [
      "P2 architectural prose",
      task({
        candidates: [evidence.candidate],
        runs: [
          {
            ...evidence.run,
            gateResult: {
              ...evidence.run.gateResult,
              findings: [
                {
                  ...evidence.run.gateResult.findings[0],
                  severity: "P2",
                  title: "Security database migration race",
                },
              ],
            },
          },
        ],
      }),
      evidence.authorizer,
      false,
    ],
    [
      "verification gap",
      task({
        candidates: [evidence.candidate],
        runs: [
          {
            ...evidence.run,
            gateResult: {
              ...evidence.run.gateResult,
              findings: [{ ...evidence.run.gateResult.findings[0], kind: "verification-gap" }],
            },
          },
        ],
      }),
      evidence.authorizer,
      false,
    ],
    [
      "unbound finding",
      task({
        candidates: [evidence.candidate],
        runs: [
          {
            ...evidence.run,
            gateResult: {
              ...evidence.run.gateResult,
              findings: [{ ...evidence.run.gateResult.findings[0], candidateRevision: 1 }],
            },
          },
        ],
      }),
      evidence.authorizer,
      false,
    ],
    [
      "implicit finding binding",
      task({
        candidates: [evidence.candidate],
        runs: [
          {
            ...evidence.run,
            gateResult: {
              ...evidence.run.gateResult,
              findings: [{ ...evidence.run.gateResult.findings[0], bindingExplicit: false }],
            },
          },
        ],
      }),
      evidence.authorizer,
      false,
    ],
  ];
  for (const [name, current, authorizer, escalates] of policies) {
    const actual = resolveEffectiveRunPolicy(current, "repair", authorizer);
    assert.equal(actual.reasoning === "xhigh", escalates, name);
  }
  const off = structuredClone(valid);
  off.agentConfig.repairEscalationPolicies.standard = null;
  assert.equal(resolveEffectiveRunPolicy(off, "repair", evidence.authorizer).escalationReason, null);
  const changedProfile = structuredClone(valid);
  changedProfile.workflowProfile.selected = "high-risk";
  assert.equal(
    resolveEffectiveRunPolicy(changedProfile, "repair", evidence.authorizer).escalationReason,
    null,
  );
  const invalid = structuredClone(valid);
  invalid.agentConfig.repairEscalationPolicies.standard = { model: "claude-opus-5-5", reasoning: "high" };
  assert.throws(
    () => resolveEffectiveRunPolicy(invalid, "repair", evidence.authorizer),
    /eligible codex policy/,
  );
  const exhausted = structuredClone(valid);
  exhausted.status = "repair-required";
  exhausted.currentStage = "dev-review";
  exhausted.candidates[0].status = "repair_required";
  exhausted.attemptsByStage.implement = 3;
  exhausted.stageRunLimits = { implement: 3 };
  assert.equal(canStartRun(exhausted, "repair"), false, "a stronger rung never grants another attempt");
});

test("settings rungs are explicit, same-provider, stronger and snapped only onto new tasks", () => {
  const settings = defaultRuntimeSettings();
  const known = new Map(
    ["gpt-6-luna", "gpt-6-sol", "claude-sonnet-5", "claude-opus-5-5"].map((id) => [
      id,
      { id, label: id, reasoningLevels: ["medium", "high", "xhigh"] },
    ]),
  );
  assert.deepEqual(settings.repairEscalationPolicies, { fast: null, standard: null, "high-risk": null });
  settings.allowedModels = [...known.keys()];
  settings.repairEscalationPolicies.standard = { model: "gpt-6-sol", reasoning: "xhigh" };
  const first = snapshotTaskPolicies({}, settings, known, { selected: "standard" }, null);
  assert.deepEqual(first.repairEscalationPolicies.standard, settings.repairEscalationPolicies.standard);
  settings.repairEscalationPolicies.standard = null;
  assert.deepEqual(first.repairEscalationPolicies.standard, { model: "gpt-6-sol", reasoning: "xhigh" });
  const second = snapshotTaskPolicies({}, settings, known, { selected: "standard" }, null);
  assert.equal(second.repairEscalationPolicies.standard, null);
  const pinned = snapshotTaskPolicies(
    { rolePolicyOverrides: { repair: { model: "gpt-6-sol", reasoning: "high" } } },
    settings,
    known,
    { selected: "standard" },
    null,
  );
  assert.equal(pinned.repairEscalationPolicies.standard, null);
  assert.throws(
    () =>
      validateRepairEscalationPolicies(
        { standard: { model: "claude-opus-5-5", reasoning: "high" } },
        {},
        settings.profileStagePolicies,
        known,
        settings.allowedModels,
      ),
    /same provider/,
  );
  assert.throws(
    () =>
      validateRepairEscalationPolicies(
        { standard: { model: "gpt-6-sol", reasoning: "medium" } },
        {},
        settings.profileStagePolicies,
        known,
        settings.allowedModels,
      ),
    /stronger/,
  );
  assert.throws(
    () =>
      validateRepairEscalationPolicies(
        { standard: { model: "gpt-6-sol", reasoning: "xhigh" } },
        {},
        settings.profileStagePolicies,
        known,
        ["gpt-6-luna"],
      ),
    /allowed/,
  );
});
