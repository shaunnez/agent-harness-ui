// The priced-rate capture, read by the host so a cited row can be checked.
//
// The model reaches the capture through `qv-corpus-server.py`. This is the host's own read of
// the same file, for one purpose: when a finished answer cites a row id, confirm the row
// exists and retain the text the model was shown, so the citation can be verified the same way
// a fetched web page is. In the 90 recorded runs every one of 549 cited row ids existed, and 13
// of them were rows with no price at all — a component priced from an unpriced row has taken
// its number from somewhere else, and nothing flagged it.
//
// The capture is read once per path and kept: it is ~20 MB, and a benchmark checks thousands
// of citations against it.

import { readFile } from "node:fs/promises";
import path from "node:path";

const cache = new Map();

/** Every full row id in a component's `row_id` text. Models write several ids in one field, and
 *  abbreviate siblings of the same table as `…:t1:r7/r9/r11`; both are expanded. */
export function rowIdsIn(text) {
  const ids = [];
  const pattern = /([0-9a-f]{64}:t\d+):r(\d+)((?:\/r?\d+)*)/g;
  for (const match of String(text ?? "").matchAll(pattern)) {
    ids.push(`${match[1]}:r${match[2]}`);
    for (const sibling of match[3].split("/").filter(Boolean))
      ids.push(`${match[1]}:r${sibling.replace(/^r/, "")}`);
  }
  return [...new Set(ids)];
}

/** A lookup over the capture at `indexPath`: `get(id)` returns `{ id, text, priced }` or null. */
export async function loadQvRows(indexPath) {
  const key = path.resolve(indexPath);
  if (!cache.has(key))
    cache.set(
      key,
      // A failed read is not cached: the capture may be mounted or written a moment later, and
      // a cached rejection would leave every later run in this process unable to check a row.
      readRows(key).catch((error) => {
        cache.delete(key);
        throw error;
      }),
    );
  return cache.get(key);
}

async function readRows(indexPath) {
  const rows = new Map();
  const body = await readFile(indexPath, "utf8");
  for (const line of body.split("\n")) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    // Only what a citation check and the review UI need is kept: the full rows are several
    // times the size.
    if (typeof row?.id === "string")
      rows.set(row.id, {
        id: row.id,
        text: rowText(row),
        priced: isPriced(row),
        section: (row.headings ?? []).map((heading) => heading.text).join(" / ") || null,
        group: row.nearest_group ?? null,
        desc: row.description ?? null,
        unit: row.unit_normalised ?? null,
        regional: regionalPrices(row),
      });
  }
  return {
    size: rows.size,
    get(id) {
      return rows.get(id) ?? null;
    },
  };
}

/** The row as a citable line: section, group, description, unit and every regional price.
 *  Deterministic, because it is content-addressed: the same row always retains the same text. */
export function rowText(row) {
  const section = (row.headings ?? []).map((heading) => heading.text).join(" / ");
  const prices = Object.entries(row.regional_values ?? {})
    .map(([region, value]) => `${region} ${priceOf(value) ?? "unpriced"}`)
    .join("; ");
  return [
    `QV CostBuilder row ${row.id}`,
    section,
    row.nearest_group ?? "",
    row.description ?? "",
    row.unit_normalised ?? "",
    prices || "no regional prices",
  ]
    .filter((part) => part !== "")
    .join(" | ");
}

/** Every regional price on a row, as the UI's `Record<place, priceString>` shape. Rows with no
 *  price for a region are left out rather than shown as "unpriced". */
function regionalPrices(row) {
  const prices = {};
  for (const [region, value] of Object.entries(row.regional_values ?? {})) {
    const price = priceOf(value);
    if (price != null) prices[region] = price;
  }
  return prices;
}

function priceOf(value) {
  if (!value) return null;
  if (value.scalar != null) return String(value.scalar);
  if (value.low != null || value.high != null) return `${value.low ?? "?"}–${value.high ?? "?"}`;
  return null;
}

function isPriced(row) {
  return Object.values(row.regional_values ?? {}).some((value) => priceOf(value) != null);
}
