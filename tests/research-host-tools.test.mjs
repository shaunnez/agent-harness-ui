// The host-owned research tools and checked citations, carried over from the retired Deep
// Agents runtime and kept through the Claude CLI's retirement: every research runtime now gets
// them from `server/research/engine/`.
//
// The bridge tests speak the socket protocol the API loop speaks (`api-loop/host-client.mjs`),
// so they reach the real bridge and the real `ResearchWebTools` in this process. The end-to-end
// tests run a whole API-loop run with a scripted model (`research-hosted-support.mjs`), so the
// model's tool calls are the ones a real run makes and its citations are checked by the real
// code. Only the model, PlanCheck and the network are fake.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { connectHostTools } from "../server/research/api-loop/host-client.mjs";
import { openHostToolBridge } from "../server/research/engine/host-tools/bridge.mjs";
import { allowedToolName, hostToolOf } from "../server/research/engine/host-tools/definitions.mjs";
import {
  classifyToolError,
  PROVIDER_UNAVAILABLE_CODE,
  REPEATED_TOOL_ERROR_CODE,
  StrikeCounter,
} from "../server/research/engine/host-tools/tool-errors.mjs";
import { rowIdsIn } from "../server/research/engine/qv-rows.mjs";
import { redactSecretsInFile, scannedNeedles } from "../server/research/engine/secret-scan.mjs";
import { extractPdfPages } from "../server/research/research-pdf-text.mjs";
import { createResearchRuntimeRegistry } from "../server/research/research-runtime-registry.mjs";
import { ResearchService } from "../server/research/research-service.mjs";
import { ResearchStore } from "../server/research/research-store.mjs";
import { ResearchToolError, ResearchWebTools } from "../server/research/research-web-tools.mjs";
import { migrateSqliteSchema } from "../server/sqlite-storage.mjs";
import {
  answerWith,
  BUDGET,
  drain,
  FIXTURE_WEB,
  PAGE_URL,
  ROW_ID,
  runRequest,
  toolCall,
  toolsThenAnswer,
  withApiLoopRuntime,
} from "./research-hosted-support.mjs";

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

test("host tool names round-trip through their mcp__ prefix and nothing else matches", () => {
  // The prefix is what the recorded transcripts carry, so it is kept after the CLIs that used it.
  assert.equal(allowedToolName("fetch_source"), "mcp__research__fetch_source");
  assert.equal(hostToolOf(allowedToolName("fetch_source")), "fetch_source");
  assert.equal(hostToolOf("mcp__qv__search_qv"), null);
  assert.equal(hostToolOf("mcp__research__rm_rf"), null);
  assert.equal(hostToolOf("WebFetch"), null);
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

// --- the bridge ----------------------------------------------------------------------------------

test("the bridge answers only the exposed tools, and every answer comes from the host", async () => {
  await withBridge(async ({ client, terminal }) => {
    const fetched = await client.call("fetch_source", { url: PAGE_URL });
    assert.equal(fetched.ok, true);
    assert.equal(fetched.result.source.id, "source-1");
    assert.match(fetched.result.source.contentSha256, /^[a-f0-9]{64}$/);
    assert.match(fetched.result.content, /\$310 per metre/);

    const read = await client.call("read_source", { sourceId: "source-1", limit: 20 });
    assert.equal(read.result.content.length, 20);

    // Not exposed, so not reachable, whatever the caller asks for.
    const hidden = await client.call("submit_finding", { claim: "x", evidence: [] });
    assert.deepEqual([hidden.ok, hidden.error.code], [false, "unknown_research_tool"]);
    assert.equal(terminal(), null);
  });
});

test("a failing call is handed back to the model, and repeating it ends the run", async () => {
  await withBridge(async ({ client, terminal }) => {
    const missing = { sourceId: "source-99" };
    for (const strike of [1, 2]) {
      const response = await client.call("read_source", missing);
      assert.equal(response.ok, false, `strike ${strike}`);
      assert.deepEqual([response.error.code, response.error.recoverable], ["source_not_in_run", true]);
      assert.equal(terminal(), null);
    }
    const third = await client.call("read_source", missing);
    assert.equal(third.ok, false);
    assert.equal(terminal().code, REPEATED_TOOL_ERROR_CODE);
    assert.equal(terminal().cause, "source_not_in_run");
    // After the end, every call is answered with it, so a caller is never left waiting.
    const after = await client.call("fetch_source", { url: PAGE_URL });
    assert.equal(after.error.code, REPEATED_TOOL_ERROR_CODE);
  });
});

test("the host's tool-call ceiling ends the run with the ceiling named", async () => {
  await withBridge(
    async ({ client, terminal }) => {
      await client.call("fetch_source", { url: PAGE_URL });
      const over = await client.call("fetch_source", { url: PAGE_URL });
      assert.equal(over.ok, false);
      assert.equal(terminal().ceiling, "maxToolCalls");
    },
    { budget: { ...BUDGET, maxToolCalls: 1 } },
  );
});

// --- checked citations, end to end ---------------------------------------------------------------

const SEARCH_AND_FETCH = [
  toolCall("c1", "search_qv", { query: "channel drain" }),
  toolCall("c2", "fetch_source", { url: PAGE_URL }),
];

const CITED = answerWith([
  { role: "Channel and grate", basis: "qv", row_id: ROW_ID, amount: { low: 300, high: 360 } },
  {
    role: "Stormwater connection",
    basis: "web",
    source: PAGE_URL,
    source_id: "source-1",
    excerpt: "$310 per metre installed",
    amount: { low: 310, high: 310 },
  },
  {
    role: "Traffic management",
    basis: "web",
    source: "https://unfetched.example.test/tm",
    amount: { low: 20, high: 40 },
  },
]);

test("a fetched web figure verifies, an unfetched one is marked unchecked, and the row is retained", async () => {
  await withApiLoopRuntime(
    async ({ runtime }) => {
      await runtime.start(runRequest("RSCH-HOST-CITES"));
      const events = await drain(runtime, "RSCH-HOST-CITES");
      const status = await runtime.status("RSCH-HOST-CITES");
      assert.equal(status.status, "completed", JSON.stringify(status.error));

      // The host announces the page it retained and the row it checked, each with the snapshot
      // behind it.
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
      assert.match(row.evidence[0].excerpt, /330/);
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
        webDerived: 0,
        webUnsupported: 0,
        allowances: 0,
      });
    },
    { step: toolsThenAnswer(SEARCH_AND_FETCH, CITED) },
  );
});

test("a quote that is not on the fetched page is rejected, and a row the run was not shown is named", async () => {
  const answer = answerWith([
    // A real-looking id the library never returned to this run: invented, as far as the host knows.
    { role: "Invented", basis: "qv", row_id: `${"d".repeat(64)}:t9:r9`, amount: { low: 1, high: 2 } },
    {
      role: "Misquoted",
      basis: "web",
      source: PAGE_URL,
      source_id: "source-1",
      excerpt: "Premium stormwater connection with a lifetime warranty",
      amount: { low: 999, high: 999 },
    },
  ]);
  await withApiLoopRuntime(
    async ({ runtime }) => {
      await runtime.start(runRequest("RSCH-HOST-BAD-CITES"));
      await drain(runtime, "RSCH-HOST-BAD-CITES");
      const [invented, misquoted] = (await runtime.result("RSCH-HOST-BAD-CITES")).findings;
      assert.equal(invented.evidence[0].quoteVerified, false);
      assert.match(invented.verification.notes, /not in the priced-rate capture/);
      assert.equal(misquoted.evidence[0].quoteVerified, false);
      const summary = runtime.citationSummary("RSCH-HOST-BAD-CITES");
      assert.deepEqual([summary.rowsMissing, summary.webExcerptRejected], [1, 1]);
    },
    { step: toolsThenAnswer(SEARCH_AND_FETCH, answer) },
  );
});

test("the checked evidence survives the store's own re-verification", async () => {
  await withApiLoopRuntime(
    async ({ runtime, directory }) => {
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
    },
    { step: toolsThenAnswer(SEARCH_AND_FETCH, CITED) },
  );
});

// The store's `verifyEvidence` is page-strict (the poppler test below). The citation check on top
// of it is not, by Shaun's decision of 25 September: a quote whose words are on another page of
// the same PDF is checked on that page, and the page it is kept under is the one it is on.
test("a PDF figure is checked on the physical page its words are on, and a quote on no page is rejected", async () => {
  const quoted = (role, page, excerpt) => ({
    role,
    basis: "web",
    source: PAGE_URL,
    source_id: "source-1",
    page,
    excerpt,
    unit: "m2",
    amount: { low: 14.5, high: 14.5 },
  });
  const answer = answerWith([
    quoted("Right page", 2, "R-value 2.6, $14.50 per square metre"),
    quoted("Wrong page", 1, "R-value 2.6, $14.50 per square metre"),
    quoted("No page has it", 2, "Glasswool batts at $14.50 per square metre, delivered"),
  ]);
  await withApiLoopRuntime(
    async ({ runtime }) => {
      await runtime.start(runRequest("RSCH-HOST-PDF"));
      await drain(runtime, "RSCH-HOST-PDF");
      const [right, wrong, absent] = (await runtime.result("RSCH-HOST-PDF")).findings;
      assert.equal(right.evidence[0].quoteVerified, true);
      assert.deepEqual(right.evidence[0].locator, { page: 2 });
      assert.equal(wrong.evidence[0].quoteVerified, true);
      assert.deepEqual(wrong.evidence[0].locator, { page: 2 });
      assert.equal(absent.evidence[0].quoteVerified, false);
      assert.equal(runtime.citationSummary("RSCH-HOST-PDF").webExcerptRejected, 1);
    },
    {
      step: toolsThenAnswer([toolCall("c1", "fetch_source", { url: PAGE_URL })], answer),
      captureProvider: pdfCapture(),
    },
  );
});

// --- credentials ---------------------------------------------------------------------------------

test("a credential the host holds is redacted from a file, and reported only by name", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "research-secrets-"));
  try {
    const file = path.join(directory, "stream.jsonl");
    const secret = "sk-sentinel-0123456789";
    await writeFile(file, `{"text":"key ${secret} and again ${secret}"}\n`);
    const found = await redactSecretsInFile(file, scannedNeedles({ BASETEN_API_KEY: secret, SHORT: "x" }));
    assert.deepEqual(found, [{ label: "BASETEN_API_KEY", occurrences: 2 }]);
    const contents = await readFile(file, "utf8");
    assert.equal(contents.includes(secret), false);
    assert.match(contents, /\[redacted:BASETEN_API_KEY\]/);
    // A clean file is left alone.
    assert.deepEqual(await redactSecretsInFile(file, scannedNeedles({ BASETEN_API_KEY: secret })), []);
    // A value too short to be a credential is not matched: it would redact ordinary words.
    assert.deepEqual(scannedNeedles({ PARALLEL_API_KEY: "short" }), []);
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

  const directory = await mkdtemp(path.join(os.tmpdir(), "research-pdf-"));
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

// --- helpers -------------------------------------------------------------------------------------

/** A bridge over real web tools, and a client speaking its socket protocol as the API loop does. */
async function withBridge(body, { budget = BUDGET, tools = ["fetch_source", "read_source"] } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "research-bridge-"));
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
  const client = await connectHostTools(bridge.socketPath);
  try {
    await body({ client, terminal: () => terminal });
  } finally {
    await client.close();
    webTools.close();
    await bridge.close();
    await rm(directory, { recursive: true, force: true });
  }
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
