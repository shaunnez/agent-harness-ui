// The human entailment packet (plan §6).
//
// No model writes here and no model reads this: another paid model judging this one is out of
// scope, and an automatic checker cannot decide entailment. The packet is blind — it carries
// no expected answer, no expected page and no forbidden inference — so a reviewer reads the
// claim against the retained excerpt, not against the answer key. The scorer applies the
// hidden oracle only after every claim has a verdict.

import { readVerifiedSnapshot } from "../../server/research/research-source-snapshots.mjs";

export const REVIEW_VERDICTS = Object.freeze(["supports", "partial", "unrelated", "contradicts"]);
export const USEFULNESS_SCALE = Object.freeze(["useful", "usable with edits", "not useful"]);
const CONTEXT_RADIUS = 400;

export const REVIEW_INSTRUCTIONS = Object.freeze([
  "For each claim, decide whether the retained excerpt alone supports it: supports, partial, unrelated or contradicts.",
  "`hostQuoteVerified` only means the excerpt is an exact substring of the retained snapshot. It is not support.",
  "Judge the claim as written. Do not repair it, and do not credit knowledge that is not in the excerpt.",
  "Record usefulness per case on the three-point scale, and note any material fact the answer omitted.",
  "Leave no verdict blank: the scorer refuses a verdict until every claim has one.",
]);

export async function buildReviewPacket({ manifest, session, snapshotDirectory }) {
  const claims = [];
  for (const executed of session.cases) {
    const entry = manifest.cases.find((candidate) => candidate.id === executed.id);
    const sources = new Map(executed.sources.map((source) => [source.id, source]));
    for (const finding of executed.result?.findings ?? []) {
      for (const [index, reference] of (finding.evidence ?? []).entries()) {
        const source = sources.get(reference.sourceId) ?? null;
        claims.push({
          claimKey: `${executed.id}::${finding.id}::${index}`,
          caseId: executed.id,
          caseLabel: entry?.label ?? executed.id,
          findingId: finding.id,
          evidenceIndex: index,
          claim: finding.claim,
          confidence: finding.confidence ?? null,
          assumptions: finding.assumptions ?? [],
          excerpt: reference.excerpt ?? "",
          retainedContext: await retainedContext(source, reference, snapshotDirectory),
          source: {
            id: reference.sourceId,
            title: source?.title ?? reference.title ?? null,
            url: source?.url ?? reference.url ?? null,
            role: sourceRole(entry, source?.url ?? reference.url ?? ""),
            retrievedAt: source?.retrievedAt ?? reference.retrievedAt ?? null,
            snapshotRef: reference.snapshotRef ?? null,
            page: reference.locator?.page ?? null,
            mediaType: source?.mediaType ?? null,
          },
          hostQuoteVerified: Boolean(reference.quoteVerified),
          reviewer: { verdict: null, notes: "" },
        });
      }
    }
  }
  return {
    version: 1,
    revision: 1,
    finalised: false,
    sessionId: session.sessionId,
    manifestHash: session.preflight.manifest.hash,
    createdAt: new Date().toISOString(),
    instructions: REVIEW_INSTRUCTIONS,
    verdicts: REVIEW_VERDICTS,
    usefulnessScale: USEFULNESS_SCALE,
    claims,
    caseReview: session.cases.map((executed) => ({
      caseId: executed.id,
      usefulness: null,
      omissions: "",
      notes: "",
    })),
    history: [],
  };
}

/** Corrections after finalisation create a new revision and preserve the prior values. */
export function withReviewRevision(previous, updated) {
  if (!previous?.finalised) return { ...updated, revision: previous?.revision ?? 1 };
  const { history: _ignored, ...priorWithoutHistory } = previous;
  return {
    ...updated,
    revision: previous.revision + 1,
    history: [...(previous.history ?? []), priorWithoutHistory],
  };
}

export function reviewCompleteness(packet) {
  const missing = [];
  for (const claim of packet?.claims ?? []) {
    if (!REVIEW_VERDICTS.includes(claim.reviewer?.verdict)) missing.push(claim.claimKey);
  }
  const missingUsefulness = (packet?.caseReview ?? [])
    .filter((entry) => !USEFULNESS_SCALE.includes(entry.usefulness))
    .map((entry) => entry.caseId);
  return {
    totalClaims: packet?.claims?.length ?? 0,
    reviewedClaims: (packet?.claims?.length ?? 0) - missing.length,
    missingClaims: missing,
    missingUsefulness,
    complete: missing.length === 0 && missingUsefulness.length === 0,
  };
}

export function renderReviewMarkdown(packet) {
  const lines = [
    `# Research pilot entailment review — ${packet.sessionId}`,
    "",
    `Manifest ${packet.manifestHash}. Revision ${packet.revision}.`,
    "",
    "## How to review",
    ...REVIEW_INSTRUCTIONS.map((line) => `- ${line}`),
    "",
    `Record every verdict in \`review.json\` as one of: ${REVIEW_VERDICTS.join(", ")}.`,
    "",
  ];
  let currentCase = null;
  for (const claim of packet.claims) {
    if (claim.caseId !== currentCase) {
      currentCase = claim.caseId;
      lines.push(`## ${claim.caseLabel} (${claim.caseId})`, "");
    }
    lines.push(
      `### ${claim.claimKey}`,
      "",
      `- Claim: ${claim.claim}`,
      `- Source: ${claim.source.title ?? "untitled"} — ${claim.source.url ?? "no url"}`,
      `- Role: ${claim.source.role ?? "unclassified"} · retrieved ${claim.source.retrievedAt ?? "unknown"}`,
      `- Snapshot: ${claim.source.snapshotRef ?? "none"}${claim.source.page ? ` · physical page ${claim.source.page}` : ""}`,
      `- Host quote verification: ${claim.hostQuoteVerified ? "exact substring of the retained snapshot" : "not verified"}`,
      "",
      "Retained excerpt:",
      "",
      `> ${String(claim.excerpt).split("\n").join("\n> ")}`,
      "",
      "Surrounding retained context:",
      "",
      "```text",
      claim.retainedContext ?? "(unavailable)",
      "```",
      "",
      `Verdict (${REVIEW_VERDICTS.join(" / ")}): ______    Notes: ______`,
      "",
    );
  }
  lines.push("## Per-case usefulness", "");
  for (const entry of packet.caseReview)
    lines.push(`- ${entry.caseId}: ${USEFULNESS_SCALE.join(" / ")} — omissions: ______`);
  lines.push("");
  return lines.join("\n");
}

async function retainedContext(source, reference, snapshotDirectory) {
  if (!source) return null;
  let verified;
  try {
    verified = await readVerifiedSnapshot(source, snapshotDirectory);
  } catch {
    return null;
  }
  const page = reference.locator?.page;
  const content = verified.pdf
    ? (verified.pdf.pages.find((candidate) => candidate.pageNumber === page)?.content ?? "")
    : verified.content;
  const excerpt = String(reference.excerpt ?? "");
  const at = content.indexOf(excerpt);
  if (at < 0) return content.slice(0, CONTEXT_RADIUS * 2);
  return content.slice(Math.max(0, at - CONTEXT_RADIUS), at + excerpt.length + CONTEXT_RADIUS);
}

function sourceRole(entry, url) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  for (const role of entry?.sourcePolicy?.roles ?? []) {
    if (role.hostSuffixes.some((suffix) => host === suffix.slice(1) || host.endsWith(suffix)))
      return role.role;
  }
  return "unclassified";
}

export { sourceRole };
