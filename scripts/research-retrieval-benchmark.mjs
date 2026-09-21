import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  estimateFirecrawlCredits,
  renderRetrievalReport,
  runRetrievalBenchmark,
  summariseRetrievalBenchmark,
} from "./research-retrieval-benchmark/benchmark.mjs";
import { resolveRetrievalProviders } from "./research-retrieval-benchmark/providers.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultCasesPath = path.join(scriptDirectory, "research-retrieval-benchmark", "cases.json");
const allProviderNames = ["local", "firecrawl", "exa"];

function positiveInteger(value, name, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}.`);
  }
  return parsed;
}

export function parseRetrievalBenchmarkArguments(argv) {
  const options = {
    providers: allProviderNames,
    repetitions: 2,
    casesPath: defaultCasesPath,
    caseIds: [],
    maxFirecrawlCredits: 50,
    dryRun: false,
  };
  for (const argument of argv) {
    if (argument === "--dry-run") {
      options.dryRun = true;
    } else if (argument.startsWith("--providers=")) {
      options.providers = argument.slice("--providers=".length).split(",").filter(Boolean);
    } else if (argument.startsWith("--repetitions=")) {
      options.repetitions = positiveInteger(argument.slice("--repetitions=".length), "repetitions", 3);
    } else if (argument.startsWith("--case=")) {
      options.caseIds.push(argument.slice("--case=".length));
    } else if (argument.startsWith("--cases=")) {
      options.casesPath = path.resolve(argument.slice("--cases=".length));
    } else if (argument.startsWith("--max-firecrawl-credits=")) {
      options.maxFirecrawlCredits = positiveInteger(
        argument.slice("--max-firecrawl-credits=".length),
        "max-firecrawl-credits",
        500,
      );
    } else {
      throw new Error(`Unknown argument "${argument}".`);
    }
  }
  const unknownProviders = options.providers.filter((provider) => !allProviderNames.includes(provider));
  if (unknownProviders.length > 0) throw new Error(`Unknown providers: ${unknownProviders.join(", ")}.`);
  return options;
}

async function loadCases(casesPath, selectedCaseIds) {
  const corpus = JSON.parse(await readFile(casesPath, "utf8"));
  let cases = corpus.cases ?? [];
  if (selectedCaseIds.length > 0) {
    cases = cases.filter((testCase) => selectedCaseIds.includes(testCase.id));
    const missing = selectedCaseIds.filter((caseId) => !cases.some((testCase) => testCase.id === caseId));
    if (missing.length > 0) throw new Error(`Unknown benchmark cases: ${missing.join(", ")}.`);
  }
  if (cases.length === 0) throw new Error("The retrieval benchmark corpus contains no selected cases.");
  return { corpus, cases };
}

function timestampDirectoryName(date = new Date()) {
  return date.toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

async function main() {
  const options = parseRetrievalBenchmarkArguments(process.argv.slice(2));
  const { corpus, cases } = await loadCases(options.casesPath, options.caseIds);
  const resolved = resolveRetrievalProviders(process.env);
  const selectedProviders = options.providers.filter((provider) => resolved.providers.has(provider));
  const skipped = resolved.skipped.filter((item) => options.providers.includes(item.provider));
  const estimatedMaximumFirecrawlCredits = options.providers.includes("firecrawl")
    ? estimateFirecrawlCredits(cases, options.repetitions)
    : 0;
  const plan = {
    corpusVersion: corpus.version,
    cases: cases.map((testCase) => ({
      id: testCase.id,
      market: testCase.market,
      kind: testCase.kind,
      url: testCase.url,
      maxPages: testCase.maxPages ?? null,
    })),
    requestedProviders: options.providers,
    runnableProviders: selectedProviders,
    skipped,
    repetitions: options.repetitions,
    plannedRetrievalCalls: cases.length * selectedProviders.length * options.repetitions,
    estimatedMaximumFirecrawlCredits,
    maxFirecrawlCredits: options.maxFirecrawlCredits,
  };
  if (options.dryRun) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return;
  }
  if (process.env.RUN_RESEARCH_RETRIEVAL_BENCHMARK !== "1") {
    throw new Error(
      "Set RUN_RESEARCH_RETRIEVAL_BENCHMARK=1 to make live calls. Calls may consume provider credits.",
    );
  }
  if (selectedProviders.length === 0) throw new Error("No requested retrieval route is runnable.");
  if (estimatedMaximumFirecrawlCredits > options.maxFirecrawlCredits) {
    throw new Error(
      `Planned Firecrawl usage (${estimatedMaximumFirecrawlCredits}) exceeds the configured ceiling (${options.maxFirecrawlCredits}).`,
    );
  }

  const generatedAt = new Date().toISOString();
  const benchmark = {
    generatedAt,
    corpusVersion: corpus.version,
    selectedProviders,
    repetitions: options.repetitions,
    estimatedMaximumFirecrawlCredits,
  };
  const runs = await runRetrievalBenchmark({
    cases,
    providers: resolved.providers,
    selectedProviders,
    repetitions: options.repetitions,
  });
  const summary = summariseRetrievalBenchmark(runs);
  const artifact = { benchmark, cases, skipped, summary, runs };
  const outputDirectory = path.resolve(
    process.env.RESEARCH_RETRIEVAL_BENCHMARK_OUTPUT_DIR ??
      path.join(".data", "research-retrieval-benchmarks", timestampDirectoryName(new Date(generatedAt))),
  );
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  const resultsPath = path.join(outputDirectory, "results.json");
  const reportPath = path.join(outputDirectory, "report.md");
  await writeFile(resultsPath, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 });
  await writeFile(reportPath, renderRetrievalReport({ benchmark, cases, runs, summary, skipped }), {
    mode: 0o600,
  });
  process.stdout.write(`${JSON.stringify({ outputDirectory, resultsPath, reportPath, summary }, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error?.message ?? String(error)}\n`);
    process.exitCode = 1;
  });
}
