import test from "node:test";
import {
  assert,
  JsonTaskStore,
  mkdtemp,
  os,
  path,
  rm,
  TaskOrchestrator,
  waitForStatus,
} from "./orchestrator-test-support.mjs";

/**
 * AH-030, the first live run: a work package that could not qualify against its own verification
 * manifest threw from `orchestrator-work-packages.mjs` and was recorded by the run coordinator,
 * never reaching the gate/repair path where `_diagnoseFailure` was wired. `routingDecisions` came
 * back empty on a failed task, and an environment problem — `npm run lint` exiting 127 with
 * `biome: command not found` — presented as a bare package failure indistinguishable from wrong
 * code. These tests pin the attribution that was missing.
 */
const ENV_DIAGNOSIS = `## Classification\n\nENVIRONMENT_FAILURE\n\n<failure-diagnosis>\n{"classification":"ENVIRONMENT_FAILURE","rewindTo":"implement","rationale":"npm run lint exited 127 because the biome binary is absent from the slice worktree; no test assertion was evaluated, so the candidate was never judged.","evidence":["npm run lint exited 127 — sh: biome: command not found"],"confidence":0.86}\n</failure-diagnosis>`;

async function failingImplementationTask(directory, { profile = "standard" } = {}) {
  const store = new JsonTaskStore(path.join(directory, "tasks.json"));
  await store.init();
  const task = await store.create({
    title: "Qualification fails on a missing binary",
    description: "The verification command cannot run in the slice worktree.",
    repositoryPath: directory,
    workflow: "implement",
    priority: "low",
  });
  await store.update(task.id, (draft) => {
    draft.status = "ready-for-implementation";
    draft.currentStage = "implement";
    draft.completedStages = ["triage", "scouts", "synthesis", "grill", "specification", "plan"];
    draft.workflowProfile = { selected: profile, reason: "test", source: "test", history: [] };
    draft.workPackages = [
      {
        id: "S1",
        title: "Cover the config",
        description: "One package.",
        dependencies: [],
        batch: 1,
        ownedPaths: ["biome.json"],
        verificationCommandIds: ["lint"],
        verification: ["lint"],
        status: "planned",
        attempts: 0,
      },
    ];
  });
  return { store, task };
}

function orchestratorThatFailsImplementation(store, diagnosisText) {
  const prompts = [];
  return {
    prompts,
    orchestrator: new TaskOrchestrator(store, {
      readVerificationManifest: async () => ({
        source: ".agent-harness/verification.json",
        commands: [{ id: "lint", command: ["npm", "run", "lint"] }],
      }),
      getStatus: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
      worktreeManager: {
        prepare: async () => {
          throw new Error(
            "S1 did not qualify: lint failed — npm run lint exited 127.\nsh: biome: command not found",
          );
        },
        base: async () => ({ baseRevision: "a".repeat(40) }),
        verifyCandidate: async () => {},
      },
      runCodex: async ({ prompt }) => {
        prompts.push(prompt);
        return {
          finalText: /<failure-diagnosis>/.test(prompt) ? diagnosisText : "## Outcome\n\nDone.",
          model: "gpt-5.6-luna",
          reasoning: "xhigh",
          usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 5, totalTokens: 15 },
        };
      },
    }),
  };
}

test("a failed implementation run is attributed instead of left as a bare package failure", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-run-diagnosis-"));
  try {
    const { store, task } = await failingImplementationTask(directory);
    const { orchestrator, prompts } = orchestratorThatFailsImplementation(store, ENV_DIAGNOSIS);
    await orchestrator.start(task.id, "implementation");
    const done = await waitForStatus(store, task.id, "failed");

    const asked = prompts.find((prompt) => /<failure-diagnosis>/.test(prompt));
    assert.ok(asked, "the failed implementation run must be sent for attribution");
    assert.match(asked, /run-failure-evidence/);
    // The prompt must teach the distinction AH-030 turned on: a command that could not run is
    // not the same as code that is wrong.
    assert.match(asked, /could not run at all/);

    const decisions = done.topologyTrace?.routingDecisions ?? [];
    assert.equal(decisions.length, 1, "routingDecisions was empty on AH-030; it must not be now");
    assert.equal(decisions[0].classification, "ENVIRONMENT_FAILURE");
    assert.equal(decisions[0].rewindTo, "", "ENVIRONMENT_FAILURE needs a human, so it does not rewind");
    assert.ok(
      done.artifacts.some((item) => item.name === "run-failure-diagnosis.md"),
      "the attribution is retained as evidence",
    );
    assert.ok(
      (done.topologyTrace?.nodesExecuted ?? []).includes("failure-diagnosis"),
      "the diagnosis counts as a node in the walk",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the fast profile records the skip rather than paying for attribution it cannot act on", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-run-diagnosis-fast-"));
  try {
    const { store, task } = await failingImplementationTask(directory, { profile: "fast" });
    const { orchestrator, prompts } = orchestratorThatFailsImplementation(store, ENV_DIAGNOSIS);
    await orchestrator.start(task.id, "implementation");
    const done = await waitForStatus(store, task.id, "failed");

    assert.equal(
      prompts.some((prompt) => /<failure-diagnosis>/.test(prompt)),
      false,
      "a fast run cannot rewind, so it must not pay for a diagnosis",
    );
    assert.deepEqual(
      (done.topologyTrace?.nodesSkipped ?? []).map((entry) => entry.node),
      ["failure-diagnosis"],
    );
    assert.deepEqual(done.topologyTrace?.routingDecisions ?? [], []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
