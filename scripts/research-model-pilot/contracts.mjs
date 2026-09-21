// Frozen pilot manifest, oracle containment and bound arithmetic
// (08-LIVE-MODEL-QUALITY-PILOT-PLAN.md §4, §7, Q1).
//
// Two rules are structural here rather than reviewed. First, only `objective` and
// `constraints` may reach a model prompt: `casePrompt()` reads nothing else, and a test scans
// every built prompt for every oracle string. Second, every budget number the runner spends
// against is recomputed from the manifest's own declared searches, captures and page caps —
// an edited total that no longer matches its parts fails parsing, not review.

import { createHash } from "node:crypto";
import {
  MAX_MODEL_MAX_OUTPUT_TOKENS,
  MIN_MODEL_MAX_OUTPUT_TOKENS,
} from "../../server/research/deepagents/model-config.mjs";

export const PILOT_MANIFEST_VERSION = 1;

/** Reserved for the scorer and the preflight drift check. Never read by the prompt builder. */
export const ORACLE_KEYS = Object.freeze(["oracle"]);

const SESSION_KEYS = [
  "firecrawlSessionCeiling",
  "serperCallCeiling",
  "calculatedFirecrawlUpperBound",
  "maxModelCalls",
  "maxSearches",
  "maxUniqueCaptures",
  "modelMaxOutputTokens",
  "requiredFirstAttemptPasses",
];
const CASE_KEYS = [
  "id",
  "label",
  "capability",
  "market",
  "objective",
  "constraints",
  "sourcePolicy",
  "budget",
  "providerBound",
  "oracle",
];
const BUDGET_KEYS = [
  "maxModelCalls",
  "maxToolCalls",
  "maxSearchCalls",
  "maxRuntimeMs",
  "maxUniqueCaptures",
  "maxPdfPages",
];
const PROVIDER_BOUND_KEYS = ["searches", "uniqueCaptures", "pdfPageCap", "calculatedFirecrawlUpperBound"];
const MARKETS = new Set(["NZ", "AU", "US", "GLOBAL"]);
const ROLES = new Set(["manufacturer", "retailer", "official", "standards"]);
const CREDENTIAL_QUERY_KEYS =
  /^(?:.*(?:token|signature|sig|key|secret|password|credential|auth|expires|x-amz-.*|se|sp|sv|sr)$)/i;

/** One Firecrawl search costs two credits; one capture costs one plus its retained page cap. */
export function calculatedFirecrawlBound({ searches, uniqueCaptures, pdfPageCap }) {
  return searches * 2 + uniqueCaptures * (1 + pdfPageCap);
}

export function hashManifestText(text) {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

export function parsePilotManifest(raw) {
  const manifest = requireObject(raw, "manifest");
  strictKeys(manifest, ["version", "description", "session", "cases"], "manifest");
  if (manifest.version !== PILOT_MANIFEST_VERSION)
    throw invalid(`The pilot manifest must be version ${PILOT_MANIFEST_VERSION}.`);
  requireString(manifest.description, "manifest description", 500);
  const session = parseSession(manifest.session);
  if (!Array.isArray(manifest.cases) || manifest.cases.length === 0)
    throw invalid("The pilot manifest must declare at least one case.");
  const cases = manifest.cases.map(parseCase);
  const ids = cases.map((entry) => entry.id);
  if (new Set(ids).size !== ids.length) throw invalid("Pilot case ids must be unique.");
  assertSessionArithmetic(session, cases);
  return Object.freeze({ ...manifest, session, cases: Object.freeze(cases) });
}

function parseSession(raw) {
  const session = requireObject(raw, "manifest session");
  strictKeys(session, SESSION_KEYS, "manifest session");
  for (const key of SESSION_KEYS) requirePositiveInteger(session[key], `session ${key}`);
  if (
    session.modelMaxOutputTokens < MIN_MODEL_MAX_OUTPUT_TOKENS ||
    session.modelMaxOutputTokens > MAX_MODEL_MAX_OUTPUT_TOKENS
  )
    throw invalid(
      `session modelMaxOutputTokens must be between ${MIN_MODEL_MAX_OUTPUT_TOKENS} and ${MAX_MODEL_MAX_OUTPUT_TOKENS}.`,
    );
  if (session.calculatedFirecrawlUpperBound > session.firecrawlSessionCeiling)
    throw invalid("The calculated Firecrawl upper bound exceeds the session ceiling.");
  return Object.freeze(session);
}

function parseCase(raw) {
  const entry = requireObject(raw, "pilot case");
  strictKeys(entry, CASE_KEYS, `pilot case ${entry.id ?? "<unnamed>"}`);
  requireString(entry.id, "case id", 60);
  requireString(entry.label, "case label", 200);
  requireString(entry.capability, "case capability", 200);
  if (!MARKETS.has(entry.market)) throw invalid(`Case ${entry.id} declares an unsupported market.`);
  requireString(entry.objective, "case objective", 4_000);
  if (!Array.isArray(entry.constraints) || entry.constraints.length === 0)
    throw invalid(`Case ${entry.id} must declare non-answer constraints.`);
  for (const constraint of entry.constraints) requireString(constraint, "case constraint", 500);
  const budget = parseBudget(entry);
  const providerBound = parseProviderBound(entry);
  if (providerBound.uniqueCaptures !== budget.maxUniqueCaptures)
    throw invalid(`Case ${entry.id} capture bound and budget disagree.`);
  if (providerBound.searches !== budget.maxSearchCalls)
    throw invalid(`Case ${entry.id} search bound and budget disagree.`);
  if (providerBound.pdfPageCap !== budget.maxPdfPages)
    throw invalid(`Case ${entry.id} PDF page cap and budget disagree.`);
  parseSourcePolicy(entry);
  parseOracle(entry);
  return Object.freeze(entry);
}

function parseBudget(entry) {
  const budget = requireObject(entry.budget, `case ${entry.id} budget`);
  strictKeys(budget, BUDGET_KEYS, `case ${entry.id} budget`);
  for (const key of BUDGET_KEYS) requirePositiveInteger(budget[key], `case ${entry.id} budget ${key}`);
  if (budget.maxPdfPages > 30) throw invalid(`Case ${entry.id} exceeds the retained PDF page limit.`);
  if (budget.maxToolCalls < budget.maxSearchCalls + budget.maxUniqueCaptures)
    throw invalid(`Case ${entry.id} cannot search and capture inside its tool-call ceiling.`);
  return budget;
}

function parseProviderBound(entry) {
  const bound = requireObject(entry.providerBound, `case ${entry.id} providerBound`);
  strictKeys(bound, PROVIDER_BOUND_KEYS, `case ${entry.id} providerBound`);
  for (const key of PROVIDER_BOUND_KEYS)
    requirePositiveInteger(bound[key], `case ${entry.id} providerBound ${key}`);
  const calculated = calculatedFirecrawlBound(bound);
  if (calculated !== bound.calculatedFirecrawlUpperBound)
    throw invalid(
      `Case ${entry.id} declares ${bound.calculatedFirecrawlUpperBound} Firecrawl credits but its parts calculate ${calculated}.`,
    );
  return bound;
}

function parseSourcePolicy(entry) {
  const policy = requireObject(entry.sourcePolicy, `case ${entry.id} sourcePolicy`);
  strictKeys(policy, ["roles"], `case ${entry.id} sourcePolicy`);
  if (!Array.isArray(policy.roles) || policy.roles.length === 0)
    throw invalid(`Case ${entry.id} must declare at least one source role.`);
  for (const role of policy.roles) {
    strictKeys(requireObject(role, "source role"), ["role", "hostSuffixes", "required"], "source role");
    if (!ROLES.has(role.role)) throw invalid(`Case ${entry.id} declares an unsupported source role.`);
    if (!Array.isArray(role.hostSuffixes) || role.hostSuffixes.length === 0)
      throw invalid(`Case ${entry.id} role ${role.role} must declare host suffixes.`);
    for (const suffix of role.hostSuffixes)
      if (typeof suffix !== "string" || !suffix.startsWith("."))
        throw invalid(`Case ${entry.id} host suffixes must start with a dot.`);
    if (typeof role.required !== "boolean")
      throw invalid(`Case ${entry.id} role ${role.role} must declare whether it is required.`);
  }
}

function parseOracle(entry) {
  const oracle = requireObject(entry.oracle, `case ${entry.id} oracle`);
  strictKeys(
    oracle,
    [
      "expectedFacts",
      "expectedPages",
      "forbiddenPages",
      "unresolvedRequired",
      "referenceSources",
      "forbiddenInferences",
      "reviewNotes",
    ],
    `case ${entry.id} oracle`,
  );
  if (!Array.isArray(oracle.expectedFacts) || oracle.expectedFacts.length === 0)
    throw invalid(`Case ${entry.id} oracle must declare at least one expected fact.`);
  for (const fact of oracle.expectedFacts) requireString(fact?.id, "expected fact id", 60);
  for (const page of oracle.expectedPages ?? []) requirePositiveInteger(page, "expected page");
  for (const page of oracle.forbiddenPages ?? []) requirePositiveInteger(page, "forbidden page");
  if (!Array.isArray(oracle.referenceSources) || oracle.referenceSources.length === 0)
    throw invalid(`Case ${entry.id} oracle must declare reference sources.`);
  for (const source of oracle.referenceSources) {
    strictKeys(requireObject(source, "reference source"), ["role", "url"], "reference source");
    if (!ROLES.has(source.role)) throw invalid(`Case ${entry.id} reference source role is unsupported.`);
    assertPublicHttpsUrl(source.url, `case ${entry.id} reference source`);
  }
  if (!Array.isArray(oracle.forbiddenInferences) || oracle.forbiddenInferences.length === 0)
    throw invalid(`Case ${entry.id} oracle must declare forbidden inferences.`);
  requireString(oracle.reviewNotes, "oracle review notes", 1_000);
}

function assertSessionArithmetic(session, cases) {
  const totals = cases.reduce(
    (sum, entry) => ({
      modelCalls: sum.modelCalls + entry.budget.maxModelCalls,
      searches: sum.searches + entry.providerBound.searches,
      captures: sum.captures + entry.providerBound.uniqueCaptures,
      credits: sum.credits + entry.providerBound.calculatedFirecrawlUpperBound,
    }),
    { modelCalls: 0, searches: 0, captures: 0, credits: 0 },
  );
  if (totals.modelCalls !== session.maxModelCalls)
    throw invalid(`Session model-call ceiling ${session.maxModelCalls} does not equal ${totals.modelCalls}.`);
  if (totals.searches !== session.maxSearches)
    throw invalid(`Session search ceiling ${session.maxSearches} does not equal ${totals.searches}.`);
  if (totals.captures !== session.maxUniqueCaptures)
    throw invalid(`Session capture ceiling ${session.maxUniqueCaptures} does not equal ${totals.captures}.`);
  if (totals.credits !== session.calculatedFirecrawlUpperBound)
    throw invalid(
      `Session Firecrawl upper bound ${session.calculatedFirecrawlUpperBound} does not equal ${totals.credits}.`,
    );
}

/** The complete model-visible text for a case. Nothing else in the case may be read here. */
export function casePrompt(entry) {
  return [
    `Research objective: ${entry.objective}`,
    "",
    "Constraints:",
    ...entry.constraints.map((constraint) => `- ${constraint}`),
  ].join("\n");
}

/** The budget override handed to `ResearchService`; overrides may only lower a profile. */
export function caseBudgetOverride(entry) {
  return {
    maxResearchers: 1,
    maxConcurrentResearchers: 1,
    maxDepth: 1,
    maxRuntimeMs: entry.budget.maxRuntimeMs,
    maxModelCalls: entry.budget.maxModelCalls,
    maxToolCalls: entry.budget.maxToolCalls,
    maxSearchCalls: entry.budget.maxSearchCalls,
  };
}

export function sessionBounds(manifest) {
  return Object.freeze({
    ...manifest.session,
    cases: manifest.cases.map((entry) => ({
      id: entry.id,
      modelCalls: entry.budget.maxModelCalls,
      ...entry.providerBound,
    })),
  });
}

/**
 * Reject anything that would send private material to a public provider before a model or a
 * provider is constructed (plan §8). Public objectives and public URLs are the entire input
 * surface of this pilot.
 */
export function assertPublicOnlyRequest({ objective, context = [] }) {
  if (Array.isArray(context) ? context.length > 0 : Boolean(context))
    throw invalid("The public research pilot refuses a non-empty request context.");
  const text = String(objective ?? "");
  if (!text.trim()) throw invalid("A pilot case objective must not be empty.");
  if (/(?:^|\s)(?:\/|~\/|\.{1,2}\/|[A-Za-z]:\\)/.test(text))
    throw invalid("A pilot objective must not carry a file path.");
  for (const match of text.matchAll(/https?:\/\/\S+/g)) assertPublicHttpsUrl(match[0], "pilot objective");
  return true;
}

export function assertPublicHttpsUrl(value, label) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    throw invalid(`${label} must be an absolute URL.`);
  }
  if (url.protocol !== "https:") throw invalid(`${label} must use https.`);
  if (url.username || url.password) throw invalid(`${label} must not carry userinfo.`);
  for (const key of url.searchParams.keys())
    if (CREDENTIAL_QUERY_KEYS.test(key))
      throw invalid(`${label} must not carry a credential query parameter.`);
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) ||
    host.includes(":")
  )
    throw invalid(`${label} must name a public host.`);
  return url;
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw invalid(`${label} must be an object.`);
  return value;
}

function strictKeys(value, allowed, label) {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length) throw invalid(`${label} has unexpected keys: ${unexpected.join(", ")}.`);
}

function requireString(value, label, max) {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw invalid(`${label} must be a non-empty string of at most ${max} characters.`);
  return value;
}

function requirePositiveInteger(value, label) {
  if (!Number.isInteger(value) || value < 1) throw invalid(`${label} must be a positive integer.`);
  return value;
}

function invalid(message) {
  const error = new Error(message);
  error.code = "pilot_manifest_invalid";
  return error;
}
