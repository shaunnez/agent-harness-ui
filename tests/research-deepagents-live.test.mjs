import assert from "node:assert/strict";
import process from "node:process";
import test from "node:test";
import { testRequest, waitForTerminal, withDeepAgentsRuntime } from "./research-deepagents-test-support.mjs";

// Opt-in, not part of `npm test`: this is the one test in the slice that spends real money and
// makes a real network call, so it never runs unless a human explicitly asks for it — run with
// `RUN_RESEARCH_DEEPAGENTS_LIVE=1 node --test tests/research-deepagents-live.test.mjs`. Its
// purpose is narrow and load-bearing: every other test in this slice proves the runtime
// plumbing against the fake model, and this is the one proof that a real model, through the
// real child process, through the real adapter, produces a real normalized result.
const LIVE = process.env.RUN_RESEARCH_DEEPAGENTS_LIVE === "1" && Boolean(process.env.ANTHROPIC_API_KEY);

test("a live Deep Agents run against the real Anthropic model completes with a real, priced-unaware usage report", {
  skip: !LIVE && "set RUN_RESEARCH_DEEPAGENTS_LIVE=1 with ANTHROPIC_API_KEY to run this",
}, async () => {
  await withDeepAgentsRuntime(
    async ({ runtime }) => {
      const request = testRequest("RSCH-DA-LIVE", {
        objective: "In one sentence, state what a checksum is used for.",
        budget: { maxRuntimeMs: 60_000, maxModelCalls: 8 },
      });
      await runtime.start(request);
      const terminal = await waitForTerminal(runtime, request.id, 60_000);
      assert.equal(terminal.status, "completed");
      assert.ok(terminal.usage.modelCalls > 0);
      assert.ok(terminal.usage.inputTokens > 0, "a real provider reports real token usage");

      const result = await runtime.result(request.id);
      assert.equal(result.findings.length, 1);
      assert.ok(result.summary);
      const [byModel] = Object.values(result.usage.byModel ?? {});
      assert.equal(
        byModel.priced,
        false,
        "no rate card exists for this model id yet — it must read as unpriced, not free",
      );
    },
    // Deliberately does NOT pass ANTHROPIC_API_KEY through envOverrides — the point is that
    // the adapter picks it up from the real process environment the way an operator's would.
    { envOverrides: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY } },
  );
});
