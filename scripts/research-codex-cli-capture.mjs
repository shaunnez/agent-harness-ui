// One small live `codex-cli` research run, kept as the fixture its stream reader is pinned to.
//
//   RESEARCH_QV_INDEX=/path/to/indexed-items.jsonl \
//   RUN_CODEX_CLI_CAPTURE=1 node scripts/research-codex-cli-capture.mjs
//
// This spends ChatGPT plan usage: one run, a few tool calls. It exists because
// `server/research/codex-cli/stream.mjs` was written from the `codex exec --json` schema, and
// the Claude reader was only trusted once it matched a recorded stream. The objective asks for
// one corpus search, one web search and one `fetch_source`, and asks whether a shell exists, so
// the capture shows every item type the reader maps and whether the shell is really gone.
//
// The transcript is copied to `tests/fixtures/codex-cli/capture.jsonl`. It holds licensed QV row
// text from the corpus calls: blank that before committing it, because the repository is public.

import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { CodexCliResearchRuntime } from "../server/research/codex-cli/runtime.mjs";

if (process.env.RUN_CODEX_CLI_CAPTURE !== "1")
  throw new Error("Set RUN_CODEX_CLI_CAPTURE=1 to confirm one live Codex run on the ChatGPT plan.");

const OBJECTIVE = [
  "This is a short capture run to record how tools are called; keep it brief.",
  "Scenario: supply and install 10 m of 150 mm concrete kerb and channel in Auckland.",
  "1. Search QV once or twice with mcp__qv__search_qv.",
  "2. Run exactly one web_search for a public NZ kerb and channel rate.",
  "3. Fetch one result with mcp__research__fetch_source and quote its figure if it has one.",
  "4. If you have a shell or command tool, do not use it; just state in one line whether one is listed.",
  "Then give the JSON answer. Do not make more than six tool calls in total.",
].join("\n");

const runId = `RSCH-CODEX-CAPTURE-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const runtime = new CodexCliResearchRuntime({ maxConcurrentRuns: 1 });
const counts = new Map();
const tools = [];

await runtime.start({
  id: runId,
  objective: OBJECTIVE,
  profile: "standard",
  context: [],
  budget: {
    maxRuntimeMs: 8 * 60_000,
    maxResearchers: 1,
    maxConcurrentResearchers: 1,
    maxDepth: 1,
    maxModelCalls: 20,
    maxToolCalls: 10,
    maxSearchCalls: 2,
  },
});
for await (const event of runtime.events(runId)) {
  counts.set(event.type, (counts.get(event.type) ?? 0) + 1);
  if (event.type === "tool.called") tools.push(event.data.tool);
  if (event.type === "log") process.stderr.write(`log: ${String(event.data.message).slice(0, 200)}\n`);
}
const status = await runtime.status(runId);
const result = await runtime.result(runId);
const transcript = result.artifacts.find((artifact) => artifact.kind === "codex-cli-transcript")?.contentRef;

const fixture = path.resolve("tests", "fixtures", "codex-cli", "capture.jsonl");
if (transcript) {
  await mkdir(path.dirname(fixture), { recursive: true });
  await copyFile(transcript, fixture);
}
process.stdout.write(
  `${JSON.stringify(
    {
      runId,
      status: status.status,
      error: status.error ?? null,
      events: Object.fromEntries(counts),
      tools,
      usage: result.usage,
      citations: runtime.citationSummary(runId),
      transcript,
      fixture: transcript ? fixture : null,
    },
    null,
    2,
  )}\n`,
);
