// Read a PDF's physical pages on this machine, with poppler's `pdftotext`.
//
// Until this existed, a PDF could only be read through Firecrawl, a paid service, so a run on
// local capture was handed `unsupported_media_type` for every PDF — including the network
// operators' pricing schedules, which are exactly where connection charges are published. In
// a live run the agent then tried to download the PDF with curl, and only the permission gate
// stopped it.
//
// `-layout` keeps a table's columns on one line, which is what makes a rate readable next to
// its description. Pages are split on the form feed `pdftotext` writes between them, so page N
// here is physical page N of the file, which is what a PDF citation's locator must name.

import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { normalizePdfCapture } from "./research-source-snapshots.mjs";
import { ResearchToolError } from "./research-tool-errors.mjs";

/** What a page with no extractable text says, so it is classified rather than silently empty —
 *  usually a scanned or image-only page, which this extractor cannot read. */
export const NO_TEXT_ON_PAGE = "[No extractable text on this physical page.]";

export async function extractPdfPages(
  bytes,
  { maxPages = 30, pdftotext = "pdftotext", pdfinfo = "pdfinfo", signal = null, timeoutMs = 30_000 } = {},
) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "research-pdf-"));
  const file = path.join(directory, "source.pdf");
  try {
    await writeFile(file, bytes, { mode: 0o600 });
    const info = await run(pdfinfo, [file], { signal, timeoutMs });
    const totalPages = Number(info.match(/^Pages:\s+(\d+)/m)?.[1]);
    if (!Number.isInteger(totalPages) || totalPages < 1)
      throw new ResearchToolError("source_incomplete", "The PDF reported no physical pages.");
    const lastPage = Math.min(totalPages, maxPages);
    const text = await run(
      pdftotext,
      ["-layout", "-enc", "UTF-8", "-f", "1", "-l", String(lastPage), file, "-"],
      {
        signal,
        timeoutMs,
      },
    );
    // One form feed after each page, so the last split is empty rather than a page.
    const pages = text.split("\f").slice(0, lastPage);
    while (pages.length < lastPage) pages.push("");
    return normalizePdfCapture({
      pages: pages.map((content, index) => ({
        pageNumber: index + 1,
        content: content.trim() || NO_TEXT_ON_PAGE,
      })),
      numPages: lastPage,
      totalPages,
      pageCap: maxPages,
    });
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

function run(command, args, { signal, timeoutMs }) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], signal: signal ?? undefined });
    } catch (error) {
      reject(unavailable(command, error));
      return;
    }
    const chunks = [];
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.resume();
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(unavailable(command, error));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(chunks).toString("utf8"));
      else
        reject(
          new ResearchToolError("source_incomplete", `${path.basename(command)} could not read this PDF.`),
        );
    });
  });
}

function unavailable(command, error) {
  if (error?.name === "AbortError")
    return new ResearchToolError("research_cancelled", "The research run was cancelled.");
  return new ResearchToolError(
    "unsupported_media_type",
    `PDFs cannot be read on this machine: ${path.basename(command)} is not available (install poppler).`,
  );
}
