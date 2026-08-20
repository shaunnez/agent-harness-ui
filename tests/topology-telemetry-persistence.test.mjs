import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildEvaluationSummary, normalizeExperimentInput } from "../server/evaluation.mjs";
import { defaultRuntimeSettings, POLICY_IDS } from "../server/model-catalog.mjs";
import { SqliteTaskStore } from "../server/sqlite-store.mjs";
import { JsonTaskStore, migratePersistedTaskState } from "../server/store.mjs";
import {
  recordEdge,
  recordNodeExecuted,
  recordNodeSkipped,
  recordRoutingDecision,
} from "../server/topology-trace.mjs";

/**
 * F1 in docs/harness-v2/progress.md: the eval lab had never processed a real run, so every
 * topology claim so far rested on unit tests that never touched persistence. This exercises the
 * path the running app actually uses — create with an experiment, write a trace, persist, read
 * back through `listEvaluationTasks`, and summarise — because a projection that dropped
 * `topologyTrace` would zero all telemetry in production while every unit test stayed green.
 */
async function fixture(storeKind) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-topology-persist-"));
  const store =
    storeKind === "sqlite"
      ? new SqliteTaskStore(path.join(directory, "tasks.sqlite3"))
      : new JsonTaskStore(path.join(directory, "tasks.json"));
  await store.init();
  return { directory, store };
}

function experiment(topologyId) {
  return normalizeExperimentInput(
    {
      groupId: "harness-v2",
      variantId: "cognitive-layer",
      topologyId,
      acceptanceCriteria: ["The topology is reported."],
      verificationCommands: ["npm test"],
    },
    { taskBriefHash: "hash", policyMatrix: {}, frozenBaseSha: "b".repeat(40) },
  );
}

for (const storeKind of ["json", "sqlite"]) {
  test(`topology telemetry survives a ${storeKind} round trip into the evaluation summary`, async () => {
    const { directory, store } = await fixture(storeKind);
    try {
      const created = await store.create({
        title: "Mailbox visibility",
        description: "Delegated connections are missing from the mailbox list.",
        repositoryPath: directory,
        workflow: "implement",
        priority: "high",
        experiment: experiment("topology-cognitive-v1"),
      });

      // A new task starts with no trace at all, exactly as a pre-existing task would.
      assert.equal(created.topologyTrace, null);
      assert.equal(created.investigation, null);
      assert.equal(created.planCritique, null);

      await store.update(created.id, (draft) => {
        for (const node of ["triage", "scouts", "synthesis", "plan", "plan-review"])
          recordNodeExecuted(draft, node);
        recordNodeSkipped(draft, "grill", "No material product decision remained.");
        recordEdge(draft, "scouts", "synthesis");
        recordEdge(draft, "plan", "plan-review");
        recordEdge(draft, "test", "plan", "backjump");
        recordRoutingDecision(draft, {
          at: "test",
          classification: "PLAN_DEFECT",
          rewindTo: "plan",
          rationale: "The plan never covered the delegated-connection criterion.",
        });
        draft.status = "merged-to-target";
        draft.startedAt = "2026-08-20T00:00:00.000Z";
        draft.completedAt = "2026-08-20T00:20:00.000Z";
      });

      const tasks =
        typeof store.listEvaluationTasks === "function"
          ? await store.listEvaluationTasks()
          : await store.list();
      const summary = buildEvaluationSummary(tasks);
      assert.equal(summary.experiments.variants.length, 1);
      const variant = summary.experiments.variants[0];

      assert.equal(variant.topologyId, "topology-cognitive-v1");
      assert.equal(variant.topologyVersion, 1);
      assert.equal(variant.nodesExecuted, 5, "every executed node survived persistence");
      assert.equal(variant.nodesSkipped, 1);
      assert.equal(variant.nodeExecutionCounts["plan-review"], 1);
      assert.equal(variant.nodeSkipCounts.grill, 1);
      assert.equal(variant.edgesTaken, 3);
      assert.equal(variant.backjumpCount, 1, "the rewind is visible in reporting");
      assert.deepEqual(variant.failureClassifications, { PLAN_DEFECT: 1 });
      assert.equal(variant.invalidTopologyTraces, 0);
      assert.ok(variant.wallTimeMs > 0);
    } finally {
      await store.close?.();
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });
}

test("a task recorded before any of this existed still reports, with zeroed topology", async () => {
  const { directory, store } = await fixture("json");
  try {
    const created = await store.create({
      title: "Legacy task",
      description: "Recorded before topology tracing existed.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "low",
      experiment: experiment("topology-baseline-v1"),
    });
    await store.update(created.id, (draft) => {
      // Simulate the shape a genuinely old row has: the field simply is not there.
      delete draft.topologyTrace;
      draft.status = "completed";
      draft.startedAt = "2026-08-01T00:00:00.000Z";
      draft.completedAt = "2026-08-01T00:10:00.000Z";
    });
    const variant = buildEvaluationSummary(await store.list()).experiments.variants[0];
    assert.equal(variant.nodesExecuted, 0);
    assert.equal(variant.edgesTaken, 0);
    assert.equal(variant.backjumpCount, 0);
    assert.equal(variant.invalidTopologyTraces, 0, "absent is not the same as malformed");
    assert.deepEqual(variant.failureClassifications, {});
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

/**
 * Adding a reasoning stage adds a policy id, and `validateStagePolicies` iterates POLICY_IDS.
 * An install whose persisted settings predate the stage would fail validation on a key it had no
 * way to know about, so the migration backfills from defaults. Verified against a copy of the
 * real 37MB store during Phase 6; pinned here against a synthetic legacy shape so it stays true.
 */
test("settings recorded before the new reasoning stages are backfilled, not rejected", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-policy-backfill-"));
  try {
    const legacyPolicies = {
      triage: { model: "gpt-5.6-luna", reasoning: "xhigh" },
      scouts: { model: "gpt-5.6-luna", reasoning: "xhigh" },
      grill: { model: "gpt-5.6-luna", reasoning: "xhigh" },
      specification: { model: "gpt-5.6-luna", reasoning: "xhigh" },
      plan: { model: "gpt-5.6-sol", reasoning: "high" },
      implement: { model: "gpt-5.6-luna", reasoning: "xhigh" },
      repair: { model: "gpt-5.6-luna", reasoning: "xhigh" },
      "dev-review": { model: "gpt-5.6-sol", reasoning: "high" },
      test: { model: "gpt-5.6-luna", reasoning: "xhigh" },
      "final-review": { model: "gpt-5.6-luna", reasoning: "medium" },
    };
    const state = {
      settings: {
        ...defaultRuntimeSettings(),
        stagePolicies: structuredClone(legacyPolicies),
        profileStagePolicies: {
          fast: structuredClone(legacyPolicies),
          standard: structuredClone(legacyPolicies),
          "high-risk": structuredClone(legacyPolicies),
        },
      },
      tasks: [],
    };

    assert.equal(migratePersistedTaskState(state), true, "a missing policy id is a change");
    for (const policyId of POLICY_IDS) {
      assert.ok(state.settings.stagePolicies[policyId], `stagePolicies is missing ${policyId}`);
      for (const profile of ["fast", "standard", "high-risk"]) {
        assert.ok(
          state.settings.profileStagePolicies[profile][policyId],
          `${profile} is missing ${policyId}`,
        );
      }
    }
    // Opposition is only opposition if the critic is not the planner's own model.
    assert.notEqual(
      state.settings.profileStagePolicies.standard["plan-review"].model,
      state.settings.profileStagePolicies.standard.plan.model,
      "the plan critic must default to a different model from the planner",
    );
    assert.equal(migratePersistedTaskState(state), false, "the backfill is idempotent");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

/**
 * Observed by booting the app against a copy of the real store: a workflow that is mostly OpenAI
 * but plans on `claude-opus-5` was getting a critic on `gpt-5.6-luna`. That is technically a
 * different model, but different by accident across vendors rather than opposition by design. The
 * new stages anchor to the provider the operator chose for planning.
 */
test("a mixed-provider workflow gets a critic from its planner's provider, not the majority's", () => {
  const mixed = {
    triage: { model: "gpt-5.6-luna", reasoning: "xhigh" },
    scouts: { model: "gpt-5.6-luna", reasoning: "xhigh" },
    grill: { model: "claude-sonnet-5", reasoning: "high" },
    specification: { model: "claude-opus-5", reasoning: "high" },
    plan: { model: "claude-opus-5", reasoning: "xhigh" },
    implement: { model: "gpt-5.6-luna", reasoning: "xhigh" },
    repair: { model: "gpt-5.6-sol", reasoning: "high" },
    "dev-review": { model: "claude-opus-5", reasoning: "high" },
    test: { model: "gpt-5.6-luna", reasoning: "xhigh" },
    "final-review": { model: "gpt-5.6-sol", reasoning: "high" },
  };
  const state = {
    settings: {
      ...defaultRuntimeSettings(),
      stagePolicies: structuredClone(mixed),
      profileStagePolicies: {
        fast: structuredClone(mixed),
        standard: structuredClone(mixed),
        "high-risk": structuredClone(mixed),
      },
    },
    tasks: [],
  };
  assert.equal(migratePersistedTaskState(state), true);

  const policies = state.settings.stagePolicies;
  // The majority of these policies are OpenAI, but planning is Claude, so the stages defined
  // relative to planning follow planning.
  assert.match(policies["plan-review"].model, /^claude-/);
  assert.match(policies.synthesis.model, /^claude-/);
  assert.notEqual(
    policies["plan-review"].model,
    policies.plan.model,
    "the critic must still be a different model from the planner",
  );
  for (const profile of ["fast", "standard", "high-risk"]) {
    assert.match(state.settings.profileStagePolicies[profile]["plan-review"].model, /^claude-/);
  }
});

test("an all-OpenAI workflow keeps its critic on OpenAI", () => {
  const openai = {
    triage: { model: "gpt-5.6-luna", reasoning: "xhigh" },
    scouts: { model: "gpt-5.6-luna", reasoning: "xhigh" },
    grill: { model: "gpt-5.6-luna", reasoning: "xhigh" },
    specification: { model: "gpt-5.6-luna", reasoning: "xhigh" },
    plan: { model: "gpt-5.6-sol", reasoning: "high" },
    implement: { model: "gpt-5.6-luna", reasoning: "xhigh" },
    repair: { model: "gpt-5.6-luna", reasoning: "xhigh" },
    "dev-review": { model: "gpt-5.6-sol", reasoning: "high" },
    test: { model: "gpt-5.6-luna", reasoning: "xhigh" },
    "final-review": { model: "gpt-5.6-luna", reasoning: "medium" },
  };
  const state = {
    settings: {
      ...defaultRuntimeSettings(),
      stagePolicies: structuredClone(openai),
      profileStagePolicies: {},
    },
    tasks: [],
  };
  assert.equal(migratePersistedTaskState(state), true);
  assert.match(state.settings.stagePolicies["plan-review"].model, /^gpt-/);
  assert.notEqual(state.settings.stagePolicies["plan-review"].model, state.settings.stagePolicies.plan.model);
});
