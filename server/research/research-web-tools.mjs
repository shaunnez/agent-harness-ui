import { createHash } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

export const DEFAULT_RESEARCH_SOURCE_DIRECTORY = path.resolve(".data", "research-sources");
export const DEFAULT_SOURCE_BYTE_LIMIT = 1_000_000;
export const DEFAULT_SOURCE_TIMEOUT_MS = 15_000;
const MAX_MODEL_CONTENT_CHARS = 50_000;
const MAX_REDIRECTS = 5;

export class ResearchToolError extends Error {
  constructor(code, message, { ceiling } = {}) {
    super(message);
    this.name = "ResearchToolError";
    this.code = code;
    this.ceiling = ceiling ?? null;
  }
}

export class ResearchWebTools {
  #runId;
  #budget;
  #context;
  #searchProvider;
  #snapshotDirectory;
  #fetch;
  #lookup;
  #now;
  #onEvent;
  #allowPrivateNetwork;
  #maxResponseBytes;
  #timeoutMs;
  #sources = new Map();
  #findings = [];
  #toolCallsUsed = 0;
  #searchCallsUsed = 0;
  #startedAtMs;
  #searchMetadata = [];
  #signal;

  constructor({
    runId,
    budget,
    context = [],
    searchProvider,
    snapshotDirectory = DEFAULT_RESEARCH_SOURCE_DIRECTORY,
    fetchImpl = globalThis.fetch,
    lookup = dnsLookup,
    now = () => new Date(),
    onEvent = () => {},
    allowPrivateNetwork = false,
    maxResponseBytes = DEFAULT_SOURCE_BYTE_LIMIT,
    timeoutMs = DEFAULT_SOURCE_TIMEOUT_MS,
    signal = null,
  }) {
    if (!searchProvider?.search) throw new Error("Research web tools require a search provider.");
    this.#runId = runId;
    this.#budget = budget;
    this.#context = context;
    this.#searchProvider = searchProvider;
    this.#snapshotDirectory = snapshotDirectory;
    this.#fetch = fetchImpl;
    this.#lookup = lookup;
    this.#now = now;
    this.#onEvent = onEvent;
    this.#allowPrivateNetwork = allowPrivateNetwork;
    this.#maxResponseBytes = maxResponseBytes;
    this.#timeoutMs = timeoutMs;
    this.#signal = signal;
    this.#startedAtMs = Date.now();
  }

  async invoke(toolName, input) {
    if (this.#signal?.aborted)
      throw new ResearchToolError("research_cancelled", "The research run was cancelled.");
    this.#reserveToolCall(toolName);
    this.#onEvent("tool.called", { tool: toolName });
    switch (toolName) {
      case "read_context":
        return this.#response(this.#context);
      case "web_search":
        return this.#response(await this.#webSearch(input));
      case "fetch_source":
        return this.#response(await this.#fetchSource(input));
      case "submit_finding":
        return this.#response(this.#submitFinding(input));
      default:
        throw new ResearchToolError("unknown_research_tool", `Unknown research tool "${toolName}".`);
    }
  }

  budgetState() {
    return {
      modelCallsUsed: 0,
      toolCallsUsed: this.#toolCallsUsed,
      searchCallsUsed: this.#searchCallsUsed,
      researchersStarted: this.#findings.length ? 1 : 0,
      elapsedMs: Date.now() - this.#startedAtMs,
    };
  }

  searchMetadata() {
    return [...this.#searchMetadata];
  }

  #response(result) {
    return { result, budgetState: this.budgetState() };
  }

  #reserveToolCall(toolName) {
    if (this.#toolCallsUsed >= this.#budget.maxToolCalls) {
      throw new ResearchToolError(
        "tool_call_ceiling_exceeded",
        `The aggregate research tool-call ceiling (${this.#budget.maxToolCalls}) was reached.`,
        { ceiling: "maxToolCalls" },
      );
    }
    if (toolName === "web_search" && this.#searchCallsUsed >= this.#budget.maxSearchCalls) {
      throw new ResearchToolError(
        "search_call_ceiling_exceeded",
        `The research search-call ceiling (${this.#budget.maxSearchCalls}) was reached.`,
        { ceiling: "maxSearchCalls" },
      );
    }
    this.#toolCallsUsed += 1;
    if (toolName === "web_search") this.#searchCallsUsed += 1;
  }

  async #webSearch(input) {
    const query = requiredString(input?.query, "Search query", 500);
    let response;
    try {
      response = await this.#searchProvider.search(query, { maxResults: 5, signal: this.#signal });
    } catch (error) {
      throw new ResearchToolError("search_failed", `Web search failed: ${error?.message ?? String(error)}`);
    }
    const results = (response?.results ?? [])
      .filter((result) => isHttpUrl(result.url))
      .map((result) => ({
        title: String(result.title ?? "Untitled result").slice(0, 500),
        url: String(result.url),
        snippet: String(result.snippet ?? "").slice(0, 2_000),
        ...(result.publishedAt ? { publishedAt: String(result.publishedAt) } : {}),
      }));
    const metadata = response?.metadata ?? {};
    this.#searchMetadata.push(metadata);
    this.#onEvent("log", { message: "Web search completed.", search: metadata });
    return { query, results };
  }

  async #fetchSource(input) {
    const requestedUrl = requiredString(input?.url, "Source URL", 4_000);
    const response = await fetchValidatedSource(requestedUrl, {
      fetchImpl: this.#fetch,
      lookup: this.#lookup,
      allowPrivateNetwork: this.#allowPrivateNetwork,
      maxResponseBytes: this.#maxResponseBytes,
      timeoutMs: this.#timeoutMs,
      signal: this.#signal,
    });
    const normalized = normalizeSourceContent(response.body, response.mediaType);
    if (!normalized.content)
      throw new ResearchToolError("source_empty", "The fetched source had no usable text.");
    const digest = sha256(normalized.content);
    await mkdir(this.#snapshotDirectory, { recursive: true });
    const snapshotPath = path.join(this.#snapshotDirectory, `${digest}.txt`);
    await writeImmutable(snapshotPath, normalized.content);
    const sourceId = `source-${this.#sources.size + 1}`;
    const retrievedAt = this.#now().toISOString();
    const snapshotRef = `sha256:${digest}`;
    const source = {
      id: sourceId,
      sourceType: "web",
      url: response.url,
      title: normalized.title ?? response.url,
      retrievedAt,
      contentSha256: digest,
      contentBytes: Buffer.byteLength(normalized.content),
      mediaType: response.mediaType,
      metadata: { snapshotRef },
    };
    this.#sources.set(sourceId, { source, content: normalized.content, snapshotRef });
    this.#onEvent("source.retrieved", { source });
    return {
      source: { ...source, snapshotRef },
      content: normalized.content.slice(0, MAX_MODEL_CONTENT_CHARS),
      contentTruncated: normalized.content.length > MAX_MODEL_CONTENT_CHARS,
    };
  }

  #submitFinding(input) {
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new ResearchToolError("invalid_finding", "A finding must be an object.");
    if (containsQuoteVerified(input))
      throw new ResearchToolError(
        "host_verification_required",
        "The model must not provide quoteVerified; verification is owned by the host.",
      );
    const evidenceInput = Array.isArray(input.evidence) ? input.evidence : [];
    if (evidenceInput.length === 0)
      throw new ResearchToolError(
        "evidence_required",
        "A finding requires at least one retained source excerpt.",
      );
    if (evidenceInput.length > 10)
      throw new ResearchToolError("too_much_evidence", "A finding may cite at most 10 excerpts.");
    const evidence = evidenceInput.map((reference) => {
      const sourceId = requiredString(reference?.sourceId, "Evidence source id", 200);
      const retained = this.#sources.get(sourceId);
      if (!retained)
        throw new ResearchToolError(
          "source_not_in_run",
          `Source ${sourceId} does not belong to research run ${this.#runId}.`,
        );
      const excerpt = requiredString(reference?.excerpt, "Evidence excerpt", 2_000);
      if (!retained.content.includes(excerpt))
        throw new ResearchToolError(
          "excerpt_not_found",
          `The submitted excerpt is not an exact substring of retained source ${sourceId}.`,
        );
      return {
        sourceId,
        sourceType: retained.source.sourceType,
        url: retained.source.url,
        title: retained.source.title,
        retrievedAt: retained.source.retrievedAt,
        ...(reference.locator ? { locator: reference.locator } : {}),
        excerpt,
        snapshotRef: retained.snapshotRef,
        quoteVerified: true,
        authority: normalizeAuthority(reference.authority),
      };
    });
    const finding = {
      id: `${this.#runId}-F${this.#findings.length + 1}`,
      claim: requiredString(input.claim, "Finding claim", 2_000),
      producedBy: "researcher",
      evidence,
      ...(input.confidence == null ? {} : { confidence: boundedConfidence(input.confidence) }),
      ...(Array.isArray(input.assumptions) && input.assumptions.length
        ? {
            assumptions: input.assumptions
              .slice(0, 10)
              .map((item) => requiredString(item, "Assumption", 500)),
          }
        : {}),
    };
    this.#findings.push(finding);
    this.#onEvent("finding.created", { findingId: finding.id });
    return finding;
  }
}

export async function verifySnapshotEvidence({
  source,
  reference,
  snapshotDirectory = DEFAULT_RESEARCH_SOURCE_DIRECTORY,
}) {
  if (!source || !reference?.excerpt || !reference?.snapshotRef || !source.contentSha256) return false;
  if (reference.snapshotRef !== `sha256:${source.contentSha256}`) return false;
  if (!/^[a-f0-9]{64}$/.test(source.contentSha256)) return false;
  try {
    const content = await readFile(path.join(snapshotDirectory, `${source.contentSha256}.txt`), "utf8");
    return sha256(content) === source.contentSha256 && content.includes(reference.excerpt);
  } catch {
    return false;
  }
}

export async function fetchValidatedSource(
  requestedUrl,
  {
    fetchImpl = globalThis.fetch,
    lookup = dnsLookup,
    allowPrivateNetwork = false,
    maxResponseBytes = DEFAULT_SOURCE_BYTE_LIMIT,
    timeoutMs = DEFAULT_SOURCE_TIMEOUT_MS,
    signal: callerSignal = null,
  } = {},
) {
  let current = new URL(requestedUrl);
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    await assertPublicHttpUrl(current, { lookup, allowPrivateNetwork });
    let response;
    try {
      response = await fetchImpl(current, {
        redirect: "manual",
        signal,
        headers: { "User-Agent": "EversorResearch/1.0 (+source-retention)" },
      });
    } catch (error) {
      if (callerSignal?.aborted)
        throw new ResearchToolError("research_cancelled", "The research run was cancelled.");
      if (timeoutSignal.aborted || error?.name === "AbortError" || error?.name === "TimeoutError")
        throw new ResearchToolError("source_timeout", `Source fetch exceeded ${timeoutMs}ms.`);
      throw new ResearchToolError("source_fetch_failed", `Source fetch failed: ${error?.message ?? error}`);
    }
    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
      if (redirects === MAX_REDIRECTS)
        throw new ResearchToolError("too_many_redirects", "Source fetch exceeded the redirect limit.");
      current = new URL(response.headers.get("location"), current);
      continue;
    }
    if (!response.ok)
      throw new ResearchToolError("source_http_error", `Source fetch returned HTTP ${response.status}.`);
    const mediaType = (response.headers.get("content-type") ?? "text/plain")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (!isSupportedMediaType(mediaType))
      throw new ResearchToolError("unsupported_media_type", `Unsupported source media type "${mediaType}".`);
    const declaredBytes = Number(response.headers.get("content-length") ?? 0);
    if (declaredBytes > maxResponseBytes)
      throw new ResearchToolError(
        "source_too_large",
        `Source declares ${declaredBytes} bytes, above the ${maxResponseBytes}-byte limit.`,
      );
    const body = await readBoundedBody(response, maxResponseBytes);
    return { url: current.toString(), mediaType, body };
  }
  throw new ResearchToolError("too_many_redirects", "Source fetch exceeded the redirect limit.");
}

async function assertPublicHttpUrl(url, { lookup, allowPrivateNetwork }) {
  if (!isHttpUrl(url.toString()))
    throw new ResearchToolError("unsupported_url_scheme", "Only HTTP and HTTPS source URLs are allowed.");
  if (url.username || url.password)
    throw new ResearchToolError("url_credentials_blocked", "Source URLs must not contain credentials.");
  if (allowPrivateNetwork) return;
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local"))
    throw new ResearchToolError(
      "private_network_url",
      "Loopback and private-network source URLs are blocked.",
    );
  const directFamily = net.isIP(hostname);
  let addresses;
  try {
    addresses = directFamily
      ? [{ address: hostname, family: directFamily }]
      : await lookup(hostname, { all: true });
  } catch (error) {
    throw new ResearchToolError(
      "source_resolution_failed",
      `Could not resolve source hostname ${hostname}: ${error?.message ?? error}`,
    );
  }
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address)))
    throw new ResearchToolError(
      "private_network_url",
      "Loopback and private-network source URLs are blocked.",
    );
}

function isPrivateAddress(address) {
  const normalized = String(address).toLowerCase();
  if (normalized === "::" || normalized === "::1") return true;
  if (
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8")
  )
    return true;
  if (normalized.startsWith("::ffff:")) return isPrivateAddress(normalized.slice(7));
  if (net.isIP(normalized) !== 4) return false;
  const [a, b] = normalized.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

async function readBoundedBody(response, maxResponseBytes) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxResponseBytes) {
      await reader.cancel().catch(() => undefined);
      throw new ResearchToolError(
        "source_too_large",
        `Source exceeded the ${maxResponseBytes}-byte response limit.`,
      );
    }
    chunks.push(value);
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
}

function normalizeSourceContent(body, mediaType) {
  if (mediaType === "text/html" || mediaType === "application/xhtml+xml") {
    const titleMatch = body.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? normalizeWhitespace(decodeHtml(stripTags(titleMatch[1]))) : null;
    const withoutNoise = body
      .replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<(br|\/p|\/div|\/li|\/section|\/article|\/h[1-6]|\/tr)>/gi, "\n");
    return { title, content: normalizeWhitespace(decodeHtml(stripTags(withoutNoise))) };
  }
  return { title: null, content: normalizeWhitespace(body) };
}

function stripTags(value) {
  return value.replace(/<[^>]+>/g, " ");
}

function decodeHtml(value) {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === "#") {
      const hex = entity[1]?.toLowerCase() === "x";
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return named[entity.toLowerCase()] ?? match;
  });
}

function normalizeWhitespace(value) {
  return String(value)
    .normalize("NFC")
    .replace(/\r/g, "")
    .replace(/[\t ]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

async function writeImmutable(filePath, content) {
  try {
    await writeFile(filePath, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = await readFile(filePath, "utf8");
    if (existing !== content) throw new Error(`Content-addressed snapshot collision at ${filePath}.`);
  }
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isSupportedMediaType(mediaType) {
  return mediaType === "text/html" || mediaType === "text/plain" || mediaType === "application/xhtml+xml";
}

function requiredString(value, label, maxLength) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new ResearchToolError("invalid_tool_input", `${label} is required.`);
  if (normalized.length > maxLength)
    throw new ResearchToolError("invalid_tool_input", `${label} must be ${maxLength} characters or fewer.`);
  return normalized;
}

function boundedConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1)
    throw new ResearchToolError("invalid_tool_input", "Finding confidence must be between 0 and 1.");
  return number;
}

function normalizeAuthority(value) {
  return value === "primary" || value === "secondary" ? value : "unknown";
}

function containsQuoteVerified(value) {
  if (!value || typeof value !== "object") return false;
  if (Object.hasOwn(value, "quoteVerified")) return true;
  return Object.values(value).some((item) =>
    Array.isArray(item) ? item.some(containsQuoteVerified) : containsQuoteVerified(item),
  );
}
