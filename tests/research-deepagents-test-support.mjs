import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { DeepAgentsResearchRuntime } from "../server/research/deepagents/adapter.mjs";

/** No provider credential, ever — the whole main test suite must resolve the "fake" model
 *  regardless of what happens to be in the host's real environment (this repository's own dev
 *  environment carries a real `ANTHROPIC_API_KEY`, which is exactly the case this must not
 *  depend on). Only what a child process needs to start Node at all. */
export function safeChildEnv(overrides = {}) {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    ...(process.platform === "win32"
      ? { SYSTEMROOT: process.env.SYSTEMROOT, USERPROFILE: process.env.USERPROFILE }
      : {}),
    ...overrides,
  };
}

export const TEST_BUDGET = Object.freeze({
  maxResearchers: 1,
  maxConcurrentResearchers: 1,
  maxDepth: 1,
  maxRuntimeMs: 20_000,
  maxModelCalls: 10,
  maxToolCalls: 10,
  maxSearchCalls: 0,
});

/** A runtime over a throwaway checkpoint database, defaulting to the fake model. */
export async function withDeepAgentsRuntime(body, { envOverrides } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "research-deepagents-test-"));
  const runtime = new DeepAgentsResearchRuntime({
    checkpointDbPath: path.join(directory, "checkpoints.sqlite3"),
    env: safeChildEnv(envOverrides),
  });
  try {
    return await body({ runtime, directory });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export function testRequest(id, overrides = {}) {
  const { budget: budgetOverrides, ...rest } = overrides;
  return {
    id,
    objective: `Test objective for ${id}.`,
    context: [],
    profile: "quick",
    ...rest,
    budget: { ...TEST_BUDGET, ...(budgetOverrides ?? {}) },
  };
}

export async function waitForTerminal(runtime, runId, timeoutMs = 20_000) {
  const start = Date.now();
  for (;;) {
    const status = await runtime.status(runId);
    if (["completed", "failed", "cancelled"].includes(status.status)) return status;
    if (Date.now() - start > timeoutMs)
      throw new Error(`Timed out waiting for ${runId} to reach a terminal state (last: ${status.status}).`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** Drain a runtime's event stream to completion, the way `ResearchService` does. */
export async function drainEvents(runtime, runId) {
  const events = [];
  for await (const event of runtime.events(runId)) events.push(event);
  return events;
}
