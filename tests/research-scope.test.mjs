// The scoping step (`28-SCOPE-PACK-EVAL-PLAN.md` §1): a scope is parsed strictly, drafted without
// starting anything, pinned onto every run, part of the evidence fingerprint, and a band priced in
// another measure is disputed. External requests are scoped once. Stub scopers and a stub process
// runner only: nothing here calls a model.

import assert from "node:assert/strict";
import test from "node:test";
import {
  claudeScopeDriver,
  codexScopeDriver,
  parseScope,
  pinnedScopeText,
  ResearchScoper,
  ScopeError,
} from "../server/research/research-scope.mjs";

export const ROOF_SCOPE = Object.freeze({
  item: "Membrane roof in place of long-run steel",
  measure: "per m²",
  unitText: "m² of roof plan area",
  quantityBasis: "1,200 m² roof",
  inclusions: ["plywood substrate", "secondary framing"],
  exclusions: ["removal of existing roof"],
  centre: "Auckland",
  assumptions: ["commercial building, low pitch"],
  clarifications: ["membrane type not stated"],
});

test("a scope is one JSON object in the schema, or an error", () => {
  assert.deepEqual(parseScope(JSON.stringify(ROOF_SCOPE)), ROOF_SCOPE);
  assert.deepEqual(parseScope(`\`\`\`json\n${JSON.stringify(ROOF_SCOPE)}\n\`\`\``), ROOF_SCOPE);
  const rejects = [
    `Here is the scope: ${JSON.stringify(ROOF_SCOPE)}`,
    JSON.stringify({ ...ROOF_SCOPE, measure: "per square" }),
    JSON.stringify({ ...ROOF_SCOPE, price: 120 }),
    JSON.stringify({ ...ROOF_SCOPE, inclusions: "plywood" }),
    JSON.stringify({ ...ROOF_SCOPE, item: "  " }),
    JSON.stringify([ROOF_SCOPE]),
  ];
  for (const reply of rejects)
    assert.throws(
      () => parseScope(reply),
      (error) => error instanceof ScopeError && error.code === "scope_malformed" && error.statusCode === 422,
      reply.slice(0, 60),
    );
});

test("the pinned text names the measure and tells the run not to re-scope", () => {
  const text = pinnedScopeText(ROOF_SCOPE);
  assert.match(text, /^Pinned scope\. Price exactly this; do not re-scope it\./);
  assert.match(text, /- Measure: per m² \(m² of roof plan area\)\. Give the band in this measure\./);
  assert.match(text, /- Not decided \(state the assumption you price on\): membrane type not stated/);
});

test("the scoper falls back only when the first model cannot answer, never when it answers badly", async () => {
  const driver = (label, call) => ({ label, runtime: `${label}-cli`, model: `${label}-model`, call });
  const good = driver("claude", async () => ({
    text: JSON.stringify(ROOF_SCOPE),
    usage: { costUsd: 0.001 },
  }));
  const down = driver("codex", async () => {
    throw new Error("plan limit");
  });
  const fallback = await new ResearchScoper({ drivers: [down, good] }).scope({ objective: "Roof?" });
  assert.deepEqual(fallback.scope, ROOF_SCOPE);
  assert.deepEqual(fallback.scopedBy, { runtime: "claude-cli", model: "claude-model", reasoning: null });

  let fellBack = false;
  const babbles = driver("codex", async () => ({ text: "The roof costs about $150/m²." }));
  const spy = driver("claude", async () => {
    fellBack = true;
    return { text: JSON.stringify(ROOF_SCOPE) };
  });
  await assert.rejects(new ResearchScoper({ drivers: [babbles, spy] }).scope({ objective: "Roof?" }), {
    code: "scope_malformed",
  });
  assert.equal(fellBack, false);

  await assert.rejects(new ResearchScoper({ drivers: [down] }).scope({ objective: "Roof?" }), {
    code: "scope_unavailable",
    statusCode: 503,
  });
});

test("the Codex scope call has no tools, no web search and no API key, and reads the last message", async () => {
  const calls = [];
  const run = async (binary, args, options = {}) => {
    calls.push({ binary, args, env: options.env });
    if (args[0] === "login") return { code: 0, stdout: "Logged in using ChatGPT\n", stderr: "" };
    const lines = [
      { type: "item.completed", item: { type: "agent_message", text: "thinking aloud" } },
      { type: "item.completed", item: { type: "agent_message", text: JSON.stringify(ROOF_SCOPE) } },
      { type: "turn.completed", usage: { input_tokens: 900, cached_input_tokens: 0, output_tokens: 200 } },
    ];
    for (const line of lines) options.onStdoutLine?.(JSON.stringify(line));
    return { code: 0, stdout: "", stderr: "" };
  };
  const env = { PATH: "/usr/bin", HOME: "/tmp", OPENAI_API_KEY: "sk-never", CODEX_API_KEY: "never" };
  const driver = codexScopeDriver(env, { binary: "/bin/codex" });
  const scoped = await new ResearchScoper({ env, run, drivers: [driver] }).scope({ objective: "Roof?" });
  assert.deepEqual(scoped.scope, ROOF_SCOPE);
  assert.deepEqual(scoped.scopedBy, { runtime: "codex-cli", model: "gpt-6-luna", reasoning: "medium" });
  assert.ok(scoped.usage);

  const exec = calls.find((call) => call.args[0] === "exec");
  assert.ok(exec.args.includes('web_search="disabled"'));
  assert.ok(exec.args.includes("shell_tool"));
  assert.equal(
    exec.args.some((arg) => arg.startsWith("mcp_servers.")),
    false,
  );
  assert.equal(exec.env.OPENAI_API_KEY, undefined);
  assert.equal(exec.env.CODEX_API_KEY, undefined);
});

test("the Haiku fallback runs on the subscription with no Anthropic key in its environment", async () => {
  const calls = [];
  const run = async (_binary, args, options = {}) => {
    calls.push({ args, env: options.env });
    if (args[0] === "auth")
      return { code: 0, stdout: JSON.stringify({ loggedIn: true, authMethod: "claude.ai" }), stderr: "" };
    const result = { type: "result", subtype: "success", result: JSON.stringify(ROOF_SCOPE), usage: {} };
    options.onStdoutLine?.(JSON.stringify(result));
    return { code: 0, stdout: "", stderr: "" };
  };
  const env = {
    PATH: "/usr/bin",
    HOME: "/tmp",
    ANTHROPIC_API_KEY: "never",
    ANTHROPIC_AUTH_TOKEN: "never",
    ANTHROPIC_BASE_URL: "https://proxy.invalid",
  };
  const driver = claudeScopeDriver(env, { binary: "/bin/claude" });
  const scoped = await new ResearchScoper({ env, run, drivers: [driver] }).scope({ objective: "Roof?" });
  assert.deepEqual(scoped.scope, ROOF_SCOPE);
  assert.equal(scoped.scopedBy.model, "claude-haiku-4-5");
  const call = calls.find((entry) => entry.args[0] === "-p");
  for (const name of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL"])
    assert.equal(call.env[name], undefined, name);
});
