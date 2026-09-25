// Check every citation in a finished cost band, after the run, against what the host holds.
//
// This is the Deep Agents runtime's best idea — a model cannot enter a claim whose excerpt
// the host has not found in a source it retained — applied to a runtime whose model states its
// citations in a final answer rather than submitting them one at a time. The check is the same
// one `submit_finding` makes (`ResearchWebTools.verifyEvidence`); only the moment differs.
//
// Two kinds of citation, checked two ways:
//
// - A QV row id is looked up in the licensed capture. A row that exists is retained as a
//   snapshot of the exact text the model was shown, so the store can verify the excerpt the
//   same way it verifies a web page. A row id that does not exist is an invented citation.
// - A web figure must name the `source_id` its page was fetched under and quote the page. A
//   URL with no `source_id` was never read — in the 90 recorded runs, every web figure came
//   from a search snippet, because the agent had no way to fetch a page at all.
//
// Nothing here fails a run. A citation that does not check out stays in the result, marked
// unverified with the reason, because hiding it would make the band look better sourced than
// it is.

import { figuresSupport, workingSupport } from "../research-quote-figures.mjs";
import { writeResearchSnapshot } from "../research-source-snapshots.mjs";
import { rowIdsIn } from "./qv-rows.mjs";

/**
 * Returns `{ components, summary }`. `components[i].evidence` is the neutral `EvidenceRef[]`
 * for component `i`, `components[i].problems` names every citation that did not verify, and
 * `components[i].check` is the one label a reviewer reads for it (`qv-found`, `web-verified`,
 * `allowance`, ...), taken from its weakest citation.
 *
 * `emitSource` is called once per retained QV row with the `source.retrieved` payload, so a
 * row reaches the store's sources table before the evidence that points at it.
 */
export async function checkCostBandCitations(
  costBand,
  { rows, webTools, snapshotDirectory, now = () => new Date(), emitSource = () => {} },
) {
  const summary = {
    rowsCited: 0,
    rowsFound: 0,
    rowsMissing: 0,
    rowsUnpriced: 0,
    webCited: 0,
    webVerified: 0,
    webNotFetched: 0,
    webExcerptRejected: 0,
    // Verified quotes whose figures the check could confirm only in part, or not at all
    // (`research-quote-figures.mjs`).
    webDerived: 0,
    webUnsupported: 0,
    // Components the model priced from judgement and labelled as such (`basis: "allowance"`).
    // Counted apart from citations: an allowance cites nothing by design, and a reader has to
    // see how much of a band rests on one.
    allowances: 0,
  };
  if (!costBand) return { components: [], summary };
  const retainedRows = new Map();
  const components = [];
  for (const component of costBand.components) {
    const evidence = [];
    const problems = [];
    const outcomes = [];
    if (component.basis === "allowance") {
      summary.allowances += 1;
      problems.push("Allowance: an amount the model assumed, not a cited price.");
    }

    // A row id in a shape the capture never uses is still a citation, and an unfindable one:
    // dropping it would make the component look as if it cited nothing.
    const rowIds = rowIdsIn(component.rowId);
    if (component.rowId && !rowIds.length) rowIds.push(component.rowId);
    for (const rowId of rowIds) {
      summary.rowsCited += 1;
      const row = rows?.get(rowId) ?? null;
      if (!row) {
        summary.rowsMissing += 1;
        outcomes.push("qv-missing");
        problems.push(`Row ${rowId} is not in the priced-rate capture.`);
        evidence.push(internalRecord(rowId, { now, excerpt: component.caveat }));
        continue;
      }
      summary.rowsFound += 1;
      outcomes.push("qv-found");
      if (!row.priced) {
        summary.rowsUnpriced += 1;
        problems.push(`Row ${rowId} carries no price, so this component's amount came from elsewhere.`);
      }
      if (!retainedRows.has(rowId))
        retainedRows.set(rowId, await retainRow(row, { snapshotDirectory, now, emitSource }));
      evidence.push(retainedRows.get(rowId));
    }

    if (component.source || component.sourceId) {
      summary.webCited += 1;
      const checked = checkWebCitation(component, webTools);
      if (checked.evidence.quoteVerified && checked.figures === "derived") {
        summary.webDerived += 1;
        outcomes.push("web-derived");
      } else if (checked.evidence.quoteVerified && checked.figures === "unsupported") {
        summary.webUnsupported += 1;
        outcomes.push("web-unsupported");
      } else if (checked.evidence.quoteVerified) {
        summary.webVerified += 1;
        outcomes.push("web-verified");
      } else if (checked.notFetched) {
        summary.webNotFetched += 1;
        outcomes.push("web-not-fetched");
      } else {
        summary.webExcerptRejected += 1;
        outcomes.push("web-unverified");
      }
      if (checked.problem) problems.push(checked.problem);
      evidence.push(checked.evidence);
    }
    components.push({ evidence, problems, check: componentCheck(component, outcomes) });
  }
  return { components, summary };
}

// One label per component, the weakest thing about it first: a reader deciding whether to trust
// the component needs its worst citation, not its best.
const CHECK_ORDER = [
  "qv-missing",
  "web-unverified",
  "web-unsupported",
  "web-not-fetched",
  "web-derived",
  "web-verified",
  "qv-found",
];
function componentCheck(component, outcomes) {
  if (component.basis === "allowance") return "allowance";
  return CHECK_ORDER.find((check) => outcomes.includes(check)) ?? "unsourced";
}

async function retainRow(row, { snapshotDirectory, now, emitSource }) {
  const snapshot = await writeResearchSnapshot(snapshotDirectory, row.text);
  const retrievedAt = now().toISOString();
  const source = {
    id: `qv:${row.id}`,
    sourceType: "internal_record",
    title: `QV CostBuilder row ${row.id}`,
    retrievedAt,
    contentSha256: snapshot.digest,
    contentBytes: snapshot.bytes,
    mediaType: "text/plain",
    metadata: {
      snapshotRef: snapshot.snapshotRef,
      corpus: "qv",
      rowId: row.id,
      priced: row.priced,
      section: row.section,
      group: row.group,
      desc: row.desc,
      unit: row.unit,
      regional: row.regional,
    },
  };
  emitSource({ source });
  return {
    sourceId: source.id,
    sourceType: "internal_record",
    title: source.title,
    retrievedAt,
    excerpt: row.text,
    snapshotRef: snapshot.snapshotRef,
    // The row is the text the model was shown and it is now retained, so this is a checked
    // quote. The store re-checks it against the snapshot before persisting either way.
    quoteVerified: true,
    authority: "primary",
  };
}

function checkWebCitation(component, webTools) {
  const url = firstUrl(component.source);
  if (!component.sourceId || !webTools)
    return {
      notFetched: true,
      problem: `${url ?? "The web figure"} was cited without being fetched, so the figure is unchecked.`,
      evidence: {
        sourceId: url ?? `unfetched:${component.role ?? "component"}`,
        sourceType: "web",
        ...(url ? { url } : {}),
        title: component.role ?? url ?? "Unfetched web citation",
        retrievedAt: new Date().toISOString(),
        quoteVerified: false,
        authority: "secondary",
      },
    };
  // A PDF quote that names no page is looked for on every retained page of that PDF (Shaun,
  // 24 September): 11 of DeepSeek's 13 failed quotes on the API loop were PDF rows with no page.
  const page =
    component.page ?? webTools.locatePdfPage?.(component.sourceId, component.excerpt ?? "") ?? null;
  const reference = {
    sourceId: component.sourceId,
    excerpt: component.excerpt ?? "",
    ...(page != null ? { locator: { page } } : {}),
    authority: "secondary",
  };
  try {
    let evidence;
    let relocated = null;
    try {
      evidence = webTools.verifyEvidence(reference);
    } catch (error) {
      // A quote that is not on the page character for character is looked for by its words (Shaun,
      // 25 September). When they are there, the page's own words are what gets checked and kept:
      // the retained excerpt is always the page's text, never the model's rewording of it.
      relocated =
        error?.code === "excerpt_not_found" || error?.code === "pdf_page_required"
          ? (webTools.locateQuote?.(component.sourceId, component.excerpt ?? "", page) ?? null)
          : null;
      if (!relocated) throw error;
      const { locator: _locator, ...rest } = reference;
      evidence = webTools.verifyEvidence({
        ...rest,
        excerpt: relocated.text,
        ...(relocated.page != null ? { locator: { page: relocated.page } } : {}),
      });
    }
    const passage =
      relocated?.text ??
      webTools.locateQuote?.(component.sourceId, component.excerpt ?? "", page)?.text ??
      evidence.excerpt ??
      component.excerpt;
    const disclaimer = webTools.disclaimerFor?.(component.sourceId, passage) ?? null;
    const figures = disclaimer
      ? {
          verdict: "unsupported",
          problem: `The source says this is not a price ("${clip(disclaimer, 80)}"): the item is not established without a quote.`,
        }
      : checkFigures(component, passage);
    const notes = [
      relocated ? `Quoted as "${clip(component.excerpt)}"; the page reads "${clip(relocated.text)}".` : null,
      figures.problem,
    ].filter(Boolean);
    return { evidence, figures: figures.verdict, ...(notes.length ? { problem: notes.join(" ") } : {}) };
  } catch (error) {
    return {
      notFetched: error?.code === "source_not_in_run",
      problem: `The web citation for "${component.role ?? "a component"}" did not verify: ${error?.message ?? error}`,
      evidence: {
        sourceId: component.sourceId,
        sourceType: "web",
        ...(url ? { url } : {}),
        title: component.role ?? component.sourceId,
        retrievedAt: new Date().toISOString(),
        ...(component.excerpt ? { excerpt: component.excerpt } : {}),
        quoteVerified: false,
        authority: "secondary",
      },
    };
  }
}

function internalRecord(rowId, { now, excerpt }) {
  return {
    sourceId: `qv:${rowId}`,
    sourceType: "internal_record",
    title: `QV CostBuilder row ${rowId} (not in the capture)`,
    retrievedAt: now().toISOString(),
    ...(excerpt ? { excerpt } : {}),
    quoteVerified: false,
    authority: "unknown",
  };
}

function firstUrl(text) {
  return String(text ?? "").match(/https?:\/\/[^\s;,]+/)?.[0] ?? null;
}

/**
 * Whether the quoted passage's own figures give the component's amount: `verified` (they do, or
 * the amount sits inside a range the page states), `derived` (one end is on the page, or the
 * component shows the quantities it worked from), or `unsupported` (the page gives other numbers,
 * or none, and the component shows no working).
 */
function checkFigures(component, passage) {
  if (component.rate && component.quantity) return checkWorking(component, passage);
  const context = [component.role, component.unit, component.caveat].filter(Boolean).join(" ");
  const { support, figures } = figuresSupport(passage, { low: component.low, high: component.high, context });
  const amount = `${component.low ?? "?"}–${component.high ?? "?"}`;
  const stated = figures.length
    ? figures
        .slice(0, 6)
        .map((value) => String(value))
        .join(", ")
    : "none";
  if (support === "match" || support === "within") return { verdict: "verified" };
  if (support === "partial" || support === "derived")
    return {
      verdict: "derived",
      problem: `The amount ${amount} is worked from the quote, not stated in it (the page's figures: ${stated}).`,
    };
  return {
    verdict: "unsupported",
    problem:
      support === "no_figures"
        ? `The quote states no figure, so it does not support the amount ${amount}.`
        : `The page's figures (${stated}) do not give the amount ${amount}, and the component shows no working.`,
  };
}

/**
 * A component that states its working is checked on both halves: its rate must be the page's
 * figure and its amount must be rate × quantity. A rate only half on the page is "worked from the
 * quote", as the same quote would be without the working.
 */
function checkWorking(component, passage) {
  const { rate, quantity } = component;
  const checked = workingSupport(passage, { rate, quantity, low: component.low, high: component.high });
  const rateText = `${rate.low}–${rate.high}${rate.unit ? ` ${rate.unit}` : ""}`;
  const stated = checked.figures.length ? checked.figures.slice(0, 6).join(", ") : "none";
  // One end of the rate on the page is what a band with no working would get for the same quote,
  // "Worked from quote": showing the working must never score worse than hiding it.
  if (checked.rate === "partial" && checked.arithmetic)
    return {
      verdict: "derived",
      problem: `Only part of the rate ${rateText} is on the page (the page's figures: ${stated}).`,
    };
  if (checked.rate !== "match" && checked.rate !== "within")
    return {
      verdict: "unsupported",
      problem:
        checked.rate === "no_figures"
          ? `The quote states no figure, so it does not give the rate ${rateText}.`
          : `The page's figures (${stated}) do not give the rate ${rateText}.`,
    };
  if (!checked.arithmetic)
    return {
      verdict: "unsupported",
      problem: `The amount ${component.low}–${component.high} is not the rate ${rateText} × the quantity ${quantity.low}–${quantity.high} (${round(checked.expected.low)}–${round(checked.expected.high)}).`,
    };
  return { verdict: "verified" };
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function clip(text, limit = 160) {
  const value = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}
