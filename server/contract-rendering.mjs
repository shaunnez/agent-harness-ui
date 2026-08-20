/**
 * Markdown views of the typed cross-stage contracts.
 *
 * The direction of dependency matters: contracts are the protocol, these renderings are for
 * Shaun and the UI. Nothing downstream parses this output — if a stage needs a fact from an
 * earlier stage, it reads the object, not the prose.
 */

function bulletList(items, { empty = "_None recorded._", indent = "" } = {}) {
  if (!items.length) return `${indent}${empty}`;
  return items.map((item) => `${indent}- ${item}`).join("\n");
}

function percentage(value) {
  return `${Math.round(value * 100)}%`;
}

export function renderInvestigationResultMarkdown(result) {
  const lines = ["## Investigation synthesis", ""];
  const recommended = result.hypotheses.find((hypothesis) => hypothesis.id === result.recommendedDiagnosis);
  lines.push(
    `**Recommended diagnosis:** ${result.recommendedDiagnosis} — ${recommended.claim}`,
    `**Confidence:** ${percentage(recommended.confidence)} · **Remaining uncertainty:** ${percentage(result.remainingUncertainty)}`,
    "",
  );

  for (const hypothesis of result.hypotheses) {
    const marker = hypothesis.id === result.recommendedDiagnosis ? " (recommended)" : "";
    lines.push(
      `### ${hypothesis.id} — ${percentage(hypothesis.confidence)}${marker}`,
      "",
      hypothesis.claim,
      "",
      "Supporting evidence:",
      bulletList(hypothesis.supportingEvidence),
      "",
    );
    if (hypothesis.contradictingEvidence.length) {
      lines.push("Contradicting evidence:", bulletList(hypothesis.contradictingEvidence), "");
    }
    if (hypothesis.unknowns.length) {
      lines.push("Unknowns:", bulletList(hypothesis.unknowns), "");
    }
  }

  if (result.additionalEvidenceNeeded.length) {
    lines.push("### Evidence still needed", "", bulletList(result.additionalEvidenceNeeded), "");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderPlanCritiqueMarkdown(critique) {
  const lines = [
    "## Plan critique",
    "",
    `**Verdict:** ${critique.verdict}`,
    critique.verdict === "REVISE"
      ? `${critique.blocking.length} blocking finding${critique.blocking.length === 1 ? "" : "s"} must be answered before implementation.`
      : "No blocking findings. Advisory notes below are not gating.",
    "",
  ];

  if (critique.blocking.length) {
    lines.push("### Blocking", "");
    for (const [index, finding] of critique.blocking.entries()) {
      lines.push(
        `${index + 1}. **${finding.dimension}** — ${finding.claim}`,
        bulletList(finding.evidence, { indent: "   " }),
        "",
      );
    }
  }

  if (critique.advisory.length) {
    lines.push("### Advisory (non-blocking)", "");
    for (const finding of critique.advisory) {
      lines.push(`- **${finding.dimension}** — ${finding.claim}`);
      if (finding.evidence.length) lines.push(bulletList(finding.evidence, { indent: "  " }));
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderFailureDiagnosisMarkdown(diagnosis, { routedTo = null } = {}) {
  const lines = [
    "## Failure diagnosis",
    "",
    `**Classification:** ${diagnosis.classification}`,
    `**Confidence:** ${percentage(diagnosis.confidence)}`,
    `**Proposed rewind:** ${diagnosis.proposedRewindTo}`,
  ];
  if (routedTo) {
    lines.push(
      routedTo === diagnosis.proposedRewindTo
        ? `**Router agreed:** rewinding to ${routedTo}.`
        : `**Router overruled the proposal:** rewinding to ${routedTo}, not ${diagnosis.proposedRewindTo}. The routing table is authoritative.`,
    );
  }
  lines.push("", diagnosis.rationale, "", "Evidence:", bulletList(diagnosis.evidence), "");
  return `${lines.join("\n").trimEnd()}\n`;
}
