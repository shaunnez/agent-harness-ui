import path from "node:path";
import {
  isCanonicalIsoTimestamp,
  readExplicitCandidateBinding,
  RUNTIME_FRESHNESS_REASONS,
} from "./run-activity.mjs";

class CandidateEvidenceError extends Error {
  constructor(code, detail = null) {
    const reasonCode = Object.prototype.hasOwnProperty.call(RUNTIME_FRESHNESS_REASONS, code)
      ? code
      : "contradictory_evidence";
    super(detail ?? RUNTIME_FRESHNESS_REASONS[reasonCode]);
    this.name = "CandidateEvidenceError";
    this.code = reasonCode;
    this.copy = RUNTIME_FRESHNESS_REASONS[reasonCode];
  }
}

function candidateEvidenceError(code, detail = null) {
  return new CandidateEvidenceError(code, detail);
}

export function isCandidateEvidenceError(error) {
  return error instanceof CandidateEvidenceError &&
    typeof error.code === "string" &&
    Object.prototype.hasOwnProperty.call(RUNTIME_FRESHNESS_REASONS, error.code);
}

function compareEvidenceBinding(binding, candidate) {
  if (binding.candidateId !== candidate.id) return "candidate_mismatch";
  if (binding.candidateRevision !== candidate.revisionNumber) return "revision_change";
  return null;
}

function parseLabelledJson(text, label) {
  const expression = new RegExp(`<${label}>\\s*([\\s\\S]*?)\\s*</${label}>`, "i");
  const match = String(text ?? "").match(expression);
  if (!match) throw new Error(`The agent did not return the required ${label} JSON block.`);
  const payload = match[1].trim();
  // Accept one optional Markdown fence only when it wraps the whole labelled payload.
  // Mixed prose, multiple blocks, and malformed JSON remain fail-closed.
  const fenced = payload.match(/^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i);
  try {
    return JSON.parse((fenced?.[1] ?? payload).trim());
  } catch (error) {
    throw new Error(`The ${label} JSON block was invalid: ${error.message}`);
  }
}

function parseCandidateEvidenceJson(text, label) {
  const expression = new RegExp(`<${label}>\\s*([\\s\\S]*?)\\s*</${label}>`, "gi");
  const matches = [...String(text ?? "").matchAll(expression)];
  if (matches.length === 0) throw candidateEvidenceError("missing_authoritative_summary");
  if (matches.length > 1) {
    throw candidateEvidenceError(
      "contradictory_evidence",
      `The agent returned more than one ${label} JSON block.`,
    );
  }
  const payload = matches[0][1].trim();
  // Review models occasionally preserve the requested single JSON payload but wrap it in
  // the Markdown fence they use everywhere else. Unwrap only when the fence is the whole
  // labelled payload; mixed prose, multiple blocks, malformed JSON, verdicts, findings and
  // candidate bindings still pass through the same fail-closed validators below.
  const fenced = payload.match(/^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i);
  try {
    return JSON.parse((fenced?.[1] ?? payload).trim());
  } catch (error) {
    throw candidateEvidenceError(
      "contradictory_evidence",
      `The ${label} JSON block was invalid: ${error.message}`,
    );
  }
}

export function parseGrillQuestions(text) {
  const value = parseLabelledJson(text, "grill-questions");
  if (!Array.isArray(value.questions) || value.questions.length > 12) {
    throw new Error("Grill output must contain a questions array with at most 12 entries.");
  }
  return value.questions.map((question, questionIndex) => {
    if (!question?.question?.trim() || !question?.whyItMatters?.trim()) {
      throw new Error(`Grill question ${questionIndex + 1} is missing its question or rationale.`);
    }
    if (!Array.isArray(question.options) || question.options.length < 2 || question.options.length > 4) {
      throw new Error(`Grill question ${questionIndex + 1} must have 2-4 options.`);
    }
    const options = question.options.map((option, optionIndex) => ({
      id: `Q${questionIndex + 1}-O${optionIndex + 1}`,
      label: String(option?.label ?? "").trim().slice(0, 300),
      description: String(option?.description ?? "").trim().slice(0, 1_000),
      recommended: option?.recommended === true,
    }));
    if (options.some((option) => !option.label) || options.filter((option) => option.recommended).length !== 1) {
      throw new Error(`Grill question ${questionIndex + 1} must have labelled options and exactly one recommendation.`);
    }
    return {
      id: `Q${questionIndex + 1}`,
      question: question.question.trim().slice(0, 1_000),
      whyItMatters: question.whyItMatters.trim().slice(0, 2_000),
      options,
      allowCustom: question.allowCustom !== false,
      answer: null,
      answerSource: null,
      resolvedAt: null,
    };
  });
}

export function parseFastChangeContract(text, repositoryPath = null) {
  const value = parseLabelledJson(text, "fast-change-contract");
  const acceptanceCriteria = Array.isArray(value.acceptanceCriteria)
    ? value.acceptanceCriteria.map((entry) => String(entry).trim()).filter(Boolean).slice(0, 12)
    : [];
  const ownedPaths = Array.isArray(value.ownedPaths)
    ? value.ownedPaths.map((entry) => normalizeOwnedPath(entry, repositoryPath)).filter(Boolean).slice(0, 20)
    : [];
  const verificationCommandIds = normalizeVerificationCommandIds(value.verificationCommandIds, "Fast change contract");
  if (!acceptanceCriteria.length) throw new Error("The fast change contract needs at least one authoritative acceptance criterion.");
  if (!ownedPaths.length) throw new Error("The fast change contract needs one to three repository-relative owned paths.");
  if (!verificationCommandIds.length) throw new Error("The fast change contract needs at least one repository manifest command ID.");
  return {
    acceptanceCriteria,
    ownedPaths,
    verificationCommandIds,
    unresolvedDecisions: Array.isArray(value.unresolvedDecisions)
      ? value.unresolvedDecisions.map((entry) => String(entry).trim()).filter(Boolean).slice(0, 8)
      : [],
    riskSignals: Array.isArray(value.riskSignals)
      ? value.riskSignals.map((entry) => String(entry).trim()).filter(Boolean).slice(0, 12)
      : [],
    workPackage: {
      id: "S1",
      title: String(value.title ?? "Bounded fast change").trim().slice(0, 300) || "Bounded fast change",
      description: String(value.description ?? acceptanceCriteria.join(" ")).trim().slice(0, 3_000),
      dependencies: [],
      batch: 1,
      ownedPaths,
      verification: verificationCommandIds,
      verificationCommandIds,
      verificationRuns: [],
      status: "planned",
      attempts: 0,
      branch: null,
      worktreePath: null,
      baseRevision: null,
      headRevision: null,
      files: [],
      error: null,
    },
  };
}

export function parseFocusedTestEvidence(text) {
  const value = parseCandidateEvidenceJson(text, "focused-test-evidence");
  const binding = readExplicitCandidateBinding(value);
  if (!binding.valid) throw candidateEvidenceError(binding.code);
  if (typeof value.command !== "string" || !value.command.trim()) {
    throw candidateEvidenceError("contradictory_evidence", "Focused test evidence must include a string command.");
  }
  if (value.durationMs != null && (!Number.isFinite(value.durationMs) || value.durationMs < 0)) {
    throw candidateEvidenceError("contradictory_evidence", "Focused test evidence durationMs must be a non-negative number or null.");
  }
  for (const field of ["startedAt", "completedAt"]) {
    if (value[field] != null && !isCanonicalIsoTimestamp(value[field])) {
      throw candidateEvidenceError(
        "contradictory_evidence",
        `Focused test evidence ${field} must be a canonical ISO timestamp or null.`,
      );
    }
  }
  const rows = Array.isArray(value.rows) ? value.rows : [];
  if (!rows.length) {
    throw candidateEvidenceError("contradictory_evidence", "Focused test evidence must include at least one row.");
  }
  if (!["passed", "failed"].includes(value.status)) {
    throw candidateEvidenceError("contradictory_evidence", "Focused test evidence status must be passed or failed.");
  }
  const normalized = {
    candidateId: binding.candidateId,
    candidateRevision: binding.candidateRevision,
    bindingExplicit: true,
    command: value.command.trim().slice(0, 2_000),
    status: value.status,
    startedAt: value.startedAt ?? null,
    completedAt: value.completedAt ?? null,
    durationMs: normalizeDuration(value.durationMs),
    rows: rows.map((row, rowIndex) => normalizeFocusedTestRow(row, rowIndex, value)),
  };
  const identities = new Set([
    `${normalized.candidateId}:${normalized.candidateRevision}`,
    ...normalized.rows.map((row) => `${row.candidateId}:${row.candidateRevision}`),
  ]);
  if (identities.size > 1) throw candidateEvidenceError("mixed_evidence");
  const derivedStatus = normalized.rows.every((row) => row.status === "passed") ? "passed" : "failed";
  if (normalized.status !== derivedStatus) {
    throw candidateEvidenceError(
      "contradictory_evidence",
      `Focused test evidence status ${normalized.status} contradicts its ${derivedStatus} rows.`,
    );
  }
  return normalized;
}

export function validateFocusedTestEvidence(evidence, candidate) {
  if (!candidate?.id || !Number.isInteger(candidate.revisionNumber)) throw new Error("Focused test evidence requires an active candidate identity.");
  if (!Array.isArray(evidence?.rows)) throw new Error("Focused test evidence must include a rows array.");
  if (evidence?.bindingExplicit !== true) throw candidateEvidenceError("missing_binding");
  const implicitRow = evidence.rows.find((row) => row?.bindingExplicit !== true);
  if (implicitRow) throw candidateEvidenceError("missing_binding");
  const identities = new Set([
    `${evidence.candidateId}:${evidence.candidateRevision}`,
    ...evidence.rows.map((row) => `${row.candidateId}:${row.candidateRevision}`),
  ]);
  if (identities.size > 1) throw candidateEvidenceError("mixed_evidence");
  const identityReason = compareEvidenceBinding(evidence, candidate);
  if (identityReason) throw candidateEvidenceError(identityReason);
  return evidence;
}

/**
 * Recorded live (AH-001 dev-review): a reviewer described a finding spanning two
 * lines as `"line": "38-39"` — a natural way to cite a multi-line finding, not a
 * malformed one — and the strict "integer or null" check discarded an otherwise
 * clean PASS verdict as "contradictory evidence", forcing a pointless rerun. The
 * frontend's `line` field is typed `number | null` for file:line navigation, so a
 * range still resolves to a single number: its start.
 *
 * The range separator is required (not `\d+` alone): a lone numeric string like
 * `"142"` stays rejected rather than silently coerced, which is what "rejects
 * unsupported gate finding field types before normalization" pins down deliberately
 * — only an *actual* range is a legitimate reason `line` would ever be a string.
 */
function normalizeGateFindingLine(value, index) {
  if (value == null) return null;
  if (Number.isInteger(value) && value >= 1) return value;
  if (typeof value === "string") {
    const match = value.trim().match(/^(\d+)\s*[-–—]\s*\d+$/);
    const line = match ? Number.parseInt(match[1], 10) : NaN;
    if (Number.isInteger(line) && line >= 1) return line;
  }
  throw candidateEvidenceError(
    "contradictory_evidence",
    `Gate finding ${index + 1} line must be a positive integer, a "start-end" line range, or null.`,
  );
}

export function parseGateEvidence(text, candidate, stageId) {
  if (!["dev-review", "final-review"].includes(stageId)) {
    throw new Error(`Structured gate evidence is not supported for ${stageId}.`);
  }
  const value = parseCandidateEvidenceJson(text, "gate-evidence");
  if (!candidate?.id || !Number.isInteger(candidate.revisionNumber)) {
    throw new Error("Gate evidence requires an active candidate identity.");
  }
  const binding = readExplicitCandidateBinding(value);
  if (!binding.valid) throw candidateEvidenceError(binding.code);
  const candidateId = binding.candidateId;
  const candidateRevision = binding.candidateRevision;
  if (!["PASS", "REPAIR"].includes(value?.verdict)) {
    throw candidateEvidenceError("contradictory_evidence", "Gate evidence verdict must be PASS or REPAIR.");
  }
  if (!Array.isArray(value.findings)) {
    throw candidateEvidenceError("contradictory_evidence", "Gate evidence must include a findings array.");
  }
  const findings = value.findings.map((finding, index) => {
    if (!finding || typeof finding !== "object" || Array.isArray(finding)) {
      throw candidateEvidenceError("contradictory_evidence", `Gate finding ${index + 1} must be an object.`);
    }
    if (typeof finding.severity !== "string") {
      throw candidateEvidenceError("contradictory_evidence", `Gate finding ${index + 1} severity must be a string.`);
    }
    const severity = finding.severity.toUpperCase();
    if (!["P0", "P1", "P2", "P3"].includes(severity)) {
      throw candidateEvidenceError(
        "contradictory_evidence",
        `Gate finding ${index + 1} must have severity P0, P1, P2, or P3.`,
      );
    }
    if (typeof finding.title !== "string" || typeof finding.detail !== "string") {
      throw candidateEvidenceError("contradictory_evidence", `Gate finding ${index + 1} title and detail must be strings.`);
    }
    if (finding.file != null && typeof finding.file !== "string") {
      throw candidateEvidenceError("contradictory_evidence", `Gate finding ${index + 1} file must be a string or null.`);
    }
    const line = normalizeGateFindingLine(finding.line, index);
    const title = finding.title.trim();
    const detail = finding.detail.trim();
    if (!title || !detail) {
      throw candidateEvidenceError(
        "contradictory_evidence",
        `Gate finding ${index + 1} is missing its title or detail.`,
      );
    }
    const hasFindingCandidateId = Object.prototype.hasOwnProperty.call(finding ?? {}, "candidateId");
    const hasFindingCandidateRevision = Object.prototype.hasOwnProperty.call(finding ?? {}, "candidateRevision");
    const findingExplicitBinding = hasFindingCandidateId && hasFindingCandidateRevision;
    if (hasFindingCandidateId !== hasFindingCandidateRevision) throw candidateEvidenceError("malformed_binding");
    const findingBinding = findingExplicitBinding ? readExplicitCandidateBinding(finding) : binding;
    if (!findingBinding.valid) throw candidateEvidenceError(findingBinding.code);
    const acceptanceCriterion = typeof finding.acceptanceCriterion === "string" && finding.acceptanceCriterion.trim()
      ? finding.acceptanceCriterion.trim().slice(0, 2_000)
      : null;
    const reproductionEvidence = typeof finding.reproductionEvidence === "string" && finding.reproductionEvidence.trim()
      ? finding.reproductionEvidence.trim().slice(0, 4_000)
      : null;
    const blocking = severity === "P0" || severity === "P1" || (finding.blocking === true && acceptanceCriterion != null);
    if (blocking && !reproductionEvidence) {
      throw candidateEvidenceError(
        "contradictory_evidence",
        `Blocking gate finding ${index + 1} must include deterministic reproductionEvidence.`,
      );
    }
    return {
      severity,
      title,
      detail,
      file: finding.file == null ? null : finding.file.trim(),
      line,
      candidateId: findingBinding.candidateId,
      candidateRevision: findingBinding.candidateRevision,
      bindingExplicit: findingExplicitBinding,
      blocking,
      acceptanceCriterion,
      reproductionEvidence,
    };
  });
  const identities = new Set([
    `${candidateId}:${candidateRevision}`,
    ...findings.map((finding) => `${finding.candidateId}:${finding.candidateRevision}`),
  ]);
  if (identities.size > 1) throw candidateEvidenceError("mixed_evidence");
  const identityReason = compareEvidenceBinding(binding, candidate);
  if (identityReason) throw candidateEvidenceError(identityReason);
  const blockingFindings = findings.filter((finding) => finding.blocking);
  const verdict = blockingFindings.length === 0 && findings.every((finding) => finding.bindingExplicit)
    ? "PASS"
    : "REPAIR";
  return {
    schemaVersion: 1,
    stage: stageId,
    candidateId,
    candidateRevision,
    verdict,
    reportedVerdict: value.verdict,
    summary: String(value.summary ?? "").trim().slice(0, 4_000),
    findings,
    blockingReasons: [
      ...blockingFindings.map((finding) => `${finding.severity}: ${finding.title}${finding.reproductionEvidence ? ` — ${finding.reproductionEvidence}` : ""}`),
      ...findings
        .filter((finding) => !finding.bindingExplicit)
        .map((finding) => `Finding ${finding.title} is missing explicit candidate identity fields.`),
    ],
  };
}

export function tryParseFocusedTestEvidence(text) {
  try {
    return parseFocusedTestEvidence(text);
  } catch (error) {
    if (isCandidateEvidenceError(error) && error.code === "missing_authoritative_summary") return null;
    if (isCandidateEvidenceError(error)) throw error;
    throw candidateEvidenceError("contradictory_evidence");
  }
}

export function parseWorkPackages(text, repositoryPath = null) {
  const value = parseLabelledJson(text, "work-packages");
  if (!Array.isArray(value.packages) || value.packages.length < 1 || value.packages.length > 8) {
    throw new Error("The plan must contain 1-8 work packages.");
  }
  const ids = value.packages.map((item) => String(item?.id ?? "").trim().toUpperCase());
  if (new Set(ids).size !== ids.length || ids.some((id, index) => id !== `S${index + 1}`)) {
    throw new Error("Work package IDs must be unique and ordered as S1, S2, and so on.");
  }
  const packages = value.packages.map((item, index) => {
    const dependencies = Array.isArray(item.dependencies)
      ? item.dependencies.map((entry) => String(entry).trim().toUpperCase())
      : [];
    if (dependencies.some((dependency) => !ids.includes(dependency) || dependency === ids[index])) {
      throw new Error(`${ids[index]} has an unknown or self dependency.`);
    }
    return {
      id: ids[index],
      title: String(item.title ?? "").trim().slice(0, 300),
      description: String(item.description ?? "").trim().slice(0, 3_000),
      dependencies: [...new Set(dependencies)],
      batch: 0,
      ownedPaths: Array.isArray(item.ownedPaths)
        ? item.ownedPaths
            .map((entry) => normalizeOwnedPath(entry, repositoryPath))
            .filter(Boolean)
            .slice(0, 40)
        : [],
      verification: Array.isArray(item.verification)
        ? item.verification.map((entry) => String(entry).trim()).filter(Boolean).slice(0, 20)
        : [],
      verificationCommandIds: normalizeVerificationCommandIds(
        item.verificationCommandIds ?? item.verification,
        ids[index],
        { tolerateLegacyProse: true },
      ),
      verificationRuns: [],
      status: "planned",
      attempts: 0,
      branch: null,
      worktreePath: null,
      baseRevision: null,
      headRevision: null,
      files: [],
      error: null,
    };
  });
  if (packages.some((item) => !item.title || !item.description)) {
    throw new Error("Every work package needs a title and description.");
  }
  if (packages.some((item) => item.ownedPaths.length === 0)) {
    throw new Error("Every work package needs at least one explicit repository-relative owned path.");
  }
  const byId = new Map(packages.map((item) => [item.id, item]));
  const visiting = new Set();
  const visited = new Set();
  const batchFor = (item) => {
    if (visited.has(item.id)) return item.batch;
    if (visiting.has(item.id)) throw new Error("Work package dependencies must be acyclic.");
    visiting.add(item.id);
    item.batch = item.dependencies.length
      ? Math.max(...item.dependencies.map((dependency) => batchFor(byId.get(dependency)))) + 1
      : 1;
    visiting.delete(item.id);
    visited.add(item.id);
    return item.batch;
  };
  for (const item of packages) batchFor(item);
  for (let left = 0; left < packages.length; left += 1) {
    for (let right = left + 1; right < packages.length; right += 1) {
      const a = packages[left];
      const b = packages[right];
      const independent = !dependsOn(a, b.id, byId) && !dependsOn(b, a.id, byId);
      const overlap = a.ownedPaths.find((entry) => b.ownedPaths.some((other) => ownedPathsOverlap(entry, other)));
      if (independent && overlap) throw new Error(`${a.id} and ${b.id} both own ${overlap} without a dependency.`);
    }
  }
  return packages;
}

function normalizeVerificationCommandIds(value, label, options = {}) {
  if (!Array.isArray(value)) return [];
  const ids = [];
  for (const entry of value.slice(0, 20)) {
    const id = String(entry ?? "").trim();
    if (!id) continue;
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(id)) {
      if (options.tolerateLegacyProse) continue;
      throw new Error(`${label} verificationCommandIds must contain lowercase repository manifest command IDs.`);
    }
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

function normalizeOwnedPath(value, repositoryPath) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  let normalized = raw.replaceAll("\\", "/");
  const pathApi = path.win32.isAbsolute(raw) ? path.win32 : path;
  if (pathApi.isAbsolute(raw)) {
    if (!repositoryPath) throw new Error(`Owned path must be repository-relative: ${raw}`);
    const repositoryApi = path.win32.isAbsolute(repositoryPath) ? path.win32 : path;
    if (repositoryApi !== pathApi) throw new Error(`Owned path uses a different path style than the repository: ${raw}`);
    const repositoryRoot = repositoryApi.resolve(repositoryPath);
    const resolved = repositoryApi.resolve(raw);
    const relative = repositoryApi.relative(repositoryRoot, resolved);
    if (!relative || relative === ".") throw new Error("A work package cannot own the repository root.");
    if (relative.startsWith(`..${repositoryApi.sep}`) || relative === ".." || repositoryApi.isAbsolute(relative)) {
      throw new Error(`Owned path is outside the selected repository: ${raw}`);
    }
    normalized = relative.replaceAll("\\", "/");
  }
  const segments = normalized.split("/").filter(Boolean);
  if (!segments.length || segments.some((segment) => segment === ".." || segment === ".")) {
    throw new Error(`Owned path must be a safe repository-relative path: ${raw}`);
  }
  return segments.join("/");
}

export function isOwnedFile(file, ownedPaths) {
  const normalizedFile = canonicalOwnedPath(file);
  return ownedPaths.some((ownedPath) => {
    const normalizedOwned = canonicalOwnedPath(ownedPath);
    return normalizedFile === normalizedOwned || normalizedFile.startsWith(`${normalizedOwned}/`);
  });
}

function ownedPathsOverlap(left, right) {
  const a = canonicalOwnedPath(left);
  const b = canonicalOwnedPath(right);
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function canonicalOwnedPath(value) {
  return String(value ?? "").trim().replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/g, "").toLowerCase();
}

function dependsOn(item, targetId, byId, seen = new Set()) {
  if (seen.has(item.id)) return false;
  seen.add(item.id);
  if (item.dependencies.includes(targetId)) return true;
  return item.dependencies.some((dependency) => dependsOn(byId.get(dependency), targetId, byId, seen));
}

function normalizeFocusedTestRow(row, rowIndex, parent) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw candidateEvidenceError("contradictory_evidence", `Focused test row ${rowIndex + 1} must be an object.`);
  }
  validateFocusedTestRowFields(row, rowIndex);
  const hasCandidateId = Object.prototype.hasOwnProperty.call(row ?? {}, "candidateId");
  const hasCandidateRevision = Object.prototype.hasOwnProperty.call(row ?? {}, "candidateRevision");
  const explicitBinding = hasCandidateId && hasCandidateRevision;
  if (hasCandidateId !== hasCandidateRevision) throw candidateEvidenceError("malformed_binding");
  const binding = explicitBinding ? readExplicitCandidateBinding(row) : readExplicitCandidateBinding(parent);
  if (!binding.valid) throw candidateEvidenceError(binding.code);
  if (!["passed", "failed"].includes(row?.status)) {
    throw candidateEvidenceError(
      "contradictory_evidence",
      `Focused test row ${rowIndex + 1} status must be passed or failed.`,
    );
  }
  const status = row.status;
  const assertions = Array.isArray(row?.assertions)
    ? row.assertions.map((assertion, assertionIndex) => ({
        label: String(assertion?.label ?? "").trim().slice(0, 300) || `Assertion ${assertionIndex + 1}`,
        actual: String(assertion?.actual ?? "").trim().slice(0, 1_000),
        expected: assertion?.expected == null ? null : String(assertion.expected).trim().slice(0, 1_000),
      }))
    : [];
  return {
    id: String(row?.id ?? `row-${rowIndex + 1}`).trim() || `row-${rowIndex + 1}`,
    bindingExplicit: explicitBinding,
    candidateId: binding.candidateId,
    candidateRevision: binding.candidateRevision,
    command: String(row?.command ?? parent.command ?? "").trim().slice(0, 2_000),
    status,
    durationMs: normalizeDuration(row?.durationMs),
    title: String(row?.title ?? "").trim().slice(0, 300) || `Focused test ${rowIndex + 1}`,
    artifactReferences: Array.isArray(row?.artifactReferences)
      ? row.artifactReferences.map((reference) => ({
          name: String(reference?.name ?? "").trim().slice(0, 300),
          path: reference?.path == null ? null : String(reference.path).trim().slice(0, 1_000),
          kind: String(reference?.kind ?? "artifact").trim().slice(0, 100),
        }))
      : [],
    assertions,
    failureDetails: row?.failureDetails == null ? null : String(row.failureDetails).trim().slice(0, 5_000),
  };
}

function validateFocusedTestRowFields(row, rowIndex) {
  const label = `Focused test row ${rowIndex + 1}`;
  for (const field of ["id", "command", "title", "failureDetails"]) {
    if (row[field] != null && typeof row[field] !== "string") {
      throw candidateEvidenceError("contradictory_evidence", `${label} ${field} must be a string or null.`);
    }
  }
  if (row.durationMs != null && (!Number.isFinite(row.durationMs) || row.durationMs < 0)) {
    throw candidateEvidenceError("contradictory_evidence", `${label} durationMs must be a non-negative number or null.`);
  }
  if (row.artifactReferences != null && !Array.isArray(row.artifactReferences)) {
    throw candidateEvidenceError("contradictory_evidence", `${label} artifactReferences must be an array.`);
  }
  for (const [referenceIndex, reference] of (row.artifactReferences ?? []).entries()) {
    if (!reference || typeof reference !== "object" || Array.isArray(reference)) {
      throw candidateEvidenceError("contradictory_evidence", `${label} artifact reference ${referenceIndex + 1} must be an object.`);
    }
    if (reference.name != null && typeof reference.name !== "string") {
      throw candidateEvidenceError("contradictory_evidence", `${label} artifact reference ${referenceIndex + 1} name must be a string or null.`);
    }
    if (reference.path != null && typeof reference.path !== "string") {
      throw candidateEvidenceError("contradictory_evidence", `${label} artifact reference ${referenceIndex + 1} path must be a string or null.`);
    }
    if (reference.kind != null && typeof reference.kind !== "string") {
      throw candidateEvidenceError("contradictory_evidence", `${label} artifact reference ${referenceIndex + 1} kind must be a string or null.`);
    }
  }
  if (row.assertions != null && !Array.isArray(row.assertions)) {
    throw candidateEvidenceError("contradictory_evidence", `${label} assertions must be an array.`);
  }
  for (const [assertionIndex, assertion] of (row.assertions ?? []).entries()) {
    if (!assertion || typeof assertion !== "object" || Array.isArray(assertion)) {
      throw candidateEvidenceError("contradictory_evidence", `${label} assertion ${assertionIndex + 1} must be an object.`);
    }
    for (const field of ["label", "actual", "expected"]) {
      if (assertion[field] != null && typeof assertion[field] !== "string") {
        throw candidateEvidenceError(
          "contradictory_evidence",
          `${label} assertion ${assertionIndex + 1} ${field} must be a string or null.`,
        );
      }
    }
  }
}

function normalizeDuration(value) {
  if (value == null || value === "") return null;
  const duration = Number(value);
  return Number.isFinite(duration) && duration >= 0 ? duration : null;
}
