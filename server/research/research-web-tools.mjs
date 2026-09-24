import path from "node:path";
import { validateMarket } from "./research-provider-contracts.mjs";
import { locatePassage } from "./research-quote-figures.mjs";
import {
  DEFAULT_SOURCE_BYTE_LIMIT,
  DEFAULT_SOURCE_TIMEOUT_MS,
  fetchValidatedSource,
} from "./research-source-fetch.mjs";
import { normalizeRequestedUrl, validatePublicSourceUrl } from "./research-source-policy.mjs";
import {
  excerptAppearsIn,
  PDF_SNAPSHOT_FORMAT,
  readVerifiedSnapshot,
  renderPdfPreview,
  serializePdfSnapshot,
  verifySnapshotEvidence,
  writeResearchSnapshot,
} from "./research-source-snapshots.mjs";
import { ResearchToolError } from "./research-tool-errors.mjs";
import {
  assertStrictObject,
  asToolError,
  boundedConfidence,
  containsQuoteVerified,
  normalizeAuthority,
  normalizeSourceContent,
  optionalInteger,
  requiredString,
} from "./research-tool-validation.mjs";

export { ResearchToolError } from "./research-tool-errors.mjs";
export { DEFAULT_SOURCE_BYTE_LIMIT, DEFAULT_SOURCE_TIMEOUT_MS, fetchValidatedSource, verifySnapshotEvidence };
export const DEFAULT_RESEARCH_SOURCE_DIRECTORY = path.resolve(".data", "research-sources");
const MAX_MODEL_CONTENT_CHARS = 50_000;

/** What one web_search hands the model. Raised from 5 and 2,000 for the API loop's Parallel search,
 *  whose excerpts carry the price lines a result is worth (24 September). Only runtimes that use the
 *  host's web_search see it; the CLIs search with their own tools. */
const MAX_SEARCH_RESULTS = 8;
const MAX_SNIPPET_CHARACTERS = 3_000;

export class ResearchWebTools {
  #runId;
  #budget;
  #context;
  #searchProvider;
  #captureProvider;
  #providerConfig;
  #snapshotDirectory;
  #fetch;
  #lookup;
  #now;
  #onEvent;
  #allowPrivateNetwork;
  #maxResponseBytes;
  #timeoutMs;
  #sources = new Map();
  #captures = new Map();
  #maxUniqueCaptures;
  #uniqueCaptures = 0;
  #findings = [];
  #toolCallsUsed = 0;
  #searchCallsUsed = 0;
  #sourceSequence = 0;
  #startedAtMs;
  #searchMetadata = [];
  #signal;
  #deadlineController = null;
  #deadlineTimer = null;
  #deadlineAtMs = null;
  #ledgers;
  #closed = false;
  #pdfExtractor;

  constructor({
    runId,
    budget,
    context = [],
    searchProvider = null,
    captureProvider = null,
    providerConfig = { defaultMarket: "NZ", maxPdfPages: 30 },
    providerLedgers = [],
    snapshotDirectory = DEFAULT_RESEARCH_SOURCE_DIRECTORY,
    fetchImpl = undefined,
    lookup,
    now = () => new Date(),
    onEvent = () => {},
    allowPrivateNetwork = false,
    maxResponseBytes = DEFAULT_SOURCE_BYTE_LIMIT,
    timeoutMs = DEFAULT_SOURCE_TIMEOUT_MS,
    signal = null,
    // A parent-side ceiling on distinct captured URLs. `ResearchBudget` deliberately has no
    // vocabulary for it: how many pages a provider charges for is a host concern, not a
    // neutral research contract concern, so a caller that needs the ceiling passes it here.
    // Null keeps the existing unlimited behaviour for every caller that does not.
    maxUniqueCaptures = null,
    // Reads a PDF's physical pages locally (`research-pdf-text.mjs`). Absent, a PDF can only be
    // read through a capture provider, which is the behaviour every caller had before it.
    pdfExtractor = null,
  }) {
    // Optional: a runtime whose model has its own search (the Claude CLI's `WebSearch`) uses
    // these tools only to retain and verify, and passes none. `web_search` then fails as a tool
    // error the model can read rather than as a crash.
    if (searchProvider != null && !searchProvider.search)
      throw new Error("A research search provider must implement search().");
    if ((captureProvider || providerConfig.searchProvider === "firecrawl") && context.length)
      throw new Error(
        "Public Firecrawl research refuses non-empty document context; queries and URLs leave the machine.",
      );
    this.#runId = runId;
    this.#budget = budget;
    this.#context = context;
    this.#searchProvider = searchProvider ?? null;
    this.#captureProvider = captureProvider;
    this.#providerConfig = providerConfig;
    this.#snapshotDirectory = snapshotDirectory;
    this.#fetch = fetchImpl;
    this.#lookup = lookup;
    this.#now = now;
    this.#onEvent = onEvent;
    this.#allowPrivateNetwork = allowPrivateNetwork;
    this.#maxResponseBytes = maxResponseBytes;
    this.#timeoutMs = timeoutMs;
    if (Number.isFinite(budget.maxRuntimeMs) && budget.maxRuntimeMs > 0) {
      this.#deadlineController = new AbortController();
      this.#deadlineAtMs = Date.now() + budget.maxRuntimeMs;
      this.#deadlineTimer = setTimeout(
        () =>
          this.#deadlineController.abort(
            new DOMException("The research run deadline expired.", "TimeoutError"),
          ),
        budget.maxRuntimeMs,
      );
      this.#signal = signal
        ? AbortSignal.any([signal, this.#deadlineController.signal])
        : this.#deadlineController.signal;
    } else this.#signal = signal;
    if (maxUniqueCaptures != null && (!Number.isInteger(maxUniqueCaptures) || maxUniqueCaptures < 1))
      throw new Error("maxUniqueCaptures must be a positive integer when supplied.");
    this.#maxUniqueCaptures = maxUniqueCaptures;
    this.#ledgers = providerLedgers.filter(Boolean);
    this.#pdfExtractor = pdfExtractor;
    this.#startedAtMs = Date.now();
  }

  async invoke(toolName, input) {
    if (this.#deadlineController?.signal.aborted) throw this.#deadlineError();
    if (this.#closed || this.#signal?.aborted)
      throw new ResearchToolError("research_cancelled", "The research run was cancelled.");
    this.#reserveToolCall(toolName);
    this.#onEvent("tool.called", { tool: toolName });
    switch (toolName) {
      case "read_context":
        assertStrictObject(input, []);
        return this.#response(this.#context);
      case "web_search":
        return this.#response(await this.#webSearch(input));
      case "fetch_source":
        return this.#response(await this.#fetchSource(input));
      case "read_source":
        return this.#response(await this.#readSource(input));
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

  /** Distinct URLs this run has attempted to capture, successfully or not. */
  uniqueCaptureCount() {
    return this.#uniqueCaptures;
  }

  providerAccounting() {
    return this.#ledgers.map((ledger) => ledger.snapshot());
  }

  unresolvedCoverageWarnings() {
    const warnings = [];
    for (const retained of this.#sources.values()) {
      if (retained.pdf?.coverage === "capped")
        warnings.push(
          `Source ${retained.source.id} represents only the configured physical-page range; evidence beyond page ${retained.pdf.parsedPages} remains unresolved.`,
        );
      if (retained.pdf?.coverage === "unknown")
        warnings.push(
          `Source ${retained.source.id} has unknown total-page coverage; absence from retained pages is not proof of absence from the document.`,
        );
    }
    return warnings;
  }

  close() {
    if (this.#closed) return this.providerAccounting();
    this.#closed = true;
    if (this.#deadlineTimer) clearTimeout(this.#deadlineTimer);
    return this.#ledgers.map((ledger) => ledger.close());
  }

  #response(result) {
    return { result, budgetState: this.budgetState() };
  }

  #reserveToolCall(toolName) {
    if (this.#toolCallsUsed >= this.#budget.maxToolCalls)
      throw new ResearchToolError(
        "tool_call_ceiling_exceeded",
        `The aggregate research tool-call ceiling (${this.#budget.maxToolCalls}) was reached.`,
        { ceiling: "maxToolCalls" },
      );
    if (toolName === "web_search" && this.#searchCallsUsed >= this.#budget.maxSearchCalls)
      throw new ResearchToolError(
        "search_call_ceiling_exceeded",
        `The research search-call ceiling (${this.#budget.maxSearchCalls}) was reached.`,
        { ceiling: "maxSearchCalls" },
      );
    this.#toolCallsUsed += 1;
    if (toolName === "web_search") this.#searchCallsUsed += 1;
  }

  async #webSearch(input) {
    if (!this.#searchProvider)
      throw new ResearchToolError(
        "search_unavailable",
        "This run has no host search provider. Use the search tool your runtime provides.",
      );
    assertStrictObject(input, ["query", "market"]);
    const query = requiredString(input.query, "Search query", 500);
    let market;
    try {
      market = validateMarket(input.market, this.#providerConfig.defaultMarket);
    } catch (error) {
      throw new ResearchToolError("invalid_tool_input", error.message);
    }
    let response;
    try {
      response = await this.#searchProvider.search(query, {
        market,
        maxResults: MAX_SEARCH_RESULTS,
        signal: this.#signal,
        remainingMs: this.#remainingMs(),
      });
    } catch (error) {
      if (this.#deadlineController?.signal.aborted) throw this.#deadlineError(error?.attempt);
      throw asToolError(error, "search_failed", "Web search failed.");
    }
    const results = [];
    const seen = new Set();
    for (const candidate of response?.results ?? []) {
      if (results.length === MAX_SEARCH_RESULTS) break;
      try {
        await validatePublicSourceUrl(candidate.url, {
          lookup: this.#lookup,
          signal: this.#signal,
          allowPrivateNetwork: this.#allowPrivateNetwork,
        });
        const normalizedUrl = normalizeRequestedUrl(candidate.url);
        if (seen.has(normalizedUrl)) continue;
        seen.add(normalizedUrl);
        results.push({
          title: String(candidate.title ?? "Untitled result").slice(0, 500),
          url: normalizedUrl,
          snippet: String(candidate.snippet ?? "").slice(0, MAX_SNIPPET_CHARACTERS),
          ...(candidate.publishedAt ? { publishedAt: String(candidate.publishedAt) } : {}),
        });
      } catch {
        // Invalid/private result URLs never reach the model.
      }
    }
    const metadata = {
      ...(response?.metadata ?? {}),
      requestedMarket: market,
      resultCount: results.length,
    };
    this.#searchMetadata.push(metadata);
    this.#onEvent("log", { message: "Web search completed.", search: metadata });
    return { query, market, results };
  }

  async #fetchSource(input) {
    assertStrictObject(input, ["url"]);
    const requestedUrl = requiredString(input.url, "Source URL", 4_000);
    try {
      await validatePublicSourceUrl(requestedUrl, {
        lookup: this.#lookup,
        signal: this.#signal,
        allowPrivateNetwork: this.#allowPrivateNetwork,
      });
    } catch (error) {
      throw asToolError(error, "policy_rejected", "The source URL was rejected by public-source policy.");
    }
    const key = normalizeRequestedUrl(requestedUrl);
    const existing = this.#captures.get(key);
    // A repeated URL still costs a tool call, but never another capture slot or provider
    // request, so a model cannot spend its capture allowance on the same page twice.
    if (existing) return existing;
    if (this.#maxUniqueCaptures != null && this.#uniqueCaptures >= this.#maxUniqueCaptures)
      throw new ResearchToolError(
        "capture_ceiling_exceeded",
        `This run may capture at most ${this.#maxUniqueCaptures} distinct source${this.#maxUniqueCaptures === 1 ? "" : "s"}; reuse a source already retained in this run.`,
      );
    this.#uniqueCaptures += 1;
    const sourceId = `source-${++this.#sourceSequence}`;
    const operation = this.#captureAndRetain(requestedUrl, sourceId);
    this.#captures.set(key, operation);
    operation.then(
      (result) => {
        const alias = normalizeRequestedUrl(result.source.url);
        if (!this.#captures.has(alias)) this.#captures.set(alias, operation);
      },
      () => undefined,
    );
    return operation;
  }

  async #captureAndRetain(requestedUrl, sourceId) {
    let captured;
    if (this.#captureProvider) {
      try {
        captured = await this.#captureProvider.capture(requestedUrl, {
          maxPdfPages: this.#providerConfig.maxPdfPages,
          signal: this.#signal,
          remainingMs: this.#remainingMs(),
        });
      } catch (error) {
        if (this.#deadlineController?.signal.aborted) throw this.#deadlineError(error?.attempt);
        const neverFallback = [
          "cancelled",
          "deadline_exceeded",
          "budget_exhausted",
          "policy_rejected",
        ].includes(error?.category);
        if (neverFallback || !error?.fallbackEligible || /\.pdf(?:$|[?#])/i.test(requestedUrl))
          throw asToolError(error, error?.category ?? "capture_failed", "Source capture failed.");
        captured = await this.#localCapture(requestedUrl, error?.attempt ? [error.attempt] : []);
      }
    } else captured = await this.#localCapture(requestedUrl);
    if (this.#deadlineController?.signal.aborted) throw this.#deadlineError();
    if (this.#closed || this.#signal?.aborted)
      throw new ResearchToolError("research_cancelled", "The research run was cancelled.");

    const isPdf = captured.mediaType === "application/pdf";
    const snapshotContent = isPdf ? serializePdfSnapshot(captured.validatedPdf) : captured.content;
    if (!snapshotContent)
      throw new ResearchToolError("source_empty", "The captured source had no usable text.");
    const snapshot = await writeResearchSnapshot(this.#snapshotDirectory, snapshotContent);
    const retrievedAt = this.#now().toISOString();
    const metadata = {
      ...(captured.metadata ?? {}),
      snapshotRef: snapshot.snapshotRef,
      ...(isPdf ? { snapshotFormat: PDF_SNAPSHOT_FORMAT } : {}),
    };
    const source = {
      id: sourceId,
      sourceType: "web",
      url: captured.metadata?.finalUrl ?? requestedUrl,
      title: captured.metadata?.title ?? requestedUrl,
      retrievedAt,
      contentSha256: snapshot.digest,
      contentBytes: snapshot.bytes,
      mediaType: captured.mediaType,
      metadata,
    };
    const retained = {
      source,
      snapshotRef: snapshot.snapshotRef,
      content: captured.content,
      pdf: captured.validatedPdf ?? null,
    };
    this.#sources.set(sourceId, retained);
    this.#onEvent("source.retrieved", { source });
    const preview = isPdf
      ? renderPdfPreview(retained.pdf)
      : {
          content: captured.content.slice(0, MAX_MODEL_CONTENT_CHARS),
          contentTruncated: captured.content.length > MAX_MODEL_CONTENT_CHARS,
        };
    return {
      source: { ...source, snapshotRef: snapshot.snapshotRef },
      ...preview,
      coverage: retained.pdf?.coverage ?? "complete",
      pages: retained.pdf ? retained.pdf.pages.map((page) => page.pageNumber) : null,
    };
  }

  async #localCapture(url, priorAttempts = []) {
    let response;
    try {
      response = await fetchValidatedSource(url, {
        ...(this.#fetch ? { fetchImpl: this.#fetch } : {}),
        lookup: this.#lookup,
        allowPrivateNetwork: this.#allowPrivateNetwork,
        maxResponseBytes: this.#maxResponseBytes,
        timeoutMs: Math.min(this.#timeoutMs, this.#remainingMs()),
        signal: this.#signal,
        acceptPdf: Boolean(this.#pdfExtractor),
      });
    } catch (error) {
      throw asToolError(error, error?.code ?? "source_fetch_failed", "Local source capture failed.");
    }
    const metadata = {
      provider: "local",
      requestedUrl: url,
      finalUrl: response.url,
      attempts: priorAttempts,
      receiptTime: this.#now().toISOString(),
      normalizationVersion: 1,
    };
    if (response.mediaType === "application/pdf") {
      let validatedPdf;
      try {
        validatedPdf = await this.#pdfExtractor(response.bytes, {
          maxPages: this.#providerConfig.maxPdfPages ?? 30,
          signal: this.#signal,
        });
      } catch (error) {
        throw asToolError(error, error?.code ?? "source_incomplete", "The PDF could not be read.");
      }
      return {
        mediaType: "application/pdf",
        content: "",
        pages: validatedPdf.pages,
        validatedPdf,
        metadata: {
          ...metadata,
          title: response.url,
          parserMode: "pdftotext-layout",
          verifiedPages: validatedPdf.parsedPages,
          coverage: validatedPdf.coverage,
          capTruncated: validatedPdf.capTruncated,
        },
      };
    }
    const normalized = normalizeSourceContent(response.body, response.mediaType);
    return {
      mediaType: response.mediaType,
      content: normalized.content,
      pages: [],
      metadata: { ...metadata, title: normalized.title ?? response.url },
    };
  }

  #remainingMs() {
    return this.#deadlineAtMs == null
      ? Number.MAX_SAFE_INTEGER
      : Math.max(1, this.#deadlineAtMs - Date.now());
  }

  #deadlineError(providerAttempt = null) {
    const error = new ResearchToolError(
      "deadline_exceeded",
      "The research run deadline expired during a host tool call.",
    );
    error.providerAttempt = providerAttempt;
    return error;
  }

  async #readSource(input) {
    assertStrictObject(input, ["sourceId", "page", "offset", "limit"]);
    const sourceId = requiredString(input.sourceId, "Source id", 200);
    const retained = this.#sources.get(sourceId);
    if (!retained)
      throw new ResearchToolError(
        "source_not_in_run",
        `Source ${sourceId} does not belong to research run ${this.#runId}.`,
      );
    const offset = optionalInteger(input.offset, 0, 0, Number.MAX_SAFE_INTEGER, "Source offset");
    const limit = optionalInteger(input.limit, 12_000, 1, 50_000, "Source limit");
    let verified;
    try {
      verified = await readVerifiedSnapshot(retained.source, this.#snapshotDirectory);
    } catch {
      throw new ResearchToolError(
        "source_snapshot_invalid",
        `Retained source ${sourceId} failed integrity verification.`,
      );
    }
    let content;
    let page = null;
    let coverage = "complete";
    if (verified.pdf) {
      if (!Number.isInteger(input.page) || input.page < 1)
        throw new ResearchToolError(
          "invalid_tool_input",
          "PDF source reads require a retained physical page.",
        );
      const selected = verified.pdf.pages.find((candidate) => candidate.pageNumber === input.page);
      if (!selected)
        throw new ResearchToolError(
          "source_page_not_retained",
          `Physical page ${input.page} is not retained for source ${sourceId}.`,
        );
      content = selected.content;
      page = input.page;
      coverage = verified.pdf.coverage;
    } else {
      if (input.page != null)
        throw new ResearchToolError("invalid_tool_input", "HTML/text source reads must not include a page.");
      content = verified.content;
    }
    if (offset >= content.length && !(offset === 0 && content.length === 0))
      throw new ResearchToolError(
        "source_offset_out_of_range",
        `Offset ${offset} is outside retained source ${sourceId}.`,
      );
    const returned = content.slice(offset, offset + limit);
    return {
      sourceId,
      ...(page == null ? {} : { page }),
      offset,
      content: returned,
      nextOffset: offset + returned.length < content.length ? offset + returned.length : null,
      totalCharacters: content.length,
      coverage,
    };
  }

  /**
   * Check one citation against what this run retained, without spending a tool call.
   *
   * For a runtime whose model states its citations in a final answer instead of submitting
   * them through `submit_finding`: the same check, applied after the fact. Throws the same
   * `ResearchToolError` codes `submit_finding` would, so a caller can say why a citation failed.
   */
  verifyEvidence(reference) {
    if (reference && typeof reference === "object" && containsQuoteVerified(reference))
      throw new ResearchToolError(
        "host_verification_required",
        "The model must not provide quoteVerified; verification is owned by the host.",
      );
    return this.#verifyReference(reference);
  }

  /**
   * The physical page of a retained PDF that holds this excerpt, when the citation named none, or
   * null. Only for the after-the-run check: the page is found by the same exact-substring test the
   * check then applies, so a quote still has to be on the page word for word. The first page that
   * holds it wins, and a quote on no page stays unverified.
   */
  locatePdfPage(sourceId, excerpt) {
    const retained = this.#sources.get(String(sourceId ?? ""));
    if (!retained?.pdf || typeof excerpt !== "string" || !excerpt.trim()) return null;
    return retained.pdf.pages.find((page) => excerptAppearsIn(page.content, excerpt))?.pageNumber ?? null;
  }

  /**
   * Where a quote sits on a retained source, found by its words (`locatePassage`): `{ page, text }`,
   * `text` being the page's own words, or null. For a PDF the named page is tried first, then every
   * retained page. Only for the after-the-run check, which then verifies `text` word for word.
   */
  locateQuote(sourceId, excerpt, page = null) {
    const retained = this.#sources.get(String(sourceId ?? ""));
    if (!retained || typeof excerpt !== "string" || !excerpt.trim()) return null;
    if (!retained.pdf) {
      const found = locatePassage(retained.content, excerpt);
      return found ? { page: null, text: found.text } : null;
    }
    const pages = [...retained.pdf.pages].sort((a, b) => (b.pageNumber === page) - (a.pageNumber === page));
    let best = null;
    for (const candidate of pages) {
      const found = locatePassage(candidate.content, excerpt);
      if (found && (!best || found.coverage > best.coverage))
        best = { page: candidate.pageNumber, text: found.text, coverage: found.coverage };
    }
    return best ? { page: best.page, text: best.text } : null;
  }

  #verifyReference(reference) {
    const sourceId = requiredString(reference?.sourceId, "Evidence source id", 200);
    const retained = this.#sources.get(sourceId);
    if (!retained)
      throw new ResearchToolError(
        "source_not_in_run",
        `Source ${sourceId} does not belong to research run ${this.#runId}.`,
      );
    const excerpt = requiredString(reference?.excerpt, "Evidence excerpt", 2_000);
    if (retained.pdf) {
      const keys = Object.keys(reference.locator ?? {});
      if (
        keys.length !== 1 ||
        keys[0] !== "page" ||
        !Number.isInteger(reference.locator.page) ||
        reference.locator.page < 1
      )
        throw new ResearchToolError(
          "pdf_page_required",
          "PDF evidence requires only a positive physical-page locator.",
        );
      const page = retained.pdf.pages.find((candidate) => candidate.pageNumber === reference.locator.page);
      if (!page || !excerptAppearsIn(page.content, excerpt))
        throw new ResearchToolError(
          "excerpt_not_found",
          `The submitted excerpt is not an exact substring of retained physical page ${reference.locator.page}.`,
        );
    } else {
      if (reference.locator?.page != null)
        throw new ResearchToolError("invalid_locator", "HTML/text evidence must not include a page locator.");
      if (!excerptAppearsIn(retained.content, excerpt))
        throw new ResearchToolError(
          "excerpt_not_found",
          `The submitted excerpt is not an exact substring of retained source ${sourceId}.`,
        );
    }
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
    const evidence = evidenceInput.map((reference) => this.#verifyReference(reference));
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
