// The host-owned research tools, as the Claude CLI sees them.
//
// These are the five tools the Deep Agents worker gave its model, moved to where the model now
// runs. What each one does is still decided by `ResearchWebTools` in the parent process; this
// file only names them, describes them and shapes their input, and it is imported by the MCP
// relay the CLI spawns — so it must stay free of anything that relay should not load.
//
// The schemas are strict on purpose (`additionalProperties: false`), matching the zod schemas
// they replace. The host re-validates every field regardless: a schema here is a hint to the
// model, never the check.

/** The MCP server name. The CLI exposes each tool as `mcp__<server>__<tool>`. */
export const HOST_TOOL_SERVER_NAME = "research";

const locator = {
  type: "object",
  additionalProperties: false,
  properties: {
    page: { type: "integer", minimum: 1 },
    section: { type: "string", maxLength: 500 },
    selector: { type: "string", maxLength: 500 },
    charStart: { type: "integer", minimum: 0 },
    charEnd: { type: "integer", minimum: 0 },
  },
};

export const HOST_TOOL_DEFINITIONS = Object.freeze({
  read_context: {
    description:
      "Return the research objective's supplied context references. Each reference is only a {type, id} pair.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
  web_search: {
    description:
      "Discover public web sources. Search snippets are discovery hints only; fetch a source before citing it.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: { type: "string", minLength: 1, maxLength: 500 },
        market: { type: "string", enum: ["NZ", "AU", "US", "GLOBAL"] },
      },
    },
  },
  fetch_source: {
    description:
      "Fetch and retain a public HTTP/HTTPS page or PDF so it can be cited. Returns a source id and the page's " +
      "normalised text (PDFs by physical page). A web figure is only citable if its page was fetched with this tool.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["url"],
      properties: { url: { type: "string", format: "uri", maxLength: 4_000 } },
    },
  },
  read_source: {
    description:
      "Read a bounded range from a source already retained by fetch_source. PDFs require a retained physical " +
      "page. This never fetches the page again.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["sourceId"],
      properties: {
        sourceId: { type: "string", minLength: 1, maxLength: 200 },
        page: { type: "integer", minimum: 1 },
        offset: { type: "integer", minimum: 0 },
        limit: { type: "integer", minimum: 1, maximum: 50_000 },
      },
    },
  },
  submit_finding: {
    description:
      "Submit one finding with exact excerpts from sources retained by fetch_source. The host verifies every " +
      "excerpt. For evidence from a PDF the locator must be exactly {page: <physical page number>} and nothing " +
      "else. For HTML or text evidence the locator must omit `page`.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["claim", "evidence"],
      properties: {
        claim: { type: "string", minLength: 1, maxLength: 2_000 },
        evidence: {
          type: "array",
          minItems: 1,
          maxItems: 10,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["sourceId", "excerpt"],
            properties: {
              sourceId: { type: "string", minLength: 1, maxLength: 200 },
              excerpt: { type: "string", minLength: 1, maxLength: 2_000 },
              locator,
              authority: { type: "string", enum: ["primary", "secondary", "unknown"] },
            },
          },
        },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        assumptions: { type: "array", maxItems: 10, items: { type: "string", maxLength: 500 } },
      },
    },
  },
});

/** The QV tools, when the rate library is PlanCheck's API rather than the local capture. The
 *  host answers them (`qv-plancheck.mjs`) because the API needs a token; the CLI sees them under
 *  the `qv` server, with the names and inputs the local capture's server always had. */
export const QV_TOOL_DEFINITIONS = Object.freeze({
  search_qv: {
    description:
      "Keyword search over PlanCheck's QV CostBuilder rate library. Returns row id, trade / section, group, " +
      "description, unit and Auckland/Wellington/Christchurch prices (NZD, GST exclusive). Search this BEFORE " +
      'the web. Rows containing every word rank first. Write numbers as QV does: "30,000", not "30000". ' +
      "Rows marked [elemental] or [benchmark] are priced per m² of a whole building's floor area, not per m² of " +
      "the work; [percent] rows are percentage adjustments; [fee] rows are consultant fees as a percentage of " +
      "construction cost; [build_up] rows are a rate's total or its components, so never add a total to the " +
      "components it is built from.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: { type: "string", minLength: 1, maxLength: 500 },
        section_contains: { type: "string", maxLength: 200 },
        limit: { type: "integer", minimum: 1, maximum: 40 },
      },
    },
  },
  get_qv_table: {
    description:
      "Return every row of the QV table a row id belongs to, to see siblings, size variants and price tiers. " +
      "Pass a row id returned by search_qv in this run.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["row_id"],
      properties: { row_id: { type: "string", minLength: 1, maxLength: 200 } },
    },
  },
  list_qv_sections: {
    description: "List QV trade / section pairs with row counts.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { contains: { type: "string", maxLength: 200 } },
    },
  },
});

/** What a run can be offered: the host research tools, then the QV tools. */
export const RELAY_TOOL_DEFINITIONS = Object.freeze({
  ...HOST_TOOL_DEFINITIONS,
  ...QV_TOOL_DEFINITIONS,
});

export const HOST_TOOL_NAMES = Object.freeze(Object.keys(HOST_TOOL_DEFINITIONS));

/** A host tool's qualified name, as the CLIs knew it and the recorded transcripts still carry it. */
export function allowedToolName(tool) {
  return `mcp__${HOST_TOOL_SERVER_NAME}__${tool}`;
}

/** The host tool a CLI tool name refers to, or null for any other tool. */
export function hostToolOf(cliToolName) {
  const prefix = `mcp__${HOST_TOOL_SERVER_NAME}__`;
  const name = String(cliToolName ?? "");
  return name.startsWith(prefix) && HOST_TOOL_NAMES.includes(name.slice(prefix.length))
    ? name.slice(prefix.length)
    : null;
}
