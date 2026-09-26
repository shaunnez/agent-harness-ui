// The QV rate library served by PlanCheck, as the research agent's three QV tools.
//
// PlanCheck holds the QV CostBuilder licence and prices tenders against its own snapshot; asking
// its rate library means research cites the rows PlanCheck prices with, from one capture, rather
// than a second copy that drifts. The same three tools the local capture served
// (`qv-corpus-server.py`) are answered here, in the host process, because the API needs a bearer
// token and nothing in the CLI's process tree may hold a credential. The CLI reaches these tools
// through the host-tool relay, as it reaches `fetch_source`.
//
// Row identity is the QV row id (`<snapshot sha>:t<table>:r<row>`), read from each row's
// provenance, so prompts, `rowIdsIn` and the citation check are unchanged. The tool output is
// deliberately compact: id, trade / section, group, description, unit, and three centres' prices.
// `scope_notes` is left out: PlanCheck notes that it carries page-wide guidance that can describe
// other sections, so section and group are the reliable scope.

import {
  PLANCHECK_TOKEN_COMMAND_ENV_VAR,
  PLANCHECK_TOKEN_FILE_ENV_VAR,
  planCheckTokenSource,
} from "./plancheck-token.mjs";

export const QV_SOURCE_ENV_VAR = "RESEARCH_QV_SOURCE";
export const PLANCHECK_API_ENV_VAR = "RESEARCH_PLANCHECK_API";
/** Which row kinds research asks for, comma separated. Unset asks for PlanCheck's default (rate
 *  rows only). Research uses `rate,elemental,benchmark,build_up,percent,fee`: everything but
 *  `no_unit`, which cannot be multiplied by a quantity. Each non-rate row is labelled. */
export const PLANCHECK_ROW_KINDS_ENV_VAR = "RESEARCH_PLANCHECK_ROW_KINDS";
export { PLANCHECK_TOKEN_COMMAND_ENV_VAR, PLANCHECK_TOKEN_FILE_ENV_VAR };

export const DEFAULT_PLANCHECK_API = "http://127.0.0.1:8031";

export const QV_TOOL_NAMES = ["search_qv", "get_qv_table", "list_qv_sections"];

const RATES_PATH = "/api/variation-costs/rates";
const DEFAULT_SEARCH_LIMIT = 12;
const MAX_SEARCH_LIMIT = 40;
const MAX_TABLE_ROWS = 80;
const MAX_SECTIONS = 60;
const PAGE_LIMIT = 100;
const REQUEST_TIMEOUT_MS = 10_000;
const CENTRES = [
  ["Auckland", "AKL"],
  ["Wellington", "WLG"],
  ["Christchurch", "CHC"],
];

/** The PlanCheck configuration, or null when research should read the local capture. The token
 *  comes from a mint command the host runs, or a file; no token value sits in an environment the
 *  CLI inherits. */
export function planCheckQvConfig(env = process.env) {
  // PlanCheck's library is the default; the local capture must be asked for by name, and is kept
  // for replaying the recorded baselines, which were measured against it.
  const source = env[QV_SOURCE_ENV_VAR] ?? "plancheck";
  if (source === "local") return null;
  if (source !== "plancheck")
    throw new Error(`${QV_SOURCE_ENV_VAR} is "plancheck" (the default) or "local", not "${source}".`);
  const baseUrl = String(env[PLANCHECK_API_ENV_VAR] ?? DEFAULT_PLANCHECK_API).replace(/\/+$/, "");
  if (!/^https?:\/\//.test(baseUrl))
    throw new Error(
      `${QV_SOURCE_ENV_VAR}=plancheck needs ${PLANCHECK_API_ENV_VAR}, e.g. http://127.0.0.1:8031.`,
    );
  const tokens = planCheckTokenSource({
    command: env[PLANCHECK_TOKEN_COMMAND_ENV_VAR] || null,
    file: env[PLANCHECK_TOKEN_FILE_ENV_VAR] || null,
  });
  const rowKinds = String(env[PLANCHECK_ROW_KINDS_ENV_VAR] ?? "")
    .split(",")
    .map((kind) => kind.trim())
    .filter(Boolean);
  return { baseUrl, tokens, rowKinds };
}

/** One run's view of the library. It remembers every row it showed the model, which is what the
 *  citation check verifies a cited row against. */
export class PlanCheckQvSession {
  #baseUrl;
  #tokens;
  #rowKinds;
  #fetch;
  #shown = new Map();
  #sections = null;
  #cache;

  /** `cache` (`engine/tool-cache.mjs`) shares the library's answers across runs; the rows each run
   *  was shown, which its citations are checked against, stay this run's own. */
  constructor({ baseUrl, tokens, rowKinds = [], fetchImpl = fetch, cache = null }) {
    this.#cache = cache;
    this.#baseUrl = baseUrl;
    this.#tokens = tokens;
    this.#rowKinds = rowKinds;
    this.#fetch = fetchImpl;
  }

  async invoke(tool, input = {}) {
    if (tool === "search_qv") return { result: await this.#search(input) };
    if (tool === "get_qv_table") return { result: await this.#table(input) };
    if (tool === "list_qv_sections") return { result: await this.#listSections(input) };
    throw toolError("unknown_research_tool", `Unknown QV tool "${tool}".`);
  }

  /** `{ get(id) }` over the rows this run was shown, in the shape `checkCostBandCitations` reads.
   *  A cited row the run never retrieved is reported as not found: the model could only have
   *  seen it by being shown it. */
  citationRows() {
    return {
      size: this.#shown.size,
      get: (id) => {
        const row = this.#shown.get(id);
        return row
          ? {
              id,
              text: citationText(row, id),
              priced: isPriced(row),
              // What the review UI shows for the row, as the local capture's rows carry it.
              section: [row.trade, row.section].filter(Boolean).join(" / ") || null,
              group: row.group_label ?? null,
              desc: row.description ?? null,
              unit: unitText(row) || null,
              regional: regionalPrices(row),
            }
          : null;
      },
    };
  }

  async #search(input) {
    const query = requiredText(input.query, "query");
    const limit = clamp(input.limit, DEFAULT_SEARCH_LIMIT, 1, MAX_SEARCH_LIMIT);
    const contains = optionalText(input.section_contains);
    // QV writes thousands with a comma ("30,000 litre"); a model writing 30000 would miss it.
    const q = query.replace(/\b(\d{1,3})(\d{3})\b/g, "$1,$2");
    const rows = await this.#rows({ q, limit: contains ? PAGE_LIMIT : limit });
    const matched = contains
      ? rows.filter((row) => `${row.trade} / ${row.section}`.toLowerCase().includes(contains.toLowerCase()))
      : rows;
    const hits = matched.slice(0, limit);
    if (!hits.length) return "No rows matched.";
    return `${hits.length} rows:\n${hits.map((row) => this.#line(row)).join("\n")}`;
  }

  async #table(input) {
    const rowId = requiredText(input.row_id, "row_id");
    const table = tableOf(rowId);
    const known = [...this.#shown.entries()].find(([id]) => tableOf(id) === table)?.[1];
    if (!known?.provenance?.url)
      throw toolError(
        "qv_table_unknown",
        `Table ${table} has not been seen in this run. Find one of its rows with search_qv first, then pass that row id.`,
      );
    const rows = [];
    let cursor = null;
    do {
      const page = await this.#get(RATES_PATH, {
        source_url: known.provenance.url,
        limit: PAGE_LIMIT,
        ...(cursor ? { cursor } : {}),
      });
      rows.push(...(page.rows ?? []));
      cursor = page.next_cursor ?? null;
    } while (cursor && rows.length < 1_000);
    const inTable = rows.filter((row) => qvIdOf(row) && tableOf(qvIdOf(row)) === table).sort(byRow);
    if (!inTable.length) return `No table ${table}.`;
    const shown = inTable.slice(0, MAX_TABLE_ROWS);
    const more =
      inTable.length > shown.length ? `\n(${inTable.length - shown.length} more rows not shown)` : "";
    return `Table ${table}, ${inTable.length} rows:\n${shown.map((row) => this.#line(row)).join("\n")}${more}`;
  }

  async #listSections(input) {
    this.#sections ??= await this.#get(`${RATES_PATH}/facets`, {});
    const contains = (optionalText(input.contains) ?? "").toLowerCase();
    const sections = this.#sections.sections ?? [];
    const sectioned = new Set(sections.filter((entry) => entry.section).map((entry) => entry.trade));
    // A trade whose rows have no section (Professional Fees) is listed on its own.
    const bare = (this.#sections.trades ?? [])
      .filter((entry) => !sectioned.has(entry.value))
      .map((entry) => ({ trade: entry.value, section: "", count: entry.count }));
    const pairs = [...sections, ...bare]
      .map((entry) => ({
        name: [entry.trade, entry.section].filter(Boolean).join(" / "),
        count: Number(entry.count ?? 0),
      }))
      .filter((entry) => entry.name.toLowerCase().includes(contains))
      .sort((a, b) => b.count - a.count)
      .slice(0, MAX_SECTIONS);
    return (
      pairs.map((entry) => `${String(entry.count).padStart(5)}  ${entry.name}`).join("\n") ||
      "No sections matched."
    );
  }

  async #rows(params) {
    return (await this.#get(RATES_PATH, params)).rows ?? [];
  }

  #line(row) {
    const id = qvIdOf(row) ?? row.id;
    // A range row can span several source rows; a citation of any of them is a citation of it.
    for (const source of row.provenance?.source_rows ?? [])
      if (typeof source === "string") this.#shown.set(source, row);
    this.#shown.set(id, row);
    return formatRow(row, id);
  }

  async #get(pathname, params) {
    const url = new URL(`${this.#baseUrl}${pathname}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    for (const kind of this.#rowKinds) url.searchParams.append("row_kind", kind);
    if (!this.#cache) return this.#request(url);
    return (await this.#cache.remember("qv", url.href, () => this.#request(url))).value;
  }

  async #request(url) {
    const token = await this.#tokens.token();
    let response = await this.#send(url, token);
    // Refused anyway (revoked, or the library restarted with a new secret): mint once and retry.
    let reminted = false;
    if (response.status === 401 || response.status === 403) {
      const fresh = await this.#tokens.refused(token);
      if (fresh) {
        reminted = true;
        response = await this.#send(url, fresh);
      }
    }
    if (response.status === 401 || response.status === 403)
      throw providerError(
        "authentication",
        reminted
          ? "The PlanCheck rate library refused a freshly minted token."
          : `The PlanCheck rate library refused the token. Set ${PLANCHECK_TOKEN_COMMAND_ENV_VAR} so the host can mint a new one.`,
      );
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      if (response.status >= 500)
        throw providerError("transient", `The PlanCheck rate library failed (${response.status}).`);
      throw toolError(
        "qv_request_rejected",
        `The rate library rejected the request (${response.status}): ${body.slice(0, 200)}`,
      );
    }
    return response.json();
  }

  async #send(url, token) {
    try {
      return await this.#fetch(url, {
        headers: { authorization: `Bearer ${token}`, accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw providerError(
        "transient",
        `The PlanCheck rate library is unreachable: ${error?.message ?? error}`,
      );
    }
  }
}

/** The row's QV id: the first source row its provenance names. */
export function qvIdOf(row) {
  const source = row?.provenance?.source_rows?.[0];
  return typeof source === "string" && /^[0-9a-f]{64}:t\d+:r\d+$/.test(source) ? source : null;
}

export function formatRow(row, id = qvIdOf(row) ?? row.id) {
  // A per-m² benchmark priced on a whole building's floor area must never read as per m² of work.
  const kind = row.row_kind && row.row_kind !== "rate" ? `[${row.row_kind}] ` : "";
  return [
    id,
    [row.trade, row.section].filter(Boolean).join(" / "),
    row.group_label ?? "",
    `${kind}${row.description ?? ""}`,
    unitText(row),
    figuresText(
      row,
      CENTRES.map(([centre, code]) => [centre, code]),
    ),
  ].join(" | ");
}

function citationText(row, id) {
  const centres = Object.keys(row.regional_values ?? {}).map((centre) => [centre, centre]);
  return [
    `QV CostBuilder row ${id}`,
    [row.trade, row.section].filter(Boolean).join(" / "),
    row.group_label ?? "",
    row.row_kind && row.row_kind !== "rate"
      ? `[${row.row_kind}] ${row.description ?? ""}`
      : (row.description ?? ""),
    unitText(row),
    figuresText(row, centres) || "no figures",
    row.provenance?.snapshot_sha256 ? `snapshot ${row.provenance.snapshot_sha256}` : "",
  ]
    .filter((part) => part !== "")
    .join(" | ");
}

const MAX_BUILDINGS = 4;

/** The unit a row's figures are in. Elemental and fee rows have none of their own. */
function unitText(row) {
  if (row.row_kind === "elemental") return "per m² of floor area";
  if (row.row_kind === "benchmark") return `${row.unit ?? "m2"} of floor area`;
  if (row.row_kind === "percent") return "%";
  if (row.row_kind === "fee") return "% of construction cost";
  return row.unit ?? "";
}

/** Elemental rows carry cost per m² for each building type, and fee rows a fee percentage, in
 *  their provenance rather than in regional values; every other kind carries regional values. */
function figuresText(row, centres) {
  const provenance = row.provenance ?? {};
  if (row.row_kind === "elemental") {
    const buildings = (provenance.building_values ?? []).filter((entry) => Number(entry.cost_per_m2) > 0);
    if (!buildings.length) return "no figures";
    const shown = buildings
      .slice(0, MAX_BUILDINGS)
      .map((entry) => `${entry.building} ${entry.cost_per_m2}/m² (${entry.percent}% of total)`)
      .join("; ");
    const more =
      buildings.length > MAX_BUILDINGS ? `; +${buildings.length - MAX_BUILDINGS} more building types` : "";
    return `${provenance.centre ?? "Auckland"}: ${shown}${more}`;
  }
  if (row.row_kind === "fee")
    return provenance.fee_percent_low != null
      ? `fee ${provenance.fee_percent_low}–${provenance.fee_percent_high ?? provenance.fee_percent_low}%`
      : "no figures";
  const suffix = row.row_kind === "percent" ? "%" : "";
  return centres
    .map(([centre, code]) => {
      const text = priceText(row.regional_values?.[centre]);
      return `${code} ${text === "unpriced" ? text : `${text}${suffix}`}`;
    })
    .join(centres.length > 3 ? "; " : " ");
}

function regionalPrices(row) {
  const prices = {};
  for (const [centre, value] of Object.entries(row.regional_values ?? {})) {
    const text = priceText(value);
    if (text !== "unpriced") prices[centre] = text;
  }
  return prices;
}

function priceText(value) {
  if (!value || (value.low == null && value.high == null)) return "unpriced";
  if (value.low === value.high || value.high == null) return String(value.low);
  if (value.low == null) return String(value.high);
  return `${value.low}–${value.high}`;
}

function isPriced(row) {
  if (row.row_kind === "elemental")
    return (row.provenance?.building_values ?? []).some((entry) => Number(entry.cost_per_m2) > 0);
  if (row.row_kind === "fee") return row.provenance?.fee_percent_low != null;
  return Object.values(row.regional_values ?? {}).some(
    (value) => value && (value.low != null || value.high != null),
  );
}

function tableOf(rowId) {
  const match = /^([0-9a-f]{64}:t\d+)/.exec(String(rowId));
  return match ? match[1] : String(rowId);
}

function byRow(left, right) {
  const row = (item) => Number(/:r(\d+)$/.exec(qvIdOf(item) ?? "")?.[1] ?? 0);
  return row(left) - row(right);
}

function requiredText(value, name) {
  const text = optionalText(value);
  if (!text) throw toolError("invalid_tool_input", `${name} is required.`);
  return text;
}

function optionalText(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.slice(0, 500) : null;
}

function clamp(value, fallback, min, max) {
  const number = Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : fallback;
  return Math.max(min, Math.min(max, number));
}

function toolError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/** A failure of the library itself, not of the research: the run ends unassessed. */
function providerError(category, message) {
  const error = toolError(`plancheck_${category}`, message);
  error.provider = "plancheck";
  error.category = category;
  return error;
}
