import test from "node:test";
import { POLICY_IDS } from "../server/model-catalog.mjs";
import { assert, cleanup, createServer, createTask, git, path, writeFile } from "./api-test-support.mjs";

function fullMatrix(overrides = {}) {
  const matrix = Object.fromEntries(
    POLICY_IDS.map((policyId) => [policyId, { model: "gpt-5.6-luna", reasoning: "xhigh" }]),
  );
  return { ...matrix, ...overrides };
}

test("stores a full per-role policy matrix and snapshots it into the experiment", async () => {
  const { directory, origin, server } = await createServer();
  try {
    await git(directory, ["init"]);
    await git(directory, ["config", "user.name", "Agent Harness Test"]);
    await git(directory, ["config", "user.email", "agent-harness@example.test"]);
    await writeFile(path.join(directory, "README.md"), "matrix base\n", "utf8");
    await git(directory, ["add", "README.md"]);
    await git(directory, ["commit", "-m", "matrix base"]);
    const baseSha = (await git(directory, ["rev-parse", "HEAD"])).stdout.trim();

    const stagePolicies = fullMatrix({ plan: { model: "claude-sonnet-5", reasoning: "high" } });

    const response = await createTask(origin, {
      title: "Role sweep candidate",
      description: "Evaluate a mixed-provider policy matrix end to end.",
      repositoryPath: directory,
      workflow: "implement",
      stagePolicies,
      experiment: {
        groupId: "role-sweep",
        variantId: "plan-sonnet",
        frozenBaseSha: baseSha,
        acceptanceCriteria: ["Matrix is honored."],
        verificationCommands: ["npm test"],
      },
    });
    assert.equal(response.status, 201);
    const { task } = await response.json();
    assert.deepEqual(task.agentConfig.stagePolicies, stagePolicies);
    for (const profile of ["fast", "standard", "high-risk"]) {
      assert.deepEqual(task.agentConfig.profileStagePolicies[profile], stagePolicies);
    }
    assert.deepEqual(task.experiment.policyMatrix, stagePolicies);
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects a stage policy matrix missing a role", async () => {
  const { directory, origin, server } = await createServer();
  try {
    const stagePolicies = fullMatrix();
    delete stagePolicies.repair;
    const response = await createTask(origin, {
      title: "Incomplete matrix",
      description: "A matrix missing a role must be rejected rather than silently backfilled.",
      repositoryPath: directory,
      workflow: "implement",
      stagePolicies,
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /repair/);
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects a stage policy matrix that names a disallowed model", async () => {
  const { directory, origin, server } = await createServer();
  try {
    const stagePolicies = fullMatrix({ implement: { model: "gpt-9.9-nonexistent", reasoning: "xhigh" } });
    const response = await createTask(origin, {
      title: "Disallowed model",
      description: "A model outside the allowed runtime list must be rejected.",
      repositoryPath: directory,
      workflow: "implement",
      stagePolicies,
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /allowed model/i);
  } finally {
    await cleanup(server, directory);
  }
});

test("creates a task with the auto-accept-recommendations Grill policy", async () => {
  const { directory, origin, server } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Auto-accept grill",
      description: "An eval runner must not have to answer every Grill question by hand.",
      repositoryPath: directory,
      workflow: "implement",
      grillPolicy: "auto-accept-recommendations",
    });
    assert.equal(response.status, 201);
    const { task } = await response.json();
    assert.equal(task.grillPolicy, "auto-accept-recommendations");
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects a task that sends both model and stagePolicies", async () => {
  const { directory, origin, server } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Conflicting policy inputs",
      description: "Sending both a single model and a full matrix is ambiguous and must be rejected.",
      repositoryPath: directory,
      workflow: "implement",
      model: "gpt-5.6-luna",
      stagePolicies: fullMatrix(),
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /stagePolicies or model/i);
  } finally {
    await cleanup(server, directory);
  }
});
