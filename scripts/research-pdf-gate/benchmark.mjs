import { evaluateRetrieval, runRetrievalBenchmark } from "../research-retrieval-benchmark/benchmark.mjs";

function percent(value) {
  return value == null ? "—" : `${Math.round(value * 100)}%`;
}

function safe(value) {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");
}

export { evaluateRetrieval, runRetrievalBenchmark };

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export function summarisePdfGate(runs) {
  return [...new Set(runs.map((run) => run.provider))].map((provider) => {
    const providerRuns = runs.filter((run) => run.provider === provider);
    const returned = providerRuns.filter((run) => !run.error);
    const complete = returned.filter((run) => run.metadata.extractionComplete !== false);
    const partial = returned.filter((run) => run.metadata.extractionComplete === false);
    const total = (field) => returned.reduce((sum, run) => sum + run.evaluation[field], 0);
    const ratio = (found, possible) => (possible === 0 ? null : found / possible);
    return {
      provider,
      runs: providerRuns.length,
      complete: complete.length,
      partial: partial.length,
      errors: providerRuns.length - returned.length,
      medianDurationMs: median(returned.map((run) => run.metadata.durationMs)),
      termHitRate: ratio(total("expectedTermsFound"), total("expectedTermsTotal")),
      pageAttributionRate: ratio(total("pageAnchorsFound"), total("pageAnchorsTotal")),
      tableCheckRate: ratio(total("tableChecksFound"), total("tableChecksTotal")),
      estimatedCredits: returned.reduce((sum, run) => sum + Number(run.metadata.estimatedCredits ?? 0), 0),
      estimatedCostUsd: returned.reduce(
        (sum, run) => sum + Number(run.metadata.estimatedCostUsdAtHobbyTopUpRate ?? 0),
        0,
      ),
      pagesMissing: returned.reduce((sum, run) => sum + Number(run.metadata.pagesMissing?.length ?? 0), 0),
      visionOutputs: returned.reduce((sum, run) => sum + Number(run.metadata.visionCalls ?? 0), 0),
    };
  });
}

export function renderPdfGateReport({ benchmark, cases, plans, runs, summary }) {
  const lines = [
    "# Firecrawl versus PlanCheck PDF gate",
    "",
    `Generated: ${benchmark.generatedAt}`,
    "",
    "> Public NZ/AU sources only. No customer, tender, or private document was sent to Firecrawl.",
    "",
    "## Run boundary",
    "",
    `- Cases: ${cases.length}`,
    `- Firecrawl preflight ceiling: ${benchmark.estimatedFirecrawlCredits} credits`,
    `- PlanCheck vision ceiling: ${benchmark.estimatedPlanCheckVisionCalls} page calls`,
    "- Provider summaries and reasoning: disabled",
    "- Firecrawl retained result: extracted snapshot and metadata; no local duplicate of its response source",
    "- PlanCheck benchmark retained public source bytes locally so the exact extractor input can be replayed",
    "",
    "## Preflight",
    "",
    "| Case | Source pages | Page cap | PlanCheck sparse/vision pages | Firecrawl mode |",
    "| --- | ---: | ---: | ---: | --- |",
  ];
  for (const testCase of cases) {
    const plan = plans.find((item) => item.caseId === testCase.id);
    lines.push(
      `| ${testCase.id} | ${plan?.totalPages ?? "—"} | ${testCase.maxPages} | ${plan?.sparsePages.length ?? "—"} | ${testCase.pdfMode} |`,
    );
  }
  lines.push(
    "",
    "## Route summary",
    "",
    "| Route | Complete | Partial | Median latency | Known terms | Physical-page anchors | Table checks | Estimated usage |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  );
  for (const item of summary) {
    const usage =
      item.provider === "firecrawl"
        ? `${item.estimatedCredits} credits / US$${item.estimatedCostUsd.toFixed(3)} marginal equivalent`
        : `${benchmark.estimatedPlanCheckVisionCalls} attempted / ${item.visionOutputs} returned / ${item.pagesMissing} missing`;
    lines.push(
      `| ${item.provider} | ${item.complete}/${item.runs} | ${item.partial} | ${item.medianDurationMs ?? "—"} ms | ${percent(item.termHitRate)} | ${percent(item.pageAttributionRate)} | ${percent(item.tableCheckRate)} | ${usage} |`,
    );
  }
  lines.push("");

  for (const testCase of cases) {
    lines.push(
      `## ${testCase.id}: ${testCase.label}`,
      "",
      `Source: [${testCase.url}](${testCase.url})  `,
      `Profile: ${testCase.market} / ${testCase.profile} / first ${testCase.maxPages} pages`,
      "",
      "| Route | Time | Characters | Terms | Page anchors | Tables | Parsed/text/vision/missing pages | Hash | Error |",
      "| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |",
    );
    for (const run of runs.filter((item) => item.caseId === testCase.id)) {
      const coverage =
        run.provider === "plancheck"
          ? `${run.metadata.parsedPages ?? 0}/${run.metadata.pagesFromText ?? 0}/${run.metadata.pagesFromVision ?? 0}/${run.metadata.pagesMissing?.length ?? 0}`
          : `${run.metadata.parsedPages ?? 0}/—/—/—`;
      lines.push(
        `| ${run.provider} | ${run.metadata.durationMs ?? "—"} ms | ${run.metadata.characterCount ?? 0} | ${run.evaluation.expectedTermsFound}/${run.evaluation.expectedTermsTotal} | ${run.evaluation.pageAnchorsFound}/${run.evaluation.pageAnchorsTotal} | ${run.evaluation.tableChecksFound}/${run.evaluation.tableChecksTotal} | ${coverage} | ${run.contentSha256?.slice(0, 12) ?? "—"} | ${safe(run.error)} |`,
      );
    }
    lines.push("");
  }

  lines.push(
    "## Material reliability finding",
    "",
    "PlanCheck's text-first path completed both native-text documents with all checked terms, page anchors, and tables. Its scanned path returned only 11 page bodies from 19 attempted pages after about eight minutes, leaving eight pages incomplete. The current extractor merges returned vision bodies by sequence after the provider has swallowed per-page failures, so page identities after the first failed call may shift. The partial scan output is therefore not safe for citation or reasoning and must fail closed.",
    "",
    "Firecrawl returned all 19 scanned pages in OCR mode in about 13 seconds. It recovered four of five checked scan terms and two of three page-19 anchors; it missed the faint `Plan of Garage` wording and did not preserve `City of Perth` on physical page 19. Managed OCR is materially stronger here, but it is still not perfect evidence extraction.",
    "",
    "The two building.govt.nz PDFs also rejected ordinary server-side downloads in this environment while loading in a normal browser and through Firecrawl. A local-only public-source path therefore still needs a browser/proxy fetch fallback in addition to PDF extraction.",
    "",
    "## Governance finding",
    "",
    "Firecrawl's ordinary self-serve path is suitable here only for public sources. Its public privacy policy permits caching/indexing and describes US storage; zero-data-retention for parsed documents is an Enterprise control. Private PlanCheck documents therefore remain local unless Eversor separately accepts a DPA, retention, residency, and deletion arrangement.",
    "",
    "## Decision rule",
    "",
    "This run supports Firecrawl as the public-source default behind the owned provider boundary: it completed every bounded document and materially outperformed the current local scan path. Treat its extraction as evidence to validate rather than perfect ground truth; fail closed or use a second extraction path when required terms, pages, or grounding are missing. Keep PlanCheck local extraction for private native-text documents. Do not rely on its current scanned path until page identity and partial-failure handling are repaired.",
    "",
  );
  return `${lines.join("\n")}\n`;
}
