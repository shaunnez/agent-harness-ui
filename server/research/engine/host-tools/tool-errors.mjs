// What a host tool failure means for the run, decided in one place.
//
// Carried over from the Deep Agents worker, which got the idea right and one detail wrong. The
// idea: a tool error the model can act on is feedback, not a crash. A mistyped excerpt on an
// otherwise correct citation used to destroy a run that had already retained the right source.
// The detail: it counted strikes per error code across the whole run, so the third website
// that returned a 403 ended the run — three different pages failing is not the model repeating
// a mistake, it is the web. Strikes here are counted per code *and* per input, so only the
// model retrying the same failing thing is stopped.
//
// Three outcomes, and the default is the forgiving one:
//
// - `terminal` — a budget or control condition no reply from the model can resolve: the run's
//   own ceilings, its deadline, cancellation, or the host's evidence store failing integrity.
// - `provider_unavailable` — a configured external provider (Firecrawl, Serper) is down,
//   throttling, out of quota or misconfigured. Ends the run, and is reported apart from a
//   research failure so a scorer records the case as unassessed rather than failed. A local
//   fetch timing out is deliberately NOT this: that is a fact about one website.
// - `recoverable` — everything else. Returned to the model as a tool error it can read.

/** Conditions that end the run. `ceiling` names the budget line that was hit, when one was. */
const TERMINAL_CODES = new Map([
  ["tool_call_ceiling_exceeded", "maxToolCalls"],
  ["deadline_exceeded", "maxRuntimeMs"],
  ["research_cancelled", null],
  ["source_snapshot_invalid", null],
]);

/** Provider categories that say nothing about the model or its research. */
const PROVIDER_UNAVAILABLE_CATEGORIES = new Set([
  "transient",
  "timeout",
  "rate_limit",
  "quota",
  "authentication",
  "configuration",
]);

/** A provider named here is this machine fetching a page itself, so its failures are facts
 *  about that page. Every other provider is a paid external service. */
const LOCAL_PROVIDERS = new Set(["local", "host"]);

/** How many times the model may be told about the same failure before the run gives up. */
export const MAX_STRIKES_PER_REPEATED_ERROR = 2;

export const REPEATED_TOOL_ERROR_CODE = "repeated_tool_error";
export const PROVIDER_UNAVAILABLE_CODE = "provider_unavailable";

/**
 * Classify one failed host tool call.
 *
 * Returns `{ outcome: "terminal" | "provider_unavailable" | "recoverable", code, message,
 * ceiling }`. Pure: strike counting is `StrikeCounter`'s job, because it needs the run's
 * history and this does not.
 */
export function classifyToolError(error) {
  const code = String(error?.code ?? "host_tool_failed");
  const message = error?.message ?? String(error);
  if (TERMINAL_CODES.has(code))
    return { outcome: "terminal", code, message, ceiling: error?.ceiling ?? TERMINAL_CODES.get(code) };
  // The search ceiling leaves the run viable — the model can still finish from what it has —
  // so it is feedback. Any other named ceiling is the run's budget running out.
  if (error?.ceiling && error.ceiling !== "maxSearchCalls")
    return { outcome: "terminal", code, message, ceiling: error.ceiling };
  const provider = error?.provider ?? null;
  if (
    provider &&
    !LOCAL_PROVIDERS.has(provider) &&
    PROVIDER_UNAVAILABLE_CATEGORIES.has(String(error?.category ?? code))
  )
    return { outcome: "provider_unavailable", code: PROVIDER_UNAVAILABLE_CODE, message, ceiling: null };
  return { outcome: "recoverable", code, message, ceiling: null };
}

/**
 * Counts how often the model has been handed the same failure.
 *
 * "The same" is the code plus the tool plus the input, canonicalised. A model re-submitting an
 * excerpt it was told is not in the source is a loop; a model trying three different pages
 * that each returned 403 is research.
 */
export class StrikeCounter {
  #strikes = new Map();
  #limit;

  constructor(limit = MAX_STRIKES_PER_REPEATED_ERROR) {
    this.#limit = limit;
  }

  /** Record one failure. Returns the strike count and whether the run may continue. */
  record(tool, input, code) {
    const key = `${code}\u0000${tool}\u0000${canonicalJson(input)}`;
    const strikes = (this.#strikes.get(key) ?? 0) + 1;
    this.#strikes.set(key, strikes);
    return { strikes, allowed: strikes <= this.#limit };
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value ?? null);
}
