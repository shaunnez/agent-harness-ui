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

import { writeResearchSnapshot } from "../research-source-snapshots.mjs";
import { rowIdsIn } from "./qv-rows.mjs";

/**
 * Returns `{ components, summary }`. `components[i].evidence` is the neutral `EvidenceRef[]`
 * for component `i`, and `components[i].problems` names every citation that did not verify.
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
        problems.push(`Row ${rowId} is not in the priced-rate capture.`);
        evidence.push(internalRecord(rowId, { now, excerpt: component.caveat }));
        continue;
      }
      summary.rowsFound += 1;
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
      if (checked.evidence.quoteVerified) summary.webVerified += 1;
      else if (checked.notFetched) summary.webNotFetched += 1;
      else summary.webExcerptRejected += 1;
      if (checked.problem) problems.push(checked.problem);
      evidence.push(checked.evidence);
    }
    components.push({ evidence, problems });
  }
  return { components, summary };
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
    metadata: { snapshotRef: snapshot.snapshotRef, corpus: "qv", rowId: row.id, priced: row.priced },
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
  const reference = {
    sourceId: component.sourceId,
    excerpt: component.excerpt ?? "",
    ...(component.page != null ? { locator: { page: component.page } } : {}),
    authority: "secondary",
  };
  try {
    return { evidence: webTools.verifyEvidence(reference) };
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
