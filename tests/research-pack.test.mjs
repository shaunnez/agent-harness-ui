// The `pack` runtime (`28-SCOPE-PACK-EVAL-PLAN.md` §2): Luna retrieves, the host checks the pack,
// Opus reasons over only what checked out, with `request_evidence` capped at two, and usage is the
// sum of every stage. A stub process runner stands in for both CLIs; nothing here calls a model.

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { checkedPack, packText, parseEvidencePack } from "../server/research/pack/evidence-pack.mjs";
import { PACK_RESEARCH_RUNTIME_ID, PackResearchRuntime } from "../server/research/pack/runtime.mjs";
import { assertResearchRuntime } from "../server/research/research-runtime-registry.mjs";

const FOUND = `${"a".repeat(64)}:t1:r4`;
const MISSING = `${"b".repeat(64)}:t2:r1`;
const CAPTURE_ROW = {
  id: FOUND,
  description: "Proprietary channel and grate, 150mm",
  headings: [{ text: "Drainage" }, { text: "Channel drains" }],
  unit_normalised: "m",
  regional_values: { Auckland: { scalar: "330.00" } },
};

const PACK = {
  items: [
    {
      role: "Channel and grate",
      basis: "qv",
      row_id: FOUND,
      unit: "m",
      amount: { low: 330, high: 330 },
      centre: "Auckland",
      caveat: "150mm",
    },
    { role: "Invented row", basis: "qv", row_id: MISSING, unit: "m", amount: { low: 10, high: 12 } },
    {
      role: "Unfetched vendor",
      basis: "web",
      source: "https://vendor.example.test/x",
      source_id: "src-none",
      excerpt: "$99 per m",
    },
  ],
  not_found: ["Traffic management: searched 'traffic management', 'TTM'"],
  qv_queries_tried: ["channel drain"],
};

const ANSWER = {
  id: "pack-test",
  resolved_from: "qv",
  confidence: "medium",
  components: [
    {
      role: "Channel and grate",
      basis: "qv",
      row_id: FOUND,
      unit: "m",
      amount: { low: 330, high: 330 },
      centre: "Auckland",
    },
    {
      role: "Sundries",
      basis: "allowance",
      row_id: null,
      unit: "m",
      amount: { low: 20, high: 40 },
      caveat: "fixings",
    },
  ],
  band: { unit: "m", low: 350, high: 370, centre: "Auckland", basis: "QV row plus a small allowance." },
  not_established: [],
  qv_queries_tried: ["channel drain"],
};

const fence = (value) => `\`\`\`json\n${JSON.stringify(value)}\n\`\`\``;

function codexLines(text) {
  return [
    { type: "item.completed", item: { type: "agent_message", text } },
    {
      type: "turn.completed",
      usage: { input_tokens: 40_000, cached_input_tokens: 20_000, output_tokens: 2_000 },
    },
  ];
}

function claudeLines(text) {
  return [
    { type: "system", subtype: "init", session_id: "s-1", model: "claude-opus-5-5", tools: [] },
    { type: "assistant", message: { content: [{ type: "text", text }] } },
    {
      type: "result",
      subtype: "success",
      is_error: false,
      num_turns: 3,
      total_cost_usd: 0.31,
      usage: { input_tokens: 9_000, output_tokens: 1_500, cache_read_input_tokens: 0 },
      modelUsage: { "claude-opus-5-5": { inputTokens: 9_000, outputTokens: 1_500, costUSD: 0.31 } },
    },
  ];
}

/** Ask the host for evidence over the run's own socket, as the relay would. */
function askHost(socketPath, requests) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    const replies = [];
    let buffered = "";
    socket.setEncoding("utf8");
    socket.on("error", reject);
    socket.on("connect", () => {
      for (const [index, input] of requests.entries())
        socket.write(`${JSON.stringify({ id: `q${index}`, tool: "request_evidence", input })}\n`);
    });
    socket.on("data", (chunk) => {
      buffered += chunk;
      let newline = buffered.indexOf("\n");
      while (newline !== -1) {
        replies.push(JSON.parse(buffered.slice(0, newline)));
        buffered = buffered.slice(newline + 1);
        newline = buffered.indexOf("\n");
      }
      if (replies.length === requests.length) {
        socket.end();
        resolve(replies.sort((a, b) => a.id.localeCompare(b.id)));
      }
    });
  });
}

/** Both CLIs, stubbed. `retrievals` are the texts each codex exec returns, in order. */
function stubCli({ retrievals, answer = fence(ANSWER), evidenceRequests = [] }) {
  const calls = [];
  let retrieval = 0;
  const run = async (command, args, options) => {
    const entry = { command, args, env: options.env, input: options.input };
    calls.push(entry);
    if (command === "/bin/codex") {
      for (const line of codexLines(retrievals[retrieval++] ?? ""))
        options.onStdoutLine?.(JSON.stringify(line));
      return { code: 0, signal: null, stdout: "", stderr: "" };
    }
    const config = JSON.parse(await readFile(args[args.indexOf("--mcp-config") + 1], "utf8"));
    entry.mcpConfig = config;
    if (evidenceRequests.length) {
      const [, socketPath] = config.mcpServers.research.args;
      entry.replies = await askHost(socketPath, evidenceRequests);
    }
    for (const line of claudeLines(answer)) options.onStdoutLine?.(JSON.stringify(line));
    return { code: 0, signal: null, stdout: "", stderr: "" };
  };
  return { run, calls };
}

async function withRuntime(stub, body) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "research-pack-test-"));
  await writeFile(path.join(directory, "capture.jsonl"), `${JSON.stringify(CAPTURE_ROW)}\n`);
  const runtime = new PackResearchRuntime({
    env: {
      PATH: process.env.PATH,
      HOME: directory,
      RESEARCH_QV_SOURCE: "local",
      RESEARCH_QV_INDEX: path.join(directory, "capture.jsonl"),
      OPENAI_API_KEY: "sk-never",
      ANTHROPIC_API_KEY: "never",
    },
    run: stub.run,
    transcriptDirectory: path.join(directory, "transcripts"),
    sourceSnapshotDirectory: path.join(directory, "sources"),
    assertAuth: async () => ({ binary: { codex: "/bin/codex", claude: "/bin/claude" } }),
  });
  try {
    return await body({ runtime, calls: stub.calls });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const request = (id) => ({
  id,
  objective: "Price the pinned channel drain scope.",
  profile: "standard",
  context: [],
  budget: {
    maxRuntimeMs: 60_000,
    maxModelCalls: 50,
    maxToolCalls: 50,
    maxSearchCalls: 20,
    maxResearchers: 1,
  },
});

async function settle(runtime, runId) {
  for await (const _event of runtime.events(runId));
  return runtime.status(runId);
}

test("the pack runtime satisfies the neutral ResearchRuntime shape", () => {
  assertResearchRuntime(new PackResearchRuntime());
  assert.equal(new PackResearchRuntime().id, PACK_RESEARCH_RUNTIME_ID);
});

test("only checked items reach the reasoning stage, and rejected ones are named", () => {
  const pack = parseEvidencePack(fence(PACK));
  const rows = new Map([
    [FOUND, { id: FOUND, text: "Drainage / Channel drains | 150mm | m | Auckland 330", priced: true }],
  ]);
  const checked = {
    components: [
      { check: "qv-found" },
      { check: "qv-missing", problems: ["Row not in capture."] },
      { check: "web-not-fetched", problems: [] },
    ],
  };
  const split = checkedPack(pack, checked, rows);
  assert.equal(split.kept.length, 1);
  assert.equal(split.rejected.length, 2);
  const text = packText(split);
  assert.match(text, /\[E1\] QV row_id a{64}:t1:r4 · for: Channel and grate/);
  assert.match(text, /host row: Drainage \/ Channel drains/);
  assert.match(text, /REJECTED by the host \(do not cite these\):\n- Invented row: Row not in capture\./);
  assert.match(text, /NOT FOUND by retrieval:\n- Traffic management/);
  assert.equal(parseEvidencePack("no fence here"), null);
});

test("Luna retrieves, the host checks, Opus prices from the pack with request_evidence capped at two", async () => {
  const more = {
    items: [
      { role: "Channel and grate", basis: "qv", row_id: FOUND, unit: "m", amount: { low: 330, high: 330 } },
    ],
    not_found: [],
  };
  const stub = stubCli({
    retrievals: [fence(PACK), fence(more), fence(more)],
    evidenceRequests: [
      { query: "traffic management per day", why: "main driver" },
      { query: "grate variants", why: "bracket the row" },
      { query: "one more", why: "over the cap" },
    ],
  });
  await withRuntime(stub, async ({ runtime, calls }) => {
    const handle = await runtime.start(request("pack-1"));
    assert.equal(handle.runtimeId, "pack");
    assert.equal(handle.runtimeMetadata.retrieveModel, "gpt-6-luna");
    const status = await settle(runtime, "pack-1");
    assert.equal(status.status, "completed", JSON.stringify(status.error));

    const codex = calls.filter((call) => call.command === "/bin/codex");
    const claude = calls.filter((call) => call.command === "/bin/claude");
    assert.equal(codex.length, 3, "one retrieval, then one per granted evidence request");
    assert.equal(claude.length, 1);
    assert.ok(codex[0].args.includes("gpt-6-luna"));
    assert.ok(codex.every((call) => call.env.OPENAI_API_KEY === undefined));
    assert.equal(claude[0].env.ANTHROPIC_API_KEY, undefined);

    // The reasoning stage sees one tool and no search: only the relay, listing request_evidence.
    const reason = claude[0];
    assert.equal(reason.args[reason.args.indexOf("--allowed-tools") + 1], "mcp__research__request_evidence");
    assert.deepEqual(Object.keys(reason.mcpConfig.mcpServers), ["research"]);
    assert.equal(reason.mcpConfig.mcpServers.research.args[2], "request_evidence");
    const prompt = reason.args[reason.args.indexOf("-p") + 1];
    assert.match(prompt, /^Price the pinned channel drain scope\.\n\nEVIDENCE PACK \(checked by the host\)/);
    assert.match(prompt, /\[E1\] QV row_id a{64}:t1:r4/);
    assert.doesNotMatch(prompt, /\[E\d\] QV row_id b{64}/, "a missing row is never presented as evidence");
    assert.match(prompt, /- Invented row:/);

    const [first, second, third] = reason.replies;
    assert.equal(first.ok, true);
    assert.match(first.result.evidence, /^MORE EVIDENCE \(checked by the host\)\n\[E2\]/);
    assert.match(second.result.evidence, /\[E3\]/);
    assert.match(third.result.refused, /limit of 2 evidence requests/);

    const outcome = runtime.outcome("pack-1");
    assert.deepEqual(outcome.costBand.band, ANSWER.band);
    assert.deepEqual(outcome.citations.checks, ["qv-found", "allowance"]);

    const usage = status.usage;
    assert.deepEqual(
      usage.byStage.map((part) => part.stage),
      ["retrieve", "retrieve", "retrieve", "reason"],
    );
    assert.ok(usage.byModel["gpt-6-luna"].estimatedCostUsd > 0);
    assert.equal(usage.byModel["claude-opus-5-5"].estimatedCostUsd, 0.31);
    const stageTotal = usage.byStage.reduce((sum, part) => sum + part.estimatedCostUsd, 0);
    assert.ok(Math.abs(usage.estimatedCostUsd - stageTotal) < 1e-6);
  });
});

test("a retrieval with no pack fails the run before Opus is called", async () => {
  const stub = stubCli({ retrievals: ["I looked but here is prose, not a pack."] });
  await withRuntime(stub, async ({ runtime, calls }) => {
    await runtime.start(request("pack-2"));
    const status = await settle(runtime, "pack-2");
    assert.equal(status.status, "failed");
    assert.equal(status.error.code, "pack_retrieval_empty");
    assert.match(status.error.message, /^Retrieval: /);
    assert.equal(calls.filter((call) => call.command === "/bin/claude").length, 0);
  });
});
