import process from "node:process";
import { DeepAgentsResearchRuntime } from "../server/research/deepagents/adapter.mjs";
import { resolveResearchBudget } from "../src/research-budget-policy.ts";

if (process.env.RUN_RESEARCH_DEMO !== "1") {
  throw new Error(
    "Set RUN_RESEARCH_DEMO=1 to confirm a live model and Tavily search run. This command may consume provider credits.",
  );
}
if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY && !process.env.RESEARCH_MODEL_API_KEY) {
  throw new Error("Provide an approved model credential before running the live research demo.");
}
if (!process.env.TAVILY_API_KEY && !process.env.RESEARCH_SEARCH_API_KEY) {
  throw new Error("Provide TAVILY_API_KEY or RESEARCH_SEARCH_API_KEY before running the live research demo.");
}

const objective =
  process.argv.slice(2).join(" ").trim() ||
  "Research Sika waterproofing membrane products currently available in New Zealand. Identify at least two New Zealand suppliers with public pricing where available, and find the manufacturer's installation or application requirements for the most relevant product. Return sourced findings only. If pricing is not publicly available, state that rather than guessing.";
const id = `RSCH-DEMO-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}`;
const budget = resolveResearchBudget("quick", {
  maxRuntimeMs: 3 * 60_000,
  maxModelCalls: 12,
  maxToolCalls: 16,
  maxSearchCalls: 4,
});
const runtime = new DeepAgentsResearchRuntime();
const startedAt = Date.now();
const handle = await runtime.start({ id, objective, profile: "quick", context: [], budget });
const events = [];
const collecting = (async () => {
  for await (const event of runtime.events(id)) events.push(event);
})();

let status;
for (;;) {
  status = await runtime.status(id);
  if (["completed", "failed", "cancelled"].includes(status.status)) break;
  await new Promise((resolve) => setTimeout(resolve, 250));
}
await collecting;
const result = await runtime.result(id);
const sources = events.filter((event) => event.type === "source.retrieved").map((event) => event.data.source);

process.stdout.write(
  `${JSON.stringify(
    {
      runId: handle.runId,
      status,
      durationMs: Date.now() - startedAt,
      sources,
      result,
    },
    null,
    2,
  )}\n`,
);
if (status.status !== "completed") process.exitCode = 1;
