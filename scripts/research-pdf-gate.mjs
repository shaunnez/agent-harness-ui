import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { FirecrawlRetrievalProvider } from "./research-retrieval-benchmark/providers.mjs";
import {
  renderPdfGateReport,
  runRetrievalBenchmark,
  summarisePdfGate,
} from "./research-pdf-gate/benchmark.mjs";
import { PlanCheckPdfProvider } from "./research-pdf-gate/providers.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultCasesPath = path.join(scriptDirectory, "research-pdf-gate", "cases.json");
const defaultAdapterPath = path.join(scriptDirectory, "research-pdf-gate", "plancheck_extract.py");

function integer(value, label, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > maximum) {
    throw new Error(`${label} must be an integer between 0 and ${maximum}.`);
  }
  return parsed;
}

export function parsePdfGateArguments(argv) {
  const options = {
    casesPath: defaultCasesPath,
    sourceDirectory: path.resolve(".data/research-pdf-gate-sources"),
    planCheckRepository: path.resolve(
      process.env.PLANCHECK_REPOSITORY_PATH ?? "/Users/shaun/projects/eversor-plancheck",
    ),
    maxFirecrawlCredits: 100,
    maxPlanCheckVisionPages: 25,
    executeVision: false,
    dryRun: false,
  };
  for (const argument of argv) {
    if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--execute-vision") options.executeVision = true;
    else if (argument.startsWith("--cases=")) {
      options.casesPath = path.resolve(argument.slice("--cases=".length));
    } else if (argument.startsWith("--source-dir=")) {
      options.sourceDirectory = path.resolve(argument.slice("--source-dir=".length));
    } else if (argument.startsWith("--plancheck-repo=")) {
      options.planCheckRepository = path.resolve(argument.slice("--plancheck-repo=".length));
    } else if (argument.startsWith("--max-firecrawl-credits=")) {
      options.maxFirecrawlCredits = integer(
        argument.slice("--max-firecrawl-credits=".length),
        "max-firecrawl-credits",
        500,
      );
    } else if (argument.startsWith("--max-plancheck-vision-pages=")) {
      options.maxPlanCheckVisionPages = integer(
        argument.slice("--max-plancheck-vision-pages=".length),
        "max-plancheck-vision-pages",
        200,
      );
    } else throw new Error(`Unknown argument "${argument}".`);
  }
  return options;
}

function timestampDirectoryName(date) {
  return date.toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

async function main() {
  const options = parsePdfGateArguments(process.argv.slice(2));
  const corpus = JSON.parse(await readFile(options.casesPath, "utf8"));
  const cases = corpus.cases ?? [];
  if (cases.length === 0) throw new Error("The PDF gate corpus is empty.");

  const plancheck = new PlanCheckPdfProvider({
    repositoryPath: options.planCheckRepository,
    sourceDirectory: options.sourceDirectory,
    adapterPath: defaultAdapterPath,
    executeVision: options.executeVision,
  });
  const plans = [];
  for (const testCase of cases) {
    plans.push({ caseId: testCase.id, ...(await plancheck.plan(testCase)) });
  }
  const estimatedFirecrawlCredits = cases.reduce((total, item) => total + 1 + item.maxPages, 0);
  const estimatedPlanCheckVisionCalls = plans.reduce((total, item) => total + item.sparsePages.length, 0);
  const preflight = {
    corpusVersion: corpus.version,
    cases: cases.map((item) => ({
      id: item.id,
      url: item.url,
      profile: item.profile,
      totalPages: plans.find((plan) => plan.caseId === item.id).totalPages,
      maxPages: item.maxPages,
      planCheckVisionPages: plans.find((plan) => plan.caseId === item.id).sparsePages,
      firecrawlMode: item.pdfMode,
    })),
    estimatedFirecrawlCredits,
    maxFirecrawlCredits: options.maxFirecrawlCredits,
    estimatedPlanCheckVisionCalls,
    maxPlanCheckVisionPages: options.maxPlanCheckVisionPages,
    executeVision: options.executeVision,
  };
  if (options.dryRun) {
    process.stdout.write(`${JSON.stringify(preflight, null, 2)}\n`);
    return;
  }
  if (process.env.RUN_RESEARCH_PDF_GATE !== "1") {
    throw new Error("Set RUN_RESEARCH_PDF_GATE=1 to make live provider calls.");
  }
  if (!process.env.FIRECRAWL_API_KEY) throw new Error("FIRECRAWL_API_KEY is not configured.");
  if (estimatedFirecrawlCredits > options.maxFirecrawlCredits) {
    throw new Error(`Planned Firecrawl use (${estimatedFirecrawlCredits}) exceeds the configured ceiling.`);
  }
  if (estimatedPlanCheckVisionCalls > options.maxPlanCheckVisionPages) {
    throw new Error(
      `Planned PlanCheck vision use (${estimatedPlanCheckVisionCalls}) exceeds the configured ceiling.`,
    );
  }
  if (estimatedPlanCheckVisionCalls > 0 && !options.executeVision) {
    throw new Error(
      "The selected corpus needs PlanCheck vision; pass --execute-vision after reviewing dry-run.",
    );
  }

  const firecrawl = new FirecrawlRetrievalProvider({ apiKey: process.env.FIRECRAWL_API_KEY });
  const providers = new Map([
    [plancheck.name, plancheck],
    [firecrawl.name, firecrawl],
  ]);
  const generatedAt = new Date();
  const benchmark = {
    generatedAt: generatedAt.toISOString(),
    estimatedFirecrawlCredits,
    estimatedPlanCheckVisionCalls,
    repetitions: 1,
    selectedProviders: [plancheck.name, firecrawl.name],
  };
  const runs = await runRetrievalBenchmark({
    cases,
    providers,
    selectedProviders: benchmark.selectedProviders,
    repetitions: 1,
  });
  const summary = summarisePdfGate(runs);
  const artifact = { benchmark, preflight, cases, plans, summary, runs };
  const outputDirectory = path.resolve(".data/research-pdf-gates", timestampDirectoryName(generatedAt));
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  const resultsPath = path.join(outputDirectory, "results.json");
  const reportPath = path.join(outputDirectory, "report.md");
  await writeFile(resultsPath, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 });
  await writeFile(reportPath, renderPdfGateReport({ benchmark, cases, plans, runs, summary }), {
    mode: 0o600,
  });
  process.stdout.write(`${JSON.stringify({ outputDirectory, reportPath, resultsPath, summary }, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error?.message ?? String(error)}\n`);
    process.exitCode = 1;
  });
}
