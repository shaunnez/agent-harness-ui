import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { FakeResearchRuntime } from "../server/research/fake-research-runtime.mjs";
import {
  assertResearchRuntime,
  createResearchRuntimeRegistry,
  DEFAULT_RESEARCH_RUNTIME_ID,
} from "../server/research/research-runtime-registry.mjs";
import {
  researchBudgetForProfile,
  researchCeilingReached,
  researchSoftOverruns,
  resolveResearchBudget,
  SPIKE_MAX_RESEARCHERS,
} from "../server/research/engine/contracts/budget-policy.ts";
import {
  isResearchEventType,
  isResearchProfile,
  isTerminalResearchRunState,
  RESEARCH_RUN_STATES,
} from "../server/research/engine/contracts/runtime-contract.ts";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the fake runtime resolves through the runtime abstraction", () => {
  const runtime = new FakeResearchRuntime();
  const registry = createResearchRuntimeRegistry([runtime]);
  assert.deepEqual(registry.ids(), [DEFAULT_RESEARCH_RUNTIME_ID]);
  assert.equal(registry.resolve("fake"), runtime);
  assert.equal(registry.has("deepagents"), false);
  assert.throws(() => registry.resolve("deepagents"), /Unknown research runtime "deepagents"/);
});

test("the registry rejects a runtime that is missing the contract or reaches past it", () => {
  assert.throws(() => assertResearchRuntime({ id: "partial", start: () => {} }), /missing status\(\)/);
  const withResume = {
    id: "eager",
    start() {},
    status() {},
    cancel() {},
    events() {},
    result() {},
    resume() {},
  };
  assert.throws(() => assertResearchRuntime(withResume), /exposes resume\(\), which is not part/);
});

test("budget profiles resolve to the approved ceilings and the spike researcher cap", () => {
  const quick = researchBudgetForProfile("quick");
  const deep = researchBudgetForProfile("deep");
  assert.equal(quick.maxResearchers, 2);
  assert.equal(quick.maxRuntimeMs, 5 * 60_000);
  assert.equal(quick.maxModelCalls, 30);
  assert.equal(quick.maxSearchCalls, 20);
  assert.equal(quick.maxToolCalls, 60);
  assert.equal(quick.maxDepth, 1);
  // DEEP asks for eight researchers; the spike admits three, and the ceiling handed to a
  // runtime is the admitted number, never the aspirational one.
  assert.equal(deep.maxResearchers, SPIKE_MAX_RESEARCHERS);
  assert.equal(deep.maxConcurrentResearchers, 3);
  assert.equal(deep.maxDepth, 1);
});

test("a budget override may lower a ceiling but never raise one", () => {
  const lowered = resolveResearchBudget("standard", { maxResearchers: 1, maxModelCalls: 4 });
  assert.equal(lowered.maxResearchers, 1);
  assert.equal(lowered.maxModelCalls, 4);
  const raised = resolveResearchBudget("quick", { maxResearchers: 99, maxSearchCalls: 9_999 });
  assert.equal(raised.maxResearchers, 2);
  assert.equal(raised.maxSearchCalls, 20);
  assert.throws(() => resolveResearchBudget("quick", { maxResearchers: 0 }), /positive whole number/);
  assert.throws(() => resolveResearchBudget("quick", { maxUsd: -1 }), /positive number/);
});

test("configured ceilings, observed usage and ceiling hits stay distinguishable", () => {
  const budget = resolveResearchBudget("standard", { maxUsd: 1, maxTokens: 100 });
  const state = {
    modelCallsUsed: 4,
    toolCallsUsed: 2,
    searchCallsUsed: 1,
    researchersStarted: 1,
    elapsedMs: 10,
  };
  assert.equal(researchCeilingReached(budget, state), null);
  assert.equal(researchCeilingReached(budget, { ...state, researchersStarted: 3 }), "maxResearchers");
  // Soft limits are reported as overruns, never as truncation: the spend already happened.
  assert.deepEqual(
    researchSoftOverruns(budget, { partial: false, estimatedCostUsd: 2, inputTokens: 90, outputTokens: 40 }),
    ["maxUsd", "maxTokens"],
  );
});

test("run state and event guards agree with the declared unions", () => {
  assert.equal(RESEARCH_RUN_STATES.length, 7);
  assert.ok(isResearchProfile("deep"));
  assert.ok(!isResearchProfile("exhaustive"));
  assert.ok(isTerminalResearchRunState("cancelled"));
  assert.ok(!isTerminalResearchRunState("cancelling"));
  assert.ok(isResearchEventType("budget.ceiling_hit"));
  assert.ok(!isResearchEventType("graph.node_entered"));
});

test("no runtime vocabulary leaks into the public research contracts", async () => {
  // The compile-time half of this lives in `server/research/engine/contracts/runtime-contract.ts`, which fails
  // `npm run typecheck` if a forbidden key appears on a contract type. This half catches the
  // vocabulary a type check cannot see: a comment, a string literal, an import.
  const forbidden = [
    "langchain",
    "langgraph",
    "langsmith",
    "deepagents",
    "deep agents",
    "checkpointer",
    "thread_id",
    "threadid",
    "subagent",
    "recursionlimit",
  ];
  // Only the contract file itself. `server/research/engine/contracts/runtime-contract.ts` is exempt because its
  // job is to *list* the forbidden vocabulary as a blocklist.
  const relativePath = "server/research/engine/contracts/research.ts";
  const source = (await readFile(path.join(repositoryRoot, relativePath), "utf8")).toLowerCase();
  for (const term of forbidden) {
    assert.ok(
      !source.includes(term),
      `${relativePath} mentions "${term}"; the neutral contracts must not name a runtime.`,
    );
  }
  assert.ok(!/\bresume\s*\(/.test(source), `${relativePath} declares resume(), which slice 1 excludes.`);
});
