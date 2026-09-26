// The research engine every runtime shares, offline: reading the answer back, the three-run
// agreement, and the run lifecycle in `server/research/engine/hosted-runtime.mjs`.
//
// The lifecycle used to be tested through the Claude CLI runtime with a replayed stream. That
// runtime is retired; the API loop is the only one left, so the lifecycle is driven through it
// with a scripted model (`research-hosted-support.mjs`). Only what `research-api-loop.test.mjs`
// does not already cover is here: the loop's own request shape, prompt and retries live there.
//
// The agreement maths is checked against the 90 recorded runs themselves, which is the
// strongest offline check available: if `agreement.mjs` reproduces 28 bands and 18 tight
// agreements from `17a-top30-results.json`, then a live eval that misses those numbers is
// telling us about the runs, not about the arithmetic.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  loadPinnedScopes,
  loadRecordedBaseline,
  recordedKeyForScope,
} from "../scripts/research-eval/scopes.mjs";
import {
  API_LOOP_EMPTY_OUTPUT_ERROR_CODE,
  API_LOOP_PLAN_LIMIT_ERROR_CODE,
} from "@eversor/research-engine/api-loop/chat-loop.mjs";
import {
  API_LOOP_RESEARCH_RUNTIME_ID,
  ApiLoopResearchRuntime,
  DEFAULT_API_LOOP_MODEL,
} from "@eversor/research-engine/api-loop/runtime.mjs";
import {
  agreementCounts,
  agreementForRuns,
  TIGHT_HIGH_RATIO,
  TIGHT_LOW_RATIO,
} from "@eversor/research-engine/engine/agreement.mjs";
import { parseFinalJsonFence } from "@eversor/research-engine/engine/final-answer.mjs";
import { PROVIDER_UNAVAILABLE_CODE } from "@eversor/research-engine/engine/host-tools/tool-errors.mjs";
import {
  findingsFromCostBand,
  parseCostBand,
  resolveCorpusIndexPath,
} from "@eversor/research-engine/engine/qv-recipe.mjs";
import { ResearchProviderError } from "@eversor/research-engine/research-provider-errors.mjs";
import {
  drain,
  fenced,
  KEY,
  NO_SEARCH,
  PAGE_URL,
  ROW_ID,
  reply,
  runRequest,
  runtimeEnv,
  toolCall,
  toolsThenAnswer,
  withApiLoopRuntime,
  withPlanCheck,
} from "./research-hosted-support.mjs";

/** What the recorded 30-scope, 90-run baseline produced; the agreement maths must reproduce it. */
const RECORDED_BASELINE = Object.freeze({
  scenarios: 30,
  withBand: 28,
  agreed: 18,
  noBandExpected: ["network-supply-connection-hv-metering", "switchboard-fault-rating-protection"],
});

const COST_BAND_ANSWER = {
  id: "channel-drain-installation-pinned",
  resolved_from: "qv",
  confidence: "medium",
  components: [
    {
      role: "Proprietary channel and grate",
      basis: "qv",
      row_id: ROW_ID,
      source: null,
      unit: "m",
      amount: { low: 300, high: 360 },
      centre: "Auckland",
      caveat: "Row is unreviewed.",
    },
    {
      role: "Stormwater connection",
      basis: "web",
      row_id: null,
      source: "https://supplier.example.test/connection",
      unit: "m",
      amount: { low: 280, high: 340 },
      centre: "Auckland",
      caveat: null,
    },
  ],
  band: { unit: "m", low: 580, high: 700, centre: "Auckland", basis: "QV rows plus one vendor page." },
  not_established: ["Traffic management is not priced."],
  qv_queries_tried: ["channel drain", "trench drain grate"],
};

// --- reading the answer -----------------------------------------------------------------------

test("the last valid json fence wins, so a quoted schema is not read as an answer", () => {
  const text =
    'Schema:\n```json\n{"band": null}\n```\nAnswer:\n```json\n{"band": {"low": 1, "high": 2}}\n```';
  assert.deepEqual(parseFinalJsonFence(text), { band: { low: 1, high: 2 } });
  // A truncated final fence must not hide a complete earlier one.
  assert.deepEqual(parseFinalJsonFence('```json\n{"a":1}\n```\n```json\n{"b":\n```'), { a: 1 });
  assert.equal(parseFinalJsonFence("no fence here"), null);
});

test("a band needs both ends, and no band is an ordinary outcome", () => {
  const halfOpen = parseCostBand(fenced({ ...COST_BAND_ANSWER, band: { unit: "m", low: 580, high: null } }));
  assert.equal(halfOpen.band, null);
  const none = parseCostBand(
    fenced({
      resolved_from: "not_established",
      band: { low: null, high: null },
      not_established: ["No published rate."],
    }),
  );
  assert.equal(none.band, null);
  assert.deepEqual(none.notEstablished, ["No published rate."]);
  assert.equal(parseCostBand("the model never produced a fence"), null);
});

test("findings carry their evidence and say plainly that nobody has reviewed them", () => {
  const findings = findingsFromCostBand(parseCostBand(fenced(COST_BAND_ANSWER)), { runId: "RSCH-1" });
  assert.equal(findings.length, 3);
  assert.equal(findings[0].evidence[0].sourceId, ROW_ID);
  // A licensed QV row is never classed as a public web citation.
  assert.equal(findings[0].evidence[0].sourceType, "internal_record");
  assert.equal(findings[0].evidence[0].quoteVerified, false);
  assert.equal(findings[1].evidence[0].url, "https://supplier.example.test/connection");
  assert.equal(findings.at(-1).producedBy, "synthesiser");
  assert.match(findings.at(-1).claim, /580–700 per m/);
  for (const finding of findings) {
    assert.equal(finding.verification.status, "unverified");
    assert.match(finding.verification.notes, /no quantity surveyor has checked this/);
  }
});

// --- agreement --------------------------------------------------------------------------------

test("agreement is the recorded arithmetic, at the recorded thresholds", () => {
  const tight = agreementForRuns([
    { run: "r1", band: { low: 100, high: 200, unit: "m", centre: "Auckland" } },
    { run: "r2", band: { low: 110, high: 230, unit: "m" } },
    { run: "r3", band: { low: 120, high: 260, unit: "m" } },
  ]);
  assert.equal(tight.status, "agreed");
  assert.equal(tight.agreement.lowRatio, 1.2);
  assert.equal(tight.agreement.highRatio, 1.3);
  // Consensus is the median of the lows and of the highs taken independently, which can name a
  // pair no single run proposed. That is `18f-build-review.py`'s behaviour and is correct for a
  // band: the two ends are separate estimates, not a unit.
  assert.deepEqual(tight.consensus, { low: 110, high: 230 });
  assert.deepEqual(tight.range, { min: 100, max: 260 });

  const loose = agreementForRuns([
    { run: "r1", band: { low: 100, high: 200 } },
    { run: "r2", band: { low: 100 * TIGHT_LOW_RATIO + 1, high: 200 } },
  ]);
  assert.equal(loose.status, "disputed");

  // A run with no band is counted in the total and excluded from the ratios: "two of three
  // found a band and they agree" is not "three runs agree".
  const partial = agreementForRuns([
    { run: "r1", band: { low: 100, high: 200 } },
    { run: "r2", band: null },
    { run: "r3", band: { low: 105, high: 210 } },
  ]);
  assert.equal(partial.status, "agreed");
  assert.deepEqual(partial.agreement.runsWithBand, 2);
  assert.deepEqual(partial.agreement.runsTotal, 3);

  assert.equal(agreementForRuns([{ run: "r1", band: null }]).status, "not_established");
  assert.ok(TIGHT_HIGH_RATIO > TIGHT_LOW_RATIO);
});

test("the agreement maths reproduces the 90 recorded runs exactly", async () => {
  const baseline = await loadRecordedBaseline();
  const records = [...baseline.entries()].map(([scenario, runs]) => ({
    scenario,
    ...agreementForRuns(runs),
  }));
  // The numbers any engine is compared against: 28 of 30 with a band, 18 of those tight.
  assert.deepEqual(agreementCounts(records), {
    scenarios: RECORDED_BASELINE.scenarios,
    agreed: RECORDED_BASELINE.agreed,
    disputed: 10,
    notEstablished: 2,
    // The recorded rows carry no run status, so none of them can be mistaken for a crash.
    incomplete: 0,
    withBand: RECORDED_BASELINE.withBand,
  });
  assert.deepEqual(
    records
      .filter((record) => record.status === "not_established")
      .map((record) => record.scenario)
      .sort(),
    [...RECORDED_BASELINE.noBandExpected].sort(),
  );
});

test("all thirty pinned scopes load and map onto a recorded baseline row", async () => {
  const scopes = await loadPinnedScopes();
  const baseline = await loadRecordedBaseline();
  assert.equal(scopes.length, RECORDED_BASELINE.scenarios);
  for (const scope of scopes) {
    assert.ok(baseline.has(scope.recordedKey), `${scope.id} has no recorded row (${scope.recordedKey})`);
    assert.match(scope.objective, /SCENARIO/);
  }
  // The baseline's keys are the filenames with the first `p-` removed — a quirk of the shell
  // loop that produced the 90 runs, reproduced rather than renamed.
  assert.equal(recordedKeyForScope("acp-facade-cladding-install"), "acfacade-cladding-install");
  assert.equal(recordedKeyForScope("p-cable"), "cable");
});

// The first live 30-scope exit test hit a plan's five-hour limit at scenario 26 and scored the
// dead scenarios as `not_established`. This is that failure, written down.
test("a scenario whose runs failed is incomplete, never a scenario that found nothing", () => {
  const code = API_LOOP_PLAN_LIMIT_ERROR_CODE;
  const crashed = agreementForRuns([
    { run: "r1", status: "failed", band: null, error: { code } },
    { run: "r2", status: "failed", band: null, error: { code } },
    { run: "r3", status: "failed", band: null, error: { code } },
  ]);
  assert.equal(crashed.status, "incomplete");
  assert.equal(crashed.failedRuns.length, 3);
  assert.equal(crashed.failedRuns[0].errorCode, code);

  // The opposite claim, and it must stay reachable: three runs completed and none of them could
  // defend a band. That is a finding about the scope.
  const researched = agreementForRuns([
    { run: "r1", status: "completed", band: null },
    { run: "r2", status: "completed", band: null },
    { run: "r3", status: "completed", band: null },
  ]);
  assert.equal(researched.status, "not_established");

  // One dead run poisons the scenario even when the other two banded: three-run agreement over
  // two runs is a different measurement.
  const partial = agreementForRuns([
    { run: "r1", status: "completed", band: { low: 100, high: 200 } },
    { run: "r2", status: "completed", band: { low: 105, high: 210 } },
    { run: "r3", status: "failed", band: null, error: { code: "api_loop_failed" } },
  ]);
  assert.equal(partial.status, "incomplete");

  // An incomplete scenario is not counted as having produced a band.
  assert.deepEqual(agreementCounts([crashed, researched, partial]), {
    scenarios: 3,
    agreed: 0,
    disputed: 0,
    notEstablished: 1,
    incomplete: 2,
    withBand: 0,
  });
});

// --- where QV comes from ------------------------------------------------------------------------

test("a run with no configured corpus fails rather than searching nothing", async () => {
  assert.throws(() => resolveCorpusIndexPath({}, null), /RESEARCH_QV_INDEX/);
  const runtime = new ApiLoopResearchRuntime({
    env: { OPENCODE_API_KEY: KEY, RESEARCH_QV_SOURCE: "local" },
    webToolsOptions: { searchProvider: NO_SEARCH },
  });
  await assert.rejects(runtime.start(runRequest("RSCH-NO-CORPUS")), /RESEARCH_QV_INDEX/);
});

test("PlanCheck's library is the default, and without a way to get a token the run says so", async () => {
  const runtime = new ApiLoopResearchRuntime({
    env: { OPENCODE_API_KEY: KEY },
    webToolsOptions: { searchProvider: NO_SEARCH },
  });
  await assert.rejects(runtime.start(runRequest("RSCH-NO-TOKEN")), /RESEARCH_PLANCHECK_TOKEN_COMMAND/);
});

// --- the run lifecycle ------------------------------------------------------------------------

test("a successful run completes with findings, usage and a transcript artifact", async () => {
  const step = toolsThenAnswer([toolCall("c1", "search_qv", { query: "channel drain" })], COST_BAND_ANSWER);
  await withApiLoopRuntime(
    async ({ runtime }) => {
      const handle = await runtime.start(runRequest("RSCH-OK"));
      assert.deepEqual(handle.model, {
        provider: API_LOOP_RESEARCH_RUNTIME_ID,
        model: DEFAULT_API_LOOP_MODEL,
        live: true,
      });
      // Fetching goes through the host or not at all: its tools are offered under their host
      // names, and there is no other fetch.
      const offered = handle.runtimeMetadata.allowedTools.split(",");
      assert.ok(offered.includes("mcp__research__fetch_source"));
      assert.equal(offered.includes("WebFetch"), false);

      const events = await drain(runtime, "RSCH-OK");
      assert.equal(events[0].type, "run.started");
      assert.equal(events.at(-1).type, "run.completed");
      assert.deepEqual(
        events.map((event) => event.ordinal),
        events.map((_event, index) => index + 1),
      );
      // The cited QV row is retained so its citation can be verified like a fetched page.
      assert.ok(
        events.some((event) => event.type === "source.retrieved" && event.data.source.id === `qv:${ROW_ID}`),
      );

      const status = await runtime.status("RSCH-OK");
      assert.equal(status.status, "completed", JSON.stringify(status.error));
      assert.equal(status.usage.partial, false);
      assert.equal(status.usage.modelCalls, 2);
      assert.equal(status.budgetState.toolCallsUsed, 1);
      assert.equal(status.budgetState.searchCallsUsed, 0);

      const result = await runtime.result("RSCH-OK");
      assert.equal(result.findings.length, 3);
      assert.deepEqual(result.unresolvedQuestions, ["Traffic management is not priced."]);
      const transcript = result.artifacts.find((artifact) => artifact.kind === "api-loop-transcript");
      assert.ok(transcript, "the raw exchange is retained");
      const retained = (await readFile(transcript.contentRef, "utf8")).trim().split("\n");
      assert.deepEqual(
        retained.map((line) => JSON.parse(line).type),
        ["response", "tool_result", "response"],
      );
      assert.equal(runtime.costBand("RSCH-OK").band.low, 580);
    },
    { step },
  );
});

test("a model that finishes without an answer is a retryable empty output, not a bad scope", async () => {
  await withApiLoopRuntime(
    async ({ runtime }) => {
      await runtime.start(runRequest("RSCH-EMPTY"));
      await drain(runtime, "RSCH-EMPTY");
      const status = await runtime.status("RSCH-EMPTY");
      assert.equal(status.status, "failed");
      assert.equal(status.error.code, API_LOOP_EMPTY_OUTPUT_ERROR_CODE);
      assert.equal(status.error.retryable, true);
    },
    { step: () => reply({ content: "" }) },
  );
});

test("a provider that refuses the call fails the run, and the band is not invented", async () => {
  await withApiLoopRuntime(
    async ({ runtime }) => {
      await runtime.start(runRequest("RSCH-REFUSED"));
      await drain(runtime, "RSCH-REFUSED");
      const status = await runtime.status("RSCH-REFUSED");
      assert.equal(status.status, "failed");
      assert.equal(status.error.code, "api_loop_reported_error");
      assert.match(status.error.message, /refused the key \(HTTP 401\)/);
      assert.equal(runtime.costBand("RSCH-REFUSED"), null);
    },
    { step: () => ({ status: 401, body: '{"error":"bad key"}' }) },
  );
});

test("runs are capped, and the ones over the cap wait queued rather than all starting at once", async () => {
  let active = 0;
  let peak = 0;
  const step = async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active -= 1;
    return reply({ content: fenced(COST_BAND_ANSWER) });
  };
  await withApiLoopRuntime(
    async ({ runtime }) => {
      const ids = Array.from({ length: 6 }, (_unused, index) => `RSCH-CAP-${index}`);
      const handles = await Promise.all(ids.map((id) => runtime.start(runRequest(id))));
      assert.ok(handles.every((handle) => handle.status === "queued"));
      await Promise.all(ids.map((id) => drain(runtime, id)));
      assert.ok(peak <= 2, `peak concurrency was ${peak}`);
      for (const id of ids) assert.equal((await runtime.status(id)).status, "completed");
    },
    { step, maxConcurrentRuns: 2 },
  );
});

test("a queued run can be cancelled before its model is ever called", async () => {
  const step = async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
    return reply({ content: fenced(COST_BAND_ANSWER) });
  };
  await withApiLoopRuntime(
    async ({ runtime, model }) => {
      await runtime.start(runRequest("RSCH-RUNNING"));
      await runtime.start(runRequest("RSCH-QUEUED"));
      await runtime.cancel("RSCH-QUEUED");
      const events = await drain(runtime, "RSCH-QUEUED");
      assert.deepEqual(
        events.map((event) => event.type),
        ["run.cancelled"],
      );
      assert.equal((await runtime.status("RSCH-QUEUED")).status, "cancelled");
      await drain(runtime, "RSCH-RUNNING");
      assert.equal((await runtime.status("RSCH-RUNNING")).status, "completed");
      // Only the running one reached the model.
      assert.equal(model.sessions(), 1);
    },
    { step, maxConcurrentRuns: 1 },
  );
});

test("a paid capture provider's outage fails the run as unassessed, not as bad research", async () => {
  await withApiLoopRuntime(
    async ({ runtime }) => {
      await runtime.start(runRequest("RSCH-OUTAGE"));
      await drain(runtime, "RSCH-OUTAGE");
      const status = await runtime.status("RSCH-OUTAGE");
      assert.equal(status.status, "failed");
      assert.equal(status.error.code, PROVIDER_UNAVAILABLE_CODE);
    },
    {
      step: toolsThenAnswer([toolCall("c1", "fetch_source", { url: PAGE_URL })], COST_BAND_ANSWER),
      captureProvider: {
        async capture() {
          throw new ResearchProviderError({
            provider: "firecrawl",
            operation: "capture",
            category: "rate_limit",
            message: "Firecrawl is throttling.",
          });
        },
      },
    },
  );
});

test("crossing the model-call ceiling stops the run and says which ceiling", async () => {
  let calls = 0;
  const step = () => {
    calls += 1;
    return reply({
      content: "Still checking.",
      tool_calls: [toolCall(`c${calls}`, "search_qv", { query: `q${calls}` })],
    });
  };
  await withApiLoopRuntime(
    async ({ runtime }) => {
      await runtime.start(runRequest("RSCH-TURNS", { maxModelCalls: 2 }));
      await drain(runtime, "RSCH-TURNS");
      const status = await runtime.status("RSCH-TURNS");
      assert.equal(status.status, "failed");
      assert.equal(status.error.code, "research_ceiling_exceeded");
      assert.equal(status.budgetState.ceilingHit, "maxModelCalls");
      assert.equal((await runtime.result("RSCH-TURNS")).truncatedBy, "maxModelCalls");
      assert.equal(calls, 2);
    },
    { step },
  );
});

test("a credential that reaches the transcript is redacted, and reported only by name", async () => {
  const step = (index) =>
    index === 0
      ? reply({
          content: `Using key ${KEY} for this.`,
          tool_calls: [toolCall("c1", "search_qv", { query: "channel drain" })],
        })
      : reply({ content: fenced(COST_BAND_ANSWER) });
  await withApiLoopRuntime(
    async ({ runtime }) => {
      await runtime.start(runRequest("RSCH-SECRET"));
      const events = await drain(runtime, "RSCH-SECRET");
      const redaction = events.find((event) => event.data?.redacted);
      assert.deepEqual(redaction.data.redacted, [{ label: "OPENCODE_API_KEY", occurrences: 1 }]);
      assert.equal(JSON.stringify(redaction).includes(KEY), false);
      const { artifacts } = await runtime.result("RSCH-SECRET");
      const transcript = await readFile(artifacts[0].contentRef, "utf8");
      assert.equal(transcript.includes(KEY), false);
      assert.match(transcript, /\[redacted:OPENCODE_API_KEY\]/);
    },
    { step },
  );
});

test("a run that names this runtime in its policy uses that model; one naming another does not", async () => {
  await withPlanCheck(async (planCheck) => {
    const runtime = new ApiLoopResearchRuntime({
      env: runtimeEnv(planCheck, { BASETEN_API_KEY: "sk-test-baseten-0123456789" }),
      fetchImpl: async () => Response.json(reply({ content: fenced(COST_BAND_ANSWER) })),
      webToolsOptions: { searchProvider: NO_SEARCH },
    });
    const model = "baseten/deepseek-ai/DeepSeek-V4.1-Flash";
    const named = await runtime.start({
      ...runRequest("RSCH-POLICY"),
      researchPolicy: { runtime: API_LOOP_RESEARCH_RUNTIME_ID, model },
    });
    assert.equal(named.model.model, model);
    const other = await runtime.start({
      ...runRequest("RSCH-OTHER"),
      researchPolicy: { runtime: "some-other-engine", model: "elsewhere/model" },
    });
    assert.equal(other.model.model, DEFAULT_API_LOOP_MODEL);
    await drain(runtime, "RSCH-POLICY");
    await drain(runtime, "RSCH-OTHER");
  });
});
