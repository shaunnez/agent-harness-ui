import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const PDF_SNAPSHOT_FORMAT = "research-pdf-v1";
export const PDF_NORMALIZATION_VERSION = 1;

export function normalizePdfCapture({ pages, numPages, totalPages = null, pageCap, blocks = null }) {
  if (!Array.isArray(pages) || pages.length === 0)
    throw incomplete("PDF capture returned no physical pages.");
  if (!Number.isInteger(pageCap) || pageCap < 1) throw incomplete("PDF capture used an invalid page cap.");
  const normalizedPages = pages.map((page, index) => {
    if (!Number.isInteger(page?.pageNumber) || page.pageNumber !== index + 1)
      throw incomplete("PDF pages must be contiguous physical pages starting at 1.");
    const content = normalizePageText(page.content ?? page.markdown ?? "");
    if (!content)
      throw incomplete("PDF capture contained an unclassified empty page.", "empty_page_unclassified");
    return { pageNumber: page.pageNumber, content };
  });
  if (!Number.isInteger(numPages) || numPages !== normalizedPages.length)
    throw incomplete("Provider page count did not match physical pages.");
  let coverage = "unknown";
  let capTruncated = null;
  let validatedTotal = null;
  if (totalPages != null) {
    if (!Number.isInteger(totalPages) || totalPages < normalizedPages.length)
      throw incomplete("Provider total-page metadata was contradictory.");
    if (normalizedPages.length !== Math.min(totalPages, pageCap))
      throw incomplete("PDF capture did not cover the required physical page range.");
    validatedTotal = totalPages;
    capTruncated = totalPages > pageCap;
    coverage = capTruncated ? "capped" : "complete";
  }
  let blockCoverage = "unknown";
  if (Array.isArray(blocks)) {
    for (const block of blocks) {
      const page = Number(block?.pageNumber ?? block?.page);
      if (!Number.isInteger(page) || page < 1 || page > normalizedPages.length)
        throw incomplete("PDF block metadata referenced an invalid physical page.");
      if (block.status != null && String(block.status).trim() !== "") {
        const status = safeBlockStatus(block.status);
        if (!["ok", "success", "complete"].includes(status))
          throw incomplete(`PDF block metadata reported extraction failure (status: ${status}).`);
      }
    }
    blockCoverage = blocks.length ? "reported" : "empty";
  }
  return {
    totalPages: validatedTotal,
    parsedPages: normalizedPages.length,
    pageCap,
    coverage,
    capTruncated,
    pages: normalizedPages,
    blockCoverage,
  };
}

export function serializePdfSnapshot(validated) {
  return `${JSON.stringify({
    format: PDF_SNAPSHOT_FORMAT,
    normalizationVersion: PDF_NORMALIZATION_VERSION,
    totalPages: validated.totalPages,
    parsedPages: validated.parsedPages,
    pageCap: validated.pageCap,
    coverage: validated.coverage,
    pages: validated.pages,
  })}\n`;
}

export function parsePdfSnapshot(content) {
  let envelope;
  try {
    envelope = JSON.parse(content);
  } catch {
    throw incomplete("PDF snapshot JSON was invalid.");
  }
  if (
    envelope?.format !== PDF_SNAPSHOT_FORMAT ||
    envelope?.normalizationVersion !== PDF_NORMALIZATION_VERSION
  )
    throw incomplete("PDF snapshot format was unsupported.");
  const validated = normalizePdfCapture({
    pages: envelope.pages,
    numPages: envelope.parsedPages,
    totalPages: envelope.totalPages,
    pageCap: envelope.pageCap,
  });
  if (validated.coverage !== envelope.coverage)
    throw incomplete("PDF snapshot coverage metadata was inconsistent.");
  return { ...validated, format: PDF_SNAPSHOT_FORMAT };
}

export async function writeResearchSnapshot(directory, content) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const digest = sha256(content);
  const filePath = path.join(directory, `${digest}.txt`);
  try {
    await writeFile(filePath, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const stat = await lstat(filePath);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error("A content-addressed snapshot path was not a regular file.");
    if ((stat.mode & 0o077) !== 0)
      throw new Error("A content-addressed snapshot must already be owner-only before reuse.");
    const existing = await readFile(filePath, "utf8");
    if (existing !== content) throw new Error(`Content-addressed snapshot collision at ${filePath}.`);
  }
  return { digest, snapshotRef: `sha256:${digest}`, filePath, bytes: Buffer.byteLength(content) };
}

export async function readVerifiedSnapshot(source, directory) {
  if (!/^[a-f0-9]{64}$/.test(source?.contentSha256 ?? ""))
    throw new Error("Source snapshot hash is invalid.");
  const filePath = path.join(directory, `${source.contentSha256}.txt`);
  const stat = await lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Source snapshot is not a regular file.");
  const content = await readFile(filePath, "utf8");
  if (sha256(content) !== source.contentSha256)
    throw new Error("Source snapshot hash did not match retained metadata.");
  if (source.mediaType === "application/pdf") {
    if (source.metadata?.snapshotFormat !== PDF_SNAPSHOT_FORMAT)
      throw new Error("PDF source is missing its versioned snapshot format.");
    return { content, pdf: parsePdfSnapshot(content) };
  }
  if (source.metadata?.snapshotFormat === PDF_SNAPSHOT_FORMAT)
    throw new Error("Non-PDF source cannot use the PDF snapshot verifier.");
  return { content, pdf: null };
}

export async function verifySnapshotEvidence({ source, reference, snapshotDirectory }) {
  if (!source || !reference?.excerpt || reference.snapshotRef !== `sha256:${source.contentSha256}`)
    return false;
  try {
    const retained = await readVerifiedSnapshot(source, snapshotDirectory);
    if (retained.pdf) {
      const keys = Object.keys(reference.locator ?? {});
      if (
        keys.length !== 1 ||
        keys[0] !== "page" ||
        !Number.isInteger(reference.locator.page) ||
        reference.locator.page < 1
      )
        return false;
      const page = retained.pdf.pages.find((candidate) => candidate.pageNumber === reference.locator.page);
      return Boolean(page && excerptAppearsIn(page.content, reference.excerpt));
    }
    if (reference.locator?.page != null) return false;
    return excerptAppearsIn(retained.content, reference.excerpt);
  } catch {
    return false;
  }
}

/**
 * Whether `excerpt` is quoted from `content`: every character the same, with whitespace
 * allowed to differ. Retained text keeps a table's cells on separate lines, and a model quoting
 * a table row joins them with spaces; that is the same quote, and rejecting it taught nothing.
 * Typographic look-alikes are also equal: every dash and minus sign reads as "-", curly quotes as
 * straight ones, "…" as "...", and invisible soft hyphens and zero-width spaces are dropped. A
 * roller-door page's "$1,800–$2,300" quoted as "$1,800-$2,300" is the same figure (A7 repeat,
 * 24 September; Shaun approved the rule for every runtime). Words, digits, currency and every
 * other character must still match exactly.
 */
export function excerptAppearsIn(content, excerpt) {
  const text = String(content ?? "");
  const quote = String(excerpt ?? "");
  if (!quote.trim()) return false;
  if (text.includes(quote)) return true;
  return foldForQuote(text).includes(foldForQuote(quote));
}

function foldForQuote(value) {
  return value
    .replace(/[\u00AD\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, "-")
    .replace(/[\u2018\u2019\u201A\u201B\u2032\uFF07]/g, "'")
    .replace(/[\u201C-\u201F\u2033\uFF02]/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/\s+/g, " ")
    .trim();
}

export function renderPdfPreview(pdf, maxCharacters = 50_000) {
  const rendered = pdf.pages
    .map((page) => `[Physical page ${page.pageNumber}]\n${page.content}`)
    .join("\n\n");
  return { content: rendered.slice(0, maxCharacters), contentTruncated: rendered.length > maxCharacters };
}

export function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function normalizePageText(value) {
  return String(value).normalize("NFC").replace(/\r\n?/g, "\n").trim();
}
function incomplete(message, code = "source_incomplete") {
  const error = new Error(message);
  error.code = code;
  error.category = "source_incomplete";
  return error;
}

function safeBlockStatus(value) {
  const status = String(value).trim().toLowerCase();
  return /^[a-z0-9_.-]{1,40}$/.test(status) ? status : "unrecognized";
}
