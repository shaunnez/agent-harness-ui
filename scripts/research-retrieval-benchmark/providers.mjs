import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 180_000;
const MAX_SOURCE_BYTES = 25_000_000;
const MAX_CONTENT_CHARACTERS = 500_000;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replaceAll("\u0000", "")
    .replace(/[ \t]+/g, " ")
    .replace(/\r?\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_CONTENT_CHARACTERS);
}

function htmlToText(html) {
  return normalizeText(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, "\n")
      .replaceAll("&nbsp;", " ")
      .replaceAll("&amp;", "&")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&quot;", '"')
      .replaceAll("&#39;", "'"),
  );
}

async function fetchWithTiming({ fetchImpl, url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const startedAt = performance.now();
  let response;
  try {
    response = await fetchImpl(url, {
      ...options,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new Error(`Request failed: ${error?.message ?? String(error)}`, { cause: error });
  }
  const durationMs = Math.round(performance.now() - startedAt);
  const body = await response.arrayBuffer();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${Buffer.from(body).toString("utf8", 0, 500)}`);
  }
  if (body.byteLength > MAX_SOURCE_BYTES) {
    throw new Error(`Response exceeded the ${MAX_SOURCE_BYTES}-byte benchmark limit.`);
  }
  return { response, body: Buffer.from(body), durationMs };
}

async function postJson({ fetchImpl, endpoint, headers, body, timeoutMs }) {
  const response = await fetchWithTiming({
    fetchImpl,
    url: endpoint,
    timeoutMs,
    options: {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    },
  });
  try {
    return { ...response, payload: JSON.parse(response.body.toString("utf8")) };
  } catch (error) {
    throw new Error("Provider returned invalid JSON.", { cause: error });
  }
}

function result({ provider, content, pages = [], metadata, request }) {
  const normalizedContent = normalizeText(content);
  const normalizedPages = pages.map((page) => ({
    pageNumber: Number(page.pageNumber),
    content: normalizeText(page.content),
  }));
  return {
    provider,
    request,
    content: normalizedContent,
    pages: normalizedPages,
    contentSha256: sha256(normalizedContent),
    metadata: {
      ...metadata,
      characterCount: normalizedContent.length,
      extractedSnapshotRetained: true,
      originalSourceBytesRetained: false,
    },
  };
}

export class LocalRetrievalProvider {
  constructor({
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    pdfInfo = "pdfinfo",
    pdfToText = "pdftotext",
  } = {}) {
    this.name = "local";
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.pdfInfo = pdfInfo;
    this.pdfToText = pdfToText;
  }

  async retrieve(testCase) {
    const fetched = await fetchWithTiming({
      fetchImpl: this.fetchImpl,
      url: testCase.url,
      timeoutMs: this.timeoutMs,
    });
    const sourceSha256 = sha256(fetched.body);
    const mediaType = fetched.response.headers.get("content-type")?.split(";")[0]?.toLowerCase() ?? "";
    if (testCase.kind === "html") {
      return result({
        provider: this.name,
        request: { url: testCase.url, kind: testCase.kind },
        content: htmlToText(fetched.body.toString("utf8")),
        metadata: {
          durationMs: fetched.durationMs,
          httpStatus: fetched.response.status,
          mediaType,
          finalUrl: fetched.response.url || testCase.url,
          sourceBytes: fetched.body.length,
          sourceSha256,
          estimatedCostUsd: 0,
        },
      });
    }

    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "research-retrieval-"));
    const pdfPath = path.join(temporaryDirectory, "source.pdf");
    try {
      await writeFile(pdfPath, fetched.body, { mode: 0o600 });
      const [{ stdout: info }, { stdout: text }] = await Promise.all([
        execFileAsync(this.pdfInfo, [pdfPath], { timeout: this.timeoutMs, maxBuffer: 2_000_000 }),
        execFileAsync(this.pdfToText, ["-f", "1", "-l", String(testCase.maxPages), "-layout", pdfPath, "-"], {
          timeout: this.timeoutMs,
          maxBuffer: 10_000_000,
        }),
      ]);
      const totalPages = Number(info.match(/^Pages:\s+(\d+)/m)?.[1] ?? 0) || null;
      const pageContents = text.split("\f").filter((page) => page.trim());
      const pages = pageContents.map((page, index) => ({ pageNumber: index + 1, content: page }));
      return result({
        provider: this.name,
        request: { url: testCase.url, kind: testCase.kind, maxPages: testCase.maxPages },
        content: pages.map((page) => `<!-- page ${page.pageNumber} -->\n${page.content}`).join("\n\n"),
        pages,
        metadata: {
          durationMs: fetched.durationMs,
          httpStatus: fetched.response.status,
          mediaType,
          finalUrl: fetched.response.url || testCase.url,
          sourceBytes: fetched.body.length,
          sourceSha256,
          parsedPages: pages.length,
          totalPages,
          estimatedCostUsd: 0,
        },
      });
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }
}

export class FirecrawlRetrievalProvider {
  constructor({
    apiKey,
    endpoint = "https://api.firecrawl.dev/v2/scrape",
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  }) {
    if (!apiKey) throw new Error("Firecrawl retrieval benchmark requires FIRECRAWL_API_KEY.");
    this.name = "firecrawl";
    this.apiKey = apiKey;
    this.endpoint = endpoint;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async retrieve(testCase) {
    const request = {
      url: testCase.url,
      formats: ["markdown"],
      onlyMainContent: true,
      timeout: Math.min(this.timeoutMs, 300_000),
      ...(testCase.kind === "pdf"
        ? {
            parsers: [
              {
                type: "pdf",
                mode: "auto",
                maxPages: testCase.maxPages,
                pages: true,
                blocks: true,
                pageMarkers: true,
              },
            ],
          }
        : {}),
    };
    const response = await postJson({
      fetchImpl: this.fetchImpl,
      endpoint: this.endpoint,
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: request,
      timeoutMs: this.timeoutMs,
    });
    if (response.payload.success === false) {
      throw new Error(response.payload.error ?? "Firecrawl reported an unsuccessful scrape.");
    }
    const data = response.payload.data ?? response.payload;
    const pages = (data.pages ?? []).map((page) => ({
      pageNumber: page.pageNumber,
      content: page.markdown ?? page.content ?? "",
    }));
    const parsedPages = Number(data.metadata?.numPages ?? pages.length) || null;
    const estimatedCredits = testCase.kind === "pdf" ? 1 + (parsedPages ?? testCase.maxPages) : 1;
    const sourceLooksLikePdf = (data.metadata?.sourceURL ?? "").toLowerCase().includes(".pdf");
    return result({
      provider: this.name,
      request,
      content: data.markdown ?? "",
      pages,
      metadata: {
        durationMs: response.durationMs,
        httpStatus: response.response.status,
        mediaType: data.metadata?.contentType ?? (sourceLooksLikePdf ? "application/pdf" : null),
        finalUrl: data.metadata?.sourceURL ?? data.metadata?.url ?? testCase.url,
        parsedPages,
        totalPages: Number(data.metadata?.totalPages ?? 0) || null,
        layoutBlockPages: Array.isArray(data.blocks) ? data.blocks.length : 0,
        estimatedCredits,
        estimatedCostUsdAtHobbyTopUpRate: estimatedCredits * 0.005,
      },
    });
  }
}

export class ExaRetrievalProvider {
  constructor({
    apiKey,
    endpoint = "https://api.exa.ai/contents",
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  }) {
    if (!apiKey) throw new Error("Exa retrieval benchmark requires EXA_API_KEY.");
    this.name = "exa";
    this.apiKey = apiKey;
    this.endpoint = endpoint;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async retrieve(testCase) {
    const request = { urls: [testCase.url], text: true, maxAgeHours: 24 };
    const response = await postJson({
      fetchImpl: this.fetchImpl,
      endpoint: this.endpoint,
      headers: { "x-api-key": this.apiKey },
      body: request,
      timeoutMs: this.timeoutMs,
    });
    const data = response.payload.results?.[0];
    const status = response.payload.statuses?.[0];
    if (!data?.text) {
      throw new Error(status?.error?.message ?? status?.status ?? "Exa returned no extracted text.");
    }
    return result({
      provider: this.name,
      request,
      content: data.text,
      metadata: {
        durationMs: response.durationMs,
        httpStatus: response.response.status,
        finalUrl: data.url ?? testCase.url,
        title: data.title ?? null,
        publishedDate: data.publishedDate ?? null,
        estimatedCostUsd: 0.001,
        physicalPageAttributionAvailable: false,
      },
    });
  }
}

export function resolveRetrievalProviders(env = process.env, options = {}) {
  const providers = new Map([["local", new LocalRetrievalProvider(options)]]);
  const skipped = [];
  if (env.FIRECRAWL_API_KEY) {
    providers.set(
      "firecrawl",
      new FirecrawlRetrievalProvider({
        ...options,
        apiKey: env.FIRECRAWL_API_KEY,
        endpoint: env.FIRECRAWL_SCRAPE_BASE_URL,
      }),
    );
  } else {
    skipped.push({ provider: "firecrawl", reason: "FIRECRAWL_API_KEY is not configured" });
  }
  if (env.EXA_API_KEY) {
    providers.set(
      "exa",
      new ExaRetrievalProvider({
        ...options,
        apiKey: env.EXA_API_KEY,
        endpoint: env.EXA_CONTENTS_BASE_URL,
      }),
    );
  } else {
    skipped.push({ provider: "exa", reason: "EXA_API_KEY is not configured" });
  }
  return { providers, skipped };
}
