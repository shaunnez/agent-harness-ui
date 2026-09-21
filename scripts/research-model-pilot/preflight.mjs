// Everything that must be true before a pilot session may construct a model or a provider
// (plan §7, §8, Q3, Q5). Nothing here performs network I/O, and nothing here prints an
// environment value: a preflight names variables and non-secret selections only.

import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import {
  modelIdentitySnapshot,
  requireExplicitModelIdentity,
  resolveModelConfig,
} from "../../server/research/deepagents/model-config.mjs";
import { sessionBounds } from "./contracts.mjs";

const run = promisify(execFile);

export const LIVE_ENV_FILE = ".env.research.local";
export const FIRECRAWL_ALLOWANCE_VAR = "RESEARCH_MODEL_PILOT_FIRECRAWL_ALLOWANCE";
export const MODEL_CALL_ALLOWANCE_VAR = "RESEARCH_MODEL_PILOT_MODEL_CALL_ALLOWANCE";

/** Prove the native database dependencies can execute in this exact Node process before a
 *  paid call, not after one. Worktrees share `node_modules` while shells select a different
 *  Node ABI, and that must fail here rather than mid-session. */
export async function probeNativeRuntime(options = {}) {
  try {
    return { ok: true, ...(await assertNativeRuntimeReady(options)) };
  } catch (error) {
    return {
      ok: false,
      checked: [],
      nodeVersion: process.version,
      moduleAbi: process.versions.modules,
      error: boundedMessage(error),
    };
  }
}

export async function assertNativeRuntimeReady({
  loadSqlite = () => import("node:sqlite"),
  loadCheckpointDatabase = () => import("better-sqlite3"),
} = {}) {
  const checked = [];
  try {
    const { DatabaseSync } = await loadSqlite();
    const database = new DatabaseSync(":memory:");
    try {
      database.exec("CREATE TABLE preflight(ready INTEGER)");
    } finally {
      database.close();
    }
    checked.push("node:sqlite");
    const loaded = await loadCheckpointDatabase();
    const Database = loaded.default ?? loaded;
    const checkpoint = new Database(":memory:");
    try {
      checkpoint.prepare("SELECT 1 AS ready").get();
    } finally {
      checkpoint.close();
    }
    checked.push("better-sqlite3");
  } catch (error) {
    const failure = new Error(
      `Pilot runtime preflight failed before any model or provider construction: ${boundedMessage(error)}`,
    );
    failure.code = "pilot_runtime_preflight_failed";
    throw failure;
  }
  return { checked, nodeVersion: process.version, moduleAbi: process.versions.modules };
}

export async function collectGitLineage({ cwd = process.cwd(), exec = run } = {}) {
  try {
    const commit = (await exec("git", ["rev-parse", "HEAD"], { cwd })).stdout.trim();
    const status = (await exec("git", ["status", "--porcelain"], { cwd })).stdout.trim();
    const changedFiles = status ? status.split("\n").length : 0;
    return { commit, dirty: changedFiles > 0, changedFiles };
  } catch (error) {
    return { commit: null, dirty: true, changedFiles: null, error: boundedMessage(error) };
  }
}

/**
 * The model this session would use. A dry run before a model has been chosen reports
 * `selectionPending` rather than inventing one; a live session must name it explicitly.
 */
export function resolvePilotModel(environment, { live }) {
  if (live) {
    requireExplicitModelIdentity(environment);
    return {
      selectionPending: false,
      identity: modelIdentitySnapshot(resolveModelConfig(environment), environment),
    };
  }
  if (!environment.RESEARCH_MODEL_PROVIDER || !environment.RESEARCH_MODEL_ID)
    return {
      selectionPending: true,
      identity: null,
      note: "No model is frozen yet. A live pilot requires RESEARCH_MODEL_PROVIDER and RESEARCH_MODEL_ID.",
    };
  try {
    return {
      selectionPending: false,
      identity: modelIdentitySnapshot(resolveModelConfig(environment), environment),
    };
  } catch (error) {
    return { selectionPending: true, identity: null, note: boundedMessage(error) };
  }
}

/** The separately approved session allowance. A configured ceiling is not an authorization,
 *  so the numbers must be supplied for this session and must admit the manifest exactly. */
export function resolveSessionAllowance(environment, manifest) {
  const credits = requireAllowance(environment[FIRECRAWL_ALLOWANCE_VAR], FIRECRAWL_ALLOWANCE_VAR);
  const modelCalls = requireAllowance(environment[MODEL_CALL_ALLOWANCE_VAR], MODEL_CALL_ALLOWANCE_VAR);
  const { calculatedFirecrawlUpperBound, firecrawlSessionCeiling, maxModelCalls } = manifest.session;
  if (credits < calculatedFirecrawlUpperBound)
    throw allowanceError(
      `${FIRECRAWL_ALLOWANCE_VAR} (${credits}) is below the manifest's calculated ${calculatedFirecrawlUpperBound}-credit upper bound.`,
    );
  if (credits > firecrawlSessionCeiling)
    throw allowanceError(
      `${FIRECRAWL_ALLOWANCE_VAR} (${credits}) exceeds the ${firecrawlSessionCeiling}-credit session ceiling.`,
    );
  if (modelCalls < maxModelCalls)
    throw allowanceError(
      `${MODEL_CALL_ALLOWANCE_VAR} (${modelCalls}) is below the manifest's ${maxModelCalls}-call maximum.`,
    );
  return { firecrawlCredits: credits, modelCalls };
}

/** Live-mode guards, in the order that fails cheapest first. */
export async function assertLiveGuards({ environment, manifest, cwd = process.cwd(), statFile = stat, git }) {
  if (environment.RESEARCH_PUBLIC_ONLY_ACKNOWLEDGED !== "1")
    throw guardError(
      "A live pilot requires RESEARCH_PUBLIC_ONLY_ACKNOWLEDGED=1: objectives, queries, URLs and excerpts leave this machine.",
    );
  const envFile = path.resolve(cwd, environment.RESEARCH_PILOT_ENV_FILE ?? LIVE_ENV_FILE);
  let info;
  try {
    info = await statFile(envFile);
  } catch {
    throw guardError(`A live pilot requires the owner-only environment file ${path.basename(envFile)}.`);
  }
  if ((info.mode & 0o077) !== 0)
    throw guardError(`${path.basename(envFile)} must be mode 0600; it is readable by others.`);
  const model = resolvePilotModel(environment, { live: true });
  if (!environment.RESEARCH_MODEL_API_KEY && !model.identity.apiKeyPresent)
    throw guardError(
      `The selected ${model.identity.provider} model has no credential; set RESEARCH_MODEL_API_KEY in ${path.basename(envFile)}.`,
    );
  if (model.identity.maxOutputTokens !== manifest.session.modelMaxOutputTokens)
    throw guardError(
      `RESEARCH_MODEL_MAX_OUTPUT_TOKENS must be ${manifest.session.modelMaxOutputTokens} for this manifest.`,
    );
  if (!environment.FIRECRAWL_API_KEY)
    throw guardError("A live pilot requires FIRECRAWL_API_KEY for the accepted public capture route.");
  const allowance = resolveSessionAllowance(environment, manifest);
  const lineage = git ?? (await collectGitLineage({ cwd }));
  if (lineage.dirty)
    throw guardError("A live pilot refuses a dirty worktree so the report's lineage is exact.");
  return { model, allowance, git: lineage, envFile: path.basename(envFile) };
}

export function buildPreflightReport({
  mode,
  manifest,
  manifestHash,
  manifestPath,
  model,
  allowance = null,
  git,
  runtime,
  providerConfig,
}) {
  return {
    version: 1,
    mode,
    generatedAt: new Date().toISOString(),
    manifest: {
      path: manifestPath,
      hash: manifestHash,
      version: manifest.version,
      caseIds: manifest.cases.map((entry) => entry.id),
    },
    git,
    runtime,
    model: model.identity ?? { selectionPending: true, note: model.note ?? null },
    bounds: sessionBounds(manifest),
    allowance,
    providerConfig,
    guarantees: {
      networkCalls: mode === "dry-run" ? 0 : null,
      modelCalls: mode === "dry-run" ? 0 : null,
      retriesIncluded: false,
      subagents: 0,
      privateContextAccepted: false,
    },
  };
}

function requireAllowance(value, name) {
  if (value == null || value === "" || !/^\d+$/.test(String(value)))
    throw allowanceError(`${name} must be supplied as an integer for this session; it is not inherited.`);
  return Number(value);
}

function allowanceError(message) {
  const error = new Error(message);
  error.code = "pilot_allowance_rejected";
  return error;
}

function guardError(message) {
  const error = new Error(message);
  error.code = "pilot_live_guard_rejected";
  return error;
}

function boundedMessage(error) {
  return String(error?.message ?? error ?? "unknown failure")
    .slice(0, 500)
    .replace(/[\r\n]+/g, " ");
}
