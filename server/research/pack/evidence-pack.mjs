// The evidence pack: what the retrieval stage found, as the host checked it, and the text the
// reasoning stage is given.
//
// An item is a cost-band component without the arithmetic, so the host checks it with the same
// code that checks a final answer (`checkCostBandCitations`). Only items that checked out go
// forward: a QV row the run was shown, or a web excerpt found on the retained page. Everything
// else is listed as rejected, with the reason, so the reasoning model knows what is missing
// rather than silently pricing around it.

import { parseFinalJsonFence } from "../claude-cli/stream.mjs";

/** The checks that let an item into the pack. */
const USABLE = new Set(["qv-found", "web-verified"]);

/** The retrieval model's reply, or null when it produced no pack. Items are read with the
 *  cost-band component reader's rules, so a pack item and an answer component are one shape. */
export function parseEvidencePack(finalText) {
  const parsed = parseFinalJsonFence(finalText);
  if (!parsed || !Array.isArray(parsed.items)) return null;
  return {
    items: parsed.items.filter((item) => item && typeof item === "object").map(readItem),
    notFound: strings(parsed.not_found),
    queriesTried: strings(parsed.qv_queries_tried),
  };
}

/**
 * Split a pack into what goes forward and what does not. `checked` is `checkCostBandCitations`'
 * output for `pack.items`, in item order; `rows` is the row map it checked against.
 */
export function checkedPack(pack, checked, rows) {
  const kept = [];
  const rejected = [];
  for (const [index, item] of pack.items.entries()) {
    const result = checked.components[index];
    if (result && USABLE.has(result.check)) {
      const rowIds = item.rowId ? [item.rowId] : [];
      kept.push({
        ...item,
        check: result.check,
        rowText: rowIds.map((id) => rows?.get(id)?.text).find(Boolean) ?? null,
      });
    } else
      rejected.push({
        role: item.role,
        check: result?.check ?? "unchecked",
        reason: result?.problems?.join(" ") || "Cites nothing the host could check.",
      });
  }
  return { kept, rejected, notFound: pack.notFound, queriesTried: pack.queriesTried };
}

/** The pack as the reasoning model reads it. Items are numbered in one sequence across the
 *  initial pack and any later requests, so a citation can be traced to where it came from. */
export function packText(pack, { startAt = 1, heading = "EVIDENCE PACK (checked by the host)" } = {}) {
  const lines = [heading];
  if (!pack.kept.length) lines.push("No item checked out.");
  for (const [offset, item] of pack.kept.entries()) {
    const label = `[E${startAt + offset}]`;
    const amount =
      item.low != null || item.high != null
        ? `${item.low ?? "?"}–${item.high ?? "?"} ${item.unit ?? ""}`.trim()
        : "no amount stated";
    if (item.check === "qv-found") {
      lines.push(`${label} QV row_id ${item.rowId} · for: ${item.role ?? "unstated"}`);
      if (item.rowText) lines.push(`  host row: ${item.rowText}`);
    } else {
      lines.push(
        `${label} Web source ${item.source ?? "unstated"} source_id ${item.sourceId} · for: ${item.role ?? "unstated"}`,
      );
      lines.push(`  excerpt${item.page ? ` (page ${item.page})` : ""}: "${item.excerpt}"`);
    }
    lines.push(
      `  retrieval read: ${amount}${item.centre ? `, ${item.centre}` : ""}${item.caveat ? `; ${item.caveat}` : ""}`,
    );
  }
  if (pack.rejected.length) {
    lines.push("", "REJECTED by the host (do not cite these):");
    for (const item of pack.rejected) lines.push(`- ${item.role ?? "unstated"}: ${item.reason}`);
  }
  if (pack.notFound.length) {
    lines.push("", "NOT FOUND by retrieval:");
    for (const item of pack.notFound) lines.push(`- ${item}`);
  }
  if (pack.queriesTried.length) lines.push("", `QV queries tried: ${pack.queriesTried.join("; ")}`);
  return lines.join("\n");
}

function readItem(raw) {
  const amount = raw?.amount && typeof raw.amount === "object" ? raw.amount : {};
  return {
    role: text(raw.role),
    rowId: text(raw.row_id),
    source: text(raw.source),
    sourceId: text(raw.source_id),
    basis: raw.basis === "qv" || raw.basis === "web" ? raw.basis : null,
    excerpt: text(raw.excerpt),
    page: Number.isInteger(raw.page) && raw.page > 0 ? raw.page : null,
    unit: text(raw.unit),
    low: number(amount.low),
    high: number(amount.high),
    centre: text(raw.centre),
    caveat: text(raw.caveat),
  };
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function number(value) {
  const parsed = typeof value === "string" ? Number(value.replace(/[$,\s]/g, "")) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
}

function strings(value) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}
