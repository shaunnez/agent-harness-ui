// Settings → Research agent: which engine and model answer a research run, validated the same
// way in Settings and on the server, snapshotted onto each run when it starts, and honoured by
// the runtime that runs it.

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ApiLoopResearchRuntime } from "../server/research/api-loop/runtime.mjs";
import { createResearchRuntimeRegistry } from "../server/research/research-runtime-registry.mjs";
import { ResearchService } from "../server/research/research-service.mjs";
import { migratePersistedTaskState } from "../server/store.mjs";
import {
  DEFAULT_RESEARCH_POLICIES,
  researchPoliciesIssue,
  researchPoliciesOf,
} from "../src/research-policies.ts";
import { withResearchStore } from "./research-test-support.mjs";

const BASETEN = "baseten/deepseek-ai/DeepSeek-V4.1-Flash";
const agent = (overrides = {}) => ({ agent: { ...DEFAULT_RESEARCH_POLICIES.agent, ...overrides } });

// --- defaults and validation ------------------------------------------------------------------

test("the API loop is the default, and a choice saved for a retired engine reads as the default", () => {
  assert.deepEqual(researchPoliciesOf(null), DEFAULT_RESEARCH_POLICIES);
  assert.deepEqual(DEFAULT_RESEARCH_POLICIES.agent, {
    runtime: "api-loop",
    provider: "api",
    model: "opencode-go/deepseek-v4.1-flash",
    reasoning: "default",
  });
  // A saved API-loop choice wins.
  assert.equal(researchPoliciesOf({ researchPolicies: agent({ model: BASETEN }) }).agent.model, BASETEN);
  // The Claude, Codex and OpenCode CLIs and the four-role comparison were retired on 26 September
  // 2026: what they saved now reads as the API loop, and the roles are gone.
  for (const retired of [
    { runtime: "codex-cli", provider: "codex", model: "gpt-6-sol", reasoning: "xhigh" },
    { runtime: "claude-cli", provider: "claude", model: "claude-opus-5-5", reasoning: "high" },
    {
      runtime: "opencode-cli",
      provider: "opencode",
      model: "opencode-go/deepseek-v4.1-flash",
      reasoning: "default",
    },
  ]) {
    const read = researchPoliciesOf({
      researchPolicies: {
        agent: retired,
        roles: { planner: { provider: "claude", model: "x", reasoning: "high" } },
      },
    });
    assert.deepEqual(read, DEFAULT_RESEARCH_POLICIES);
  }

  // The store's own migration derives it the same way.
  const state = {
    tasks: [],
    settings: { allowedModels: ["claude-opus-5"], pricing: { creditRates: {}, creditSourceUrl: "x" } },
  };
  migratePersistedTaskState(state);
  assert.deepEqual(state.settings.researchPolicies, DEFAULT_RESEARCH_POLICIES);
  assert.equal(researchPoliciesIssue(state.settings.researchPolicies), null);
});

test("only the API loop's own research models validate, never a delivery model", () => {
  assert.equal(researchPoliciesIssue(DEFAULT_RESEARCH_POLICIES), null);
  assert.equal(researchPoliciesIssue(agent({ model: BASETEN })), null);
  assert.match(researchPoliciesIssue(agent({ model: "gpt-6-sol" })), /API loop's research models/);
  assert.match(researchPoliciesIssue(agent({ reasoning: "max" })), /does not support max/);
  assert.match(researchPoliciesIssue(agent({ provider: "claude" })), /runs api models only/);
  assert.match(researchPoliciesIssue(agent({ runtime: "codex-cli" })), /API loop only/);
  assert.match(researchPoliciesIssue(null), /Choose a research agent policy/);
});

// --- the snapshot each run takes ----------------------------------------------------------------

test("a run that names no runtime takes the Settings model on the API loop, and keeps it", async () => {
  await withResearchStore(async ({ store }) => {
    let saved = { researchPolicies: agent({ model: BASETEN }) };
    const runtimes = ["fake", "api-loop"].map(stubRuntime);
    const service = new ResearchService({
      store,
      registry: createResearchRuntimeRegistry(runtimes),
      settings: async () => saved,
    });
    const byId = Object.fromEntries(runtimes.map((runtime) => [runtime.id, runtime]));

    const run = await service.createRun({ objective: "Price a kerb." });
    assert.equal(run.runtimeId, "api-loop");
    assert.deepEqual(byId["api-loop"].started.at(-1).researchPolicy, {
      source: "settings-default",
      runtime: "api-loop",
      provider: "api",
      model: BASETEN,
      reasoning: "default",
    });
    // Changing Settings afterwards does not rewrite the run.
    saved = { researchPolicies: structuredClone(DEFAULT_RESEARCH_POLICIES) };
    assert.equal((await service.getRun(run.id)).request.researchPolicy.model, BASETEN);

    // A named runtime still wins; the fake takes no snapshot.
    await service.createRun({ objective: "Price a kerb.", runtimeId: "fake" });
    assert.equal(byId.fake.started.at(-1).researchPolicy, undefined);

    // A caller cannot supply its own snapshot.
    await service.createRun({
      objective: "Price a kerb.",
      runtimeId: "fake",
      researchPolicy: { runtime: "fake", model: "anything" },
    });
    assert.equal(byId.fake.started.at(-1).researchPolicy, undefined);
  });
});

test("without Settings wired in, a run with no runtime still goes to the fake runtime", async () => {
  await withResearchStore(async ({ store }) => {
    const service = new ResearchService({
      store,
      registry: createResearchRuntimeRegistry([stubRuntime("fake")]),
    });
    assert.equal((await service.createRun({ objective: "Price a kerb." })).runtimeId, "fake");
  });
});

test("the API loop runs the snapshotted model, and says which provider serves it", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rpol-"));
  try {
    const runtime = new ApiLoopResearchRuntime({
      env: {
        BASETEN_API_KEY: "test-key",
        RESEARCH_QV_SOURCE: "plancheck",
        RESEARCH_PLANCHECK_API: "http://127.0.0.1:9",
        RESEARCH_PLANCHECK_TOKEN_FILE: path.join(directory, "token.json"),
      },
      transcriptDirectory: path.join(directory, "transcripts"),
      sourceSnapshotDirectory: path.join(directory, "sources"),
      webToolsOptions: { searchProvider: { id: "stub", search: async () => ({ results: [] }) } },
    });
    const handle = await runtime.start({
      id: "RSCH-POLICY-BASETEN",
      objective: "Price a kerb.",
      profile: "standard",
      context: [],
      budget: { maxRuntimeMs: 10_000 },
      researchPolicy: {
        source: "settings-default",
        runtime: "api-loop",
        provider: "api",
        model: BASETEN,
        reasoning: "default",
      },
    });
    assert.equal(handle.model.model, BASETEN);
    assert.equal(handle.runtimeMetadata.provider, "Baseten");
    await runtime.cancel("RSCH-POLICY-BASETEN");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

// --- helpers -----------------------------------------------------------------------------------

function stubRuntime(id) {
  return {
    id,
    started: [],
    async start(request) {
      this.started.push(structuredClone(request));
      return { runId: request.id, runtimeId: id, status: "running", startedAt: new Date().toISOString() };
    },
    async status(runId) {
      return { runId, status: "completed", usage: { partial: false } };
    },
    async cancel() {},
    async *events() {},
    async result(runId) {
      return { runId, findings: [], artifacts: [], usage: { partial: false }, unresolvedQuestions: [] };
    },
  };
}
