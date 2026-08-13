export const WORKFLOW_PROFILE_IDS = Object.freeze(["fast", "standard", "high-risk"]);

const HIGH_RISK_SIGNALS = Object.freeze([
  [
    "security or access control",
    /\b(security|authentication|authorization|permission|credential|secret|encryption|privacy)\b/i,
  ],
  ["schema or migration", /\b(schema|migration|database|backfill|ddl|data[- ]integrity)\b/i],
  ["concurrency", /\b(concurrency|race condition|locking|deadlock|atomicity|parallel write)\b/i],
  [
    "broad architecture",
    /\b(architecture|architectural|cross[- ]cutting|rewrite|large refactor|multi[- ]package)\b/i,
  ],
]);

const FAST_SIGNALS = Object.freeze([
  ["copy or documentation", /\b(copy|wording|label|typo|documentation|readme|help text)\b/i],
  ["isolated styling", /\b(css|style|styling|colour|color|spacing|padding|margin|font|visual polish)\b/i],
  ["explicitly narrow scope", /\b(small|tiny|narrow|isolated|single[- ]file|one[- ]file)\b/i],
]);

const SENSITIVE_PATH =
  /(^|\/)(auth|security|migrations?|schema|database|infra|terraform|permissions?|secrets?)(\/|$)/i;

function now() {
  return new Date().toISOString();
}

export function selectWorkflowProfile(input = {}) {
  const requested = WORKFLOW_PROFILE_IDS.includes(input.requestedProfile) ? input.requestedProfile : null;
  const text = `${input.title ?? ""}\n${input.description ?? ""}`;
  const highRisk = matchingSignals(text, HIGH_RISK_SIGNALS);
  const fast = matchingSignals(text, FAST_SIGNALS);
  let selected = requested;
  let source = requested ? "operator" : "automatic";
  let reason;

  if (requested === "fast" && highRisk.length) {
    selected = "high-risk";
    source = "automatic-escalation";
    reason = `Fast was requested, but deterministic triage found ${highRisk.join(", ")}.`;
  } else if (requested) {
    reason = `Operator selected the ${requested} workflow profile at task creation.`;
  } else if (highRisk.length) {
    selected = "high-risk";
    reason = `Deterministic triage selected high-risk because the task names ${highRisk.join(", ")}.`;
  } else if (fast.length) {
    selected = "fast";
    reason = `Deterministic triage selected fast because the task is limited to ${fast.join(", ")} and names no high-risk boundary.`;
  } else {
    selected = "standard";
    reason =
      "Deterministic triage selected standard because the task does not prove a narrow fast-path scope or a high-risk boundary.";
  }

  const selectedAt = now();
  return {
    selected,
    reason,
    source,
    selectedAt,
    history: [{ from: null, to: selected, reason, source, at: selectedAt }],
  };
}

export function migratedStandardProfile() {
  const selectedAt = now();
  const reason = "Existing persisted task migrated to the compatibility-safe standard workflow profile.";
  return {
    selected: "standard",
    reason,
    source: "migration",
    selectedAt,
    history: [{ from: null, to: "standard", reason, source: "migration", at: selectedAt }],
  };
}

export function recordWorkflowProfile(task, selected, reason, source = "automatic-escalation") {
  if (!WORKFLOW_PROFILE_IDS.includes(selected)) throw new Error(`Unknown workflow profile: ${selected}`);
  const prior = task.workflowProfile?.selected ?? "standard";
  if (prior === selected && task.workflowProfile) return false;
  const at = now();
  const history = Array.isArray(task.workflowProfile?.history) ? task.workflowProfile.history : [];
  task.workflowProfile = {
    selected,
    reason: String(reason).trim().slice(0, 2_000),
    source,
    selectedAt: at,
    history: [
      ...history,
      { from: prior, to: selected, reason: String(reason).trim().slice(0, 2_000), source, at },
    ],
  };
  const policies = task.agentConfig?.profileStagePolicies?.[selected];
  if (policies) task.agentConfig.stagePolicies = structuredClone(policies);
  return true;
}

export function fastEscalation(input = {}) {
  if (input.profile !== "fast") return null;
  const reasons = [];
  let target = "standard";

  if (input.kind === "triage") {
    const highRisk = matchingSignals(
      `${input.text ?? ""}\n${(input.riskSignals ?? []).join("\n")}`,
      HIGH_RISK_SIGNALS,
    );
    if (highRisk.length) {
      target = "high-risk";
      reasons.push(`triage discovered ${highRisk.join(", ")}`);
    }
    if ((input.unresolvedDecisions ?? []).length)
      reasons.push("authoritative acceptance criteria still contain unresolved decisions");
    if ((input.ownedPaths ?? []).length > 3) reasons.push("the bounded contract owns more than three paths");
    if (topLevelBoundaries(input.ownedPaths).size > 1)
      reasons.push("the bounded contract crosses repository boundaries");
  }

  if (input.kind === "plan") {
    if ((input.packageCount ?? 0) !== 1) reasons.push("fast requires exactly one coherent work package");
    if ((input.dependencyCount ?? 0) > 0) reasons.push("the work package crosses a dependency boundary");
  }

  if (input.kind === "changed-paths") {
    const files = (input.files ?? []).map(normalizePath).filter(Boolean);
    if (files.length > 3) reasons.push(`the implementation changed ${files.length} files`);
    if (topLevelBoundaries(files).size > 1) reasons.push("the implementation crossed repository boundaries");
    if (files.some((file) => SENSITIVE_PATH.test(file))) {
      target = "high-risk";
      reasons.push("the implementation changed a sensitive path");
    }
  }

  if (input.kind === "verification-failure") reasons.push("focused package verification failed");
  if (input.kind === "review-risk") {
    reasons.push("independent review confirmed candidate risk outside the fast-path limit");
    if (input.architectural === true) target = "high-risk";
  }

  if (!reasons.length) return null;
  return {
    target,
    reason: `Fast automatically escalated to ${target}: ${reasons.join("; ")}.`,
  };
}

export function canOverrideWorkflowProfile(task) {
  if (
    ["running", "cancelling", "merging", "merged-to-target", "completed", "closed", "archived"].includes(
      task?.status,
    )
  )
    return false;
  if ((task?.candidates ?? []).length) return false;
  return !(task?.workPackages ?? []).some((workPackage) =>
    ["running", "ready_for_integration", "integrated"].includes(workPackage.status),
  );
}

export function isArchitecturalRisk(findings = []) {
  return findings.some((finding) =>
    HIGH_RISK_SIGNALS.some(([, expression]) =>
      expression.test(`${finding?.title ?? ""} ${finding?.detail ?? ""} ${finding?.file ?? ""}`),
    ),
  );
}

function matchingSignals(text, definitions) {
  return definitions.filter(([, expression]) => expression.test(text)).map(([label]) => label);
}

function topLevelBoundaries(paths = []) {
  return new Set(
    paths
      .map(normalizePath)
      .filter(Boolean)
      .map((file) => file.split("/")[0])
      .filter((boundary) => !["test", "tests", "__tests__", "docs"].includes(boundary)),
  );
}

function normalizePath(value) {
  return String(value ?? "")
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\.\//, "");
}
