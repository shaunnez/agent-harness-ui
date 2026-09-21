import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  renderBenchmarkReport,
  runBenchmark,
  summariseBenchmark,
} from "./research-search-benchmark/benchmark.mjs";
import { resolveBenchmarkProviders } from "./research-search-benchmark/providers.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultCasesPath = path.join(scriptDirectory, "research-search-benchmark", "cases.json");
const allProviderNames = ["serper", "tavily", "exa", "firecrawl"];

function parsePositiveInteger(value, name, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}.`);
  }
  return parsed;
}

export function parseBenchmarkArguments(argv) {
  const options = {
    providers: allProviderNames,
    repetitions: 2,
    maxResults: 10,
    casesPath: defaultCasesPath,
    caseIds: [],
    dryRun: false,
  };
  for (const argument of argv) {
    if (argument === "--dry-run") {
      options.dryRun = true;
    } else if (argument.startsWith("--providers=")) {
      options.providers = argument.slice("--providers=".length).split(",").filter(Boolean);
    } else if (argument.startsWith("--repetitions=")) {
      options.repetitions = parsePositiveInteger(argument.slice("--repetitions=".length), "repetitions", 5);
    } else if (argument.startsWith("--max-results=")) {
      options.maxResults = parsePositiveInteger(argument.slice("--max-results=".length), "max-results", 10);
    } else if (argument.startsWith("--case=")) {
      options.caseIds.push(argument.slice("--case=".length));
    } else if (argument.startsWith("--cases=")) {
      options.casesPath = path.resolve(argument.slice("--cases=".length));
    } else {
      throw new Error(`Unknown argument "${argument}".`);
    }
  }
  const unknownProviders = options.providers.filter((provider) => !allProviderNames.includes(provider));
  if (unknownProviders.length > 0) {
    throw new Error(`Unknown providers: ${unknownProviders.join(", ")}.`);
  }
  return options;
}

function timestampDirectoryName(date = new Date()) {
  return date.toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

async function loadCases(casesPath, selectedCaseIds) {
  const corpus = JSON.parse(await readFile(casesPath, "utf8"));
  let cases = corpus.cases ?? [];
  if (selectedCaseIds.length > 0) {
    cases = cases.filter((testCase) => selectedCaseIds.includes(testCase.id));
    const missing = selectedCaseIds.filter((caseId) => !cases.some((testCase) => testCase.id === caseId));
    if (missing.length > 0) throw new Error(`Unknown benchmark cases: ${missing.join(", ")}.`);
  }
  if (cases.length === 0) throw new Error("The benchmark corpus contains no selected cases.");
  return { corpus, cases };
}

async function main() {
  const options = parseBenchmarkArguments(process.argv.slice(2));
  const { corpus, cases } = await loadCases(options.casesPath, options.caseIds);
  const resolved = resolveBenchmarkProviders(process.env);
  const selectedProviders = options.providers.filter((provider) => resolved.providers.has(provider));
  const skipped = resolved.skipped.filter((item) => options.providers.includes(item.provider));
  const plan = {
    corpusVersion: corpus.version,
    cases: cases.map((testCase) => ({ id: testCase.id, market: testCase.market, query: testCase.query })),
    requestedProviders: options.providers,
    runnableProviders: selectedProviders,
    skipped,
    repetitions: options.repetitions,
    maxResults: options.maxResults,
    plannedSearchCalls: cases.length * selectedProviders.length * options.repetitions,
  };

  if (options.dryRun) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return;
  }
  if (process.env.RUN_RESEARCH_SEARCH_BENCHMARK !== "1") {
    throw new Error(
      "Set RUN_RESEARCH_SEARCH_BENCHMARK=1 to make live provider calls. Calls may consume provider credits.",
    );
  }
  if (selectedProviders.length === 0) throw new Error("No requested search provider is runnable.");

  const generatedAt = new Date().toISOString();
  const benchmark = {
    generatedAt,
    corpusVersion: corpus.version,
    selectedProviders,
    repetitions: options.repetitions,
    maxResults: options.maxResults,
  };
  const runs = await runBenchmark({
    cases,
    providers: resolved.providers,
    selectedProviders,
    repetitions: options.repetitions,
    maxResults: options.maxResults,
  });
  const summary = summariseBenchmark(runs);
  const artifact = { benchmark, cases, skipped, summary, runs };
  const outputDirectory = path.resolve(
    process.env.RESEARCH_SEARCH_BENCHMARK_OUTPUT_DIR ??
      path.join(".data", "research-benchmarks", timestampDirectoryName(new Date(generatedAt))),
  );
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  const resultsPath = path.join(outputDirectory, "results.json");
  const reportPath = path.join(outputDirectory, "report.md");
  await writeFile(resultsPath, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 });
  await writeFile(reportPath, renderBenchmarkReport({ benchmark, cases, runs, summary, skipped }), {
    mode: 0o600,
  });
  process.stdout.write(
    `${JSON.stringify({ outputDirectory, reportPath, resultsPath, summary, skipped }, null, 2)}\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error?.message ?? String(error)}\n`);
    process.exitCode = 1;
  });
}
