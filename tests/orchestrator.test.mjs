import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { TaskOrchestrator } from "../server/orchestrator.mjs";
import { JsonTaskStore } from "../server/store.mjs";

test("runs the investigation frontier and retains each stage handoff", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-orchestrator-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Map a repository",
      description: "Produce a grounded investigation handoff.",
      repositoryPath: directory,
      workflow: "investigate",
      priority: "medium",
    });
    const orchestrator = new TaskOrchestrator(store, {
      getStatus: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
      runCodex: async ({ prompt, onEvent }) => {
        onEvent({ type: "activity", tone: "success", title: "Repository inspected", detail: "mock" });
        return {
          finalText: `## Artifact\n\n${prompt.match(/Your stage assignment:\n([^\n]+)/)?.[1] ?? "Ready"}`,
          usage: { inputTokens: 10, cachedInputTokens: 4, outputTokens: 5, totalTokens: 15 },
        };
      },
    });

    assert.equal(orchestrator.start(task.id), true);
    let finished = null;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      finished = await store.get(task.id);
      if (finished.status !== "running" && finished.status !== "queued") break;
    }

    assert.equal(finished.status, "awaiting-spec-approval", finished.error);
    assert.deepEqual(finished.completedStages, ["triage", "scouts", "grill", "specification"]);
    assert.equal(finished.artifacts.length, 4);
    assert.equal(finished.usage.totalTokens, 60);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("advances an approved implementation task through a revision-bound candidate", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-candidate-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Ship a small change",
      description: "Implement and verify the approved change.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
    });
    let merged = false;
    let commitCount = 0;
    let reviewCount = 0;
    const worktreeManager = {
      async prepare(_task, candidateId) {
        return {
          id: candidateId,
          revisionNumber: 1,
          baseRevision: "a".repeat(40),
          baseBranch: "main",
          headRevision: null,
          branch: "agent-harness/test-c1",
          repositoryRoot: directory,
          worktreePath: directory,
          status: "implementing",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          revisions: [],
        };
      },
      async commit() {
        commitCount += 1;
        return {
          headRevision: (commitCount === 1 ? "b" : "c").repeat(40),
          files: ["src/change.ts"],
          summary: "1 file changed",
          diff: "+change",
        };
      },
      async merge() {
        merged = true;
      },
      async verifyCandidate() {
        return true;
      },
    };
    const orchestrator = new TaskOrchestrator(store, {
      getStatus: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
      worktreeManager,
      runCodex: async ({ prompt }) => {
        let finalText = "## Outcome\n\nReady";
        if (/Development review/.test(prompt)) {
          reviewCount += 1;
          finalText = reviewCount === 1 ? "REPAIR\n\n## Verdict\n\nREPAIR" : "PASS\n\n## Verdict\n\nPASS";
        } else if (/Focused test|Final review/.test(prompt)) {
          finalText = "PASS\n\n## Verdict\n\nPASS";
        }
        return {
          finalText,
          usage: { inputTokens: 10, cachedInputTokens: 4, outputTokens: 5, totalTokens: 15 },
        };
      },
    });

    orchestrator.start(task.id);
    await waitForStatus(store, task.id, "awaiting-spec-approval");
    await orchestrator.recordDecision(task.id, { question: "Compatibility", answer: "Keep it backwards compatible." });
    await orchestrator.approveSpecification(task.id);
    await waitForStatus(store, task.id, "awaiting-plan-approval");
    await orchestrator.approvePlan(task.id);
    assert.equal((await store.get(task.id)).status, "ready-for-implementation");

    orchestrator.start(task.id, "implementation");
    await waitForStatus(store, task.id, "ready-for-review");
    orchestrator.start(task.id, "review");
    await waitForStatus(store, task.id, "repair-required");
    orchestrator.start(task.id, "repair");
    await waitForStatus(store, task.id, "ready-for-review");
    orchestrator.start(task.id, "review");
    await waitForStatus(store, task.id, "ready-for-test");
    orchestrator.start(task.id, "test");
    await waitForStatus(store, task.id, "ready-for-final-review");
    orchestrator.start(task.id, "final-review");
    const approvalTask = await waitForStatus(store, task.id, "awaiting-human-approval");

    assert.equal(approvalTask.candidates[0].headRevision, "c".repeat(40));
    assert.equal(approvalTask.candidates[0].revisionNumber, 2);
    assert.deepEqual(
      approvalTask.candidates[0].revisions.map((revision) => revision.headRevision),
      ["b".repeat(40), "c".repeat(40)],
    );
    assert.equal(approvalTask.decisions.length, 1);
    assert.equal(approvalTask.artifacts.length, 11);
    await orchestrator.approveMerge(task.id);
    const complete = await store.get(task.id);
    assert.equal(complete.status, "completed");
    assert.equal(complete.candidates[0].status, "merged");
    assert.equal(merged, true);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

async function waitForStatus(store, id, expected) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const task = await store.get(id);
    if (task.status === expected) return task;
    if (attempt > 5 && ["failed", "blocked", "cancelled", "repair-required"].includes(task.status)) {
      assert.fail(`Task stopped at ${task.status}: ${task.error ?? "no error"}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`Task did not reach ${expected}.`);
}
