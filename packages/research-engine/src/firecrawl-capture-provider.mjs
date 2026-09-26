import { postProviderJson } from "./research-provider-http.mjs";
import { providerFailure } from "./research-provider-errors.mjs";
import { normalizePdfCapture } from "./research-source-snapshots.mjs";
import { validatePublicSourceUrl } from "./research-source-policy.mjs";

const ENDPOINT = "https://api.firecrawl.dev/v2/scrape";
const ALLOWED_TYPES = new Set(["text/html", "application/xhtml+xml", "text/plain", "application/pdf"]);

export class FirecrawlCaptureProvider {
  constructor({
    apiKey,
    ledger,
    fetchImpl = globalThis.fetch,
    lookup,
    timeoutMs = 120_000,
    endpoint = ENDPOINT,
    maxResponseBytes = 8_388_608,
    maxRetainedCharacters = 2_000_000,
  }) {
    if (!apiKey) throw new Error("Firecrawl capture requires FIRECRAWL_API_KEY.");
    if (!ledger) throw new Error("Firecrawl capture requires a per-run credit ledger.");
    Object.assign(this, {
      apiKey,
      ledger,
      fetchImpl,
      lookup,
      timeoutMs,
      endpoint,
      maxResponseBytes,
      maxRetainedCharacters,
    });
  }

  async capture(url, { maxPdfPages, signal, remainingMs } = {}) {
    await validatePublicSourceUrl(url, { lookup: this.lookup, signal });
    const reservationId = this.ledger.reserve("capture", 1 + maxPdfPages);
    const effectiveTimeoutMs = boundedTimeout(this.timeoutMs, remainingMs);
    const request = {
      url,
      formats: ["markdown"],
      onlyMainContent: true,
      maxAge: 0,
      storeInCache: false,
      timeout: effectiveTimeoutMs,
      parsers: [
        { type: "pdf", mode: "ocr", maxPages: maxPdfPages, pages: true, pageMarkers: true, blocks: true },
      ],
    };
    const { payload, attempt } = await postProviderJson({
      provider: "firecrawl",
      operation: "capture",
      endpoint: this.endpoint,
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: request,
      fetchImpl: this.fetchImpl,
      timeoutMs: effectiveTimeoutMs,
      maxBytes: this.maxResponseBytes,
      signal,
      ledger: this.ledger,
      reservationId,
    });
    if (payload.success === false)
      throw providerFailure({
        provider: "firecrawl",
        operation: "capture",
        category: "invalid_response",
        attempt,
      });
    const data = payload.data;
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw providerFailure({
        provider: "firecrawl",
        operation: "capture",
        category: "invalid_response",
        attempt,
      });
    const metadata = data.metadata ?? {};
    const targetStatus = Number(metadata.statusCode ?? metadata.status);
    if (Number.isInteger(targetStatus) && targetStatus >= 400)
      throw providerFailure({
        provider: "firecrawl",
        operation: "capture",
        category: "source_http_error",
        status: targetStatus,
        attempt,
      });
    const finalUrl = String(metadata.sourceURL ?? metadata.url ?? url);
    await validatePublicSourceUrl(finalUrl, { lookup: this.lookup, signal });
    const mediaType = String(metadata.contentType ?? metadata.content_type ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    const pages = Array.isArray(data.pages)
      ? data.pages.map((page) => ({
          pageNumber: page.pageNumber,
          content: page.markdown ?? page.content ?? "",
        }))
      : [];
    const isPdf = mediaType === "application/pdf" || (pages.length > 0 && metadata.numPages != null);
    if (!isPdf && !ALLOWED_TYPES.has(mediaType))
      throw providerFailure({
        provider: "firecrawl",
        operation: "capture",
        category: "unsupported_media_type",
        attempt,
      });
    if (metadata.cacheHit === true || metadata.cacheState === "hit")
      throw providerFailure({
        provider: "firecrawl",
        operation: "capture",
        category: "invalid_response",
        attempt,
      });
    let validatedPdf = null;
    let content = "";
    if (isPdf) {
      validatedPdf = normalizePdfCapture({
        pages,
        numPages: Number(metadata.numPages),
        totalPages: metadata.totalPages == null ? null : Number(metadata.totalPages),
        pageCap: maxPdfPages,
        blocks: data.blocks,
      });
      if (JSON.stringify(validatedPdf.pages).length > this.maxRetainedCharacters)
        throw providerFailure({
          provider: "firecrawl",
          operation: "capture",
          category: "invalid_response",
          attempt,
        });
    } else {
      content = normalizeText(data.markdown ?? "");
      if (!content || content.length > this.maxRetainedCharacters)
        throw providerFailure({
          provider: "firecrawl",
          operation: "capture",
          category: "invalid_response",
          attempt,
        });
    }
    return {
      mediaType: isPdf ? "application/pdf" : mediaType,
      content,
      pages: validatedPdf?.pages ?? [],
      metadata: {
        provider: "firecrawl",
        requestedUrl: url,
        finalUrl,
        title: bounded(metadata.title, 500) || finalUrl,
        upstreamContentType: mediaType || null,
        attempts: [attempt],
        receiptTime: new Date().toISOString(),
        upstreamCaptureTime: metadata.createdAt ?? metadata.scrapeIdCreatedAt ?? null,
        cacheState:
          metadata.cacheHit == null && metadata.cacheState == null
            ? "unknown"
            : String(metadata.cacheState ?? metadata.cacheHit),
        normalizationVersion: 1,
        parserMode: "ocr",
        pageCap: maxPdfPages,
        providerReportedPages: metadata.numPages == null ? null : Number(metadata.numPages),
        providerReportedTotalPages: metadata.totalPages == null ? null : Number(metadata.totalPages),
        verifiedPages: validatedPdf?.parsedPages ?? null,
        coverage: validatedPdf?.coverage ?? null,
        capTruncated: validatedPdf?.capTruncated ?? null,
        blockCoverage: validatedPdf?.blockCoverage ?? "unknown",
      },
      validatedPdf,
    };
  }
}

function boundedTimeout(configured, remaining) {
  return Number.isFinite(remaining) ? Math.max(1, Math.min(configured, remaining)) : configured;
}

function normalizeText(value) {
  return String(value).normalize("NFC").replace(/\r\n?/g, "\n").trim();
}
function bounded(value, limit) {
  return String(value ?? "").slice(0, limit);
}
