import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseResearchProviderConfig } from "@eversor/research-engine/research-provider-contracts.mjs";

const manifestPath = fileURLToPath(new URL("./research-provider-acceptance-cases.json", import.meta.url));
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const expectedIds = [
  "nz-dynamic-price-html",
  "au-hardie-table-pdf",
  "wrong-existing-page-fixture",
  "synthetic-firecrawl-failure-serper-fallback",
];
assertManifest(manifest, expectedIds);

const environment = {
  ...process.env,
  RESEARCH_SEARCH_PROVIDER: "firecrawl",
  RESEARCH_SEARCH_FALLBACK: "serper",
  RESEARCH_CAPTURE_PROVIDER: "firecrawl",
  RESEARCH_PDF_PROVIDER: "firecrawl",
  RESEARCH_DEFAULT_MARKET: "NZ",
  RESEARCH_FIRECRAWL_MAX_PDF_PAGES: "3",
  RESEARCH_FIRECRAWL_MAX_CREDITS_PER_RUN: "40",
  RESEARCH_SERPER_MAX_CALLS_PER_RUN: "1",
};
const config = parseResearchProviderConfig(environment);
const dryRun = process.env.RUN_RESEARCH_PROVIDER_ACCEPTANCE !== "1";
const summary = {
  mode: dryRun ? "dry-run" : "live",
  manifestVersion: manifest.version,
  scenarioIds: manifest.scenarios.map((scenario) => scenario.id),
  configuration: {
    searchProvider: config.searchProvider,
    searchFallback: config.searchFallback,
    captureProvider: config.captureProvider,
    pdfProvider: config.pdfProvider,
    defaultMarket: config.defaultMarket,
    pdfMode: "ocr",
    maxPdfPages: config.maxPdfPages,
    maxAge: 0,
    storeInCache: false,
  },
  allowance: manifest.limits,
  networkCalls: 0,
  modelCalls: 0,
};

if (dryRun) {
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  process.exit(0);
}

if (process.env.RESEARCH_PUBLIC_ONLY_ACKNOWLEDGED !== "1")
  throw new Error(
    "Live acceptance requires RESEARCH_PUBLIC_ONLY_ACKNOWLEDGED=1; public queries and URLs leave the machine.",
  );
if (!process.env.FIRECRAWL_API_KEY || !process.env.SERPER_API_KEY)
  throw new Error("Live acceptance requires FIRECRAWL_API_KEY and SERPER_API_KEY.");
if (process.env.RESEARCH_MODEL_PROVIDER && process.env.RESEARCH_MODEL_PROVIDER !== "fake")
  throw new Error("Provider acceptance rejects live-model selection; use the deterministic fake model.");

// Prove that the native checkpoint dependency can execute in this exact Node process before
// any paid provider is constructed. Worktrees can share node_modules while shells select a
// different Node ABI, which must fail before the first search rather than after paid capture.
const { preflightResearchAcceptanceRuntime } = await import("./research-provider-acceptance-preflight.mjs");
await preflightResearchAcceptanceRuntime();

// The guard above is intentionally the last point before importing the live runner. Dry runs
// therefore cannot instantiate providers, resolve DNS, create acceptance directories or touch
// credentials. The live runner owns the single shared ledger and writes one owner-only report.
const { runResearchProviderAcceptance } = await import("./research-provider-acceptance-live.mjs");
const report = await runResearchProviderAcceptance({ environment, manifest, manifestPath });
const reportDirectory = path.resolve(".data", "research-runtime-acceptance", report.sessionId);
await mkdir(reportDirectory, { recursive: true, mode: 0o700 });
const reportPath = path.join(reportDirectory, "report.json");
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
  encoding: "utf8",
  mode: 0o600,
  flag: "wx",
});
await writeAndFlush(
  `${JSON.stringify({ status: report.status, reportPath, usage: report.usage }, null, 2)}\n`,
);
// This is a bounded one-shot CLI. Provider HTTP clients may retain idle connection handles after
// the report and all owned runtime resources are closed, so exit only after durable output flushes.
process.exit(report.status === "passed" ? 0 : 1);

function assertManifest(value, ids) {
  if (value?.version !== 1 || !Array.isArray(value.scenarios))
    throw new Error("Acceptance manifest must be version 1 with scenarios.");
  assertUnique(
    value.scenarios.map((scenario) => scenario.id),
    "scenario ids",
  );
  for (const id of ids)
    if (!value.scenarios.some((scenario) => scenario.id === id))
      throw new Error(`Acceptance manifest is missing ${id}.`);
  if (value.limits?.firecrawlCredits !== 40 || value.limits?.serperCalls !== 1)
    throw new Error("Acceptance allowance must remain 40 Firecrawl credits and one Serper call.");
  if (value.limits?.calculatedFirecrawlUpperBound !== 12)
    throw new Error("Acceptance manifest upper bound must remain 12 Firecrawl credits.");
}

function assertUnique(values, label) {
  if (new Set(values).size !== values.length) throw new Error(`Acceptance ${label} must be unique.`);
}

function writeAndFlush(content) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      process.stdout.off("error", onError);
      reject(error);
    };
    process.stdout.once("error", onError);
    process.stdout.write(content, () => {
      process.stdout.off("error", onError);
      resolve();
    });
  });
}
