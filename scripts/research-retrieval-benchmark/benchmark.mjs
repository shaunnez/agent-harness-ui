function canonical(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[™®©]/g, "")
    .replace(/[^a-zA-Z0-9$]+/g, " ")
    .trim()
    .toLowerCase();
}

function contains(haystack, needle) {
  return canonical(haystack).includes(canonical(needle));
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export function estimateFirecrawlCredits(cases, repetitions) {
  return cases.reduce((total, testCase) => {
    const credits = testCase.kind === "pdf" ? 1 + testCase.maxPages : 1;
    return total + credits * repetitions;
  }, 0);
}

export function evaluateRetrieval(testCase, run) {
  if (run.error) {
    return {
      expectedTermsFound: 0,
      expectedTermsTotal: testCase.expectedTerms.length,
      termHitRate: 0,
      pageAnchorsFound: 0,
      pageAnchorsTotal: testCase.pageAnchors.length,
      pageAttributionRate: testCase.pageAnchors.length === 0 ? null : 0,
      tableChecksFound: 0,
      tableChecksTotal: testCase.tableChecks?.length ?? 0,
      priceSignalFound: false,
    };
  }
  const expectedTermsFound = testCase.expectedTerms.filter((term) => contains(run.content, term)).length;
  const pageAnchorsFound = testCase.pageAnchors.filter((anchor) => {
    const page = run.pages.find((candidate) => candidate.pageNumber === anchor.page);
    return page && contains(page.content, anchor.text);
  }).length;
  const tableChecks = testCase.tableChecks ?? [];
  const tableChecksFound = tableChecks.filter((check) =>
    check.cells.every((item) => contains(run.content, item)),
  ).length;
  const priceSignalFound = /(?:NZ\$|AU\$|\$\s?\d|NZD|AUD|price)/i.test(run.content);
  return {
    expectedTermsFound,
    expectedTermsTotal: testCase.expectedTerms.length,
    termHitRate: testCase.expectedTerms.length === 0 ? 1 : expectedTermsFound / testCase.expectedTerms.length,
    pageAnchorsFound,
    pageAnchorsTotal: testCase.pageAnchors.length,
    pageAttributionRate:
      testCase.pageAnchors.length === 0 ? null : pageAnchorsFound / testCase.pageAnchors.length,
    tableChecksFound,
    tableChecksTotal: tableChecks.length,
    priceSignalFound,
  };
}

export async function runRetrievalBenchmark({ cases, providers, selectedProviders, repetitions }) {
  const runs = [];
  for (const testCase of cases) {
    for (const providerName of selectedProviders) {
      const provider = providers.get(providerName);
      if (!provider) continue;
      for (let repetition = 1; repetition <= repetitions; repetition += 1) {
        const base = {
          caseId: testCase.id,
          provider: providerName,
          repetition,
          retrievedAt: new Date().toISOString(),
        };
        try {
          const response = await provider.retrieve(testCase);
          const run = { ...base, ...response };
          runs.push({ ...run, evaluation: evaluateRetrieval(testCase, run) });
        } catch (error) {
          const run = {
            ...base,
            error: error?.message ?? String(error),
            content: "",
            pages: [],
            metadata: {},
          };
          runs.push({ ...run, evaluation: evaluateRetrieval(testCase, run) });
        }
      }
    }
  }
  return runs;
}

export function summariseRetrievalBenchmark(runs) {
  return [...new Set(runs.map((run) => run.provider))].map((provider) => {
    const providerRuns = runs.filter((run) => run.provider === provider);
    const successes = providerRuns.filter((run) => !run.error);
    const contentHashesByCase = new Map();
    for (const run of successes) {
      const hashes = contentHashesByCase.get(run.caseId) ?? new Set();
      hashes.add(run.contentSha256);
      contentHashesByCase.set(run.caseId, hashes);
    }
    const repeatedCases = [...contentHashesByCase.values()].filter((hashes) => hashes.size > 0);
    const deterministicCases = repeatedCases.filter((hashes) => hashes.size === 1).length;
    const termsFound = successes.reduce((total, run) => total + run.evaluation.expectedTermsFound, 0);
    const termsTotal = successes.reduce((total, run) => total + run.evaluation.expectedTermsTotal, 0);
    const pageAnchorsFound = successes.reduce((total, run) => total + run.evaluation.pageAnchorsFound, 0);
    const pageAnchorsTotal = successes.reduce((total, run) => total + run.evaluation.pageAnchorsTotal, 0);
    const tableChecksFound = successes.reduce((total, run) => total + run.evaluation.tableChecksFound, 0);
    const tableChecksTotal = successes.reduce((total, run) => total + run.evaluation.tableChecksTotal, 0);
    return {
      provider,
      runs: providerRuns.length,
      successes: successes.length,
      errors: providerRuns.length - successes.length,
      medianDurationMs: median(successes.map((run) => run.metadata.durationMs)),
      termHitRate: termsTotal === 0 ? null : termsFound / termsTotal,
      pageAttributionRate: pageAnchorsTotal === 0 ? null : pageAnchorsFound / pageAnchorsTotal,
      tableCheckRate: tableChecksTotal === 0 ? null : tableChecksFound / tableChecksTotal,
      deterministicRate: repeatedCases.length === 0 ? null : deterministicCases / repeatedCases.length,
      estimatedCredits: successes.reduce(
        (total, run) => total + Number(run.metadata.estimatedCredits ?? 0),
        0,
      ),
      estimatedCostUsd: successes.reduce(
        (total, run) =>
          total + Number(run.metadata.estimatedCostUsd ?? run.metadata.estimatedCostUsdAtHobbyTopUpRate ?? 0),
        0,
      ),
    };
  });
}

function percent(value) {
  return value == null ? "—" : `${Math.round(value * 100)}%`;
}

function decimal(value, places = 3) {
  return Number(value).toFixed(places);
}

function cell(value) {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");
}

export function renderRetrievalReport({ benchmark, cases, runs, summary, skipped }) {
  const lines = [
    "# Research capture and PDF benchmark",
    "",
    `Generated: ${benchmark.generatedAt}`,
    "",
    "> Directional benchmark using public sources only. Extracted evidence snapshots are retained; original PDF bytes are not retained by the harness.",
    "",
    "## Run configuration",
    "",
    `- Cases: ${cases.length}`,
    `- Repetitions: ${benchmark.repetitions}`,
    `- Routes: ${benchmark.selectedProviders.join(", ")}`,
    `- Preflight Firecrawl ceiling: ${benchmark.estimatedMaximumFirecrawlCredits} credits`,
    "- Provider-generated answers and summaries: disabled",
    "- Local route: downloads public source bytes temporarily, hashes them, extracts content, then deletes the bytes",
    "- Managed routes: retain only extracted text, metadata, and the extracted snapshot hash",
    "",
  ];
  if (skipped.length > 0) {
    lines.push("## Routes not run", "");
    for (const item of skipped) lines.push(`- ${item.provider}: ${item.reason}`);
    lines.push("");
  }
  lines.push(
    "## Route summary",
    "",
    "| Route | Successful | Errors | Median latency | Expected terms | Physical-page anchors | Table checks | Repeatable output | Estimated usage |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  );
  for (const item of summary) {
    const usage =
      [
        item.estimatedCredits ? `${decimal(item.estimatedCredits, 0)} credits` : "",
        item.estimatedCostUsd ? `$${decimal(item.estimatedCostUsd)}` : "",
      ]
        .filter(Boolean)
        .join(" / ") || "—";
    lines.push(
      `| ${item.provider} | ${item.successes}/${item.runs} | ${item.errors} | ${item.medianDurationMs ?? "—"} ms | ${percent(item.termHitRate)} | ${percent(item.pageAttributionRate)} | ${percent(item.tableCheckRate)} | ${percent(item.deterministicRate)} | ${usage} |`,
    );
  }
  lines.push("");

  for (const testCase of cases) {
    lines.push(
      `## ${testCase.id}: ${testCase.label}`,
      "",
      `Source: [${testCase.url}](${testCase.url})  `,
      `Market/type: ${testCase.market} / ${testCase.kind}`,
      "",
      "| Route | Repeat | Time | Characters | Terms | Page anchors | Tables | Price signal | Extracted hash | Error |",
      "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |",
    );
    for (const run of runs.filter((item) => item.caseId === testCase.id)) {
      lines.push(
        `| ${run.provider} | ${run.repetition} | ${run.metadata.durationMs ?? "—"} ms | ${run.metadata.characterCount ?? 0} | ${run.evaluation.expectedTermsFound}/${run.evaluation.expectedTermsTotal} | ${run.evaluation.pageAnchorsFound}/${run.evaluation.pageAnchorsTotal} | ${run.evaluation.tableChecksFound}/${run.evaluation.tableChecksTotal} | ${run.evaluation.priceSignalFound ? "yes" : "no"} | ${run.contentSha256?.slice(0, 12) ?? "—"} | ${cell(run.error ?? "")} |`,
      );
    }
    lines.push("");
  }

  lines.push(
    "## Cost interpretation",
    "",
    "- Firecrawl usage is estimated from its documented base scrape charge plus the PDF parsing charge. The USD equivalent uses the Hobby top-up rate; an actual paid plan has a monthly minimum.",
    "- Exa Contents is estimated at one text content type for one URL. Its billing definition treats a PDF URL as one page, not one physical PDF page.",
    "- Local extraction has no external extraction fee, but still has engineering, compute, OCR, and operational costs not priced by this benchmark.",
    "- Production cost should be based on unique source captures, not agent count. A shared snapshot prevents ten agents from paying to parse the same document ten times.",
    "",
    "## Decision gate",
    "",
    "A managed default is acceptable only if it retrieves the representative sources, preserves exact text and physical-page attribution needed for citations, and remains affordable at expected unique-source volume. Failure on one of those dimensions means a local or second-provider fallback remains necessary.",
    "",
  );
  return `${lines.join("\n")}\n`;
}
