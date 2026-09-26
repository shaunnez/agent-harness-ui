// Settings → Research agent: which engine and model answer a research run, validated the same
// way in Settings and on the server, snapshotted onto each run when it starts, and honoured by
// the runtime that runs it.

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ClaudeCliResearchRuntime } from "../server/research/claude-cli/runtime.mjs";
import { CodexCliResearchRuntime } from "../server/research/codex-cli/runtime.mjs";
import { createResearchRuntimeRegistry } from "../server/research/research-runtime-registry.mjs";
import { ResearchService } from "../server/research/research-service.mjs";
import { migratePersistedTaskState } from "../server/store.mjs";
import {
  DEFAULT_RESEARCH_POLICIES,
  researchPoliciesIssue,
  researchPoliciesOf,
} from "../src/research-policies.ts";
import { withResearchStore } from "./research-test-support.mjs";

const MODELS = [
  {
    id: "claude-opus-5-5",
    label: "Claude Opus 5.5",
    provider: "claude",
    editable: true,
    reasoningLevels: ["low", "high"],
  },
  {
    id: "claude-opus-5",
    label: "Claude Opus 5",
    provider: "claude",
    editable: true,
    reasoningLevels: ["high"],
  },
  {
    id: "gpt-6-sol",
    label: "GPT-6 Sol",
    provider: "codex",
    editable: true,
    reasoningLevels: ["high", "xhigh"],
  },
];
const ALLOWED = MODELS.map((model) => model.id);
const codexAgent = (overrides = {}) => ({
  ...structuredClone(DEFAULT_RESEARCH_POLICIES),
  agent: { runtime: "codex-cli", provider: "codex", model: "gpt-6-sol", reasoning: "xhigh", ...overrides },
});

// --- defaults and validation ------------------------------------------------------------------

test("settings saved before the section existed read as the defaults: DeepSeek for the agent, Opus 5.5 or Claude Design for the roles", () => {
  assert.deepEqual(researchPoliciesOf(null), DEFAULT_RESEARCH_POLICIES);
  assert.deepEqual(researchPoliciesOf({ allowedModels: ALLOWED }), DEFAULT_RESEARCH_POLICIES);
  const older = researchPoliciesOf({
    allowedModels: ["claude-opus-5", "gpt-5.6-sol"],
    designPolicies: { "claude-design": { model: "claude-opus-5", reasoning: "high" } },
  });
  // The agent's default is DeepSeek on OpenCode, which no delivery allowlist governs.
  assert.deepEqual(older.agent, {
    runtime: "opencode-cli",
    provider: "opencode",
    model: "opencode-go/deepseek-v4.1-flash",
    reasoning: "default",
  });
  assert.equal(older.roles.verifier.model, "claude-opus-5");
  // A saved choice always wins.
  assert.equal(
    researchPoliciesOf({ researchPolicies: codexAgent(), allowedModels: [] }).agent.runtime,
    "codex-cli",
  );

  // The store's own migration derives it the same way, rather than copying the raw default.
  const state = {
    tasks: [],
    settings: {
      allowedModels: ["claude-opus-5"],
      designPolicies: { "claude-design": { provider: "claude", model: "claude-opus-5", reasoning: "high" } },
      pricing: { creditRates: {}, creditSourceUrl: "x" },
    },
  };
  migratePersistedTaskState(state);
  assert.equal(state.settings.researchPolicies.agent.model, "opencode-go/deepseek-v4.1-flash");
  assert.equal(state.settings.researchPolicies.roles.verifier.model, "claude-opus-5");
  assert.equal(researchPoliciesIssue(state.settings.researchPolicies, MODELS, ["claude-opus-5"]), null);
});

test("the engine decides the provider, and each model must be allowed and support its reasoning", () => {
  assert.equal(researchPoliciesIssue(DEFAULT_RESEARCH_POLICIES, MODELS, ALLOWED), null);
  assert.equal(researchPoliciesIssue(codexAgent(), MODELS, ALLOWED), null);
  assert.match(
    researchPoliciesIssue(codexAgent({ model: "claude-opus-5-5", provider: "codex" }), MODELS, ALLOWED),
    /needs a Codex model/,
  );
  assert.match(
    researchPoliciesIssue(codexAgent({ provider: "claude" }), MODELS, ALLOWED),
    /runs codex models only/,
  );
  assert.match(
    researchPoliciesIssue(codexAgent({ reasoning: "low" }), MODELS, ALLOWED),
    /does not support low/,
  );
  assert.match(researchPoliciesIssue(codexAgent(), MODELS, ["claude-opus-5-5"]), /needs an allowed model/);
  assert.match(
    researchPoliciesIssue(
      { ...codexAgent(), agent: { ...codexAgent().agent, runtime: "fake" } },
      MODELS,
      ALLOWED,
    ),
    /Claude CLI, Codex CLI, OpenCode CLI or the API loop/,
  );
  // OpenCode models come from their own research list, never the delivery allowlist.
  assert.equal(researchPoliciesIssue(DEFAULT_RESEARCH_POLICIES, MODELS, ["claude-opus-5-5"]), null);
  const openCode = (agent) => ({
    ...structuredClone(DEFAULT_RESEARCH_POLICIES),
    agent: { ...DEFAULT_RESEARCH_POLICIES.agent, ...agent },
  });
  assert.match(
    researchPoliciesIssue(openCode({ model: "gpt-6-sol" }), MODELS, ALLOWED),
    /OpenCode CLI's research models/,
  );
  assert.match(
    researchPoliciesIssue(openCode({ reasoning: "max" }), MODELS, ALLOWED),
    /does not support max/,
  );
  assert.match(
    researchPoliciesIssue(openCode({ provider: "claude" }), MODELS, ALLOWED),
    /runs opencode models only/,
  );
  // The API loop has its own research list too: DeepSeek on OpenCode Go's API or on Baseten.
  const apiLoop = (model) => openCode({ runtime: "api-loop", provider: "api", model });
  assert.equal(researchPoliciesIssue(apiLoop("opencode-go/deepseek-v4.1-flash"), MODELS, ["claude-opus-5-5"]), null);
  assert.equal(researchPoliciesIssue(apiLoop("baseten/deepseek-ai/DeepSeek-V4.1-Flash"), MODELS, ["claude-opus-5-5"]), null);
  assert.match(researchPoliciesIssue(apiLoop("gpt-6-sol"), MODELS, ALLOWED), /API loop's research models/);
  assert.match(
    researchPoliciesIssue(openCode({ runtime: "api-loop", provider: "opencode" }), MODELS, ALLOWED),
    /runs api models only/,
  );
  const codexRole = structuredClone(DEFAULT_RESEARCH_POLICIES);
  codexRole.roles.verifier = { provider: "claude", model: "gpt-6-sol", reasoning: "high" };
  assert.match(researchPoliciesIssue(codexRole, MODELS, ALLOWED), /verifier role needs a Claude model/);
});

// --- the snapshot each run takes ----------------------------------------------------------------

test("a run that names no runtime takes the Settings engine and model, and keeps them", async () => {
  await withResearchStore(async ({ store }) => {
    let saved = { researchPolicies: codexAgent() };
    const runtimes = ["fake", "claude-cli", "codex-cli", "opencode-cli", "claude-cli-roles"].map(stubRuntime);
    const service = new ResearchService({
      store,
      registry: createResearchRuntimeRegistry(runtimes),
      settings: async () => saved,
    });
    const byId = Object.fromEntries(runtimes.map((runtime) => [runtime.id, runtime]));

    const run = await service.createRun({ objective: "Price a kerb." });
    assert.equal(run.runtimeId, "codex-cli");
    assert.deepEqual(byId["codex-cli"].started.at(-1).researchPolicy, {
      source: "settings-default",
      runtime: "codex-cli",
      provider: "codex",
      model: "gpt-6-sol",
      reasoning: "xhigh",
    });
    // Changing Settings afterwards does not rewrite the run.
    saved = { researchPolicies: structuredClone(DEFAULT_RESEARCH_POLICIES) };
    assert.equal((await service.getRun(run.id)).request.researchPolicy.model, "gpt-6-sol");

    // With no saved choice, the default is DeepSeek on OpenCode.
    const deepseek = await service.createRun({ objective: "Price a kerb." });
    assert.equal(deepseek.runtimeId, "opencode-cli");
    assert.equal(byId["opencode-cli"].started.at(-1).researchPolicy.model, "opencode-go/deepseek-v4.1-flash");
    saved = {
      researchPolicies: {
        ...structuredClone(DEFAULT_RESEARCH_POLICIES),
        agent: { runtime: "claude-cli", provider: "claude", model: "claude-opus-5-5", reasoning: "high" },
      },
    };

    // A named runtime still wins. It takes the Settings model only when Settings chose it.
    await service.createRun({ objective: "Price a kerb.", runtimeId: "codex-cli" });
    assert.equal(byId["codex-cli"].started.at(-1).researchPolicy, undefined);
    await service.createRun({ objective: "Price a kerb.", runtimeId: "claude-cli" });
    assert.equal(byId["claude-cli"].started.at(-1).researchPolicy.source, "settings-for-named-runtime");
    await service.createRun({ objective: "Price a kerb.", runtimeId: "claude-cli-roles" });
    assert.equal(
      byId["claude-cli-roles"].started.at(-1).researchPolicy.roles.planner.model,
      "claude-opus-5-5",
    );
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

// --- the runtimes honour it ---------------------------------------------------------------------

test("the Claude runtime runs the snapshotted model and effort, and passes no effort without one", async () => {
  const seen = [];
  await withCliRuntime(ClaudeCliResearchRuntime, seen, async (runtime) => {
    const handle = await runtime.start(
      request("RSCH-POLICY-CLAUDE", {
        source: "settings-default",
        runtime: "claude-cli",
        provider: "claude",
        model: "claude-sonnet-5",
        reasoning: "high",
      }),
    );
    assert.equal(handle.model.model, "claude-sonnet-5");
    assert.equal(handle.runtimeMetadata.effort, "high");
    await drain(runtime, "RSCH-POLICY-CLAUDE");
    await runtime.start(request("RSCH-POLICY-NONE"));
    await drain(runtime, "RSCH-POLICY-NONE");
  });
  assert.equal(flag(seen[0], "--model"), "claude-sonnet-5");
  assert.equal(flag(seen[0], "--effort"), "high");
  // The benchmarks bypass Settings and must keep the recorded flag set.
  assert.equal(seen[1].includes("--effort"), false);
  assert.equal(flag(seen[1], "--model"), "claude-opus-5-5");
});

test("the Codex runtime runs the snapshotted model and reasoning", async () => {
  const seen = [];
  await withCliRuntime(CodexCliResearchRuntime, seen, async (runtime) => {
    const handle = await runtime.start(
      request("RSCH-POLICY-CODEX", {
        source: "settings-default",
        runtime: "codex-cli",
        provider: "codex",
        model: "gpt-6-luna",
        reasoning: "xhigh",
      }),
    );
    assert.equal(handle.model.model, "gpt-6-luna");
    assert.equal(handle.runtimeMetadata.reasoning, "xhigh");
    await drain(runtime, "RSCH-POLICY-CODEX");
  });
  assert.equal(flag(seen[0], "--model"), "gpt-6-luna");
  assert.ok(seen[0].includes('model_reasoning_effort="xhigh"'));
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

async function withCliRuntime(Runtime, seen, body) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rpol-"));
  await writeFile(path.join(directory, "capture.jsonl"), "");
  const runtime = new Runtime({
    env: {
      PATH: process.env.PATH,
      HOME: directory,
      RESEARCH_QV_SOURCE: "local",
      RESEARCH_QV_INDEX: path.join(directory, "capture.jsonl"),
    },
    transcriptDirectory: path.join(directory, "transcripts"),
    sourceSnapshotDirectory: path.join(directory, "sources"),
    hostTools: [],
    assertAuth: async () => ({ binary: "/usr/local/bin/cli" }),
    run: async (_binary, args) => {
      seen.push(args);
      return { code: 0, signal: null, stdout: "", stderr: "" };
    },
  });
  try {
    await body(runtime);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function request(id, researchPolicy) {
  return {
    id,
    objective: "Price a kerb.",
    profile: "standard",
    context: [],
    budget: { maxRuntimeMs: 10_000 },
    ...(researchPolicy ? { researchPolicy } : {}),
  };
}

async function drain(runtime, runId) {
  for await (const _event of runtime.events(runId));
}

function flag(args, name) {
  return args[args.indexOf(name) + 1];
}
