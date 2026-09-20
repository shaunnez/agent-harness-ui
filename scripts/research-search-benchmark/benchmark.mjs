const PRICE_SIGNAL = /(?:NZ\$|AU\$|US\$|\$\s?\d|NZD|AUD|USD|price|buy|shop)/i;
const PDF_SIGNAL = /(?:\.pdf(?:$|[?#])|\bpdf\b|data\s*sheet|installation\s*(?:guide|manual))/i;

function hostname(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function hostMatches(host, expectedHost) {
  return host === expectedHost || host.endsWith(`.${expectedHost}`);
}

function resultText(result) {
  return `${result.title} ${result.url} ${result.snippet}`;
}

export function evaluateBenchmarkRun(testCase, run) {
  if (run.error) {
    return {
      referenceSourceEligible: testCase.referenceHosts.length > 0,
      referenceSourceRank: null,
      localDomainEligible: testCase.localHostSuffixes.length > 0,
      localResultsTop5: 0,
      priceSignalsTop5: 0,
      technicalDocumentSignalsTop5: 0,
      targetTermCoverageTop5: 0,
    };
  }

  const topFive = run.results.slice(0, 5);
  const referenceSourceRank =
    run.results.findIndex((result) => {
      const host = hostname(result.url);
      return testCase.referenceHosts.some((expectedHost) => hostMatches(host, expectedHost));
    }) + 1 || null;
  const localResultsTop5 = topFive.filter((result) =>
    testCase.localHostSuffixes.some((suffix) => hostname(result.url).endsWith(suffix)),
  ).length;
  const priceSignalsTop5 = topFive.filter((result) => PRICE_SIGNAL.test(resultText(result))).length;
  const technicalDocumentSignalsTop5 = topFive.filter((result) => PDF_SIGNAL.test(resultText(result))).length;
  const coveredTerms = testCase.targetTerms.filter((term) =>
    topFive.some((result) => resultText(result).toLowerCase().includes(term.toLowerCase())),
  );

  return {
    referenceSourceEligible: testCase.referenceHosts.length > 0,
    referenceSourceRank,
    localDomainEligible: testCase.localHostSuffixes.length > 0,
    localResultsTop5,
    priceSignalsTop5,
    technicalDocumentSignalsTop5,
    targetTermCoverageTop5:
      testCase.targetTerms.length === 0 ? 1 : coveredTerms.length / testCase.targetTerms.length,
  };
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export function summariseBenchmark(runs) {
  const providerNames = [...new Set(runs.map((run) => run.provider))];
  return providerNames.map((provider) => {
    const providerRuns = runs.filter((run) => run.provider === provider);
    const successes = providerRuns.filter((run) => !run.error);
    const evaluations = successes.map((run) => run.evaluation);
    const referenceSourceEligible = evaluations.filter((evaluation) => evaluation.referenceSourceEligible);
    const referenceSourceHits = referenceSourceEligible.filter(
      (evaluation) => evaluation.referenceSourceRank != null,
    );
    const reciprocalRanks = referenceSourceHits.map((evaluation) => 1 / evaluation.referenceSourceRank);
    const localDomainEligible = evaluations.filter((evaluation) => evaluation.localDomainEligible);
    const localSlots = localDomainEligible.length * 5;
    const estimatedCredits = successes.reduce(
      (total, run) => total + Number(run.metadata.estimatedCredits ?? 0),
      0,
    );
    const estimatedCostUsd = successes.reduce(
      (total, run) => total + Number(run.metadata.estimatedCostUsd ?? 0),
      0,
    );
    return {
      provider,
      runs: providerRuns.length,
      successes: successes.length,
      errors: providerRuns.length - successes.length,
      medianDurationMs: median(successes.map((run) => run.metadata.durationMs)),
      referenceSourceHitRate:
        referenceSourceEligible.length === 0
          ? null
          : referenceSourceHits.length / referenceSourceEligible.length,
      meanReciprocalReferenceRank:
        referenceSourceEligible.length === 0
          ? null
          : reciprocalRanks.reduce((total, value) => total + value, 0) / referenceSourceEligible.length,
      localResultRateTop5:
        localSlots === 0
          ? 0
          : localDomainEligible.reduce((total, evaluation) => total + evaluation.localResultsTop5, 0) /
            localSlots,
      priceSignalRuns: evaluations.filter((evaluation) => evaluation.priceSignalsTop5 > 0).length,
      technicalDocumentSignalRuns: evaluations.filter(
        (evaluation) => evaluation.technicalDocumentSignalsTop5 > 0,
      ).length,
      estimatedCredits,
      estimatedCostUsd,
    };
  });
}

export async function runBenchmark({ cases, providers, selectedProviders, repetitions, maxResults }) {
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
          queriedAt: new Date().toISOString(),
        };
        try {
          const response = await provider.search({
            query: testCase.query,
            market: testCase.market,
            maxResults,
          });
          const run = { ...base, ...response };
          runs.push({ ...run, evaluation: evaluateBenchmarkRun(testCase, run) });
        } catch (error) {
          const run = {
            ...base,
            error: error?.message ?? String(error),
            results: [],
            metadata: {},
          };
          runs.push({ ...run, evaluation: evaluateBenchmarkRun(testCase, run) });
        }
      }
    }
  }
  return runs;
}

function percent(value) {
  if (value == null) return "—";
  return `${Math.round(value * 100)}%`;
}

function decimal(value, places = 2) {
  return Number(value).toFixed(places);
}

function markdownCell(value) {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");
}

function resultLink(result) {
  return result ? `[${markdownCell(result.title)}](${result.url})` : "—";
}

export function renderBenchmarkReport({ benchmark, cases, runs, summary, skipped }) {
  const lines = [
    "# Research search provider benchmark",
    "",
    `Generated: ${benchmark.generatedAt}`,
    "",
    "> This is a small directional benchmark. Automated signals are heuristics, not a vendor decision. Review the actual results below before selecting a provider.",
    "",
    "## Run configuration",
    "",
    `- Cases: ${cases.length}`,
    `- Repetitions: ${benchmark.repetitions}`,
    `- Maximum results per search: ${benchmark.maxResults}`,
    `- Providers requested: ${benchmark.selectedProviders.join(", ")}`,
    "- Search-only comparison: no provider-generated answer, raw-page content, or scraping requested",
    "",
  ];

  if (skipped.length > 0) {
    lines.push("## Providers not run", "");
    for (const item of skipped) lines.push(`- ${item.provider}: ${item.reason}`);
    lines.push("");
  }

  lines.push(
    "## Provider summary",
    "",
    "| Provider | Successful | Errors | Median latency | Reference-source hit | Mean reciprocal rank | Local top-5 rate | Price signal runs | Technical-document runs | Estimated usage |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  );
  for (const item of summary) {
    const usage = [
      item.estimatedCredits ? `${decimal(item.estimatedCredits, 0)} credits` : "",
      item.estimatedCostUsd ? `$${decimal(item.estimatedCostUsd, 3)}` : "",
    ]
      .filter(Boolean)
      .join(" / ");
    lines.push(
      `| ${item.provider} | ${item.successes}/${item.runs} | ${item.errors} | ${item.medianDurationMs ?? "—"} ms | ${percent(item.referenceSourceHitRate)} | ${item.meanReciprocalReferenceRank == null ? "—" : decimal(item.meanReciprocalReferenceRank)} | ${percent(item.localResultRateTop5)} | ${item.priceSignalRuns} | ${item.technicalDocumentSignalRuns} | ${usage || "—"} |`,
    );
  }
  lines.push("");

  for (const testCase of cases) {
    lines.push(
      `## ${testCase.id}: ${testCase.label}`,
      "",
      `Query: \`${testCase.query}\`  `,
      `Market: ${testCase.market}  `,
      `Intent: ${testCase.intent}`,
      "",
      "| Provider | Repeat | Time | Top result | Reference-source rank | Local results | Price signals | Document signals | Error |",
      "| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | --- |",
    );
    for (const run of runs.filter((item) => item.caseId === testCase.id)) {
      lines.push(
        `| ${run.provider} | ${run.repetition} | ${run.metadata.durationMs ?? "—"} ms | ${resultLink(run.results[0])} | ${run.evaluation.referenceSourceRank ?? "—"} | ${run.evaluation.localDomainEligible ? `${run.evaluation.localResultsTop5}/5` : "—"} | ${run.evaluation.priceSignalsTop5}/5 | ${run.evaluation.technicalDocumentSignalsTop5}/5 | ${markdownCell(run.error ?? "")} |`,
      );
    }
    lines.push("", "Top-five results from the first successful run of each provider:", "");
    for (const provider of benchmark.selectedProviders) {
      const run = runs.find(
        (item) => item.caseId === testCase.id && item.provider === provider && !item.error,
      );
      if (!run) continue;
      lines.push(`**${provider}**`);
      for (const result of run.results.slice(0, 5)) {
        lines.push(`${result.rank}. [${markdownCell(result.title)}](${result.url})`);
      }
      lines.push("");
    }
    lines.push(
      "Human review: authoritative source ☐ · correct market ☐ · usable public price ☐ · current/non-duplicate ☐ · evidence page retrievable ☐",
      "",
    );
  }

  lines.push(
    "## Interpretation boundary",
    "",
    "- A price signal means only that a top-five title, URL, or snippet looks price-related; it does not prove a valid or current price.",
    "- A reference-source hit checks only the known manufacturer or reference hosts in the corpus. It is not a complete authority judgment and does not penalize cases without reference hosts.",
    "- A local-domain signal is useful for NZ/AU discovery but misses local pages hosted on global domains.",
    "- PDF discovery is measured here. The current host fetcher does not yet ingest PDFs, so discovery and evidence retrieval are separate decisions.",
    "- Firecrawl was exercised in search-only mode. Its scrape/PDF capabilities require a separate retrieval-fallback benchmark.",
    "- Do not send private project or customer information through free-tier searches.",
    "",
  );
  return `${lines.join("\n")}\n`;
}
