import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { evaluateRetrieval } from "./research-retrieval-benchmark/benchmark.mjs";

const execFileAsync = promisify(execFile);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultCasesPath = path.join(scriptDirectory, "research-pdf-gate", "cases.json");
const defaultAdapterPath = path.join(scriptDirectory, "research-pdf-gate", "plancheck_current_extract.py");
const defaultRetainedResults = path.resolve(".data/research-pdf-gates/2026-09-20T23-39-20-270Z/results.json");
const MAX_BUFFER = 40_000_000;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function containedFile(directory, filename) {
  const root = path.resolve(directory);
  const candidate = path.resolve(root, filename);
  if (path.dirname(candidate) !== root) throw new Error(`Unsafe local source filename: ${filename}`);
  return candidate;
}

function safe(value) {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");
}

function positiveNumber(value, label, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > maximum) {
    throw new Error(`${label} must be greater than zero and no more than ${maximum}.`);
  }
  return parsed;
}

export function parseCurrentPdfGateArguments(argv) {
  const options = {
    casesPath: defaultCasesPath,
    retainedResultsPath: defaultRetainedResults,
    sourceDirectory: path.resolve(".data/research-pdf-gate-sources"),
    planCheckRepository: path.resolve(
      process.env.PLANCHECK_REPOSITORY_PATH ?? "/Users/shaun/projects/eversor-plancheck",
    ),
    maxUsd: 1,
    dryRun: false,
  };
  for (const argument of argv) {
    if (argument === "--dry-run") options.dryRun = true;
    else if (argument.startsWith("--cases=")) {
      options.casesPath = path.resolve(argument.slice("--cases=".length));
    } else if (argument.startsWith("--retained-results=")) {
      options.retainedResultsPath = path.resolve(argument.slice("--retained-results=".length));
    } else if (argument.startsWith("--source-dir=")) {
      options.sourceDirectory = path.resolve(argument.slice("--source-dir=".length));
    } else if (argument.startsWith("--plancheck-repo=")) {
      options.planCheckRepository = path.resolve(argument.slice("--plancheck-repo=".length));
    } else if (argument.startsWith("--max-usd=")) {
      options.maxUsd = positiveNumber(argument.slice("--max-usd=".length), "max-usd", 10);
    } else throw new Error(`Unknown argument "${argument}".`);
  }
  return options;
}

function normalizedRun({ testCase, payload, phase }) {
  const content = payload.content;
  const run = {
    caseId: testCase.id,
    provider: `plancheck-current-detection-${phase}`,
    repetition: 1,
    retrievedAt: new Date().toISOString(),
    content,
    pages: payload.pages.map((page) => ({
      pageNumber: page.pageNumber,
      content: page.content,
    })),
    contentSha256: sha256(content),
    metadata: {
      durationMs: payload.durationMs,
      characterCount: content.length,
      extractionComplete: payload.extractionCompleteWithinCap,
      incompletePages: payload.incompletePages,
      failures: payload.failures,
      policyBlocked: payload.policyBlocked,
      cappedPages: payload.cappedPages,
      aborted: payload.aborted,
      usage: payload.usage,
    },
  };
  return { ...run, evaluation: evaluateRetrieval(testCase, run) };
}

export function renderCurrentPdfGateReport({ generatedAt, testCase, plancheck, cold, warm, firecrawl }) {
  const rows = [cold, warm, firecrawl];
  const complete = (run) =>
    run.provider === "firecrawl"
      ? run.metadata.extractionComplete !== false
      : run.metadata.extractionComplete;
  const lines = [
    "# Current PlanCheck versus Firecrawl scanned-PDF replacement gate",
    "",
    `Generated: ${generatedAt}`,
    "",
    "> Public Australian source only. The Firecrawl result is retained evidence from the earlier gate; this run made no new Firecrawl request.",
    "",
    "## Run boundary",
    "",
    `- Source: [${testCase.url}](${testCase.url})`,
    `- Exact source SHA-256: \`${testCase.sourceSha256}\``,
    `- Physical pages evaluated: 1-${testCase.maxPages} of ${plancheck.totalPages}`,
    `- PlanCheck route: \`${plancheck.extractorRoute}\``,
    `- Primary transcription model: \`${plancheck.transcriptionModel}\``,
    `- Escalation model: \`${plancheck.escalationModel}\``,
    `- PlanCheck evaluation allowance: US$${plancheck.maxUsd.toFixed(2)}; the cache replay is skipped if the cold known-token receipt exceeds it`,
    `- Original PDF bytes sent to Firecrawl in this replacement run: no`,
    `- Customer or private documents used: no`,
    "",
    "## Results",
    "",
    "| Route | Complete within cap | Time | Terms | Page-19 anchors | Missing/blocked/truncated pages | Provider calls | Cache hits | Known cost |",
    "| --- | --- | ---: | ---: | ---: | --- | ---: | ---: | ---: |",
  ];
  for (const run of rows) {
    const usage = run.metadata.usage ?? {};
    const incomplete = [
      ...(run.metadata.incompletePages ?? []),
      ...(run.metadata.policyBlocked ?? []).map((item) => item.page),
    ];
    lines.push(
      `| ${run.provider} | ${complete(run) ? "yes" : "no"} | ${run.metadata.durationMs ?? "—"} ms | ${run.evaluation.expectedTermsFound}/${run.evaluation.expectedTermsTotal} | ${run.evaluation.pageAnchorsFound}/${run.evaluation.pageAnchorsTotal} | ${incomplete.length ? [...new Set(incomplete)].join(", ") : "none"} | ${usage.providerCallsReturned ?? "—"} | ${usage.cacheHits ?? "—"} | ${usage.knownUsd == null ? "retained prior result" : `US$${usage.knownUsd.toFixed(4)}${usage.accountingComplete ? "" : " + unpriced refusal(s)"}`} |`,
    );
  }
  lines.push(
    "",
    "## Page-level PlanCheck state",
    "",
    "| Page | Cold source | Cold chars | Truncated | Reproducible | Warm source | Warm cache |",
    "| ---: | --- | ---: | --- | --- | --- | --- |",
  );
  for (const page of plancheck.cold.pages) {
    const replay = plancheck.warm.pages?.find((candidate) => candidate.pageNumber === page.pageNumber);
    lines.push(
      `| ${page.pageNumber} | ${page.source} | ${page.textCharacters} | ${page.truncated ? "yes" : "no"} | ${page.reproducible ? "yes" : "no"} | ${replay?.source ?? "—"} | ${replay?.fromCache ? "yes" : "no"} |`,
    );
  }
  lines.push(
    "",
    "## Evidence checks",
    "",
    "| Expected evidence | Current PlanCheck cold | Current PlanCheck warm | Retained Firecrawl |",
    "| --- | --- | --- | --- |",
  );
  for (const term of testCase.expectedTerms) {
    const contains = (run) => run.content.toLowerCase().includes(term.toLowerCase());
    lines.push(
      `| ${safe(term)} | ${contains(cold) ? "found" : "missing"} | ${contains(warm) ? "found" : "missing"} | ${contains(firecrawl) ? "found" : "missing"} |`,
    );
  }
  lines.push(
    "",
    "## Interpretation boundary",
    "",
    "Visual inspection of physical page 19 confirms that `Plan of Garage` and the `City of Perth` stamp are present but faint inside the degraded drawing. Neither route retained both strings on that physical page. Equal automated scores therefore mean equal checked coverage on this case, not perfect OCR.",
    "",
    "This gate compares extraction completeness, physical-page identity, checked evidence recovery, latency, cache replay, and attributable transcription cost. It does not treat either model-produced transcription as legal-verbatim ground truth. Every cited excerpt still requires host-side verification against the retained page text, and missing required evidence must fail closed.",
    "",
  );
  return `${lines.join("\n")}\n`;
}

async function main() {
  const options = parseCurrentPdfGateArguments(process.argv.slice(2));
  const corpus = JSON.parse(await readFile(options.casesPath, "utf8"));
  const testCase = corpus.cases.find((item) => item.id === "au-scanned-building-plan");
  if (!testCase) throw new Error("The scanned-plan case is missing from the PDF gate corpus.");
  const sourcePath = containedFile(options.sourceDirectory, testCase.localFilename);
  const pythonPath = path.join(options.planCheckRepository, "backend", ".venv", "bin", "python");
  const baseArgs = [
    defaultAdapterPath,
    "--repository",
    options.planCheckRepository,
    "--source",
    sourcePath,
    "--max-pages",
    String(testCase.maxPages),
    "--max-usd",
    String(options.maxUsd),
  ];
  const preflightResponse = await execFileAsync(pythonPath, [...baseArgs, "--plan-only"], {
    maxBuffer: MAX_BUFFER,
    env: process.env,
  });
  const preflight = JSON.parse(preflightResponse.stdout);
  if (preflight.sourceSha256 !== testCase.sourceSha256) throw new Error("Scanned-plan source hash mismatch.");
  if (options.dryRun) {
    process.stdout.write(
      `${JSON.stringify({ testCase, preflight, retainedResults: options.retainedResultsPath }, null, 2)}\n`,
    );
    return;
  }
  if (process.env.RUN_RESEARCH_CURRENT_PDF_GATE !== "1") {
    throw new Error("Set RUN_RESEARCH_CURRENT_PDF_GATE=1 after reviewing --dry-run.");
  }
  const retained = JSON.parse(await readFile(options.retainedResultsPath, "utf8"));
  const firecrawl = retained.runs.find(
    (run) => run.caseId === testCase.id && run.provider === "firecrawl" && !run.error,
  );
  if (!firecrawl) throw new Error("The retained Firecrawl result for the scanned-plan case is missing.");
  const retainedCase = retained.cases.find((item) => item.id === testCase.id);
  if (retainedCase?.sourceSha256 !== testCase.sourceSha256) {
    throw new Error("The retained Firecrawl result belongs to a different source hash.");
  }

  const response = await execFileAsync(pythonPath, [...baseArgs, "--execute-vision"], {
    timeout: 900_000,
    maxBuffer: MAX_BUFFER,
    env: process.env,
  });
  if (response.stderr) process.stderr.write(response.stderr);
  const plancheck = JSON.parse(response.stdout);
  if (plancheck.sourceSha256 !== testCase.sourceSha256)
    throw new Error("PlanCheck result source hash mismatch.");
  if (plancheck.warm.skipped) throw new Error(plancheck.warm.reason);

  const cold = normalizedRun({ testCase, payload: plancheck.cold, phase: "cold" });
  const warm = normalizedRun({ testCase, payload: plancheck.warm, phase: "warm" });
  const generatedAt = new Date().toISOString();
  const artifact = {
    generatedAt,
    testCase,
    provenance: {
      plancheckRepository: options.planCheckRepository,
      extractorRoute: plancheck.extractorRoute,
      retainedFirecrawlResults: options.retainedResultsPath,
      newFirecrawlCalls: 0,
    },
    plancheck,
    runs: [cold, warm, firecrawl],
  };
  const directoryName = generatedAt.replaceAll(":", "-").replaceAll(".", "-");
  const outputDirectory = path.resolve(".data/research-current-pdf-gates", directoryName);
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  const resultsPath = path.join(outputDirectory, "results.json");
  const reportPath = path.join(outputDirectory, "report.md");
  await writeFile(resultsPath, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 });
  await writeFile(
    reportPath,
    renderCurrentPdfGateReport({ generatedAt, testCase, plancheck, cold, warm, firecrawl }),
    { mode: 0o600 },
  );
  process.stdout.write(
    `${JSON.stringify(
      {
        outputDirectory,
        reportPath,
        resultsPath,
        knownPlanCheckCostUsd: plancheck.knownTotalUsd,
        cold: cold.evaluation,
        warm: warm.evaluation,
        firecrawl: firecrawl.evaluation,
      },
      null,
      2,
    )}\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error?.message ?? String(error)}\n`);
    process.exitCode = 1;
  });
}
