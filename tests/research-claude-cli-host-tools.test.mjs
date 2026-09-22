// The host-owned research tools and checked citations, carried over from the retired Deep
// Agents runtime into the `claude-cli` runtime.
//
// The CLI is replaced by an injected runner, as in `research-claude-cli.test.mjs`, but these
// tests go one step further: the runner spawns the real MCP relay the CLI would spawn, speaks
// MCP to it, and so reaches the real socket bridge and the real `ResearchWebTools` in this
// process. Only the model and the network are fake.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { REQUIRED_AUTH_METHOD } from "../server/research/claude-cli/auth.mjs";
import { openHostToolBridge } from "../server/research/claude-cli/host-tools/bridge.mjs";
import { allowedToolName, hostToolOf } from "../server/research/claude-cli/host-tools/definitions.mjs";
import {
  classifyToolError,
  PROVIDER_UNAVAILABLE_CODE,
  REPEATED_TOOL_ERROR_CODE,
  StrikeCounter,
} from "../server/research/claude-cli/host-tools/tool-errors.mjs";
import { QV_ALLOWED_TOOLS } from "../server/research/claude-cli/qv-recipe.mjs";
import { rowIdsIn } from "../server/research/claude-cli/qv-rows.mjs";
import { ClaudeCliResearchRuntime } from "../server/research/claude-cli/runtime.mjs";
import { redactSecretsInFile, scannedNeedles } from "../server/research/claude-cli/secret-scan.mjs";
import { extractPdfPages } from "../server/research/research-pdf-text.mjs";
import { ResearchProviderError } from "../server/research/research-provider-errors.mjs";
import { createResearchRuntimeRegistry } from "../server/research/research-runtime-registry.mjs";
import { ResearchService } from "../server/research/research-service.mjs";
import { ResearchStore } from "../server/research/research-store.mjs";
import { ResearchToolError, ResearchWebTools } from "../server/research/research-web-tools.mjs";
import { migrateSqliteSchema } from "../server/sqlite-storage.mjs";

const RELAY = path.resolve("server/research/claude-cli/host-tools/mcp-server.mjs");
const ROW_ID = `${"b".repeat(64)}:t2:r3`;
const PAGE_URL = "https://supplier.example.test/connection";
const PAGE_TEXT = "Standard stormwater connection: $310 per metre installed, excluding traffic management.";

const BUDGET = Object.freeze({
  maxRuntimeMs: 30_000,
  maxResearchers: 1,
  maxConcurrentResearchers: 1,
  maxDepth: 1,
  maxModelCalls: 20,
  maxToolCalls: 20,
  maxSearchCalls: 10,
});

const FIXTURE_WEB = Object.freeze({
  lookup: async () => [{ address: "93.184.216.34", family: 4 }],
  fetchImpl: async () =>
    new Response(`<html><head><title>Supplier rates</title></head><body><p>${PAGE_TEXT}</p></body></html>`, {
      headers: { "content-type": "text/html" },
    }),
});

// --- what a tool failure means -----------------------------------------------------------------

test("a budget or control failure ends the run and names its ceiling", () => {
  const ceiling = classifyToolError(
    new ResearchToolError("tool_call_ceiling_exceeded", "full", { ceiling: "maxToolCalls" }),
  );
  assert.deepEqual([ceiling.outcome, ceiling.ceiling], ["terminal", "maxToolCalls"]);
  assert.equal(classifyToolError(new ResearchToolError("deadline_exceeded", "late")).ceiling, "maxRuntimeMs");
  assert.equal(classifyToolError(new ResearchToolError("research_cancelled", "stop")).outcome, "terminal");
});

test("a paid provider's outage is unassessed, while one website timing out is feedback", () => {
  const outage = new ResearchToolError("rate_limit", "slow down");
  outage.provider = "firecrawl";
  outage.category = "rate_limit";
  assert.equal(classifyToolError(outage).outcome, "provider_unavailable");
  assert.equal(classifyToolError(outage).code, PROVIDER_UNAVAILABLE_CODE);

  // The Deep Agents worker ended the run here: `source_timeout` was not on its allowlist.
  const slowSite = new ResearchToolError("source_timeout", "timed out");
  slowSite.provider = "local";
  slowSite.category = "timeout";
  assert.equal(classifyToolError(slowSite).outcome, "recoverable");
});

test("the search ceiling is feedback, because the model can still finish from what it has", () => {
  const verdict = classifyToolError(
    new ResearchToolError("search_call_ceiling_exceeded", "no more", { ceiling: "maxSearchCalls" }),
  );
  assert.equal(verdict.outcome, "recoverable");
});

test("strikes count the same failing call, not every failure with the same code", () => {
  const strikes = new StrikeCounter(2);
  // Three different pages each returning 403 is the web, not a loop.
  for (const url of ["https://a.test", "https://b.test", "https://c.test"])
    assert.equal(strikes.record("fetch_source", { url }, "source_http_error").allowed, true);
  // The same call a third time is.
  const same = { url: "https://a.test" };
  assert.equal(strikes.record("fetch_source", same, "source_http_error").allowed, true);
  assert.equal(strikes.record("fetch_source", { ...same }, "source_http_error").allowed, false);
});

test("host tool names round-trip through the CLI's mcp__ prefix and nothing else matches", () => {
  assert.equal(hostToolOf(allowedToolName("fetch_source")), "fetch_source");
  assert.equal(hostToolOf("mcp__qv__search_qv"), null);
  assert.equal(hostToolOf("mcp__research__rm_rf"), null);
  assert.ok(QV_ALLOWED_TOOLS.includes("mcp__research__fetch_source"));
  // Fetching goes through the host or not at all.
  assert.equal(QV_ALLOWED_TOOLS.includes("WebFetch"), false);
});

test("row ids are found in prose, and abbreviated siblings are expanded", () => {
  const table = "c".repeat(64);
  assert.deepEqual(rowIdsIn(`${table}:t1:r7/r9/11 and nothing else`), [
    `${table}:t1:r7`,
    `${table}:t1:r9`,
    `${table}:t1:r11`,
  ]);
  assert.deepEqual(rowIdsIn("no id here"), []);
});

// --- the relay and the bridge ------------------------------------------------------------------

test("the relay lists only the exposed tools and every call is answered by the host", async () => {
  await withBridge(async ({ client, terminal }) => {
    const listed = await client.request("tools/list");
    assert.deepEqual(
      listed.tools.map((tool) => tool.name),
      ["fetch_source", "read_source"],
    );

    const fetched = await client.call("fetch_source", { url: PAGE_URL });
    assert.equal(fetched.isError, undefined);
    const source = JSON.parse(fetched.content[0].text);
    assert.equal(source.source.id, "source-1");
    assert.match(source.source.contentSha256, /^[a-f0-9]{64}$/);
    assert.match(source.content, /\$310 per metre/);

    const read = JSON.parse(
      (await client.call("read_source", { sourceId: "source-1", limit: 20 })).content[0].text,
    );
    assert.equal(read.content.length, 20);

    // Not exposed, so not reachable, whatever the relay is asked.
    const hidden = await client.call("submit_finding", { claim: "x", evidence: [] });
    assert.equal(hidden.isError, true);
    assert.equal(terminal(), null);
  });
});

test("a failing call is handed back to the model, and repeating it ends the run", async () => {
  await withBridge(async ({ client, terminal }) => {
    const missing = { sourceId: "source-99" };
    for (const strike of [1, 2]) {
      const response = await client.call("read_source", missing);
      assert.equal(response.isError, true, `strike ${strike}`);
      const { error } = JSON.parse(response.content[0].text);
      assert.deepEqual([error.code, error.recoverable], ["source_not_in_run", true]);
      assert.equal(terminal(), null);
    }
    const third = await client.call("read_source", missing);
    assert.equal(third.isError, true);
    assert.equal(terminal().code, REPEATED_TOOL_ERROR_CODE);
    assert.equal(terminal().cause, "source_not_in_run");
  });
});

test("the host's tool-call ceiling ends the run with the ceiling named", async () => {
  await withBridge(
    async ({ client, terminal }) => {
      await client.call("fetch_source", { url: PAGE_URL });
      const over = await client.call("fetch_source", { url: PAGE_URL });
      assert.equal(over.isError, true);
      assert.equal(terminal().ceiling, "maxToolCalls");
    },
    { budget: { ...BUDGET, maxToolCalls: 1 } },
  );
});

// --- the runtime, end to end ---------------------------------------------------------------------

test("a fetched web figure verifies, an unfetched one is marked unchecked, and the row is retained", async () => {
  await withRuntime(async ({ runtime }) => {
    await runtime.start(runRequest("RSCH-HOST-CITES"));
    const events = await drain(runtime, "RSCH-HOST-CITES");
    const status = await runtime.status("RSCH-HOST-CITES");
    assert.equal(status.status, "completed", JSON.stringify(status.error));

    // The host announces the page it retained; the stream's copy of the same tool result is not
    // persisted beside it.
    const sources = events
      .filter((event) => event.type === "source.retrieved")
      .map((event) => event.data.source);
    assert.deepEqual(
      sources.map((source) => source.id),
      ["source-1", `qv:${ROW_ID}`],
    );
    assert.ok(sources.every((source) => /^[a-f0-9]{64}$/.test(source.contentSha256)));

    const result = await runtime.result("RSCH-HOST-CITES");
    const [row, web, unfetched] = result.findings;
    assert.equal(row.evidence[0].quoteVerified, true);
    assert.match(row.evidence[0].excerpt, /Auckland 330\.00/);
    assert.equal(web.evidence[0].quoteVerified, true);
    assert.match(web.evidence[0].snapshotRef, /^sha256:[a-f0-9]{64}$/);
    assert.equal(unfetched.evidence[0].quoteVerified, false);
    assert.match(unfetched.verification.notes, /cited without being fetched/);
    // Nobody has reviewed any of it, checked citations or not.
    assert.ok(result.findings.every((finding) => finding.verification.status === "unverified"));

    assert.deepEqual(runtime.citationSummary("RSCH-HOST-CITES"), {
      rowsCited: 1,
      rowsFound: 1,
      rowsMissing: 0,
      rowsUnpriced: 0,
      webCited: 2,
      webVerified: 1,
      webNotFetched: 1,
      webExcerptRejected: 0,
    });
  });
});

test("a quote that is not on the fetched page is rejected, and an invented row id is named", async () => {
  await withRuntime(
    async ({ runtime }) => {
      await runtime.start(runRequest("RSCH-HOST-BAD-CITES"));
      await drain(runtime, "RSCH-HOST-BAD-CITES");
      const result = await runtime.result("RSCH-HOST-BAD-CITES");
      const [invented, misquoted] = result.findings;
      assert.equal(invented.evidence[0].quoteVerified, false);
      assert.match(invented.verification.notes, /not in the priced-rate capture/);
      assert.equal(misquoted.evidence[0].quoteVerified, false);
      assert.match(misquoted.verification.notes, /not an exact substring/);
      const summary = runtime.citationSummary("RSCH-HOST-BAD-CITES");
      assert.deepEqual([summary.rowsMissing, summary.webExcerptRejected], [1, 1]);
    },
    {
      answer: (sourceId) => ({
        components: [
          { role: "Invented", row_id: `${"d".repeat(64)}:t9:r9`, amount: { low: 1, high: 2 } },
          {
            role: "Misquoted",
            source: PAGE_URL,
            source_id: sourceId,
            excerpt: "$999 per metre",
            amount: { low: 999, high: 999 },
          },
        ],
      }),
    },
  );
});

test("the checked evidence survives the store's own re-verification", async () => {
  await withRuntime(async ({ runtime, directory }) => {
    const db = new DatabaseSync(path.join(directory, "tasks.sqlite3"));
    db.exec("PRAGMA foreign_keys = ON");
    migrateSqliteSchema(db);
    const service = new ResearchService({
      store: new ResearchStore(db, { sourceSnapshotDirectory: path.join(directory, "sources") }),
      registry: createResearchRuntimeRegistry([runtime]),
    });
    try {
      const created = await service.createRun({
        objective: "Price the stormwater connection.",
        profile: "quick",
        runtimeId: runtime.id,
      });
      await service.settled(created.id);
      assert.equal((await service.getRun(created.id)).status, "completed");
      const sources = await service.listSources(created.id);
      const retained = sources.filter((source) => source.contentSha256);
      assert.deepEqual(retained.map((source) => source.id).sort(), [`qv:${ROW_ID}`, "source-1"]);
      const result = await service.getResult(created.id);
      const verified = result.findings
        .flatMap((finding) => finding.evidence)
        .filter((ref) => ref.quoteVerified);
      assert.deepEqual(verified.map((ref) => ref.sourceId).sort(), [`qv:${ROW_ID}`, "source-1"]);
    } finally {
      await service.shutdown();
      db.close();
    }
  });
});

test("a PDF figure verifies only against the physical page it was quoted from", async () => {
  await withRuntime(
    async ({ runtime }) => {
      await runtime.start(runRequest("RSCH-HOST-PDF"));
      await drain(runtime, "RSCH-HOST-PDF");
      const [right, wrong] = (await runtime.result("RSCH-HOST-PDF")).findings;
      assert.equal(right.evidence[0].quoteVerified, true);
      assert.deepEqual(right.evidence[0].locator, { page: 2 });
      assert.equal(wrong.evidence[0].quoteVerified, false);
    },
    {
      captureProvider: pdfCapture(),
      answer: (sourceId) => ({
        components: [
          { role: "Right page", source: PAGE_URL, source_id: sourceId, page: 2, excerpt: "R-value 2.6" },
          { role: "Wrong page", source: PAGE_URL, source_id: sourceId, page: 1, excerpt: "R-value 2.6" },
        ],
      }),
    },
  );
});

test("a paid capture provider's outage fails the run as unassessed, not as bad research", async () => {
  await withRuntime(
    async ({ runtime }) => {
      await runtime.start(runRequest("RSCH-HOST-OUTAGE"));
      await drain(runtime, "RSCH-HOST-OUTAGE");
      const status = await runtime.status("RSCH-HOST-OUTAGE");
      assert.equal(status.status, "failed");
      assert.equal(status.error.code, PROVIDER_UNAVAILABLE_CODE);
    },
    {
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
  await withRuntime(
    async ({ runtime }) => {
      await runtime.start(runRequest("RSCH-HOST-TURNS", { maxModelCalls: 2 }));
      await drain(runtime, "RSCH-HOST-TURNS");
      const status = await runtime.status("RSCH-HOST-TURNS");
      assert.equal(status.status, "failed");
      assert.equal(status.error.code, "research_ceiling_exceeded");
      assert.equal(status.budgetState.ceilingHit, "maxModelCalls");
      assert.equal((await runtime.result("RSCH-HOST-TURNS")).truncatedBy, "maxModelCalls");
    },
    { extraTurns: 3 },
  );
});

test("with host tools turned off the run is the recorded configuration exactly", async () => {
  const calls = [];
  await withRuntime(
    async ({ runtime }) => {
      await runtime.start(runRequest("RSCH-HOST-OFF"));
      await drain(runtime, "RSCH-HOST-OFF");
      const { args } = calls[0];
      assert.equal(
        args[args.indexOf("--allowed-tools") + 1],
        "mcp__qv__search_qv,mcp__qv__get_qv_table,mcp__qv__list_qv_sections,WebSearch",
      );
      const config = JSON.parse(await readFile(args[args.indexOf("--mcp-config") + 1], "utf8"));
      assert.deepEqual(Object.keys(config.mcpServers), ["qv"]);
    },
    {
      hostTools: [],
      run: async (command, args, options) => {
        calls.push({ command, args });
        for (const line of cliLines({ components: [] })) options.onStdoutLine(JSON.stringify(line));
        return { code: 0, signal: null, stdout: "", stderr: "" };
      },
    },
  );
});

// --- helpers -------------------------------------------------------------------------------------

async function withBridge(body, { budget = BUDGET, tools = ["fetch_source", "read_source"] } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rcc-bridge-"));
  const webTools = new ResearchWebTools({
    runId: "RSCH-BRIDGE",
    budget,
    snapshotDirectory: path.join(directory, "sources"),
    ...FIXTURE_WEB,
  });
  let terminal = null;
  const bridge = await openHostToolBridge({
    directory,
    webTools,
    tools,
    onTerminal: (verdict) => {
      terminal = verdict;
    },
  });
  const client = await startMcpClient(process.execPath, [RELAY, bridge.socketPath, tools.join(",")]);
  try {
    await body({ client, terminal: () => terminal });
  } finally {
    client.close();
    webTools.close();
    await bridge.close();
    await rm(directory, { recursive: true, force: true });
  }
}

/** A minimal MCP client over a spawned stdio server: what the Claude CLI does, and no more. */
async function startMcpClient(command, args) {
  const child = spawn(command, args, { stdio: ["pipe", "pipe", "inherit"] });
  const pending = new Map();
  let sequence = 0;
  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    const message = JSON.parse(line);
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  });
  const request = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, (message) =>
        message.error ? reject(new Error(message.error.message)) : resolve(message.result),
      );
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  const initialized = await request("initialize", { protocolVersion: "2025-06-18", capabilities: {} });
  assert.equal(initialized.serverInfo.name, "research");
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  return {
    request,
    call: (name, input) => request("tools/call", { name, arguments: input }),
    close: () => child.stdin.end(),
  };
}

/** A process runner standing in for the CLI: it spawns the relay from the `--mcp-config` it was
 *  given, fetches the page through it, and answers citing what it fetched. */
function fetchingRunner({ answer, extraTurns = 0 }) {
  return async (_command, args, options) => {
    const config = JSON.parse(await readFile(args[args.indexOf("--mcp-config") + 1], "utf8"));
    const { command, args: relayArgs } = config.mcpServers.research;
    const client = await startMcpClient(command, relayArgs);
    let sourceId = null;
    try {
      const fetched = await client.call("fetch_source", { url: PAGE_URL });
      sourceId = fetched.isError ? null : JSON.parse(fetched.content[0].text).source.id;
    } finally {
      client.close();
    }
    for (const line of cliLines(answer(sourceId), { extraTurns })) options.onStdoutLine(JSON.stringify(line));
    return { code: 0, signal: null, stdout: "", stderr: "" };
  };
}

function defaultAnswer(sourceId) {
  return {
    components: [
      { role: "Channel and grate", row_id: ROW_ID, amount: { low: 300, high: 360 } },
      {
        role: "Stormwater connection",
        source: PAGE_URL,
        source_id: sourceId,
        excerpt: "$310 per metre installed",
        amount: { low: 280, high: 340 },
      },
      {
        role: "Traffic management",
        source: "https://unfetched.example.test/tm",
        amount: { low: 20, high: 40 },
      },
    ],
  };
}

function cliLines({ components }, { extraTurns = 0 } = {}) {
  const answer = {
    id: "fixture",
    resolved_from: "qv+web",
    confidence: "medium",
    components: components.map((component) => ({ unit: "m", centre: "Auckland", ...component })),
    band: { unit: "m", low: 600, high: 740, centre: "Auckland", basis: "Fixture." },
    not_established: [],
    qv_queries_tried: ["channel drain"],
  };
  return [
    { type: "system", subtype: "init", session_id: "s-host", model: "claude-opus-5", tools: [] },
    {
      type: "assistant",
      message: {
        id: "msg-1",
        content: [
          { type: "tool_use", id: "toolu_f", name: "mcp__research__fetch_source", input: { url: PAGE_URL } },
        ],
      },
    },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolu_f", content: "{…}" }] } },
    ...Array.from({ length: extraTurns }, (_unused, index) => ({
      type: "assistant",
      message: { id: `msg-extra-${index}`, content: [{ type: "text", text: "Still checking." }] },
    })),
    {
      type: "assistant",
      message: {
        id: "msg-final",
        content: [{ type: "text", text: `\`\`\`json\n${JSON.stringify(answer)}\n\`\`\`` }],
      },
    },
    {
      type: "result",
      subtype: "success",
      num_turns: 2 + extraTurns,
      total_cost_usd: 0.5,
      usage: { input_tokens: 10, output_tokens: 20 },
    },
  ];
}

async function withRuntime(
  body,
  { answer = defaultAnswer, extraTurns = 0, captureProvider = null, hostTools, run } = {},
) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rcc-host-"));
  await writeFile(
    path.join(directory, "capture.jsonl"),
    `${JSON.stringify({
      id: ROW_ID,
      description: "Proprietary channel and grate",
      headings: [{ text: "Drainage" }],
      unit_normalised: "m",
      regional_values: { Auckland: { scalar: "330.00" } },
    })}\n`,
  );
  const runtime = new ClaudeCliResearchRuntime({
    env: {
      PATH: process.env.PATH,
      HOME: directory,
      RESEARCH_QV_INDEX: path.join(directory, "capture.jsonl"),
    },
    transcriptDirectory: path.join(directory, "transcripts"),
    sourceSnapshotDirectory: path.join(directory, "sources"),
    assertAuth: async () => ({
      binary: "/usr/local/bin/claude",
      probe: { authMethod: REQUIRED_AUTH_METHOD },
    }),
    run: run ?? fetchingRunner({ answer, extraTurns }),
    captureProvider,
    webToolsOptions: FIXTURE_WEB,
    ...(hostTools ? { hostTools } : {}),
  });
  try {
    await body({ runtime, directory });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function runRequest(id, budget = {}) {
  return {
    id,
    objective: "Price the pinned stormwater scope.",
    profile: "standard",
    context: [],
    budget: { ...BUDGET, ...budget },
  };
}

async function drain(runtime, runId) {
  const events = [];
  for await (const event of runtime.events(runId)) events.push(event);
  return events;
}

function pdfCapture() {
  return {
    async capture() {
      return {
        mediaType: "application/pdf",
        content: "",
        pages: [],
        validatedPdf: {
          totalPages: 2,
          parsedPages: 2,
          pageCap: 3,
          coverage: "complete",
          capTruncated: false,
          pages: [
            { pageNumber: 1, content: "Contents and scope." },
            { pageNumber: 2, content: "Insulation batts, R-value 2.6, $14.50 per square metre." },
          ],
        },
        metadata: { provider: "fixture", finalUrl: PAGE_URL, title: "Supplier datasheet" },
      };
    },
  };
}

test("a credential the host holds is redacted from a transcript, and reported only by name", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rcc-secrets-"));
  try {
    const file = path.join(directory, "stream.jsonl");
    const secret = "sk-ant-sentinel-0123456789";
    await writeFile(file, `{"text":"key ${secret} and again ${secret}"}\n`);
    const found = await redactSecretsInFile(file, scannedNeedles({ ANTHROPIC_API_KEY: secret, SHORT: "x" }));
    assert.deepEqual(found, [{ label: "ANTHROPIC_API_KEY", occurrences: 2 }]);
    const contents = await readFile(file, "utf8");
    assert.equal(contents.includes(secret), false);
    assert.match(contents, /\[redacted:ANTHROPIC_API_KEY\]/);
    // A clean file is left alone.
    assert.deepEqual(await redactSecretsInFile(file, scannedNeedles({ ANTHROPIC_API_KEY: secret })), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

// --- PDFs read on this machine ------------------------------------------------------------------

const HAS_POPPLER = spawnSync("pdftotext", ["-v"]).error == null;

test("a PDF's physical pages are read locally, and a quote verifies only on its own page", {
  skip: !HAS_POPPLER,
}, async () => {
  const pdf = minimalPdf([
    "Contents and scope of this schedule.",
    "Capital contribution: $3,193 per connection.",
  ]);
  const pages = await extractPdfPages(pdf, { maxPages: 30 });
  assert.deepEqual([pages.parsedPages, pages.totalPages, pages.coverage], [2, 2, "complete"]);
  assert.match(pages.pages[1].content, /\$3,193 per connection/);

  const directory = await mkdtemp(path.join(os.tmpdir(), "rcc-pdf-"));
  const tools = new ResearchWebTools({
    runId: "RSCH-PDF",
    budget: BUDGET,
    snapshotDirectory: path.join(directory, "sources"),
    pdfExtractor: extractPdfPages,
    lookup: FIXTURE_WEB.lookup,
    fetchImpl: async () => new Response(pdf, { headers: { "content-type": "application/pdf" } }),
  });
  try {
    const fetched = (
      await tools.invoke("fetch_source", { url: "https://operator.example.test/schedule.pdf" })
    ).result;
    assert.equal(fetched.source.mediaType, "application/pdf");
    assert.deepEqual(fetched.pages, [1, 2]);
    const right = tools.verifyEvidence({
      sourceId: fetched.source.id,
      excerpt: "$3,193 per connection",
      locator: { page: 2 },
    });
    assert.equal(right.quoteVerified, true);
    assert.throws(
      () =>
        tools.verifyEvidence({
          sourceId: fetched.source.id,
          excerpt: "$3,193 per connection",
          locator: { page: 1 },
        }),
      (error) => error.code === "excerpt_not_found",
    );
  } finally {
    tools.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("without a PDF reader, a PDF is still refused rather than read as text", async () => {
  const tools = new ResearchWebTools({
    runId: "RSCH-PDF-OFF",
    budget: BUDGET,
    lookup: FIXTURE_WEB.lookup,
    fetchImpl: async () =>
      new Response(minimalPdf(["x"]), { headers: { "content-type": "application/pdf" } }),
  });
  try {
    await assert.rejects(
      tools.invoke("fetch_source", { url: "https://operator.example.test/schedule.pdf" }),
      (error) => error.code === "unsupported_media_type",
    );
  } finally {
    tools.close();
  }
});

/** A valid PDF with one line of text per page, built by hand so the test needs no fixture file. */
function minimalPdf(pageTexts) {
  const objects = [];
  const pageIds = pageTexts.map((_text, index) => 4 + index * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageTexts.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pageTexts.forEach((text, index) => {
    const pageId = pageIds[index];
    const stream = `BT /F1 12 Tf 72 720 Td (${text.replace(/[()\\]/g, "\\$&")}) Tj ET`;
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageId + 1} 0 R >>`;
    objects[pageId + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  let body = "%PDF-1.4\n";
  const offsets = [];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = body.length;
    body += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = body.length;
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1)
    body += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}
