// One live research run through the `claude-cli` runtime, printed in full.
//
//   RESEARCH_QV_INDEX=/path/to/indexed-items.jsonl RUN_RESEARCH_DEMO=1 \
//     npm run research:demo -- "<scope to price>"
//
// Spends plan usage on the operator's Claude subscription — roughly $2 to $6 a run — and never
// an API key: the runtime refuses to start unless `claude auth status` reports claude.ai.

import process from "node:process";
import { ClaudeCliResearchRuntime } from "../server/research/claude-cli/runtime.mjs";
import { resolveResearchBudget } from "../src/research-budget-policy.ts";

if (process.env.RUN_RESEARCH_DEMO !== "1")
  throw new Error("Set RUN_RESEARCH_DEMO=1 to confirm one live run on the Claude subscription.");

const objective =
  process.argv.slice(2).join(" ").trim() ||
  "Price supply and installation of 40 m of 100 mm uPVC stormwater pipe in a 900 mm deep trench in Auckland, " +
    "including bedding, backfill and one connection to an existing manhole. NZD, GST exclusive.";
const id = `RSCH-DEMO-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}`;
const budget = resolveResearchBudget("standard");
const runtime = new ClaudeCliResearchRuntime();
const startedAt = Date.now();
const handle = await runtime.start({ id, objective, profile: "standard", context: [], budget });
const events = [];
for await (const event of runtime.events(id)) events.push(event);
const status = await runtime.status(id);
const result = await runtime.result(id);
const sources = events.filter((event) => event.type === "source.retrieved").map((event) => event.data.source);

process.stdout.write(
  `${JSON.stringify(
    {
      runId: handle.runId,
      // Named before anything it produced: a reader should not have to reach the findings
      // before learning what answered.
      model: handle.model ?? null,
      status,
      durationMs: Date.now() - startedAt,
      citations: runtime.citationSummary(id),
      sources: sources.filter((source) => source.contentSha256),
      result,
    },
    null,
    2,
  )}\n`,
);
if (status.status !== "completed") process.exitCode = 1;
