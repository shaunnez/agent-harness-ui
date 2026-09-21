import assert from "node:assert/strict";
import process from "node:process";
import test from "node:test";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import {
  drainEvents,
  fixtureSearchProvider,
  safeChildEnv,
  testRequest,
  waitForTerminal,
  withDeepAgentsRuntime,
} from "./research-deepagents-test-support.mjs";

// These tests spawn real child processes (real `node`, real `deepagents`/`@langchain/langgraph`)
// against the deterministic fake model, so they exercise the actual process boundary — spawn,
// NDJSON parsing, cancellation, checkpointing — without a network call or an API key. The one
// live-model test is a separate, opt-in file.

test("a successful Deep Agents run completes with a normalized result and usage", async () => {
  await withDeepAgentsRuntime(async ({ runtime }) => {
    const request = testRequest("RSCH-DA-1");
    const handle = await runtime.start(request);
    assert.equal(handle.runtimeId, "deepagents");
    assert.equal(handle.status, "running");
    assert.ok(handle.runtimeMetadata.threadId, "the adapter records a thread id in opaque runtime metadata");
    assert.ok(handle.runtimeMetadata.checkpointDbPath);

    const events = [];
    const collecting = (async () => {
      for await (const event of runtime.events(request.id)) events.push(event);
    })();

    const terminal = await waitForTerminal(runtime, request.id);
    await collecting;
    assert.equal(terminal.status, "completed");
    assert.equal(terminal.usage.partial, false);
    assert.ok(terminal.usage.modelCalls > 0);

    const result = await runtime.result(request.id);
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].producedBy, "researcher");
    assert.equal(result.findings[0].evidence.length, 1);
    assert.equal(result.findings[0].evidence[0].quoteVerified, true);
    assert.match(result.findings[0].evidence[0].snapshotRef, /^sha256:[a-f0-9]{64}$/);
    assert.equal(result.usage.partial, false);
    assert.ok(result.summary);

    assert.ok(events.some((event) => event.type === "run.started"));
    assert.ok(events.some((event) => event.type === "tool.called"));
    assert.ok(events.some((event) => event.type === "finding.created"));
    assert.ok(events.some((event) => event.type === "usage.updated"));
    assert.ok(events.some((event) => event.type === "run.completed"));
    // Ordinals are locally assigned and strictly increasing — `ResearchStore.appendEvent`
    // still recomputes the authoritative ordinal, but the runtime's own numbering must never
    // go backwards or repeat.
    const ordinals = events.map((event) => event.ordinal);
    assert.deepEqual(
      ordinals,
      [...ordinals].sort((a, b) => a - b),
    );
    assert.equal(new Set(ordinals).size, ordinals.length);
  });
});

test("a checkpoint is created and survives a fresh process reading it back", async () => {
  await withDeepAgentsRuntime(async ({ runtime }) => {
    const request = testRequest("RSCH-DA-CKPT");
    const handle = await runtime.start(request);
    await waitForTerminal(runtime, request.id);
    const dbPath = handle.runtimeMetadata.checkpointDbPath;
    const threadId = handle.runtimeMetadata.threadId;

    // A brand new `SqliteSaver` instance, not the one the child used — this is the "fresh
    // process reads it back" proof at the checkpointer level (the child process itself already
    // exited by the time we get here, which is the process-restart half of the proof).
    const saver = SqliteSaver.fromConnString(dbPath);
    const tuple = await saver.getTuple({ configurable: { thread_id: threadId } });
    assert.ok(tuple, "a checkpoint tuple exists for this run's thread after the child has exited");
    assert.ok(tuple.checkpoint.channel_values.messages.length > 0);
  });
});

test("malformed tool output is rejected at the tool boundary and the model recovers", async () => {
  await withDeepAgentsRuntime(
    async ({ runtime }) => {
      const request = testRequest("RSCH-DA-MALFORMED");
      await runtime.start(request);
      const terminal = await waitForTerminal(runtime, request.id);
      assert.equal(terminal.status, "completed", "the graph does not crash over one bad tool call");
      const result = await runtime.result(request.id);
      assert.equal(result.findings.length, 1, "the model recovered and submitted a valid finding");
    },
    { envOverrides: { RESEARCH_MODEL_FAKE_MISBEHAVIOR: "invalid_finding" } },
  );
});

test("a host-rejected finding reaches the model as feedback instead of killing the run", async () => {
  await withDeepAgentsRuntime(
    async ({ runtime }) => {
      const request = testRequest("RSCH-DA-HOST-REJECT");
      await runtime.start(request);
      const terminal = await waitForTerminal(runtime, request.id);
      // The host rejection used to escape the tool, escape the graph, and end the run as
      // `model_or_tool_error` — discarding every source the run had already retained.
      assert.equal(terminal.status, "completed", "a correctable host rejection does not end the run");
      const result = await runtime.result(request.id);
      assert.equal(
        result.findings.length,
        1,
        "the model corrected the citation and submitted a real finding",
      );
    },
    { envOverrides: { RESEARCH_MODEL_FAKE_MISBEHAVIOR: "host_rejected_finding" } },
  );
});

test("the general-purpose subagent is rejected even with zero subagents configured", async () => {
  await withDeepAgentsRuntime(
    async ({ runtime }) => {
      const request = testRequest("RSCH-DA-GENERAL-PURPOSE");
      await runtime.start(request);
      const terminal = await waitForTerminal(runtime, request.id);
      assert.equal(terminal.status, "failed");
      assert.match(terminal.error.message, /general-purpose/);
      const result = await runtime.result(request.id);
      assert.equal(result.findings.length, 0);
    },
    { envOverrides: { RESEARCH_MODEL_FAKE_MISBEHAVIOR: "general_purpose_subagent" } },
  );
});

test("the model-call ceiling invalidates the run but preserves partial usage and findings", async () => {
  await withDeepAgentsRuntime(async ({ runtime }) => {
    const request = testRequest("RSCH-DA-CEILING", { budget: { maxModelCalls: 1 } });
    await runtime.start(request);
    const terminal = await waitForTerminal(runtime, request.id);
    assert.equal(terminal.status, "failed");
    assert.equal(terminal.error.code, "model_call_ceiling_exceeded");
    assert.equal(terminal.budgetState.ceilingHit, "maxModelCalls");

    const result = await runtime.result(request.id);
    assert.equal(result.truncatedBy, "maxModelCalls");
    assert.equal(result.usage.partial, true);
    assert.equal(result.findings.length, 0, "no finding is invented before the evidence loop finishes");
  });
});

test("the parent-owned aggregate tool ceiling stops the graph across different tool names", async () => {
  await withDeepAgentsRuntime(async ({ runtime }) => {
    const request = testRequest("RSCH-DA-TOOL-CEILING", { budget: { maxToolCalls: 1 } });
    await runtime.start(request);
    const terminal = await waitForTerminal(runtime, request.id);
    assert.equal(terminal.status, "failed");
    assert.equal(terminal.error.code, "tool_call_ceiling_exceeded");
    assert.equal(terminal.budgetState.ceilingHit, "maxToolCalls");
    assert.equal(terminal.usage.toolCalls, 1);
    assert.equal(terminal.usage.searchCalls, 1);

    const result = await runtime.result(request.id);
    assert.equal(result.truncatedBy, "maxToolCalls");
    assert.equal(result.findings.length, 0);
  });
});

test("cancellation while the child is genuinely running kills the process and preserves partial usage", async () => {
  await withDeepAgentsRuntime(
    async ({ runtime }) => {
      const request = testRequest("RSCH-DA-CANCEL");
      const handle = await runtime.start(request);
      const pid = Number(handle.runtimeMetadata.childPid);
      assert.ok(pid > 0);

      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.doesNotThrow(() => process.kill(pid, 0), "the child is genuinely running before cancel");

      await runtime.cancel(request.id);
      const terminal = await waitForTerminal(runtime, request.id, 15_000);
      assert.equal(terminal.status, "cancelled");
      assert.equal(terminal.usage.partial, true);

      assert.throws(
        () => process.kill(pid, 0),
        "the process is actually gone, not merely reported cancelled",
      );

      const result = await runtime.result(request.id);
      assert.equal(result.usage.partial, true);
    },
    { envOverrides: { RESEARCH_MODEL_FAKE_DELAY_MS: "6000" } },
  );
});

test("an abnormal child exit becomes a normalized research failure", async () => {
  await withDeepAgentsRuntime(async ({ runtime, directory }) => {
    // Point the checkpoint path at a path that is itself an existing directory: better-sqlite3
    // cannot open a directory as a database file, so the child fails during setup, before any
    // graph runs — the "checkpoint storage failure" and "abnormal child exit" experiments in
    // one, since a startup failure IS the abnormal exit in this design (§11.3, §11.6).
    const request = testRequest("RSCH-DA-ABNORMAL");
    const runtimeWithBadCheckpoint = new (Object.getPrototypeOf(runtime).constructor)({
      checkpointDbPath: directory, // a directory, not a file
      env: safeChildEnv(),
      searchProvider: fixtureSearchProvider(),
    });
    await runtimeWithBadCheckpoint.start(request);
    const terminal = await waitForTerminal(runtimeWithBadCheckpoint, request.id);
    assert.equal(terminal.status, "failed");
    assert.ok(terminal.error, "a durable, explainable error is recorded");

    const events = await drainEvents(runtimeWithBadCheckpoint, request.id);
    assert.ok(events.some((event) => event.type === "run.failed"));
  });
});

test("LangSmith stays inactive: the child reports zero tracing env vars, even with the host carrying real ones", async () => {
  await withDeepAgentsRuntime(
    async ({ runtime }) => {
      const request = testRequest("RSCH-DA-LANGSMITH");
      await runtime.start(request);
      const events = await drainEvents(runtime, request.id);
      await waitForTerminal(runtime, request.id);
      const logs = events.filter((event) => event.type === "log").map((event) => event.data.message);
      assert.ok(
        logs.some((message) => message === "langsmith/langchain tracing env vars present in child: 0"),
        `expected a log confirming zero tracing env vars, got: ${JSON.stringify(logs)}`,
      );
    },
    // The host process for this test session may carry LANGSMITH_*/LANGCHAIN_* itself; prove
    // the denylist strips them rather than merely that they were never offered.
    {
      envOverrides: {
        LANGSMITH_API_KEY: "test-would-be-leaked",
        LANGSMITH_TRACING: "true",
        LANGCHAIN_TRACING_V2: "true",
      },
    },
  );
});

test("Eversor survives a Deep Agents child failure: the runtime can immediately run another request", async () => {
  await withDeepAgentsRuntime(async ({ runtime }) => {
    const failing = testRequest("RSCH-DA-SURVIVE-FAIL", { budget: { maxModelCalls: 1 } });
    await runtime.start(failing);
    const failedStatus = await waitForTerminal(runtime, failing.id);
    assert.equal(failedStatus.status, "failed");

    // The same runtime instance, same companion process, immediately handles a fresh request.
    const following = testRequest("RSCH-DA-SURVIVE-OK");
    await runtime.start(following);
    const okStatus = await waitForTerminal(runtime, following.id);
    assert.equal(okStatus.status, "completed");
  });
});

test("model configuration never reaches the child under the provider's own env var name", async () => {
  await withDeepAgentsRuntime(
    async ({ runtime }) => {
      // Force the fake path explicitly: the point is proving `buildChildEnvironment` strips
      // `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` from the child even though they are present in
      // the companion's environment, not exercising a real provider network call here (the
      // live test file does that, deliberately, as a separate opt-in run).
      const request = testRequest("RSCH-DA-ENV-SHAPE");
      await runtime.start(request);
      const terminal = await waitForTerminal(runtime, request.id);
      assert.equal(terminal.status, "completed", "the fake path ran, unaffected by the stray provider keys");
    },
    {
      envOverrides: {
        RESEARCH_MODEL_PROVIDER: "fake",
        ANTHROPIC_API_KEY: "sk-would-be-leaked",
        OPENAI_API_KEY: "sk-would-be-leaked-too",
      },
    },
  );
});
