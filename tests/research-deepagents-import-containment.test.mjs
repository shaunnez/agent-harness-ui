import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { buildChildEnvironment } from "../server/research/deepagents/child-env.mjs";

// Architecture §5.4: `worker.mjs` is the only file in the repository permitted to import
// `deepagents`, `langchain`, `@langchain/*` or `langsmith`. Everything else in the Deep Agents
// adapter — including this test — must be checkable without a graph engine installed, and a
// future edit that starts pulling LangGraph types into the adapter or the neutral contracts
// must fail a test, not a review.

// Matches only an actual import/require specifier, e.g. `from "deepagents"`,
// `require("langsmith")`, `import("@langchain/core/messages")` — never prose that merely
// mentions these names, which every other file in this directory does on purpose to explain
// why it must not import them.
const RESTRICTED =
  /(?:from\s+|require\(\s*|import\(\s*)["'](deepagents|langchain|@langchain\/[^"']*|langsmith)(?:\/[^"']*)?["']/;
const DEEPAGENTS_DIR = path.resolve(import.meta.dirname, "..", "server", "research", "deepagents");
const ALLOWED_IMPORTER = "worker.mjs";

test("only worker.mjs imports deepagents, langchain, @langchain/* or langsmith", async () => {
  const entries = (await readdir(DEEPAGENTS_DIR)).filter((name) => name.endsWith(".mjs"));
  assert.ok(entries.includes(ALLOWED_IMPORTER), "worker.mjs must exist in the deepagents adapter directory");
  const offenders = [];
  for (const entry of entries) {
    if (entry === ALLOWED_IMPORTER) continue;
    const contents = await readFile(path.join(DEEPAGENTS_DIR, entry), "utf8");
    for (const line of contents.split("\n")) {
      if (RESTRICTED.test(line)) offenders.push(`${entry}: ${line.trim()}`);
    }
  }
  assert.deepEqual(offenders, [], "found a restricted import outside worker.mjs");
});

test("src/domain/research.ts and the runtime contract stay free of the restricted vocabulary", async () => {
  const files = [
    path.resolve(import.meta.dirname, "..", "src", "domain", "research.ts"),
    path.resolve(import.meta.dirname, "..", "src", "research-runtime-contract.ts"),
  ];
  for (const file of files) {
    const contents = await readFile(file, "utf8");
    for (const line of contents.split("\n")) {
      assert.equal(RESTRICTED.test(line), false, `${file} must not reference deepagents/langchain: ${line}`);
    }
  }
});

test("search, capture, model and tracing credentials are absent from the child", () => {
  const environment = buildChildEnvironment({
    PATH: process.env.PATH,
    FIRECRAWL_API_KEY: "firecrawl-sentinel",
    SERPER_API_KEY: "serper-sentinel",
    TAVILY_API_KEY: "tavily-sentinel",
    RESEARCH_SEARCH_API_KEY: "search-sentinel",
    LANGSMITH_API_KEY: "trace-sentinel",
    ANTHROPIC_API_KEY: "model-sentinel",
  });
  const serialized = JSON.stringify(environment);
  for (const sentinel of [
    "firecrawl-sentinel",
    "serper-sentinel",
    "tavily-sentinel",
    "search-sentinel",
    "trace-sentinel",
    "model-sentinel",
  ])
    assert.equal(serialized.includes(sentinel), false, sentinel);
});
