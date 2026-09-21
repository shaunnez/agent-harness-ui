import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  MAX_MODEL_MAX_OUTPUT_TOKENS,
  MIN_MODEL_MAX_OUTPUT_TOKENS,
  modelConstructorOptions,
  modelIdentitySnapshot,
  requireExplicitModelIdentity,
  resolveModelConfig,
  resolveModelMaxOutputTokens,
} from "../server/research/deepagents/model-config.mjs";
import { ResearchWebTools } from "../server/research/research-web-tools.mjs";
import { writeArtifact, writeJsonArtifact } from "../scripts/research-model-pilot/artifacts.mjs";
import {
  assertPublicOnlyRequest,
  calculatedFirecrawlBound,
  caseBudgetOverride,
  casePrompt,
  hashManifestText,
  parsePilotManifest,
  sessionBounds,
} from "../scripts/research-model-pilot/contracts.mjs";
import { assertManifestLineage, finalizeSession } from "../scripts/research-model-pilot/finalize.mjs";
import {
  assertLiveGuards,
  buildPreflightReport,
  probeNativeRuntime,
  resolvePilotModel,
  resolveSessionAllowance,
} from "../scripts/research-model-pilot/preflight.mjs";
import {
  buildReviewPacket,
  reviewCompleteness,
  withReviewRevision,
} from "../scripts/research-model-pilot/review.mjs";
import { runModelPilotSession } from "../scripts/research-model-pilot/runner.mjs";
import { CASE_CHECK_IDS, scoreCase, scoreSession } from "../scripts/research-model-pilot/score.mjs";
import { scanArtifactsForSecrets, scannedNeedles } from "../scripts/research-model-pilot/secret-scan.mjs";
import { attemptsFor, PilotSessionLedger } from "../scripts/research-model-pilot/session-ledger.mjs";
import { fixtureSearchProvider, safeChildEnv } from "./research-deepagents-test-support.mjs";

const MANIFEST_PATH = fileURLToPath(
  new URL("../scripts/research-model-pilot/manifest.json", import.meta.url),
);
const manifestText = await readFile(MANIFEST_PATH, "utf8");
const shippedManifest = parsePilotManifest(JSON.parse(manifestText));

async function withTempDirectory(body) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "research-model-pilot-"));
  try {
    return await body(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function manifestJson() {
  return JSON.parse(manifestText);
}

// --- Q1: manifest, oracle containment and bound arithmetic --------------------------------

test("the shipped manifest declares four cases whose parts calculate the frozen session bounds", () => {
  assert.equal(shippedManifest.cases.length, 4);
  const bounds = sessionBounds(shippedManifest);
  assert.equal(bounds.maxModelCalls, 42);
  assert.equal(bounds.calculatedFirecrawlUpperBound, 42);
  assert.equal(bounds.firecrawlSessionCeiling, 50);
  assert.equal(bounds.serperCallCeiling, 2);
  assert.equal(bounds.maxUniqueCaptures, 5);
  assert.equal(bounds.modelMaxOutputTokens, 8_192);
  for (const entry of shippedManifest.cases)
    assert.equal(
      entry.providerBound.calculatedFirecrawlUpperBound,
      calculatedFirecrawlBound(entry.providerBound),
    );
});

test("a manifest with an unexpected key, a duplicate id or broken arithmetic fails to parse", () => {
  const withUnexpectedKey = manifestJson();
  withUnexpectedKey.cases[0].answer = "1.93";
  assert.throws(() => parsePilotManifest(withUnexpectedKey), /unexpected keys/);

  const duplicated = manifestJson();
  duplicated.cases[1].id = duplicated.cases[0].id;
  assert.throws(() => parsePilotManifest(duplicated), /unique/);

  const brokenCase = manifestJson();
  brokenCase.cases[0].providerBound.calculatedFirecrawlUpperBound = 4;
  assert.throws(() => parsePilotManifest(brokenCase), /calculate/);

  const brokenSession = manifestJson();
  brokenSession.session.maxModelCalls = 41;
  assert.throws(() => parsePilotManifest(brokenSession), /model-call ceiling/);

  const widerCapture = manifestJson();
  widerCapture.cases[0].budget.maxUniqueCaptures = 2;
  assert.throws(() => parsePilotManifest(widerCapture), /capture bound/);
});

test("a non-public or credential-bearing reference source fails to parse", () => {
  for (const url of [
    "http://www.mitre10.co.nz/p/1",
    "https://user:secret@www.mitre10.co.nz/p/1",
    "https://www.mitre10.co.nz/p/1?signature=abc",
    "https://localhost/p/1",
    "https://127.0.0.1/p/1",
  ]) {
    const candidate = manifestJson();
    candidate.cases[0].oracle.referenceSources[0].url = url;
    assert.throws(() => parsePilotManifest(candidate), /reference source/, url);
  }
});

test("answer-bearing oracle fields never enter a model prompt", () => {
  // An objective may legitimately name what is being asked about — the product, the document,
  // the wording in question. What must never reach a prompt is the answer to it: an expected
  // value, an expected page, the reference URL that would remove the discovery step, the
  // forbidden inferences, or the reviewer's notes.
  for (const entry of shippedManifest.cases) {
    const prompt = casePrompt(entry).toLowerCase();
    const answers = [
      ...entry.oracle.expectedFacts.filter((fact) => fact.kind === "exact_value").map((fact) => fact.value),
      ...entry.oracle.referenceSources.map((source) => source.url),
      ...entry.oracle.forbiddenInferences,
      entry.oracle.reviewNotes,
      // The page an expected *value* sits on is part of the answer. A page the objective
      // itself asks about (case `au-scanned-pdf-limit`) is part of the question, not a leak.
      ...entry.oracle.expectedFacts
        .filter((fact) => fact.kind === "exact_value")
        .map((fact) => `page ${fact.page}`),
    ];
    for (const value of answers)
      assert.equal(
        prompt.includes(String(value).toLowerCase()),
        false,
        `${entry.id} prompt leaked "${value}"`,
      );
    assert.equal(/expected answer|oracle|forbidden inference|review note/i.test(prompt), false);
  }
});

test("a built prompt is derived from nothing but the objective and constraints", () => {
  const entry = {
    ...shippedManifest.cases[1],
    oracle: { ...shippedManifest.cases[1].oracle, reviewNotes: "SENTINEL-ORACLE-NOTE" },
  };
  assert.equal(casePrompt(entry).includes("SENTINEL-ORACLE-NOTE"), false);
});

test("a case prompt is exactly its objective and constraints", () => {
  const entry = shippedManifest.cases[0];
  const expected = [
    `Research objective: ${entry.objective}`,
    "",
    "Constraints:",
    ...entry.constraints.map((constraint) => `- ${constraint}`),
  ].join("\n");
  assert.equal(casePrompt(entry), expected);
});

test("a case budget override only lowers ceilings and never widens the profile", () => {
  const override = caseBudgetOverride(shippedManifest.cases[3]);
  assert.deepEqual(override, {
    maxResearchers: 1,
    maxConcurrentResearchers: 1,
    maxDepth: 1,
    maxRuntimeMs: 180_000,
    maxModelCalls: 12,
    maxToolCalls: 16,
    maxSearchCalls: 2,
  });
});

test("the public-only guard refuses context, file paths and non-public URLs", () => {
  assert.equal(assertPublicOnlyRequest({ objective: "Find a public NZ retail price." }), true);
  assert.throws(
    () => assertPublicOnlyRequest({ objective: "x", context: [{ type: "project", id: "p1" }] }),
    /non-empty request context/,
  );
  assert.throws(() => assertPublicOnlyRequest({ objective: "Read /Users/shaun/tender.pdf" }), /file path/);
  assert.throws(
    () => assertPublicOnlyRequest({ objective: "See https://files.example.com/a?token=abc" }),
    /credential query parameter/,
  );
});

test("the manifest hash changes when any oracle value changes", () => {
  const drifted = manifestJson();
  drifted.cases[1].oracle.expectedFacts[0].value = "1.94";
  assert.notEqual(hashManifestText(JSON.stringify(drifted)), hashManifestText(manifestText));
});

// --- Q2: bounded live model construction and frozen identity -------------------------------

test("the maximum output token setting is validated and passed to both live constructors", () => {
  assert.equal(resolveModelMaxOutputTokens({}), null);
  assert.equal(resolveModelMaxOutputTokens({ RESEARCH_MODEL_MAX_OUTPUT_TOKENS: "1024" }), 1_024);
  for (const invalid of ["0", "255", "8193", "1k", "-1"])
    assert.throws(
      () => resolveModelMaxOutputTokens({ RESEARCH_MODEL_MAX_OUTPUT_TOKENS: invalid }),
      /must be an integer from 256 to 8192/,
      invalid,
    );
  assert.equal(MIN_MODEL_MAX_OUTPUT_TOKENS, 256);
  assert.equal(MAX_MODEL_MAX_OUTPUT_TOKENS, 8_192);

  const anthropic = resolveModelConfig({
    RESEARCH_MODEL_PROVIDER: "anthropic",
    RESEARCH_MODEL_ID: "claude-pilot",
    RESEARCH_MODEL_API_KEY: "model-sentinel",
    RESEARCH_MODEL_MAX_OUTPUT_TOKENS: "8192",
  });
  assert.equal(anthropic.maxOutputTokens, 8_192);
  assert.deepEqual(modelConstructorOptions(anthropic, "k"), {
    provider: "anthropic",
    options: { model: "claude-pilot", apiKey: "k", maxTokens: 8_192 },
  });

  const openai = resolveModelConfig({
    RESEARCH_MODEL_PROVIDER: "openai-compatible",
    RESEARCH_MODEL_ID: "local-qwen",
    RESEARCH_MODEL_BASE_URL: "https://endpoint.example.test/v1",
    RESEARCH_MODEL_API_KEY: "model-sentinel",
    RESEARCH_MODEL_MAX_OUTPUT_TOKENS: "512",
  });
  assert.deepEqual(modelConstructorOptions(openai, "k"), {
    provider: "openai-compatible",
    options: {
      model: "local-qwen",
      apiKey: "k",
      configuration: { baseURL: "https://endpoint.example.test/v1" },
      maxTokens: 512,
    },
  });
});

test("the worker hands the configured output ceiling to a real constructor without a network call", async () => {
  const { buildModel } = await import("../server/research/deepagents/worker.mjs");
  const anthropic = await buildModel(
    {
      provider: "anthropic",
      model: "claude-pilot",
      apiKeyEnvVar: "RESEARCH_MODEL_API_KEY",
      maxOutputTokens: 1_024,
    },
    { RESEARCH_MODEL_API_KEY: "model-sentinel" },
  );
  assert.equal(anthropic.maxTokens, 1_024);
  assert.equal(anthropic.model, "claude-pilot");
  const openai = await buildModel(
    {
      provider: "openai-compatible",
      model: "local-qwen",
      baseURL: "https://endpoint.example.test/v1",
      apiKeyEnvVar: "RESEARCH_MODEL_API_KEY",
      maxOutputTokens: 512,
    },
    { RESEARCH_MODEL_API_KEY: "model-sentinel" },
  );
  assert.equal(openai.maxTokens, 512);
});

test("ordinary fake-model defaults are unchanged and carry no output ceiling", () => {
  const fake = resolveModelConfig({});
  assert.equal(fake.provider, "fake");
  assert.equal(fake.model, "fake-research-model");
  assert.equal("maxOutputTokens" in fake, false);
  assert.deepEqual(modelConstructorOptions(fake, null), {
    provider: "fake",
    options: { label: "fake-research-model" },
  });
});

test("an implicit or fake paid-model identity is refused before provider construction", () => {
  assert.throws(() => requireExplicitModelIdentity({ ANTHROPIC_API_KEY: "model-sentinel" }), /requires both/);
  assert.throws(
    () => requireExplicitModelIdentity({ RESEARCH_MODEL_PROVIDER: "anthropic" }),
    /requires both/,
  );
  assert.throws(
    () => requireExplicitModelIdentity({ RESEARCH_MODEL_PROVIDER: "fake", RESEARCH_MODEL_ID: "x" }),
    /cannot select the deterministic fake model/,
  );
  assert.deepEqual(
    requireExplicitModelIdentity({ RESEARCH_MODEL_PROVIDER: "anthropic", RESEARCH_MODEL_ID: "claude-pilot" }),
    { provider: "anthropic", model: "claude-pilot" },
  );
});

test("a recorded model snapshot names the credential variable but never its value", () => {
  const config = resolveModelConfig({
    RESEARCH_MODEL_PROVIDER: "anthropic",
    RESEARCH_MODEL_ID: "claude-pilot",
    RESEARCH_MODEL_API_KEY: "model-sentinel",
    RESEARCH_MODEL_MAX_OUTPUT_TOKENS: "8192",
  });
  const snapshot = modelIdentitySnapshot(config, {});
  assert.deepEqual(snapshot, {
    provider: "anthropic",
    model: "claude-pilot",
    maxOutputTokens: 8_192,
    apiKeyEnvVar: "RESEARCH_MODEL_API_KEY",
    apiKeyPresent: true,
  });
  assert.equal(JSON.stringify(snapshot).includes("model-sentinel"), false);
});

// --- Q3: session admission and shared accounting -------------------------------------------

test("a case lease cannot close, reset or widen the shared session ledger", () => {
  const session = new PilotSessionLedger({ provider: "firecrawl", ceiling: 5 });
  const first = session.lease("case-one");
  first.settle(first.reserve("search", 2), { reportedCharge: 2 });
  first.close();
  assert.equal(session.snapshot().committedUpperBound, 2);

  const second = session.lease("case-two");
  second.settle(second.reserve("capture", 3), { reportedCharge: 3 });
  assert.equal(session.snapshot().committedUpperBound, 5);
  assert.throws(() => second.reserve("search", 2), /allowance was exhausted/);
  second.close();
  assert.equal(attemptsFor(session.snapshot(), "capture"), 1);
  assert.equal(attemptsFor(session.snapshot(), "search"), 1);
});

test("closing a lease settles only its own outstanding reservations, as unknown", () => {
  const session = new PilotSessionLedger({ provider: "firecrawl", ceiling: 10 });
  const lease = session.lease("case-one");
  lease.reserve("capture", 3);
  const snapshot = lease.close();
  assert.equal(snapshot.activeReservations, 0);
  assert.equal(snapshot.attempts.at(-1).certainty, "unknown_after_termination");
  assert.equal(snapshot.committedUpperBound, 3);
  const later = session.lease("case-two");
  assert.ok(later.reserve("search", 2), "the shared ledger is still open for the next case");
});

test("a run may not exchange unused search calls for extra captures", async () => {
  await withTempDirectory(async (directory) => {
    const tools = new ResearchWebTools({
      runId: "CAP-1",
      budget: { maxToolCalls: 10, maxSearchCalls: 2, maxRuntimeMs: 10_000 },
      searchProvider: fixtureSearchProvider(),
      snapshotDirectory: path.join(directory, "sources"),
      maxUniqueCaptures: 1,
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
      fetchImpl: async () =>
        new Response("<html><body><p>Apply two coats of the tested membrane.</p></body></html>", {
          headers: { "content-type": "text/html" },
        }),
    });
    const first = await tools.invoke("fetch_source", { url: "https://manufacturer.example.test/a" });
    const repeat = await tools.invoke("fetch_source", { url: "https://manufacturer.example.test/a" });
    assert.equal(repeat.result.source.id, first.result.source.id);
    assert.equal(tools.uniqueCaptureCount(), 1);
    assert.equal(repeat.budgetState.toolCallsUsed, 2, "a repeated capture still costs a tool call");
    await assert.rejects(
      tools.invoke("fetch_source", { url: "https://manufacturer.example.test/b" }),
      /capture at most 1 distinct source/,
    );
    assert.equal(tools.uniqueCaptureCount(), 1);
    tools.close();
  });
});

test("a session runs its cases sequentially against one ledger that never resets", async () => {
  await withTempDirectory(async (directory) => {
    const manifest = fixtureManifest();
    const session = await runFixtureSession({ manifest, directory });
    assert.equal(session.status, "completed");
    assert.deepEqual(
      session.cases.map((entry) => entry.status),
      ["completed", "completed"],
    );
    // Two cases, one search each, two credits per search: the second case starts from the
    // first case's committed total rather than from zero.
    assert.equal(session.cases[0].accounting.providers.firecrawl.caseCommitted, 2);
    assert.equal(session.cases[1].accounting.providers.firecrawl.caseCommitted, 2);
    assert.equal(session.ledgers.firecrawl.committedUpperBound, 4);
    assert.equal(session.ledgers.firecrawl.activeReservations, 0);
    assert.equal(session.ledgers.firecrawl.contractViolation, false);
    for (const executed of session.cases) {
      assert.equal(executed.capturesUsed <= 1, true);
      assert.equal(executed.verification.length > 0, true);
      assert.equal(
        executed.verification.every((row) => row.storeQuoteVerified),
        true,
      );
    }
  });
});

// --- Q4: owner-only artifacts ---------------------------------------------------------------

test("session artifacts are owner-only and atomically written", async () => {
  await withTempDirectory(async (directory) => {
    const manifest = fixtureManifest();
    const session = await runFixtureSession({ manifest, directory });
    const sessionStat = await stat(session.directory);
    assert.equal(sessionStat.mode & 0o777, 0o700);
    for (const file of [
      "preflight.json",
      "cases/fixture-alpha/result.json",
      "cases/fixture-alpha/accounting.json",
    ]) {
      const info = await stat(path.join(session.directory, file));
      assert.equal(info.mode & 0o777, 0o600, file);
    }
    const events = await readFile(path.join(session.directory, "cases/fixture-alpha/events.jsonl"), "utf8");
    const parsed = events
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(parsed[0].type, "run.started");
    assert.ok(parsed.some((event) => event.type === "run.completed"));
    const leftovers = (await readdir(session.directory)).filter((name) => name.endsWith(".partial"));
    assert.deepEqual(leftovers, []);
  });
});

test("a finalised session writes a review packet, a secret scan and a report", async () => {
  await withTempDirectory(async (directory) => {
    const manifest = fixtureManifest();
    const session = await runFixtureSession({ manifest, directory });
    const { report, review, artifactScan } = await finalizeSession({
      manifest,
      session,
      environment: { FIRECRAWL_API_KEY: "firecrawl-sentinel-value" },
    });
    assert.equal(artifactScan.leakCount, 0);
    assert.equal(review.claims.length > 0, true);
    assert.equal(report.verdict, "pending_human_review");
    for (const file of ["review.json", "review.md", "report.json", "report.md", "artifact-scan.json"]) {
      const info = await stat(path.join(session.directory, file));
      assert.equal(info.mode & 0o777, 0o600, file);
    }
  });
});

// --- Q5: dry run, live guard and allowance --------------------------------------------------

test("a dry run constructs no provider, no model and no transport", async () => {
  await withTempDirectory(async (directory) => {
    const manifest = fixtureManifest();
    let providerCalls = 0;
    let guardCalls = 0;
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = async (...args) => {
      fetchCalls += 1;
      return originalFetch(...args);
    };
    try {
      const session = await runModelPilotSession({
        manifest,
        manifestHash: "sha256:fixture",
        manifestPath: "fixture.json",
        environment: { PATH: process.env.PATH, HOME: process.env.HOME },
        mode: "dry-run",
        sessionRoot: path.join(directory, "sessions"),
        createProviders: () => {
          providerCalls += 1;
          throw new Error("a dry run must not construct a provider");
        },
        liveGuards: () => {
          guardCalls += 1;
          throw new Error("a dry run must not evaluate live guards");
        },
      });
      assert.equal(session.status, "dry-run");
      assert.equal(session.cases.length, 0);
      assert.equal(providerCalls, 0);
      assert.equal(guardCalls, 0);
      assert.equal(fetchCalls, 0);
      assert.equal(session.preflight.mode, "dry-run");
      assert.deepEqual(session.preflight.guarantees, {
        networkCalls: 0,
        modelCalls: 0,
        retriesIncluded: false,
        subagents: 0,
        privateContextAccepted: false,
      });
      assert.equal(session.preflight.model.selectionPending, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("a dry run reports the frozen bounds section 7 declares", async () => {
  await withTempDirectory(async (directory) => {
    const session = await runModelPilotSession({
      manifest: shippedManifest,
      manifestHash: hashManifestText(manifestText),
      manifestPath: "scripts/research-model-pilot/manifest.json",
      environment: { PATH: process.env.PATH, HOME: process.env.HOME },
      mode: "dry-run",
      sessionRoot: path.join(directory, "sessions"),
    });
    const preflight = JSON.parse(await readFile(path.join(session.directory, "preflight.json"), "utf8"));
    assert.equal(preflight.bounds.maxModelCalls, 42);
    assert.equal(preflight.bounds.calculatedFirecrawlUpperBound, 42);
    assert.equal(preflight.bounds.firecrawlSessionCeiling, 50);
    assert.equal(preflight.bounds.serperCallCeiling, 2);
    assert.equal(preflight.allowance, null);
  });
});

test("live mode cannot be entered by credentials alone", async () => {
  await withTempDirectory(async (directory) => {
    const envFile = path.join(directory, ".env.research.local");
    await writeFile(envFile, "RESEARCH_MODEL_API_KEY=model-sentinel\n", { mode: 0o600 });
    const base = {
      RESEARCH_PUBLIC_ONLY_ACKNOWLEDGED: "1",
      RESEARCH_PILOT_ENV_FILE: ".env.research.local",
      RESEARCH_MODEL_PROVIDER: "anthropic",
      RESEARCH_MODEL_ID: "claude-pilot",
      RESEARCH_MODEL_API_KEY: "model-sentinel",
      RESEARCH_MODEL_MAX_OUTPUT_TOKENS: "8192",
      FIRECRAWL_API_KEY: "firecrawl-sentinel",
      RESEARCH_MODEL_PILOT_FIRECRAWL_ALLOWANCE: "42",
      RESEARCH_MODEL_PILOT_MODEL_CALL_ALLOWANCE: "42",
    };
    const guards = (environment, overrides = {}) =>
      assertLiveGuards({
        environment: { ...base, ...environment },
        manifest: shippedManifest,
        cwd: directory,
        git: { commit: "abc", dirty: false, changedFiles: 0 },
        ...overrides,
      });

    assert.ok(await guards({}));
    await assert.rejects(guards({ RESEARCH_PUBLIC_ONLY_ACKNOWLEDGED: undefined }), /PUBLIC_ONLY/);
    await assert.rejects(guards({ RESEARCH_PILOT_ENV_FILE: ".env.missing" }), /owner-only environment file/);
    await assert.rejects(guards({ RESEARCH_MODEL_ID: undefined }), /requires both/);
    await assert.rejects(guards({ RESEARCH_MODEL_PROVIDER: "fake" }), /fake model/);
    await assert.rejects(guards({ RESEARCH_MODEL_MAX_OUTPUT_TOKENS: "2048" }), /must be 8192/);
    await assert.rejects(guards({ FIRECRAWL_API_KEY: undefined }), /FIRECRAWL_API_KEY/);
    await assert.rejects(guards({ RESEARCH_MODEL_PILOT_FIRECRAWL_ALLOWANCE: undefined }), /must be supplied/);
    await assert.rejects(guards({ RESEARCH_MODEL_PILOT_FIRECRAWL_ALLOWANCE: "41" }), /below the manifest/);
    await assert.rejects(guards({ RESEARCH_MODEL_PILOT_FIRECRAWL_ALLOWANCE: "51" }), /session ceiling/);
    await assert.rejects(guards({ RESEARCH_MODEL_PILOT_MODEL_CALL_ALLOWANCE: "41" }), /below the manifest/);
    await assert.rejects(
      guards({}, { git: { commit: "abc", dirty: true, changedFiles: 3 } }),
      /dirty worktree/,
    );
  });
});

test("an owner-readable env file is refused before any spend", async () => {
  await withTempDirectory(async (directory) => {
    await writeFile(path.join(directory, ".env.research.local"), "X=1\n", { mode: 0o644 });
    await assert.rejects(
      assertLiveGuards({
        environment: {
          RESEARCH_PUBLIC_ONLY_ACKNOWLEDGED: "1",
          RESEARCH_MODEL_PROVIDER: "anthropic",
          RESEARCH_MODEL_ID: "claude-pilot",
        },
        manifest: shippedManifest,
        cwd: directory,
        git: { commit: "abc", dirty: false },
      }),
      /mode 0600/,
    );
  });
});

test("a session allowance must be supplied for this session and admit the manifest exactly", () => {
  assert.deepEqual(
    resolveSessionAllowance(
      {
        RESEARCH_MODEL_PILOT_FIRECRAWL_ALLOWANCE: "50",
        RESEARCH_MODEL_PILOT_MODEL_CALL_ALLOWANCE: "42",
      },
      shippedManifest,
    ),
    { firecrawlCredits: 50, modelCalls: 42 },
  );
});

test("the local runtime is probed before any model or provider construction", async () => {
  const probe = await probeNativeRuntime();
  assert.equal(probe.ok, true);
  assert.deepEqual(probe.checked, ["node:sqlite", "better-sqlite3"]);
  const broken = await probeNativeRuntime({
    loadCheckpointDatabase: async () => {
      throw new Error("Could not locate the bindings file");
    },
  });
  assert.equal(broken.ok, false);
  assert.match(broken.error, /bindings file/);
});

test("a preflight report names variables and selections, never environment contents", () => {
  const report = buildPreflightReport({
    mode: "live",
    manifest: shippedManifest,
    manifestHash: "sha256:fixture",
    manifestPath: "scripts/research-model-pilot/manifest.json",
    model: resolvePilotModel(
      {
        RESEARCH_MODEL_PROVIDER: "anthropic",
        RESEARCH_MODEL_ID: "claude-pilot",
        RESEARCH_MODEL_API_KEY: "model-sentinel",
        RESEARCH_MODEL_MAX_OUTPUT_TOKENS: "8192",
      },
      { live: true },
    ),
    allowance: { firecrawlCredits: 42, modelCalls: 42 },
    git: { commit: "abc", dirty: false },
    runtime: { ok: true, checked: ["node:sqlite"], nodeVersion: "v22", moduleAbi: "127" },
    providerConfig: { searchProvider: "firecrawl" },
  });
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes("model-sentinel"), false);
  assert.equal(report.model.apiKeyEnvVar, "RESEARCH_MODEL_API_KEY");
  assert.equal(report.model.maxOutputTokens, 8_192);
  assert.equal(report.guarantees.retriesIncluded, false);
});

// --- deterministic session fixtures ---------------------------------------------------------

const FIXTURE_HTML =
  "<html><head><title>Fixture manufacturer guide</title></head><body><h1>Application</h1>" +
  "<p>Apply two coats of the tested membrane to the prepared substrate.</p></body></html>";

function fixtureCase(id) {
  return {
    id,
    label: `Fixture case ${id}`,
    capability: "Deterministic fixture",
    market: "NZ",
    objective: `Report what the fixture manufacturer guide requires for ${id}.`,
    constraints: ["Use the manufacturer's own published guide.", "Quote the retained page exactly."],
    sourcePolicy: { roles: [{ role: "manufacturer", hostSuffixes: [".example.test"], required: true }] },
    budget: {
      maxModelCalls: 10,
      maxToolCalls: 16,
      maxSearchCalls: 1,
      maxRuntimeMs: 30_000,
      maxUniqueCaptures: 1,
      maxPdfPages: 2,
    },
    providerBound: { searches: 1, uniqueCaptures: 1, pdfPageCap: 2, calculatedFirecrawlUpperBound: 5 },
    oracle: {
      expectedFacts: [{ id: "application-requirement", kind: "supported_phrase", phrase: "two coats" }],
      expectedPages: [],
      referenceSources: [{ role: "manufacturer", url: "https://manufacturer.example.test/application" }],
      forbiddenInferences: ["reporting a requirement absent from the retained page"],
      reviewNotes: "The claim must be supported by the retained excerpt.",
    },
  };
}

function fixtureManifest() {
  return parsePilotManifest({
    version: 1,
    description: "Deterministic two-case fixture manifest.",
    session: {
      firecrawlSessionCeiling: 50,
      serperCallCeiling: 2,
      calculatedFirecrawlUpperBound: 10,
      maxModelCalls: 20,
      maxSearches: 2,
      maxUniqueCaptures: 2,
      modelMaxOutputTokens: 1_024,
      requiredFirstAttemptPasses: 2,
    },
    cases: [fixtureCase("fixture-alpha"), fixtureCase("fixture-beta")],
  });
}

/** One deterministic session: a fake model, a fixture search provider that charges the shared
 *  ledger exactly as Firecrawl search would, and local capture from an injected response. */
function runFixtureSession({ manifest, directory }) {
  return runModelPilotSession({
    manifest,
    manifestHash: "sha256:fixture",
    manifestPath: "fixture.json",
    environment: {
      ...safeChildEnv(),
      RESEARCH_MODEL_PROVIDER: "fake",
      RESEARCH_MODEL_ID: "fake-research-model",
    },
    mode: "live",
    sessionRoot: path.join(directory, "sessions"),
    liveGuards: async () => ({
      model: { selectionPending: false, identity: { provider: "fake", model: "fake-research-model" } },
      allowance: { firecrawlCredits: 10, modelCalls: 20 },
      git: { commit: "fixture", dirty: false },
    }),
    createProviders: ({ leases }) => ({
      searchProvider: {
        async search(query) {
          const reservation = leases.firecrawl.reserve("search", 2);
          leases.firecrawl.settle(reservation, { reportedCharge: 2, certainty: "reported" });
          return {
            results: [
              {
                title: "Fixture manufacturer guide",
                url: "https://manufacturer.example.test/application",
                snippet: "Application requirements for the tested membrane.",
              },
            ],
            metadata: { provider: "fixture", query },
          };
        },
      },
      captureProvider: null,
    }),
    runtimeOptions: {
      webToolsOptions: {
        lookup: async () => [{ address: "93.184.216.34", family: 4 }],
        fetchImpl: async () => new Response(FIXTURE_HTML, { headers: { "content-type": "text/html" } }),
      },
    },
  });
}

// --- Q6: scorer fixtures ---------------------------------------------------------------------

const PDF_CASE = shippedManifest.cases.find((entry) => entry.id === "au-native-pdf-table");
const PRICE_CASE = shippedManifest.cases.find((entry) => entry.id === "nz-product-price-state");
const SCANNED_CASE = shippedManifest.cases.find((entry) => entry.id === "au-scanned-pdf-limit");

function executedCase(id, overrides = {}) {
  const findings = overrides.findings ?? [];
  return {
    id,
    runId: `RSCH-${id}`,
    status: "completed",
    error: null,
    result: {
      summary: overrides.summary ?? "",
      findings,
      unresolvedQuestions: overrides.unresolvedQuestions ?? [],
    },
    sources: overrides.sources ?? [],
    verification:
      overrides.verification ??
      findings.flatMap((finding) =>
        (finding.evidence ?? []).map((reference, index) => ({
          findingId: finding.id,
          evidenceIndex: index,
          sourceId: reference.sourceId,
          url: reference.url,
          page: reference.locator?.page ?? null,
          reportedQuoteVerified: true,
          storeQuoteVerified: true,
        })),
      ),
    accounting: {
      model: { modelCalls: 6, toolCalls: 7, searchCalls: 1 },
      budgetState: {},
      providers: {
        firecrawl: { caseCommitted: 5, contractViolation: false, attempts: [] },
        serper: { caseCommitted: 0, contractViolation: false, attempts: [] },
      },
      ...(overrides.accounting ?? {}),
    },
    capturesUsed: overrides.capturesUsed ?? 1,
    ...(overrides.status ? { status: overrides.status } : {}),
  };
}

function pdfFinding({ page = 2, excerpt = "R2.0 1.93 2.04" } = {}) {
  return {
    id: "F1",
    claim: "The direct-fixed R2.0 assembly has summer 1.93 and winter 2.04 total R-values.",
    producedBy: "researcher",
    evidence: [
      {
        sourceId: "source-1",
        url: "https://www.jameshardie.com.au/guide.pdf",
        excerpt,
        locator: { page },
        quoteVerified: true,
        snapshotRef: "sha256:fixture",
      },
    ],
  };
}

const PDF_SOURCE = {
  id: "source-1",
  url: "https://www.jameshardie.com.au/guide.pdf",
  mediaType: "application/pdf",
  title: "Hardie Weather Barrier guide",
  retrievedAt: "2026-09-21T00:00:00.000Z",
};

function reviewFor(executedCases, verdict = "supports") {
  return {
    version: 1,
    revision: 1,
    claims: executedCases.flatMap((executed) =>
      (executed.result.findings ?? []).flatMap((finding) =>
        (finding.evidence ?? []).map((_reference, index) => ({
          claimKey: `${executed.id}::${finding.id}::${index}`,
          caseId: executed.id,
          findingId: finding.id,
          evidenceIndex: index,
          reviewer: { verdict, notes: "" },
        })),
      ),
    ),
    caseReview: executedCases.map((executed) => ({
      caseId: executed.id,
      usefulness: "useful",
      omissions: "",
      notes: "",
    })),
  };
}

const CLEAN_SCAN = { scannedFiles: 3, scannedBytes: 10, needleCount: 2, leakCount: 0, findings: [] };

function checkStatus(score, id) {
  return score.checks.find((check) => check.id === id)?.status;
}

test("the scorer keeps quote verification, claim support and authority separate", () => {
  const executed = executedCase(PDF_CASE.id, { findings: [pdfFinding()], sources: [PDF_SOURCE] });
  const passing = scoreCase({
    entry: PDF_CASE,
    executed,
    review: reviewFor([executed]),
    artifactScan: CLEAN_SCAN,
  });
  assert.deepEqual(passing.failed, []);
  assert.deepEqual(passing.pending, []);
  assert.equal(passing.taskPassed, true);
  assert.deepEqual(
    passing.checks.map((check) => check.id),
    [...CASE_CHECK_IDS],
  );

  // An exact quote that a human reads as unrelated: structurally verified, semantically not.
  const unsupported = scoreCase({
    entry: PDF_CASE,
    executed,
    review: reviewFor([executed], "unrelated"),
    artifactScan: CLEAN_SCAN,
  });
  assert.equal(checkStatus(unsupported, "quote_verified"), "passed");
  assert.equal(checkStatus(unsupported, "claim_supported"), "failed");
  assert.equal(unsupported.taskPassed, false);
});

test("a wrong page, an unverifiable excerpt or a foreign host fails its own check", () => {
  const wrongPage = executedCase(PDF_CASE.id, {
    findings: [pdfFinding({ page: 3 })],
    sources: [PDF_SOURCE],
  });
  assert.equal(
    checkStatus(
      scoreCase({
        entry: PDF_CASE,
        executed: wrongPage,
        review: reviewFor([wrongPage]),
        artifactScan: CLEAN_SCAN,
      }),
      "pdf_page_correct",
    ),
    "failed",
  );

  const absentExcerpt = executedCase(PDF_CASE.id, { findings: [pdfFinding()], sources: [PDF_SOURCE] });
  absentExcerpt.verification[0].storeQuoteVerified = false;
  const absentScore = scoreCase({
    entry: PDF_CASE,
    executed: absentExcerpt,
    review: reviewFor([absentExcerpt]),
    artifactScan: CLEAN_SCAN,
  });
  assert.equal(checkStatus(absentScore, "quote_verified"), "failed");
  assert.equal(checkStatus(absentScore, "expected_fact_represented"), "failed");

  const foreignHost = executedCase(PDF_CASE.id, {
    findings: [
      {
        ...pdfFinding(),
        evidence: [
          {
            ...pdfFinding().evidence[0],
            url: "https://www.somewholesaler.example.com/guide.pdf",
          },
        ],
      },
    ],
    sources: [{ ...PDF_SOURCE, url: "https://www.somewholesaler.example.com/guide.pdf" }],
  });
  assert.equal(
    checkStatus(
      scoreCase({
        entry: PDF_CASE,
        executed: foreignHost,
        review: reviewFor([foreignHost]),
        artifactScan: CLEAN_SCAN,
      }),
      "authority_appropriate",
    ),
    "failed",
  );
});

test("a missing price is neither invented nor reported as zero", () => {
  const htmlSource = {
    id: "source-1",
    url: "https://www.mitre10.co.nz/shop/gib-aqualine/p/433057",
    mediaType: "text/html",
    title: "GIB Aqualine",
    retrievedAt: "2026-09-21T00:00:00.000Z",
  };
  const evidence = (excerpt) => ({
    sourceId: "source-1",
    url: htmlSource.url,
    excerpt,
    quoteVerified: true,
    snapshotRef: "sha256:fixture",
  });

  const absent = executedCase(PRICE_CASE.id, {
    findings: [
      {
        id: "F1",
        claim:
          "The retained page identifies GIB Aqualine 2400 x 1200 but shows no price; the price is unavailable from the retained page.",
        producedBy: "researcher",
        evidence: [evidence("GIB Aqualine Plasterboard Sheet 10 x 2400 x 1200mm")],
      },
    ],
    sources: [htmlSource],
  });
  const absentScore = scoreCase({
    entry: PRICE_CASE,
    executed: absent,
    review: reviewFor([absent]),
    artifactScan: CLEAN_SCAN,
  });
  assert.equal(absentScore.taskPassed, true);

  const invented = executedCase(PRICE_CASE.id, {
    findings: [
      {
        id: "F1",
        claim: "GIB Aqualine 2400 x 1200 is priced at $58.90.",
        producedBy: "researcher",
        evidence: [evidence("GIB Aqualine Plasterboard Sheet 10 x 2400 x 1200mm")],
      },
    ],
    sources: [htmlSource],
  });
  const inventedScore = scoreCase({
    entry: PRICE_CASE,
    executed: invented,
    review: reviewFor([invented]),
    artifactScan: CLEAN_SCAN,
  });
  assert.equal(checkStatus(inventedScore, "dynamic_absence_discipline"), "failed");

  const zeroed = executedCase(PRICE_CASE.id, {
    findings: [
      {
        id: "F1",
        claim: "GIB Aqualine 2400 x 1200 has a price of $0.",
        producedBy: "researcher",
        evidence: [evidence("GIB Aqualine Plasterboard Sheet 10 x 2400 x 1200mm")],
      },
    ],
    sources: [htmlSource],
  });
  assert.equal(
    checkStatus(
      scoreCase({
        entry: PRICE_CASE,
        executed: zeroed,
        review: reviewFor([zeroed]),
        artifactScan: CLEAN_SCAN,
      }),
      "dynamic_absence_discipline",
    ),
    "failed",
  );
});

test("a deliberately unresolved question must be reported, not resolved from elsewhere", () => {
  const scannedSource = {
    id: "source-1",
    url: "https://www.vincent.wa.gov.au/agenda/assessment.pdf",
    mediaType: "application/pdf",
    title: "Heritage assessment",
    retrievedAt: "2026-09-21T00:00:00.000Z",
  };
  const supported = {
    id: "F1",
    claim: "The assessment refers to Building Licence Plans dated March 1951.",
    producedBy: "researcher",
    evidence: [
      {
        sourceId: "source-1",
        url: scannedSource.url,
        excerpt: "Building Licence Plans dated March 1951",
        locator: { page: 19 },
        quoteVerified: true,
        snapshotRef: "sha256:fixture",
      },
    ],
  };

  const honest = executedCase(SCANNED_CASE.id, {
    findings: [supported],
    sources: [scannedSource],
    unresolvedQuestions: [
      "Whether retained physical page 19 supports the exact wording Plan of Garage is unresolved: the phrase is absent from the retained page text.",
    ],
  });
  assert.equal(
    scoreCase({
      entry: SCANNED_CASE,
      executed: honest,
      review: reviewFor([honest]),
      artifactScan: CLEAN_SCAN,
    }).taskPassed,
    true,
  );

  const overclaimed = executedCase(SCANNED_CASE.id, {
    findings: [
      supported,
      {
        id: "F2",
        claim: "Physical page 19 contains the wording Plan of Garage.",
        producedBy: "researcher",
        evidence: [
          {
            sourceId: "source-1",
            url: scannedSource.url,
            excerpt: "Appendix 2: Plans",
            locator: { page: 19 },
            quoteVerified: true,
            snapshotRef: "sha256:fixture",
          },
        ],
      },
    ],
    sources: [scannedSource],
  });
  assert.equal(
    checkStatus(
      scoreCase({
        entry: SCANNED_CASE,
        executed: overclaimed,
        review: reviewFor([overclaimed]),
        artifactScan: CLEAN_SCAN,
      }),
      "uncertainty_surfaced",
    ),
    "failed",
  );

  const silent = executedCase(SCANNED_CASE.id, { findings: [supported], sources: [scannedSource] });
  assert.equal(
    checkStatus(
      scoreCase({
        entry: SCANNED_CASE,
        executed: silent,
        review: reviewFor([silent]),
        artifactScan: CLEAN_SCAN,
      }),
      "uncertainty_surfaced",
    ),
    "failed",
  );
});

test("exceeding a frozen bound, or a provider charge contract, fails the case", () => {
  const overspent = executedCase(PDF_CASE.id, {
    findings: [pdfFinding()],
    sources: [PDF_SOURCE],
    accounting: {
      model: { modelCalls: 11, toolCalls: 7, searchCalls: 1 },
      budgetState: {},
      providers: {
        firecrawl: { caseCommitted: 6, contractViolation: true, attempts: [] },
        serper: { caseCommitted: 0, contractViolation: false, attempts: [] },
      },
    },
    capturesUsed: 2,
  });
  const score = scoreCase({
    entry: PDF_CASE,
    executed: overspent,
    review: reviewFor([overspent]),
    artifactScan: CLEAN_SCAN,
  });
  assert.equal(checkStatus(score, "within_bounds"), "failed");
  assert.match(score.checks.find((check) => check.id === "within_bounds").detail, /maxModelCalls/);
});

test("a truncated or failed run never passes its case", () => {
  const truncated = executedCase(PDF_CASE.id, { findings: [pdfFinding()], sources: [PDF_SOURCE] });
  truncated.accounting.budgetState = { ceilingHit: "maxModelCalls" };
  assert.equal(
    checkStatus(
      scoreCase({
        entry: PDF_CASE,
        executed: truncated,
        review: reviewFor([truncated]),
        artifactScan: CLEAN_SCAN,
      }),
      "run_completed",
    ),
    "failed",
  );
  const failed = executedCase(PDF_CASE.id, { findings: [], sources: [], status: "failed" });
  const failedScore = scoreCase({
    entry: PDF_CASE,
    executed: failed,
    review: { claims: [], caseReview: [] },
    artifactScan: CLEAN_SCAN,
  });
  assert.equal(failedScore.taskPassed, false);
  assert.equal(checkStatus(failedScore, "evidence_retained"), "failed");
});

test("a credential found in an artifact fails every case", () => {
  const executed = executedCase(PDF_CASE.id, { findings: [pdfFinding()], sources: [PDF_SOURCE] });
  const score = scoreCase({
    entry: PDF_CASE,
    executed,
    review: reviewFor([executed]),
    artifactScan: {
      scannedFiles: 4,
      leakCount: 1,
      findings: [{ artifact: "report.json", label: "FIRECRAWL_API_KEY", occurrences: 1 }],
    },
  });
  assert.equal(checkStatus(score, "no_credential_leak"), "failed");
  assert.equal(score.taskPassed, false);
});

// --- Q6/Q12: a missing review cannot produce a pass -------------------------------------------

test("a session verdict stays pending while any claim lacks a human verdict", () => {
  const executed = shippedManifest.cases.map((entry) =>
    executedCase(entry.id, {
      findings: [pdfFinding()],
      sources: [PDF_SOURCE],
    }),
  );
  const session = {
    sessionId: "fixture",
    status: "completed",
    preflight: { manifest: { hash: "sha256:fixture" } },
    cases: executed,
    ledgers: null,
  };
  const withoutVerdicts = reviewFor(executed);
  for (const claim of withoutVerdicts.claims) claim.reviewer.verdict = null;
  const pending = scoreSession({
    manifest: shippedManifest,
    session,
    review: withoutVerdicts,
    artifactScan: CLEAN_SCAN,
  });
  assert.equal(pending.verdict, "pending_human_review");
  assert.equal(pending.activationRecommended, false);
  assert.notEqual(pending.verdict, "passed");
  assert.equal(pending.review.complete, false);
});

test("activation requires four first-attempt passes and nothing less", () => {
  const passing = shippedManifest.cases.map((entry) => {
    if (entry.id === PDF_CASE.id)
      return executedCase(entry.id, { findings: [pdfFinding()], sources: [PDF_SOURCE] });
    return executedCase(entry.id, { findings: [pdfFinding()], sources: [PDF_SOURCE] });
  });
  const session = {
    sessionId: "fixture",
    status: "completed",
    preflight: { manifest: { hash: "sha256:fixture" } },
    cases: passing,
    ledgers: null,
  };
  const report = scoreSession({
    manifest: shippedManifest,
    session,
    review: reviewFor(passing),
    artifactScan: CLEAN_SCAN,
  });
  assert.equal(report.primaryMetric.required, 4);
  assert.equal(report.primaryMetric.retriesIncluded, false);
  assert.equal(report.verdict, report.primaryMetric.firstAttemptPasses === 4 ? "passed" : "failed");
  assert.equal(report.activationRecommended, report.verdict === "passed");
});

test("a case that never ran is scored as a failure, not omitted", () => {
  const session = {
    sessionId: "fixture",
    status: "stopped",
    stopped: { caseId: "au-native-pdf-table", reason: "structural_failure:child_process_failed" },
    preflight: { manifest: { hash: "sha256:fixture" } },
    cases: [],
    ledgers: null,
  };
  const report = scoreSession({
    manifest: shippedManifest,
    session,
    review: { claims: [], caseReview: [] },
    artifactScan: CLEAN_SCAN,
  });
  assert.equal(report.cases.length, 4);
  assert.equal(report.primaryMetric.firstAttemptPasses, 0);
  assert.notEqual(report.verdict, "passed");
});

// --- Q6: review packet, secret scan, lineage and offline scoring -------------------------------

test("the review packet is blind to the oracle and refuses a verdict until every claim is judged", async () => {
  await withTempDirectory(async (directory) => {
    const manifest = fixtureManifest();
    const session = await runFixtureSession({ manifest, directory });
    const packet = await buildReviewPacket({
      manifest,
      session,
      snapshotDirectory: path.join(session.directory, "sources"),
    });
    const serialized = JSON.stringify(packet);
    for (const entry of manifest.cases) {
      assert.equal(serialized.includes(entry.oracle.reviewNotes), false);
      assert.equal(serialized.includes(entry.oracle.forbiddenInferences[0]), false);
      assert.equal(serialized.includes(entry.oracle.expectedFacts[0].phrase.toUpperCase()), false);
    }
    assert.equal(packet.claims.length > 0, true);
    for (const claim of packet.claims) {
      assert.equal(claim.reviewer.verdict, null);
      assert.equal(typeof claim.excerpt, "string");
      assert.equal(typeof claim.retainedContext, "string");
      assert.equal(claim.retainedContext.includes(claim.excerpt), true);
      assert.equal(claim.source.role, "manufacturer");
      assert.equal(claim.hostQuoteVerified, true);
    }
    const before = reviewCompleteness(packet);
    assert.equal(before.complete, false);
    assert.equal(before.missingClaims.length, packet.claims.length);

    for (const claim of packet.claims) claim.reviewer.verdict = "supports";
    for (const entry of packet.caseReview) entry.usefulness = "useful";
    assert.equal(reviewCompleteness(packet).complete, true);
  });
});

test("a correction after finalisation creates a revision and preserves the prior values", () => {
  const finalised = {
    version: 1,
    revision: 1,
    finalised: true,
    claims: [{ claimKey: "a", reviewer: { verdict: "supports", notes: "" } }],
    caseReview: [],
    history: [],
  };
  const corrected = withReviewRevision(finalised, {
    ...finalised,
    claims: [{ claimKey: "a", reviewer: { verdict: "partial", notes: "reconsidered" } }],
  });
  assert.equal(corrected.revision, 2);
  assert.equal(corrected.history.length, 1);
  assert.equal(corrected.history[0].claims[0].reviewer.verdict, "supports");
  assert.equal(corrected.claims[0].reviewer.verdict, "partial");
});

test("the artifact scan reports counts and names, never the searched value", async () => {
  await withTempDirectory(async (directory) => {
    await writeJsonArtifact(path.join(directory, "report.json"), { note: "clean" });
    await writeArtifact(path.join(directory, "cases/a/stdout.log"), "captured firecrawl-sentinel output\n");
    const scan = await scanArtifactsForSecrets(
      directory,
      scannedNeedles({ FIRECRAWL_API_KEY: "unused-key" }),
    );
    assert.equal(scan.leakCount, 1);
    assert.deepEqual(scan.findings, [
      { artifact: "cases/a/stdout.log", label: "synthetic-sentinel", occurrences: 1 },
    ]);
    assert.equal(JSON.stringify(scan).includes("firecrawl-sentinel"), false);

    const clean = await scanArtifactsForSecrets(path.join(directory, "cases"), [
      { label: "FIRECRAWL_API_KEY", value: "a-value-not-present" },
    ]);
    assert.equal(clean.leakCount, 0);
  });
});

test("a session is scored only against the manifest revision it ran on", () => {
  const session = { preflight: { manifest: { hash: "sha256:original" } } };
  assert.equal(assertManifestLineage(session, "sha256:original"), "sha256:original");
  assert.throws(() => assertManifestLineage(session, "sha256:edited"), /own manifest revision/);
});

test("scoring is offline: a session is rescored from its own artifacts with no provider", async () => {
  await withTempDirectory(async (directory) => {
    const manifest = fixtureManifest();
    const session = await runFixtureSession({ manifest, directory });
    await finalizeSession({ manifest, session, environment: {} });

    const { loadSessionFromDirectory } = await import("../scripts/research-model-pilot/finalize.mjs");
    const reloaded = await loadSessionFromDirectory(session.directory);
    assert.equal(reloaded.cases.length, 2);
    assert.deepEqual(
      reloaded.cases.map((entry) => entry.id),
      ["fixture-alpha", "fixture-beta"],
    );
    const review = JSON.parse(await readFile(path.join(session.directory, "review.json"), "utf8"));
    for (const claim of review.claims) claim.reviewer.verdict = "supports";
    for (const entry of review.caseReview) entry.usefulness = "useful";
    review.finalised = true;

    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = async (...args) => {
      fetchCalls += 1;
      return originalFetch(...args);
    };
    try {
      const { report } = await finalizeSession({ manifest, session: reloaded, review, environment: {} });
      assert.equal(fetchCalls, 0);
      assert.equal(report.review.complete, true);
      assert.equal(report.primaryMetric.firstAttemptPasses, 2);
      assert.equal(report.verdict, "passed");
      assert.equal(report.activationRecommended, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("a structural case failure stops the session and still leaves a readable report", async () => {
  await withTempDirectory(async (directory) => {
    const manifest = fixtureManifest();
    let calls = 0;
    const session = await runModelPilotSession({
      manifest,
      manifestHash: "sha256:fixture",
      manifestPath: "fixture.json",
      environment: { ...safeChildEnv(), RESEARCH_MODEL_PROVIDER: "fake" },
      mode: "live",
      sessionRoot: path.join(directory, "sessions"),
      liveGuards: async () => ({ model: { identity: null, selectionPending: true }, allowance: null }),
      createProviders: () => {
        calls += 1;
        const error = new Error("Firecrawl rejected the credential.");
        error.code = "provider_auth_failed";
        throw error;
      },
    });
    assert.equal(calls, 1, "the session stopped before the second case");
    assert.equal(session.status, "stopped");
    assert.equal(session.cases.length, 1);
    assert.equal(session.cases[0].status, "failed");
    assert.equal(session.stopped.reason, "structural_failure:provider_auth_failed");
    const persisted = JSON.parse(
      await readFile(path.join(session.directory, "cases/fixture-alpha/result.json"), "utf8"),
    );
    assert.equal(persisted.status, "failed");
    assert.equal(persisted.error.code, "provider_auth_failed");

    const { report } = await finalizeSession({ manifest, session, environment: {} });
    assert.equal(report.sessionStatus, "stopped");
    assert.notEqual(report.verdict, "passed");
    assert.equal(report.cases[1].taskPassed, false);
    assert.equal(report.cases[1].failed.includes("run_completed"), true);
  });
});

test("an eligible Firecrawl failure falls back to one bounded Serper call on the session lease", async () => {
  const { FallbackSearchProvider } = await import("../server/research/fallback-search-provider.mjs");
  const { SerperSearchProvider } = await import("../server/research/serper-search-provider.mjs");
  const { ResearchProviderError } = await import("../server/research/research-provider-errors.mjs");
  const session = new PilotSessionLedger({ provider: "serper", ceiling: 2 });
  const lease = session.lease("fallback-case");
  let serperRequests = 0;
  const fallback = new FallbackSearchProvider({
    primary: {
      async search() {
        throw new ResearchProviderError({
          provider: "firecrawl",
          operation: "search",
          category: "transient",
          fallbackEligible: true,
          message: "Synthetic pre-transport Firecrawl failure.",
          attempt: { provider: "firecrawl", operation: "search", certainty: "not_sent", charge: 0 },
        });
      },
    },
    fallback: new SerperSearchProvider({
      apiKey: "serper-sentinel",
      ledger: lease,
      fetchImpl: async () => {
        serperRequests += 1;
        return new Response(
          JSON.stringify({ organic: [{ title: "Fixture", link: "https://manufacturer.example.test/a" }] }),
          { headers: { "content-type": "application/json" } },
        );
      },
    }),
  });
  const result = await fallback.search("fixture query", { market: "NZ", maxResults: 5 });
  assert.equal(result.metadata.selectedProvider, "serper");
  assert.equal(serperRequests, 1);
  lease.close();
  assert.equal(session.snapshot().committedUpperBound, 1);
  assert.equal(attemptsFor(session.snapshot(), "search"), 1);
});

test("the documented rollback configuration resolves without constructing a paid provider", async () => {
  const { resolveResearchProviders } = await import("../server/research/research-provider-resolver.mjs");
  const resolved = resolveResearchProviders({
    RESEARCH_SEARCH_PROVIDER: "tavily",
    RESEARCH_SEARCH_FALLBACK: "none",
    RESEARCH_CAPTURE_PROVIDER: "local",
    RESEARCH_PDF_PROVIDER: "disabled",
    TAVILY_API_KEY: "tavily-sentinel",
  });
  assert.equal(resolved.config.searchProvider, "tavily");
  assert.equal(resolved.captureProvider, null);
  assert.equal(resolved.config.pdfProvider, "disabled");
});

test("a run deadline during a tool call still closes every reservation and lets the session continue", async () => {
  await withTempDirectory(async (directory) => {
    const manifest = parsePilotManifest({
      version: 1,
      description: "Deterministic deadline fixture.",
      session: {
        firecrawlSessionCeiling: 50,
        serperCallCeiling: 2,
        calculatedFirecrawlUpperBound: 10,
        maxModelCalls: 20,
        maxSearches: 2,
        maxUniqueCaptures: 2,
        modelMaxOutputTokens: 8_192,
        requiredFirstAttemptPasses: 2,
      },
      cases: [
        {
          ...fixtureCase("fixture-alpha"),
          budget: { ...fixtureCase("fixture-alpha").budget, maxRuntimeMs: 1_500 },
        },
        fixtureCase("fixture-beta"),
      ],
    });
    let slowSearches = 0;
    const session = await runModelPilotSession({
      manifest,
      manifestHash: "sha256:fixture",
      manifestPath: "fixture.json",
      environment: { ...safeChildEnv(), RESEARCH_MODEL_PROVIDER: "fake" },
      mode: "live",
      sessionRoot: path.join(directory, "sessions"),
      liveGuards: async () => ({ model: { identity: null, selectionPending: true }, allowance: null }),
      createProviders: ({ entry, leases }) => ({
        searchProvider: {
          async search(query) {
            if (entry.id === "fixture-alpha") {
              slowSearches += 1;
              // Reserved but never settled by the provider: the run is killed mid-call.
              leases.firecrawl.reserve("search", 2);
              await new Promise((resolve) => setTimeout(resolve, 5_000));
            } else {
              const reservation = leases.firecrawl.reserve("search", 2);
              leases.firecrawl.settle(reservation, { reportedCharge: 2, certainty: "reported" });
            }
            return {
              results: [
                {
                  title: "Fixture manufacturer guide",
                  url: "https://manufacturer.example.test/application",
                  snippet: "Application requirements.",
                },
              ],
              metadata: { provider: "fixture", query },
            };
          },
        },
        captureProvider: null,
      }),
      runtimeOptions: {
        webToolsOptions: {
          lookup: async () => [{ address: "93.184.216.34", family: 4 }],
          fetchImpl: async () => new Response(FIXTURE_HTML, { headers: { "content-type": "text/html" } }),
        },
      },
    });
    assert.equal(slowSearches, 1);
    assert.equal(session.cases[0].status, "failed");
    assert.match(session.cases[0].error.code, /timeout|cancelled|process/);
    assert.equal(session.cases.length, 2, "an ordinary quality failure does not stop the session");
    assert.equal(session.ledgers.firecrawl.activeReservations, 0);
    const abandoned = session.ledgers.firecrawl.attempts.find(
      (attempt) => attempt.certainty === "unknown_after_termination",
    );
    assert.ok(abandoned, "an unsettled reservation is retained as unknown, never as zero");
    const accounting = JSON.parse(
      await readFile(path.join(session.directory, "cases/fixture-alpha/accounting.json"), "utf8"),
    );
    assert.equal(accounting.providers.firecrawl.caseCommitted, 2);
  });
});
