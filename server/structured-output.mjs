import path from "node:path";

function parseLabelledJson(text, label) {
  const expression = new RegExp(`<${label}>\\s*([\\s\\S]*?)\\s*</${label}>`, "i");
  const match = String(text ?? "").match(expression);
  if (!match) throw new Error(`The agent did not return the required ${label} JSON block.`);
  try {
    return JSON.parse(match[1].trim());
  } catch (error) {
    throw new Error(`The ${label} JSON block was invalid: ${error.message}`);
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

export function parseFocusedTestEvidence(text) {
  const value = parseLabelledJson(text, "focused-test-evidence");
  if (!value?.candidateId?.trim()) throw new Error("Focused test evidence must include a candidateId.");
  if (!Number.isInteger(value.candidateRevision) || value.candidateRevision < 1) {
    throw new Error("Focused test evidence must include a positive candidateRevision.");
  }
  if (!value.command?.trim()) throw new Error("Focused test evidence must include a command.");
  const rows = Array.isArray(value.rows) ? value.rows : [];
  if (!rows.length) throw new Error("Focused test evidence must include at least one row.");
  return {
    candidateId: value.candidateId.trim(),
    candidateRevision: value.candidateRevision,
    command: value.command.trim().slice(0, 2_000),
    status: value.status === "failed" ? "failed" : "passed",
    startedAt: value.startedAt ?? null,
    completedAt: value.completedAt ?? null,
    durationMs: normalizeDuration(value.durationMs),
    rows: rows.map((row, rowIndex) => normalizeFocusedTestRow(row, rowIndex, value)),
  };
}

export function tryParseFocusedTestEvidence(text) {
  try {
    return parseFocusedTestEvidence(text);
  } catch (error) {
    if (String(error?.message ?? "").includes("focused-test-evidence")) return null;
    if (String(error?.message ?? "").includes("Focused test evidence must include")) throw error;
    return null;
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
      const overlap = a.ownedPaths.find((entry) => b.ownedPaths.includes(entry));
      if (independent && overlap) throw new Error(`${a.id} and ${b.id} both own ${overlap} without a dependency.`);
    }
  }
  return packages;
}

function normalizeOwnedPath(value, repositoryPath) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  let normalized = raw.replaceAll("\\", "/");
  if (path.isAbsolute(raw)) {
    if (!repositoryPath) throw new Error(`Owned path must be repository-relative: ${raw}`);
    const repositoryRoot = path.resolve(repositoryPath);
    const resolved = path.resolve(raw);
    const relative = path.relative(repositoryRoot, resolved);
    if (!relative || relative === ".") throw new Error("A work package cannot own the repository root.");
    if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
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

function dependsOn(item, targetId, byId, seen = new Set()) {
  if (seen.has(item.id)) return false;
  seen.add(item.id);
  if (item.dependencies.includes(targetId)) return true;
  return item.dependencies.some((dependency) => dependsOn(byId.get(dependency), targetId, byId, seen));
}

function normalizeFocusedTestRow(row, rowIndex, parent) {
  const candidateId = String(row?.candidateId ?? parent.candidateId ?? "").trim();
  const candidateRevision = Number.isInteger(row?.candidateRevision)
    ? row.candidateRevision
    : parent.candidateRevision;
  if (!candidateId) throw new Error(`Focused test row ${rowIndex + 1} must include a candidateId.`);
  if (!Number.isInteger(candidateRevision) || candidateRevision < 1) {
    throw new Error(`Focused test row ${rowIndex + 1} must include a positive candidateRevision.`);
  }
  const status = row?.status === "failed" ? "failed" : "passed";
  const assertions = Array.isArray(row?.assertions)
    ? row.assertions.map((assertion, assertionIndex) => ({
        label: String(assertion?.label ?? "").trim().slice(0, 300) || `Assertion ${assertionIndex + 1}`,
        actual: String(assertion?.actual ?? "").trim().slice(0, 1_000),
        expected: assertion?.expected == null ? null : String(assertion.expected).trim().slice(0, 1_000),
      }))
    : [];
  return {
    id: String(row?.id ?? `row-${rowIndex + 1}`).trim() || `row-${rowIndex + 1}`,
    candidateId,
    candidateRevision,
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

function normalizeDuration(value) {
  if (value == null || value === "") return null;
  const duration = Number(value);
  return Number.isFinite(duration) && duration >= 0 ? duration : null;
}
