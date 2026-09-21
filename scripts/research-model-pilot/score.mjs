// The pilot scorer (plan §5, §Q1, §Q6).
//
// Three things stay separate here on purpose. `quote_verified` is structural: the excerpt is
// an exact substring of a retained snapshot. `claim_supported` is semantic and comes only from
// a human verdict — never from an automatic check and never from another model.
// `authority_appropriate` is about which kind of source a claim leans on. A case passes only
// when all three, and every other gate, hold; no weighting can average an unsupported material
// claim away.

import { reviewCompleteness, REVIEW_VERDICTS, sourceRole } from "./review.mjs";

export const CASE_CHECK_IDS = Object.freeze([
  "run_completed",
  "evidence_retained",
  "quote_verified",
  "expected_fact_represented",
  "pdf_page_correct",
  "no_snippet_evidence",
  "authority_appropriate",
  "dynamic_absence_discipline",
  "uncertainty_surfaced",
  "within_bounds",
  "no_credential_leak",
  "claim_supported",
]);

const AMOUNT = /(?:NZ\$|AU\$|AUD|NZD|\$)\s?\d[\d,]*(?:\.\d{1,2})?/i;
const ABSENCE =
  /\b(?:unavailable|not available|no (?:public |listed |displayed )?price|not shown|not displayed|not listed|price is not)\b/i;
const FABRICATED_ZERO =
  /(?:(?:NZ\$|AU\$|\$)\s?0(?:\.00?)?(?!\d)|zero dollars|free of charge|nil price|price of 0(?!\d))/i;
const UNCERTAIN =
  /\b(?:unresolved|not supported|not present|not found|could not|cannot|unable|absent|does not appear|no evidence)\b/i;
const SEARCH_ENGINE_HOST = /(?:^|\.)(?:google|bing|duckduckgo|serper|firecrawl|yahoo)\./i;

/**
 * Retail pages style the inside of an amount: Bunnings renders $73.04 as "$73 .04", with the
 * cents in their own element. Whitespace sitting between digits and the decimal point is that
 * styling, not part of the number, so it is dropped before an asserted amount is looked for in
 * a retained excerpt.
 *
 * This does not loosen what the check proves. The digits themselves must still appear, in
 * order, in text the run retained — a fabricated or hallucinated amount fails exactly as it did
 * before. What it stops failing is the opposite case: a model that read the source correctly,
 * normalised the styling the way a person would, and said so.
 */
function normalizeAmountText(text) {
  return String(text).replace(/(?<=[\d.])\s+(?=[\d.])/g, "");
}

export function scoreCase({ entry, executed, review, artifactScan }) {
  const findings = executed?.result?.findings ?? [];
  const evidence = findings.flatMap((finding) =>
    (finding.evidence ?? []).map((reference, index) => ({ finding, reference, index })),
  );
  const verification = new Map(
    (executed?.verification ?? []).map((row) => [`${row.findingId}::${row.evidenceIndex}`, row]),
  );
  const sources = new Map((executed?.sources ?? []).map((source) => [source.id, source]));
  const verified = evidence.filter(
    ({ finding, index }) => verification.get(`${finding.id}::${index}`)?.storeQuoteVerified,
  );
  const claimText = [
    ...findings.map((finding) => finding.claim),
    executed?.result?.summary ?? "",
    ...(executed?.result?.unresolvedQuestions ?? []),
  ].join("\n");
  const answerText = [...findings.map((finding) => finding.claim), executed?.result?.summary ?? ""].join(
    "\n",
  );
  const context = {
    entry,
    executed,
    findings,
    evidence,
    verified,
    verification,
    sources,
    claimText,
    answerText,
  };

  const checks = [
    runCompleted(context),
    evidenceRetained(context),
    quoteVerified(context),
    expectedFactRepresented(context),
    pdfPageCorrect(context),
    noSnippetEvidence(context),
    authorityAppropriate(context),
    dynamicAbsenceDiscipline(context),
    uncertaintySurfaced(context),
    withinBounds(context),
    credentialScanClean(artifactScan),
    claimSupported({ entry, review }),
  ];
  const pending = checks.filter((check) => check.status === "pending");
  const failed = checks.filter((check) => check.status === "failed");
  return {
    caseId: entry.id,
    capability: entry.capability,
    checks,
    taskPassed: failed.length === 0 && pending.length === 0,
    pending: pending.map((check) => check.id),
    failed: failed.map((check) => check.id),
    diagnostics: caseDiagnostics({ entry, executed, review, verified, evidence }),
  };
}

export function scoreSession({ manifest, session, review, artifactScan }) {
  const completeness = reviewCompleteness(review);
  const cases = manifest.cases.map((entry) => {
    const executed = session.cases.find((candidate) => candidate.id === entry.id) ?? null;
    if (!executed)
      return {
        caseId: entry.id,
        capability: entry.capability,
        checks: [{ id: "run_completed", status: "failed", detail: "The case did not run in this session." }],
        taskPassed: false,
        pending: [],
        failed: ["run_completed"],
        diagnostics: null,
      };
    return scoreCase({ entry, executed, review, artifactScan });
  });
  const firstAttemptPasses = cases.filter((entry) => entry.taskPassed).length;
  const pendingReview = cases.some((entry) => entry.pending.length > 0) || !completeness.complete;
  const verdict = pendingReview
    ? "pending_human_review"
    : firstAttemptPasses === manifest.session.requiredFirstAttemptPasses
      ? "passed"
      : "failed";
  return {
    version: 1,
    sessionId: session.sessionId,
    manifestHash: session.preflight?.manifest?.hash ?? null,
    sessionStatus: session.status,
    stopped: session.stopped ?? null,
    generatedAt: new Date().toISOString(),
    primaryMetric: {
      name: "first-attempt task gate success rate",
      firstAttemptPasses,
      required: manifest.session.requiredFirstAttemptPasses,
      total: manifest.cases.length,
      retriesIncluded: false,
    },
    verdict,
    activationRecommended: verdict === "passed",
    review: completeness,
    cases,
    ledgers: session.ledgers ?? null,
    artifactScan: artifactScan ?? null,
    limitations: [
      "Four public-web cases are a small sample; a pass is not production proof.",
      "Exact quote verification is structural; claim support is a human verdict recorded in review.json.",
      "Model dollar exposure is bounded by call and output-token ceilings, not by a pre-call billing guarantee.",
    ],
  };
}

function runCompleted({ executed }) {
  if (executed?.status !== "completed")
    return fail("run_completed", `The run ended as ${executed?.status ?? "missing"}.`);
  if (executed.accounting?.budgetState?.ceilingHit)
    return fail("run_completed", `The run was truncated by ${executed.accounting.budgetState.ceilingHit}.`);
  return pass("run_completed", "The run reached completed without a hard-ceiling truncation.");
}

function evidenceRetained({ findings, evidence }) {
  if (!findings.length) return fail("evidence_retained", "No finding was submitted.");
  if (!evidence.length) return fail("evidence_retained", "No finding carried evidence.");
  return pass("evidence_retained", `${findings.length} finding(s), ${evidence.length} excerpt(s).`);
}

function quoteVerified({ evidence, verified }) {
  if (!evidence.length) return fail("quote_verified", "There was no evidence to verify.");
  if (verified.length !== evidence.length)
    return fail(
      "quote_verified",
      `${evidence.length - verified.length} excerpt(s) did not reverify against the retained snapshot.`,
    );
  return pass("quote_verified", "Every excerpt reverified as an exact substring of its retained snapshot.");
}

function expectedFactRepresented({ entry, verified, answerText, claimText }) {
  const misses = [];
  for (const fact of entry.oracle.expectedFacts) {
    if (!factRepresented(fact, { verified, answerText, claimText })) misses.push(fact.id);
  }
  return misses.length
    ? fail("expected_fact_represented", `Expected fact(s) not correctly represented: ${misses.join(", ")}.`)
    : pass("expected_fact_represented", "Every expected fact is represented and evidenced.");
}

function factRepresented(fact, { verified, answerText }) {
  if (fact.kind === "identity_terms") {
    const matched = fact.terms.filter((term) =>
      verified.some(({ reference }) => includesInsensitive(reference.excerpt, term)),
    );
    return matched.length >= (fact.minimumTerms ?? fact.terms.length);
  }
  if (fact.kind === "exact_value")
    return (
      verified.some(
        ({ reference }) =>
          reference.locator?.page === fact.page && String(reference.excerpt).includes(fact.value),
      ) && answerText.includes(fact.value)
    );
  if (fact.kind === "supported_phrase")
    return verified.some(
      ({ reference }) =>
        reference.locator?.page === fact.page && includesInsensitive(reference.excerpt, fact.phrase),
    );
  if (fact.kind === "dynamic_amount_or_absence") {
    const amountInEvidence = verified.find(({ reference }) =>
      AMOUNT.test(normalizeAmountText(reference.excerpt)),
    );
    const claimed = answerText.match(AMOUNT)?.[0];
    if (claimed) {
      const digits = claimed.replace(/[^\d.]/g, "");
      return Boolean(
        amountInEvidence &&
          verified.some(({ reference }) => normalizeAmountText(reference.excerpt).includes(digits)),
      );
    }
    return ABSENCE.test(answerText);
  }
  return false;
}

function pdfPageCorrect({ entry, verified, sources }) {
  const expected = entry.oracle.expectedPages ?? [];
  const forbidden = entry.oracle.forbiddenPages ?? [];
  const pdfEvidence = verified.filter(
    ({ reference }) => sources.get(reference.sourceId)?.mediaType === "application/pdf",
  );
  if (!expected.length)
    return pdfEvidence.length
      ? pass("pdf_page_correct", "No page expectation applies; retained PDF pages were used.")
      : pass("pdf_page_correct", "No PDF evidence and no page expectation.");
  if (!pdfEvidence.length) return fail("pdf_page_correct", "The case expects retained PDF page evidence.");
  // The expected page must be cited and a forbidden page must not be. Citing a further page
  // that is neither is corroboration, not an error: a model that answers from page 19 and also
  // points at the two pages leading to it has done more work, not worse work. A forbidden page
  // still fails on its own, which is what keeps this from being a weaker rule than "every
  // excerpt on an expected page" for the thing the oracle actually guards against.
  const offending = pdfEvidence.filter(({ reference }) => forbidden.includes(reference.locator?.page));
  if (offending.length)
    return fail("pdf_page_correct", `${offending.length} excerpt(s) cite a forbidden page.`);
  const onExpected = pdfEvidence.filter(({ reference }) => expected.includes(reference.locator?.page));
  return onExpected.length
    ? pass(
        "pdf_page_correct",
        `${onExpected.length} of ${pdfEvidence.length} PDF excerpt(s) cite physical page ${expected.join(", ")}; none cite a forbidden page.`,
      )
    : fail("pdf_page_correct", `No excerpt cites physical page ${expected.join(", ")}.`);
}

function noSnippetEvidence({ evidence, sources }) {
  const offenders = evidence.filter(({ reference }) => {
    const source = sources.get(reference.sourceId);
    if (!source || !reference.snapshotRef) return true;
    try {
      return SEARCH_ENGINE_HOST.test(new URL(source.url).hostname);
    } catch {
      return true;
    }
  });
  return offenders.length
    ? fail("no_snippet_evidence", `${offenders.length} excerpt(s) are not backed by a retained source.`)
    : pass("no_snippet_evidence", "Every excerpt came from a retained capture, not a search snippet.");
}

function authorityAppropriate({ entry, verified }) {
  const roles = new Set(
    verified.map(({ reference }) => sourceRole(entry, reference.url ?? "")).filter(Boolean),
  );
  const unclassified = verified.filter(
    ({ reference }) => sourceRole(entry, reference.url ?? "") === "unclassified",
  );
  if (unclassified.length)
    return fail(
      "authority_appropriate",
      `${unclassified.length} excerpt(s) come from a host outside the declared source classes.`,
    );
  const missing = entry.sourcePolicy.roles
    .filter((role) => role.required && !roles.has(role.role))
    .map((role) => role.role);
  return missing.length
    ? fail("authority_appropriate", `No evidence from required source role(s): ${missing.join(", ")}.`)
    : pass("authority_appropriate", `Evidence covers required role(s): ${[...roles].join(", ")}.`);
}

function dynamicAbsenceDiscipline({ entry, verified, answerText }) {
  const dynamic = entry.oracle.expectedFacts.some((fact) => fact.kind === "dynamic_amount_or_absence");
  if (!dynamic) return pass("dynamic_absence_discipline", "The case has no dynamic amount.");
  if (FABRICATED_ZERO.test(answerText))
    return fail("dynamic_absence_discipline", "A missing amount was reported as zero or free.");
  const claimed = answerText.match(AMOUNT)?.[0];
  if (!claimed) return pass("dynamic_absence_discipline", "No amount was asserted.");
  const digits = claimed.replace(/[^\d.]/g, "");
  return verified.some(({ reference }) => normalizeAmountText(reference.excerpt).includes(digits))
    ? pass("dynamic_absence_discipline", "The asserted amount appears in a retained excerpt.")
    : fail("dynamic_absence_discipline", "An amount was asserted that no retained excerpt contains.");
}

function uncertaintySurfaced({ entry, executed, verified, claimText, answerText }) {
  const required = entry.oracle.unresolvedRequired ?? [];
  if (!required.length)
    return pass("uncertainty_surfaced", "The case declares no deliberately unresolved question.");
  for (const item of required) {
    const supportedOnPage = verified.some(
      ({ reference }) =>
        reference.locator?.page === item.page && includesInsensitive(reference.excerpt, item.phrase),
    );
    if (supportedOnPage) continue;
    if (includesInsensitive(answerText, item.phrase) && !UNCERTAIN.test(answerText))
      return fail(
        "uncertainty_surfaced",
        `${item.id} was asserted without retained page-${item.page} evidence.`,
      );
    const declared =
      (executed?.result?.unresolvedQuestions ?? []).some((question) =>
        includesInsensitive(question, item.phrase),
      ) ||
      (includesInsensitive(claimText, item.phrase) && UNCERTAIN.test(claimText));
    if (!declared)
      return fail("uncertainty_surfaced", `${item.id} was neither evidenced nor reported as unresolved.`);
  }
  return pass("uncertainty_surfaced", "Deliberately unresolved questions were reported as unresolved.");
}

function withinBounds({ entry, executed }) {
  const usage = executed?.accounting?.model ?? {};
  const firecrawl = executed?.accounting?.providers?.firecrawl ?? {};
  const serper = executed?.accounting?.providers?.serper ?? {};
  const breaches = [];
  if ((usage.modelCalls ?? 0) > entry.budget.maxModelCalls) breaches.push("maxModelCalls");
  if ((usage.toolCalls ?? 0) > entry.budget.maxToolCalls) breaches.push("maxToolCalls");
  if ((usage.searchCalls ?? 0) > entry.budget.maxSearchCalls) breaches.push("maxSearchCalls");
  if ((executed?.capturesUsed ?? 0) > entry.budget.maxUniqueCaptures) breaches.push("uniqueCaptures");
  if ((firecrawl.caseCommitted ?? 0) > entry.providerBound.calculatedFirecrawlUpperBound)
    breaches.push("firecrawlCredits");
  if (firecrawl.contractViolation || serper.contractViolation) breaches.push("providerChargeContract");
  return breaches.length
    ? fail("within_bounds", `The case exceeded: ${breaches.join(", ")}.`)
    : pass("within_bounds", "The case stayed inside every frozen model, tool, capture and credit bound.");
}

function credentialScanClean(artifactScan) {
  if (!artifactScan) return pending("no_credential_leak", "The artifact secret scan has not run.");
  return artifactScan.leakCount === 0
    ? pass(
        "no_credential_leak",
        `${artifactScan.scannedFiles} artifact(s) scanned, no credential value found.`,
      )
    : fail("no_credential_leak", `${artifactScan.leakCount} credential occurrence(s) in retained artifacts.`);
}

function claimSupported({ entry, review }) {
  const claims = (review?.claims ?? []).filter((claim) => claim.caseId === entry.id);
  if (!claims.length) return pending("claim_supported", "No review rows exist for this case yet.");
  const missing = claims.filter((claim) => !REVIEW_VERDICTS.includes(claim.reviewer?.verdict));
  if (missing.length)
    return pending("claim_supported", `${missing.length} claim(s) await a human entailment verdict.`);
  const unsupported = claims.filter((claim) => claim.reviewer.verdict !== "supports");
  return unsupported.length
    ? fail(
        "claim_supported",
        `${unsupported.length} claim/excerpt pair(s) were reviewed as ${[...new Set(unsupported.map((claim) => claim.reviewer.verdict))].join(", ")}.`,
      )
    : pass("claim_supported", "A human reviewer marked every claim/excerpt pair as supports.");
}

function caseDiagnostics({ entry, executed, review, verified, evidence }) {
  const claims = (review?.claims ?? []).filter((claim) => claim.caseId === entry.id);
  const usefulness = (review?.caseReview ?? []).find((row) => row.caseId === entry.id)?.usefulness ?? null;
  return {
    findings: executed?.result?.findings?.length ?? 0,
    evidenceCount: evidence.length,
    reverifiedExcerpts: verified.length,
    unresolvedQuestions: executed?.result?.unresolvedQuestions ?? [],
    entailmentVerdicts: claims.reduce((counts, claim) => {
      const verdict = claim.reviewer?.verdict ?? "unreviewed";
      counts[verdict] = (counts[verdict] ?? 0) + 1;
      return counts;
    }, {}),
    usefulness,
    usage: executed?.accounting?.model ?? null,
    durationMs: executed?.accounting?.durationMs ?? null,
    firecrawlCredits: executed?.accounting?.providers?.firecrawl?.caseCommitted ?? null,
    serperCalls: executed?.accounting?.providers?.serper?.caseCommitted ?? null,
    capturesUsed: executed?.capturesUsed ?? null,
  };
}

export function renderReportMarkdown(report) {
  const lines = [
    `# Live-model research pilot report — ${report.sessionId}`,
    "",
    `- Session status: ${report.sessionStatus}`,
    `- Verdict: ${report.verdict}`,
    `- First-attempt task passes: ${report.primaryMetric.firstAttemptPasses} of ${report.primaryMetric.total} (requires ${report.primaryMetric.required})`,
    `- Activation recommended: ${report.activationRecommended ? "yes" : "no"}`,
    `- Human review: ${report.review.reviewedClaims}/${report.review.totalClaims} claims reviewed`,
    `- Manifest: ${report.manifestHash}`,
    "",
  ];
  if (report.stopped)
    lines.push(`The session stopped at ${report.stopped.caseId}: ${report.stopped.reason}.`, "");
  for (const entry of report.cases) {
    lines.push(`## ${entry.caseId} — ${entry.taskPassed ? "passed" : "not passed"}`, "");
    for (const check of entry.checks) lines.push(`- ${check.status}: **${check.id}** — ${check.detail}`);
    lines.push("");
  }
  lines.push("## Limitations", "", ...report.limitations.map((line) => `- ${line}`), "");
  return lines.join("\n");
}

function includesInsensitive(haystack, needle) {
  return String(haystack).toLowerCase().includes(String(needle).toLowerCase());
}
function pass(id, detail) {
  return { id, status: "passed", detail };
}
function fail(id, detail) {
  return { id, status: "failed", detail };
}
function pending(id, detail) {
  return { id, status: "pending", detail };
}
