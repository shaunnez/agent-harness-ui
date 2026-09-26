// PlanCheck's QV rate library as the research agent's QV tools: answered in the host (the token
// never reaches the CLI), compact rows keyed by the QV row id, tables rebuilt from one QV page,
// citations checked against the rows the run was shown, and a library outage ending the run as
// unassessed. A stand-in API only; nothing here reaches PlanCheck.

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkCostBandCitations } from "@eversor/research-engine/engine/citations.mjs";
import { openHostToolSession } from "@eversor/research-engine/engine/host-tools/session.mjs";
import { classifyToolError } from "@eversor/research-engine/engine/host-tools/tool-errors.mjs";
import { expiryOf, PlanCheckTokenSource } from "@eversor/research-engine/plancheck-token.mjs";
import { formatRow, PlanCheckQvSession, planCheckQvConfig } from "@eversor/research-engine/qv-plancheck.mjs";

const SHA = "78c8fd59161b9762a39ae3343a98a487a3973500676292e0de7fc9f254e869a4";
const PAGE = "https://costbuilder.qv.co.nz/detailed-rates/doors/doors/";

function rate(
  table,
  row,
  description,
  { low = 1000, high = low, url = PAGE, section = "Doors, Industrial Roller Shutter" } = {},
) {
  return {
    id: `uuid-${table}-${row}`,
    trade: "Doors",
    section,
    group_label: "Interlocking Slat Roller Shutter Door",
    description,
    unit: "each",
    scope_notes: "General page guidance that can describe other sections.",
    regional_values: { Auckland: { low, high }, Wellington: { low: low + 10, high: high + 10 } },
    provenance: { url, snapshot_sha256: SHA, source_rows: [`${SHA}:t${table}:r${row}`] },
    review_status: "unreviewed",
  };
}

const LIBRARY = [
  rate(14, 3, "3000mm x 3000mm wide", { low: 3000 }),
  rate(14, 4, "3600mm x 3600mm wide", { low: 3300 }),
  rate(15, 1, "Removable mullion", { low: 271 }),
  rate(2, 1, "30,000 litre", {
    low: 6500,
    url: "https://costbuilder.qv.co.nz/tanks/",
    section: "Water Tanks",
  }),
];

async function withLibrary(body, { status = 200, token = "test-token" } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "research-qv-plancheck-"));
  const tokenFile = path.join(directory, "token");
  if (token) await writeFile(tokenFile, `${token}\n`);
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url: new URL(url), authorization: init.headers.authorization });
    if (status !== 200) return new Response("{}", { status });
    const { pathname, searchParams } = new URL(url);
    if (pathname.endsWith("/facets"))
      return Response.json({
        sections: [
          { trade: "Doors", section: "Doors, Industrial Roller Shutter", count: 3 },
          { trade: "Plumbing", section: "Water Tanks", count: 1 },
        ],
      });
    const q = (searchParams.get("q") ?? "").toLowerCase();
    const sourceUrl = searchParams.get("source_url");
    const rows = LIBRARY.filter((row) =>
      sourceUrl
        ? row.provenance.url === sourceUrl
        : q.split(/\s+/).some((word) => `${row.section} ${row.description}`.toLowerCase().includes(word)),
    );
    return Response.json({ rows: rows.slice(0, Number(searchParams.get("limit") ?? 50)), next_cursor: null });
  };
  try {
    return await body({
      session: new PlanCheckQvSession({
        baseUrl: "http://127.0.0.1:8031",
        tokens: new PlanCheckTokenSource({ command: null, file: tokenFile, now: Date.now, run: null }),
        fetchImpl,
      }),
      requests,
      directory,
      tokenFile,
      fetchImpl,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("search returns compact rows keyed by the QV row id, without the page-wide notes", async () => {
  await withLibrary(async ({ session, requests }) => {
    const { result } = await session.invoke("search_qv", { query: "roller shutter" });
    const lines = result.split("\n");
    assert.match(lines[0], /^3 rows:/);
    assert.equal(
      lines[1],
      `${SHA}:t14:r3 | Doors / Doors, Industrial Roller Shutter | Interlocking Slat Roller Shutter Door | 3000mm x 3000mm wide | each | AKL 3000 WLG 3010 CHC unpriced`,
    );
    assert.equal(result.includes("General page guidance"), false);
    assert.equal(requests[0].authorization, "Bearer test-token");

    // QV writes thousands with a comma.
    await session.invoke("search_qv", { query: "30000 litre tank" });
    assert.equal(requests.at(-1).url.searchParams.get("q"), "30,000 litre tank");
    const tanks = (await session.invoke("search_qv", { query: "litre", section_contains: "water tanks" }))
      .result;
    assert.match(tanks, /^1 rows:/);
  });
});

test("a table is every row of one QV page with the same table index, and needs a row seen first", async () => {
  await withLibrary(async ({ session, requests }) => {
    await assert.rejects(session.invoke("get_qv_table", { row_id: `${SHA}:t14:r3` }), /search_qv first/);
    await session.invoke("search_qv", { query: "3000mm" });
    const { result } = await session.invoke("get_qv_table", { row_id: `${SHA}:t14:r3` });
    assert.match(result, new RegExp(`^Table ${SHA}:t14, 2 rows:`));
    assert.equal(
      result.includes("Removable mullion"),
      false,
      "table 15 on the same page is a different table",
    );
    assert.equal(requests.at(-1).url.searchParams.get("source_url"), PAGE);
    assert.match(
      (await session.invoke("list_qv_sections", { contains: "tank" })).result,
      /1 {2}Plumbing \/ Water Tanks/,
    );
  });
});

test("citations are checked against the rows this run was shown", async () => {
  await withLibrary(async ({ session, directory }) => {
    await session.invoke("search_qv", { query: "roller shutter" });
    const { components } = await checkCostBandCitations(
      {
        components: [
          { role: "Shutter", rowId: `${SHA}:t14:r3` },
          { role: "Never shown", rowId: `${SHA}:t99:r1` },
        ],
      },
      { rows: session.citationRows(), webTools: null, snapshotDirectory: path.join(directory, "snapshots") },
    );
    assert.deepEqual(
      components.map((item) => item.check),
      ["qv-found", "qv-missing"],
    );
    assert.match(components[0].evidence[0].excerpt, /snapshot 78c8fd59/);
  });
});

test("a refused token or an unreachable library ends the run as unassessed, not as a research failure", async () => {
  await withLibrary(
    async ({ session }) => {
      const error = await session.invoke("search_qv", { query: "shutter" }).catch((reason) => reason);
      assert.match(error.message, /RESEARCH_PLANCHECK_TOKEN_COMMAND/);
      assert.equal(classifyToolError(error).outcome, "provider_unavailable");
    },
    { status: 401 },
  );
  await withLibrary(
    async ({ session }) => {
      const error = await session.invoke("search_qv", { query: "shutter" }).catch((reason) => reason);
      assert.equal(classifyToolError(error).outcome, "provider_unavailable");
    },
    { token: "" },
  );
});

test("the CLI reaches PlanCheck's library through the host relay, with no token in its config", async () => {
  // PlanCheck is the default; the local capture is asked for by name.
  assert.equal(planCheckQvConfig({ RESEARCH_QV_SOURCE: "local" }), null);
  assert.throws(() => planCheckQvConfig({}), /RESEARCH_PLANCHECK_TOKEN_COMMAND/);
  assert.throws(
    () => planCheckQvConfig({ RESEARCH_QV_SOURCE: "elsewhere" }),
    /"plancheck" \(the default\) or "local"/,
  );
  await withLibrary(async ({ session, directory, tokenFile }) => {
    const config = planCheckQvConfig({
      RESEARCH_QV_SOURCE: "plancheck",
      RESEARCH_PLANCHECK_API: "http://127.0.0.1:8031/",
      RESEARCH_PLANCHECK_TOKEN_FILE: tokenFile,
    });
    assert.deepEqual(config, { baseUrl: "http://127.0.0.1:8031", tokens: config.tokens, rowKinds: [] });
    const host = await openHostToolSession({
      runId: "RSCH-QV",
      budget: { maxToolCalls: 10, maxRuntimeMs: 60_000 },
      directory,
      tools: ["fetch_source", "read_source"],
      qv: session,
    });
    try {
      // A QV call on the run's socket, answered by the host bridge. The token stays on the host.
      const reply = await new Promise((resolve, reject) => {
        const socket = createConnection(host.socketPath);
        socket.setEncoding("utf8");
        let buffered = "";
        socket.on("data", (chunk) => {
          buffered += chunk;
          if (buffered.includes("\n")) {
            socket.end();
            resolve(JSON.parse(buffered.split("\n")[0]));
          }
        });
        socket.on("error", reject);
        socket.write(`${JSON.stringify({ id: "1", tool: "search_qv", input: { query: "mullion" } })}\n`);
      });
      assert.equal(reply.ok, true);
      assert.match(reply.result, /Removable mullion/);
    } finally {
      await host.close();
    }
  });
});

const jwt = (expSeconds) => `h.${Buffer.from(JSON.stringify({ exp: expSeconds })).toString("base64url")}.s`;

test("the host mints a token when it has none, reuses it, and renews it before it expires", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "research-plancheck-token-"));
  try {
    let clock = 1_000_000_000_000;
    const minted = [];
    const run = async () => {
      const token = jwt(Math.floor(clock / 1000) + 24 * 3600);
      minted.push(token);
      return `warning from the script\n${token}\n`;
    };
    const file = path.join(directory, "token");
    const tokens = new PlanCheckTokenSource({ command: "mint", file, now: () => clock, run });

    const [a, b] = await Promise.all([tokens.token(), tokens.token()]);
    assert.equal(a, b, "parallel runs share one mint");
    assert.equal(minted.length, 1);
    assert.equal(expiryOf(a), clock + 24 * 3600 * 1000);

    clock += 23 * 3600 * 1000; // an hour left: still fresh
    assert.equal(await tokens.token(), a);
    clock += 40 * 60 * 1000; // twenty minutes left: renewed
    const renewed = await tokens.token();
    assert.notEqual(renewed, a);
    assert.equal(minted.length, 2);

    // Refused anyway: mint once more.
    const again = await tokens.refused(renewed);
    assert.equal(minted.length, 3);
    assert.equal(await tokens.token(), again);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("without a mint command an expired token says how to fix it, and a refused request is retried once", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "research-plancheck-token-"));
  try {
    const file = path.join(directory, "token");
    await writeFile(file, `${jwt(Math.floor(Date.now() / 1000) - 60)}\n`);
    const expired = new PlanCheckTokenSource({ command: null, file, now: Date.now, run: null });
    const error = await expired.token().catch((reason) => reason);
    assert.match(error.message, /has expired.*RESEARCH_PLANCHECK_TOKEN_COMMAND/);
    assert.equal(classifyToolError(error).outcome, "provider_unavailable");

    let calls = 0;
    const tokens = new PlanCheckTokenSource({
      command: "mint",
      file: null,
      now: Date.now,
      run: async () => jwt(Math.floor(Date.now() / 1000) + 3600 * 24 + calls++),
    });
    const seen = [];
    const session = new PlanCheckQvSession({
      baseUrl: "http://127.0.0.1:8031",
      tokens,
      rowKinds: ["all"],
      fetchImpl: async (url, init) => {
        seen.push({ auth: init.headers.authorization, kinds: new URL(url).searchParams.getAll("row_kind") });
        return seen.length === 1 ? new Response("{}", { status: 401 }) : Response.json({ rows: [] });
      },
    });
    assert.equal((await session.invoke("search_qv", { query: "tank" })).result, "No rows matched.");
    assert.equal(seen.length, 2);
    assert.notEqual(seen[0].auth, seen[1].auth, "retried with a newly minted token");
    assert.deepEqual(seen[1].kinds, ["all"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rows that are not detailed rates are labelled and show their own figures", () => {
  const base = LIBRARY[0];
  assert.match(
    formatRow({ ...base, row_kind: "benchmark", unit: "m2" }),
    /\| \[benchmark\] 3000mm x 3000mm wide \| m2 of floor area \| AKL 3000/,
  );
  assert.equal(formatRow({ ...base, row_kind: "rate" }).includes("[rate]"), false);
  // Shapes as PlanCheck serves them on 24 September.
  const elemental = {
    ...base,
    row_kind: "elemental",
    unit: null,
    regional_values: {},
    provenance: {
      ...base.provenance,
      centre: "Auckland",
      building_values: [
        { building: "Warehouse", cost_per_m2: "118.00", percent: "9.1" },
        { building: "Basement Parking", cost_per_m2: "0.00", percent: "0.0" },
      ],
    },
  };
  assert.match(
    formatRow(elemental),
    /\| per m² of floor area \| Auckland: Warehouse 118\.00\/m² \(9\.1% of total\)$/,
  );
  const fee = {
    ...base,
    row_kind: "fee",
    unit: null,
    regional_values: {},
    provenance: { ...base.provenance, fee_percent_low: "11.0", fee_percent_high: "12.5" },
  };
  assert.match(formatRow(fee), /\| % of construction cost \| fee 11\.0–12\.5%$/);
  const percent = {
    ...base,
    row_kind: "percent",
    unit: null,
    regional_values: { Auckland: { low: 60, high: 60 } },
  };
  assert.match(formatRow(percent), /\| % \| AKL 60% WLG unpriced CHC unpriced$/);
});
