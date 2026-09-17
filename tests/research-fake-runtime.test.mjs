import assert from "node:assert/strict";
import test from "node:test";
import { runToEnd, settle, waitFor, withResearchService } from "./research-test-support.mjs";

const OBJECTIVE = "Establish whether the research plane can run without a model.";

test("a successful run walks queued -> running -> completed and persists its result", async () => {
  await withResearchService(async ({ service, runtime, store }) => {
    const created = await service.createRun({ objective: OBJECTIVE, profile: "standard" });
    assert.match(created.id, /^RSCH-\d{3}$/);
    assert.equal(created.runtimeId, "fake");
    assert.equal(created.status, "queued");
    assert.equal(created.objective, OBJECTIVE);

    runtime.advance(created.id);
    await waitFor(async () => (await store.getRun(created.id)).status === "running", "the run to start");

    await runToEnd(service, runtime, created.id);
    const finished = await store.getRun(created.id);
    assert.equal(finished.status, "completed");
    assert.equal(finished.error, null);
    assert.ok(finished.revision > created.revision, "each transition bumps the run revision");

    const result = await service.getResult(created.id);
    assert.equal(result.runId, created.id);
    assert.equal(result.findings.length, 3);
    assert.equal(result.artifacts.length, 1);
    assert.equal(result.truncatedBy, undefined);
    const [finding] = result.findings;
    assert.equal(finding.producedBy, "researcher");
    assert.equal(finding.verification.status, "unverified");
    const [reference] = finding.evidence;
    assert.equal(reference.sourceType, "web");
    assert.equal(reference.quoteVerified, false);
    assert.match(reference.excerpt, /Fake excerpt 1/);
    assert.equal(reference.locator.charStart, 100);
    assert.ok(reference.retrievedAt);
    assert.ok(reference.url);
  });
});

test("a failing run reaches failed with normalized error information and partial usage", async () => {
  await withResearchService(async ({ service, runtime, store }) => {
    const created = await service.createRun({
      objective: OBJECTIVE,
      metadata: { fakeOutcome: "failure" },
    });
    await runToEnd(service, runtime, created.id);
    const failed = await store.getRun(created.id);
    assert.equal(failed.status, "failed");
    assert.deepEqual(failed.error, {
      code: "fake_runtime_failure",
      message: "The fake research runtime was asked to fail.",
    });
    // A failed run still accounts for what it spent. Recording `partial: true` rather than a
    // null usage block is the gap audit §12 names on the SDLC side, not repeated here.
    assert.equal(failed.usage.partial, true);
    assert.equal(failed.usage.modelCalls, 1);
    assert.ok(failed.usage.inputTokens > 0);
  });
});

test("a cancelled run walks running -> cancelling -> cancelled and keeps the operator's intent", async () => {
  await withResearchService(async ({ service, runtime, store }) => {
    const created = await service.createRun({ objective: OBJECTIVE });
    runtime.advance(created.id);
    await waitFor(async () => (await store.getRun(created.id)).status === "running", "the run to start");
    runtime.advance(created.id);
    await settle();

    const cancelling = await service.cancel(created.id);
    assert.equal(cancelling.status, "cancelling");
    // Intent is written before the runtime is signalled, so it survives a companion that dies
    // between the two.
    assert.ok(cancelling.cancellationRequestedAt);

    await runToEnd(service, runtime, created.id);
    const cancelled = await store.getRun(created.id);
    assert.equal(cancelled.status, "cancelled");
    assert.equal(cancelled.usage.partial, true);
    assert.equal(cancelled.cancellationRequestedAt, cancelling.cancellationRequestedAt);

    const events = await store.listEvents(created.id);
    assert.ok(events.events.some((event) => event.type === "run.cancelled"));

    // Partial work is still the operator's: one worker reported before the cancel landed.
    const result = await service.getResult(created.id);
    assert.equal(result.findings.length, 1);
    assert.ok(result.unresolvedQuestions.length > 0);
  });
});

test("the runtime receives the resolved budget and is bounded by it", async () => {
  await withResearchService(async ({ service, runtime, store }) => {
    // QUICK admits two researchers; the fake planner always wants three.
    const created = await service.createRun({ objective: OBJECTIVE, profile: "quick" });
    assert.deepEqual(runtime.receivedBudget(created.id), created.budget);
    assert.equal(created.budget.maxResearchers, 2);

    await runToEnd(service, runtime, created.id);
    const result = await service.getResult(created.id);
    assert.equal(result.findings.length, 2, "the runtime ran only as many workers as it was allowed");
    assert.equal(result.truncatedBy, "maxResearchers");

    const finished = await store.getRun(created.id);
    assert.equal(finished.budgetState.ceilingHit, "maxResearchers");
    assert.equal(finished.budgetState.researchersStarted, 2);

    const { events } = await store.listEvents(created.id);
    const echoed = events.find((event) => event.type === "log");
    assert.deepEqual(echoed.data.budget, created.budget);
    const hit = events.find((event) => event.type === "budget.ceiling_hit");
    assert.deepEqual(hit.data, { ceiling: "maxResearchers", requested: 3, admitted: 2 });
  });
});

test("a runtime that cannot start still leaves a durable failed run", async () => {
  await withResearchService(
    async ({ service, store }) => {
      const created = await service.createRun({ objective: OBJECTIVE });
      assert.equal(created.status, "failed");
      assert.equal(created.error.code, "runtime_start_failed");
      assert.equal(created.usage.partial, true);
      assert.ok(await store.getRun(created.id), "the run row survives a runtime that never ran");
    },
    {
      runtimeOptions: {
        outcomeFor() {
          throw new Error("The runtime refused the request.");
        },
      },
    },
  );
});
