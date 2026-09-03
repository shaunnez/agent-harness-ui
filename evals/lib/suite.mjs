import { readFile } from "node:fs/promises";
import path from "node:path";
import { VALID_WORKFLOWS, validateAttachments } from "../../server/api.mjs";

// Section 4.1 of docs/model-evaluation-plan.md. Keep this list in sync with that schema; an
// unrecognised key is always a typo in a hand-written suite file, never a feature to silently
// accept.
const SUITE_KEYS = new Set([
  "schemaVersion",
  "suiteId",
  "repositoryPath",
  "frozenBaseSha",
  "verificationCommands",
  "cases",
]);

const CASE_KEYS = new Set([
  "caseId",
  "shape",
  "title",
  "description",
  "workflow",
  "workflowProfile",
  "attachments",
  "acceptanceCriteria",
  "verificationCommands",
]);

const ATTACHMENT_KEYS = new Set(["path"]);
const CASE_SHAPES = new Set(["single-package", "multi-package"]);
// "auto" plus the values `WORKFLOW_PROFILE_IDS` names — mirrors the check in
// `task-creation-routes.mjs` so a suite case can request anything the create route accepts.
const WORKFLOW_PROFILES = new Set(["auto", "fast", "standard", "high-risk"]);
const FROZEN_SHA_PATTERN = /^[a-f0-9]{40,64}$/i;
const ATTACHMENT_MIME_TYPES = new Map([
  [".html", "text/html"],
  [".htm", "text/html"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
  [".zip", "application/zip"],
]);

/**
 * Load and validate a suite file (section 4.1). Returns plain objects shaped for the
 * `POST /api/tasks` payload the runner (WP3) will send: case-level `verificationCommands`
 * inheritance is already resolved, and attachments are already read from disk and base64-encoded.
 */
export async function loadSuite(suitePath) {
  const absolutePath = path.resolve(suitePath);
  const raw = await readJsonFile(absolutePath, "suite");
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("suite must be a JSON object.");
  assertOnlyKeys(raw, SUITE_KEYS, "suite");

  if (raw.schemaVersion !== 1)
    throw new Error(`suite.schemaVersion must be 1, got ${JSON.stringify(raw.schemaVersion)}.`);
  const suiteId = requireNonEmptyString(raw.suiteId, "suite.suiteId");
  const repositoryPath = resolveRepositoryPath(raw.repositoryPath);
  const frozenBaseSha = requireFrozenBaseSha(raw.frozenBaseSha);
  const verificationCommands = requireStringList(raw.verificationCommands, "suite.verificationCommands");
  if (!Array.isArray(raw.cases) || raw.cases.length === 0)
    throw new Error("suite.cases must be a non-empty array.");

  const baseDir = path.dirname(absolutePath);
  const cases = [];
  const seenCaseIds = new Set();
  for (const [index, rawCase] of raw.cases.entries()) {
    const loaded = await loadCase(rawCase, index, {
      suiteVerificationCommands: verificationCommands,
      baseDir,
    });
    if (seenCaseIds.has(loaded.caseId))
      throw new Error(`suite.cases has a duplicate caseId: "${loaded.caseId}".`);
    seenCaseIds.add(loaded.caseId);
    cases.push(loaded);
  }

  return { schemaVersion: 1, suiteId, repositoryPath, frozenBaseSha, verificationCommands, cases };
}

async function loadCase(rawCase, index, { suiteVerificationCommands, baseDir }) {
  const positionalLabel = `suite.cases[${index}]`;
  if (!rawCase || typeof rawCase !== "object" || Array.isArray(rawCase))
    throw new Error(`${positionalLabel} must be an object.`);
  assertOnlyKeys(rawCase, CASE_KEYS, positionalLabel);
  const caseId = requireNonEmptyString(rawCase.caseId, `${positionalLabel}.caseId`);
  const label = `suite.cases["${caseId}"]`;

  if (!CASE_SHAPES.has(rawCase.shape))
    throw new Error(`${label}.shape must be one of: ${[...CASE_SHAPES].join(", ")}.`);
  const title = requireNonEmptyString(rawCase.title, `${label}.title`);
  const description = requireNonEmptyString(rawCase.description, `${label}.description`);
  if (!VALID_WORKFLOWS.has(rawCase.workflow))
    throw new Error(`${label}.workflow must be one of: ${[...VALID_WORKFLOWS].join(", ")}.`);
  if (!WORKFLOW_PROFILES.has(rawCase.workflowProfile))
    throw new Error(`${label}.workflowProfile must be one of: ${[...WORKFLOW_PROFILES].join(", ")}.`);
  const acceptanceCriteria = requireStringList(rawCase.acceptanceCriteria, `${label}.acceptanceCriteria`);
  const verificationCommands =
    rawCase.verificationCommands === null || rawCase.verificationCommands === undefined
      ? [...suiteVerificationCommands]
      : requireStringList(rawCase.verificationCommands, `${label}.verificationCommands`);
  const attachments = await loadAttachments(rawCase.attachments, `${label}.attachments`, baseDir);

  return {
    caseId,
    shape: rawCase.shape,
    title,
    description,
    workflow: rawCase.workflow,
    workflowProfile: rawCase.workflowProfile,
    attachments,
    acceptanceCriteria,
    verificationCommands,
  };
}

async function loadAttachments(value, field, baseDir) {
  if (value === undefined) throw new Error(`${field} is required — use [] when a case has none.`);
  if (!Array.isArray(value)) throw new Error(`${field} must be an array.`);
  const built = [];
  for (const [index, entry] of value.entries()) {
    const entryLabel = `${field}[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      throw new Error(`${entryLabel} must be an object.`);
    assertOnlyKeys(entry, ATTACHMENT_KEYS, entryLabel);
    const relativePath = requireNonEmptyString(entry.path, `${entryLabel}.path`);
    const absolutePath = path.resolve(baseDir, relativePath);
    let data;
    try {
      data = await readFile(absolutePath);
    } catch (error) {
      throw new Error(`${entryLabel}.path could not be read (${relativePath}): ${error.message}`);
    }
    built.push({
      name: path.basename(relativePath),
      type: ATTACHMENT_MIME_TYPES.get(path.extname(relativePath).toLowerCase()) ?? "application/octet-stream",
      size: data.length,
      data: data.toString("base64"),
    });
  }
  // Reuse the create route's own extension/size/base64-integrity checks rather than a second
  // copy of them — a case whose attachment the API would reject should fail here, at load time.
  return validateAttachments(built);
}

function resolveRepositoryPath(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) throw new Error("suite.repositoryPath is required.");
  // Relative values (including ".") resolve against the current working directory, matching how
  // the suite path itself is passed on the command line; an absolute value is returned unchanged.
  return path.resolve(process.cwd(), trimmed);
}

function requireFrozenBaseSha(value) {
  const sha = typeof value === "string" ? value.trim() : "";
  if (!FROZEN_SHA_PATTERN.test(sha))
    throw new Error("suite.frozenBaseSha must be a 40 to 64 character hex commit SHA.");
  return sha.toLowerCase();
}

function requireStringList(value, field) {
  if (!Array.isArray(value) || value.length === 0)
    throw new Error(`${field} must be a non-empty array of strings.`);
  return value.map((entry, index) => requireNonEmptyString(entry, `${field}[${index}]`));
}

function requireNonEmptyString(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string.`);
  return value;
}

function assertOnlyKeys(object, allowed, label) {
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) throw new Error(`${label} has an unknown field: "${key}".`);
  }
}

async function readJsonFile(absolutePath, kind) {
  let text;
  try {
    text = await readFile(absolutePath, "utf8");
  } catch (error) {
    throw new Error(`Could not read ${kind} file at ${absolutePath}: ${error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Could not parse ${kind} JSON at ${absolutePath}: ${error.message}`);
  }
}
