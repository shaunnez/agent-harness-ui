// The four-role sequence, offline.
//
// What matters here is structural and can be asserted without spending anything: the four
// calls happen in order, each is handed the previous one's output, the synthesiser is given no
// tools, a failed role stops the sequence rather than letting the synthesiser write a band
// from unchecked evidence, and the final schema is the one the single-agent runtime produces
// so the two are scored identically.
//
// Whether four roles actually beat one agent is not a test. It is a measurement over the 30
// pinned scopes, and `scripts/research-claude-cli-roles-benchmark.mjs` makes it.

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { comparePhases } from "../scripts/research-claude-cli/phase-comparison.mjs";
import {
  RESEARCH_ROLE_NAMES,
  RESEARCH_ROLE_SEQUENCE,
  verifierEffect,
} from "../server/research/claude-cli/roles.mjs";
import {
  CLAUDE_CLI_ROLES_RUNTIME_ID,
  ClaudeCliRolesResearchRuntime,
} from "../server/research/claude-cli/roles-runtime.mjs";
import { DEFAULT_CLAUDE_CLI_MODEL } from "../server/research/claude-cli/runtime.mjs";
import { assertResearchRuntime } from "../server/research/research-runtime-registry.mjs";

const fence = (payload) => `\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``;

const PLAN = {
  components: [{ role: "Channel and grate", corpus_queries: ["channel drain"], web_only: false }],
};
const RESEARCH = {
  components: [
    {
      role: "Channel and grate",
      row_id: "abc:t1:r4",
      source: null,
      unit: "m",
      amount: { low: 300, high: 360 },
    },
    {
      role: "Traffic management",
      row_id: "xyz:t9:r1",
      source: null,
      unit: "m",
      amount: { low: 90, high: 120 },
    },
  ],
  not_established: [],
};
const CHECKS = {
  checks: [
    { role: "Channel and grate", status: "supported", reason: "Row exists and matches the duty class." },
    { role: "Traffic management", status: "rejected", reason: "The scope excludes traffic management." },
  ],
};
const BAND = {
  id: "channel-drain-installation-pinned",
  resolved_from: "qv",
  confidence: "medium",
  components: [
    {
      role: "Channel and grate",
      row_id: "abc:t1:r4",
      source: null,
      unit: "m",
      amount: { low: 300, high: 360 },
      centre: "Auckland",
      caveat: "Unreviewed row.",
    },
  ],
  band: { unit: "m", low: 580, high: 700, centre: "Auckland", basis: "One verified row." },
  not_established: [],
  qv_queries_tried: ["channel drain"],
};

const ROLE_ANSWERS = { planner: PLAN, researcher: RESEARCH, verifier: CHECKS, synthesiser: BAND };

/** A runner that answers whichever role it was called as, and records the call. */
function roleRunner({ calls = [], failRole = null, answers = ROLE_ANSWERS } = {}) {
  return async (command, args, options) => {
    const systemPrompt = args[args.indexOf("--append-system-prompt") + 1];
    const role = RESEARCH_ROLE_NAMES.find((name) => systemPrompt.includes(name.toUpperCase()));
    calls.push({ command, args, options, role, objective: args[1] });
    if (role === failRole) return { code: 1, signal: null, stdout: "", stderr: "" };
    const lines = [
      { type: "system", subtype: "init", session_id: `s-${role}`, model: DEFAULT_CLAUDE_CLI_MODEL },
      { type: "assistant", message: { content: [{ type: "text", text: fence(answers[role]) }] } },
      {
        type: "result",
        subtype: "success",
        is_error: false,
        num_turns: 3,
        total_cost_usd: 1.1,
        usage: { input_tokens: 10, output_tokens: 20 },
        modelUsage: { [DEFAULT_CLAUDE_CLI_MODEL]: { inputTokens: 10, outputTokens: 20, costUSD: 1.1 } },
      },
    ];
    for (const line of lines) options.onStdoutLine?.(JSON.stringify(line));
    return { code: 0, signal: null, stdout: "", stderr: "" };
  };
}

const AUTHORISED = async () => ({
  binary: "/usr/local/bin/claude",
  probe: { loggedIn: true, authMethod: "claude.ai" },
});

async function withRuntime(body, overrides = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "research-claude-cli-roles-test-"));
  const runtime = new ClaudeCliRolesResearchRuntime({
    env: {
      PATH: process.env.PATH,
      HOME: directory,
      RESEARCH_QV_SOURCE: "local",
      RESEARCH_QV_INDEX: path.join(directory, "capture.jsonl"),
    },
    transcriptDirectory: path.join(directory, "transcripts"),
    assertAuth: AUTHORISED,
    ...overrides,
  });
  try {
    return await body({ runtime, directory });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function request(id) {
  return {
    id,
    objective: "SCENARIO\nid: channel-drain-installation-pinned\nPrice the pinned channel drain scope.",
    profile: "standard",
    context: [],
    budget: {
      maxRuntimeMs: 60_000,
      maxResearchers: 4,
      maxModelCalls: 100,
      maxToolCalls: 100,
      maxSearchCalls: 40,
      maxDepth: 1,
      maxConcurrentResearchers: 1,
    },
  };
}

async function drain(runtime, runId) {
  const events = [];
  for await (const event of runtime.events(runId)) events.push(event);
  return events;
}

test("the roles runtime satisfies the same neutral contract as the single agent", () => {
  assertResearchRuntime(new ClaudeCliRolesResearchRuntime());
  assert.equal(new ClaudeCliRolesResearchRuntime().id, CLAUDE_CLI_ROLES_RUNTIME_ID);
  assert.deepEqual(RESEARCH_ROLE_NAMES, ["planner", "researcher", "verifier", "synthesiser"]);
});

test("the four roles run in order, and our code is the sequence", async () => {
  const calls = [];
  await withRuntime(
    async ({ runtime }) => {
      await runtime.start(request("RSCH-ROLES-ORDER"));
      const events = await drain(runtime, "RSCH-ROLES-ORDER");
      assert.deepEqual(
        calls.map((call) => call.role),
        ["planner", "researcher", "verifier", "synthesiser"],
      );
      // The verifier is guaranteed to run because this loop runs it, not because a model chose
      // to. That is the whole reason for four calls rather than `--agents`.
      assert.deepEqual(
        events.filter((event) => event.type === "phase.started").map((event) => event.data.role),
        ["planner", "researcher", "verifier", "synthesiser"],
      );
      assert.equal((await runtime.status("RSCH-ROLES-ORDER")).status, "completed");
    },
    { run: roleRunner({ calls }) },
  );
});

test("each role is handed the previous role's output", async () => {
  const calls = [];
  await withRuntime(
    async ({ runtime }) => {
      await runtime.start(request("RSCH-ROLES-FEED"));
      await drain(runtime, "RSCH-ROLES-FEED");
      const byRole = Object.fromEntries(calls.map((call) => [call.role, call.objective]));
      assert.ok(byRole.planner.includes("channel-drain-installation-pinned"));
      assert.ok(byRole.researcher.includes("PLAN FROM THE PLANNER"));
      assert.ok(byRole.researcher.includes("corpus_queries"));
      assert.ok(byRole.verifier.includes("COMPONENTS FROM THE RESEARCHER"));
      assert.ok(byRole.verifier.includes("abc:t1:r4"));
      assert.ok(byRole.synthesiser.includes("VERIFIER CHECKS"));
      assert.ok(byRole.synthesiser.includes("rejected"));
      // The pinned scope reaches every role. A role that only saw the previous output would
      // start substituting its own parameters, which is what pinning exists to prevent.
      for (const objective of Object.values(byRole)) assert.ok(objective.includes("SCENARIO"));
    },
    { run: roleRunner({ calls }) },
  );
});

test("the synthesiser has no tools, so no unchecked evidence can enter at the last step", async () => {
  const calls = [];
  await withRuntime(
    async ({ runtime }) => {
      await runtime.start(request("RSCH-ROLES-TOOLS"));
      await drain(runtime, "RSCH-ROLES-TOOLS");
      const toolsFor = (role) =>
        calls.find((call) => call.role === role).args[calls[0].args.indexOf("--allowed-tools") + 1];
      assert.equal(toolsFor("synthesiser"), "");
      assert.equal(
        toolsFor("planner").includes("WebSearch"),
        false,
        "the planner surveys, it does not price",
      );
      assert.ok(toolsFor("researcher").includes("WebSearch"));
      assert.ok(toolsFor("verifier").includes("mcp__qv__get_qv_table"));
    },
    { run: roleRunner({ calls }) },
  );
});

test("a failed role stops the sequence instead of letting the band be written anyway", async () => {
  const calls = [];
  await withRuntime(
    async ({ runtime }) => {
      await runtime.start(request("RSCH-ROLES-FAIL"));
      await drain(runtime, "RSCH-ROLES-FAIL");
      // The synthesiser never runs. Continuing past a failed verifier would produce a band from
      // evidence nobody checked, and that band would score as a success.
      assert.deepEqual(
        calls.map((call) => call.role),
        ["planner", "researcher", "verifier"],
      );
      const status = await runtime.status("RSCH-ROLES-FAIL");
      assert.equal(status.status, "failed");
      assert.equal(status.error.role, "verifier");
      assert.equal(runtime.costBand("RSCH-ROLES-FAIL"), null);
      assert.deepEqual((await runtime.result("RSCH-ROLES-FAIL")).findings, []);
    },
    { run: roleRunner({ calls, failRole: "verifier" }) },
  );
});

test("the final answer is the same schema the single agent produces, so both are scored alike", async () => {
  await withRuntime(
    async ({ runtime }) => {
      await runtime.start(request("RSCH-ROLES-SCHEMA"));
      await drain(runtime, "RSCH-ROLES-SCHEMA");
      const band = runtime.costBand("RSCH-ROLES-SCHEMA");
      assert.deepEqual(band.band, {
        unit: "m",
        low: 580,
        high: 700,
        centre: "Auckland",
        basis: "One verified row.",
      });
      const result = await runtime.result("RSCH-ROLES-SCHEMA");
      assert.equal(result.findings.length, 2);
      assert.equal(result.findings.at(-1).producedBy, "synthesiser");
      // One transcript per role, all retained.
      assert.deepEqual(
        result.artifacts.map((artifact) => artifact.id),
        [
          "cli-transcript-planner",
          "cli-transcript-researcher",
          "cli-transcript-verifier",
          "cli-transcript-synthesiser",
        ],
      );
      const planner = await readFile(result.artifacts[0].contentRef, "utf8");
      assert.match(planner, /corpus_queries/);
    },
    { run: roleRunner() },
  );
});

test("spend is the sum of the four calls, not the last one", async () => {
  await withRuntime(
    async ({ runtime }) => {
      await runtime.start(request("RSCH-ROLES-USAGE"));
      await drain(runtime, "RSCH-ROLES-USAGE");
      const { usage } = await runtime.status("RSCH-ROLES-USAGE");
      assert.equal(usage.estimatedCostUsd, 4.4);
      assert.equal(usage.modelCalls, 12);
      assert.equal(usage.byModel[DEFAULT_CLAUDE_CLI_MODEL].outputTokens, 80);
      assert.equal(usage.partial, false);
    },
    { run: roleRunner() },
  );
});

test("a role run holds one concurrency slot for its whole sequence, not one per call", async () => {
  let active = 0;
  let peak = 0;
  const calls = [];
  const inner = roleRunner({ calls });
  const gated = async (command, args, options) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    const outcome = await inner(command, args, options);
    active -= 1;
    return outcome;
  };
  await withRuntime(
    async ({ runtime }) => {
      const ids = Array.from({ length: 6 }, (_unused, index) => `RSCH-ROLES-CAP-${index}`);
      await Promise.all(ids.map((id) => runtime.start(request(id))));
      await Promise.all(ids.map((id) => drain(runtime, id)));
      // Three concurrent role runs must not mean twelve children in flight.
      assert.ok(peak <= 3, `peak concurrency was ${peak}`);
    },
    { run: gated, maxConcurrentRuns: 3 },
  );
});

// --- what the verifier actually did ------------------------------------------------------------

test("the verifier's effect is read off the outputs, never judged by a model", () => {
  const effect = verifierEffect({
    researcherText: fence(RESEARCH),
    verifierText: fence(CHECKS),
    costBand: { components: [{ role: "Channel and grate" }] },
  });
  assert.deepEqual(effect.checks, { supported: 1, weakened: 0, rejected: 1 });
  assert.equal(effect.challenged, 1);
  assert.equal(effect.researcherComponents, 2);
  assert.equal(effect.finalComponents, 1);
  assert.equal(effect.netComponentsRemoved, 1);
  assert.equal(effect.missingByName, 1);

  // A verifier that waved everything through changed nothing, and the count says so rather
  // than crediting the run for having had a verifier at all.
  const waved = verifierEffect({
    researcherText: fence(RESEARCH),
    verifierText: fence({ checks: RESEARCH.components.map((c) => ({ role: c.role, status: "supported" })) }),
    costBand: { components: RESEARCH.components },
  });
  assert.equal(waved.challenged, 0);
  assert.equal(waved.netComponentsRemoved, 0);

  // The synthesiser rewords role labels. A component that survived under a new name is a
  // relabelling, not a removal, and only the name-set difference sees it that way — which is
  // why the decision rule uses the rename-immune count. The first live run showed exactly
  // this: 8 researcher components, 8 final components, 3 "missing by name".
  const relabelled = verifierEffect({
    researcherText: fence(RESEARCH),
    verifierText: fence(CHECKS),
    costBand: {
      components: [{ role: "Channel and grate (proprietary)" }, { role: "Traffic control" }],
    },
  });
  assert.equal(relabelled.missingByName, 2);
  assert.equal(relabelled.netComponentsRemoved, 0);
});

test("the tie goes to one agent, and a coverage regression is not redeemable", () => {
  const verifier = {
    challenged: 9,
    netComponentsRemoved: 4,
    missingByName: 7,
    runs: 90,
    runsWithNoChallenge: 40,
  };
  const FULL = { scenariosRun: 30, requiredScenarios: 30 };
  const onePhase = (withBand, agreed, usd) => ({
    counts: { withBand, agreed },
    planUsdPerScenario: usd,
  });

  // Fewer bands: lost, whatever else improved.
  assert.equal(
    comparePhases({ phase1: onePhase(28, 18, 4.97), phase2: onePhase(26, 22, 3.0), verifier, ...FULL })
      .winner,
    "one agent",
  );
  // Same numbers, cheaper, verifier busy: still a tie on the things that matter.
  assert.equal(
    comparePhases({
      phase1: onePhase(28, 18, 4.97),
      phase2: onePhase(28, 18, 3.0),
      verifier: {
        challenged: 0,
        netComponentsRemoved: 0,
        missingByName: 0,
        runs: 90,
        runsWithNoChallenge: 90,
      },
      ...FULL,
    }).winner,
    "one agent",
  );
  // A clear margin on agreement: four roles win.
  assert.equal(
    comparePhases({ phase1: onePhase(28, 18, 4.97), phase2: onePhase(28, 21, 9.0), verifier, ...FULL })
      .winner,
    "four roles",
  );
  // The verifier removed things and nothing got worse: four roles win on the narrow ground.
  assert.equal(
    comparePhases({ phase1: onePhase(28, 18, 4.97), phase2: onePhase(28, 19, 9.0), verifier, ...FULL })
      .winner,
    "four roles",
  );
  // No phase 1 report means no verdict is invented.
  assert.equal(comparePhases({ phase1: null, phase2: onePhase(28, 18, 4.97), verifier }), null);

  // Nor does a smoke run get one. One scenario either way is inside the run-to-run variation
  // these are made of, so a partial run reports the numbers and names no winner.
  const partial = comparePhases({
    phase1: onePhase(1, 1, 4.0),
    phase2: onePhase(1, 1, 10.88),
    verifier,
    scenariosRun: 1,
    requiredScenarios: 30,
  });
  assert.equal(partial.applicable, false);
  assert.equal(partial.winner, null);
  assert.match(partial.reason, /all 30 pinned scopes/);
});

test("the sequence is fixed, because a reorderable verifier would be decoration", () => {
  assert.ok(Object.isFrozen(RESEARCH_ROLE_SEQUENCE));
  assert.equal(RESEARCH_ROLE_SEQUENCE.at(-1).role, "synthesiser");
  assert.deepEqual(RESEARCH_ROLE_SEQUENCE.at(-1).allowedTools, []);
});
