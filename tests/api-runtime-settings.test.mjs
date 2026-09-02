import test from "node:test";
import { assert, cleanup, createServer, createTask, fetch, nativeFetch } from "./api-test-support.mjs";

test("new runtime settings default design generation to Opus High and Sol High", async () => {
  const { directory, origin, server } = await createServer();
  try {
    const settings = (await (await fetch(`${origin}/api/settings`)).json()).settings;
    assert.deepEqual(settings.designPolicies, {
      "claude-design": { provider: "claude", model: "claude-opus-5", reasoning: "high" },
      "codex-design": { provider: "codex", model: "gpt-5.6-sol", reasoning: "high" },
    });
  } finally {
    await cleanup(server, directory);
  }
});

test("a rotated CSRF token rejects the old value, and runtime status hands out the new one", async () => {
  // The server mints a fresh csrfToken per process (see createApiServer's default of
  // crypto.randomUUID()), so a restart is indistinguishable, from the client's side, from
  // a second server instance minted with a different token. This exercises that boundary
  // directly: src/api.ts's request() helper recovers from exactly this by re-fetching
  // /api/runtime/status and replaying the mutation once, which is verified manually since
  // src/api.ts is TypeScript and not importable from this plain-JS test runner.
  const rotated = await createServer({ csrfToken: "fresh-token-after-restart" });
  try {
    const payload = JSON.stringify({
      title: "Rotated token probe",
      description: "Confirms a token minted before a restart is rejected after one.",
      repositoryPath: rotated.directory,
      workflow: "investigate",
    });
    const rejectedByOldToken = await nativeFetch(`${rotated.origin}/api/tasks`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-agent-harness-csrf": "stale-token-from-before-restart",
      },
      body: payload,
    });
    assert.equal(rejectedByOldToken.status, 403);
    const rejectedBody = await rejectedByOldToken.json();
    assert.match(rejectedBody.error, /csrf token/i);

    const status = await nativeFetch(`${rotated.origin}/api/runtime/status`);
    assert.equal(status.status, 200);
    const statusBody = await status.json();
    assert.equal(statusBody.csrfToken, "fresh-token-after-restart");

    const acceptedByFreshToken = await nativeFetch(`${rotated.origin}/api/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-agent-harness-csrf": statusBody.csrfToken },
      body: payload,
    });
    assert.equal(acceptedByFreshToken.status, 201);
  } finally {
    await cleanup(rotated.server, rotated.directory);
  }
});

test("exposes a shared runtime schema version on local runtime endpoints", async () => {
  const { directory, origin, server } = await createServer();
  try {
    const healthResponse = await fetch(`${origin}/api/health`);
    assert.equal(healthResponse.status, 200);
    const health = await healthResponse.json();
    assert.equal(Number.isInteger(health.runtimeSchemaVersion), true);

    const runtimeResponse = await fetch(`${origin}/api/runtime/status`);
    assert.equal(runtimeResponse.status, 200);
    const runtime = await runtimeResponse.json();
    assert.equal(Number.isInteger(runtime.runtimeSchemaVersion), true);
    assert.equal(runtime.runtimeSchemaVersion, health.runtimeSchemaVersion);
  } finally {
    await cleanup(server, directory);
  }
});

test("persists an allowed Sol model policy and snapshots it on new tasks", async () => {
  const { directory, origin, server } = await createServer();
  try {
    const settingsResponse = await fetch(`${origin}/api/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grillPolicy: "auto-accept-recommendations",
        allowedModels: ["gpt-5.6-sol", "gpt-5.6-luna", "claude-opus-5"],
        defaultModel: "gpt-5.6-sol",
        defaultReasoning: "xhigh",
      }),
    });
    assert.equal(settingsResponse.status, 200);
    const settings = (await settingsResponse.json()).settings;
    assert.equal(settings.defaultModel, "gpt-5.6-sol");
    assert.equal(settings.defaultReasoning, "xhigh");
    assert.equal(settings.grillPolicy, "auto-accept-recommendations");

    const legacySettingsResponse = await fetch(`${origin}/api/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        allowedModels: ["gpt-5.6-sol", "gpt-5.6-luna", "claude-opus-5"],
        defaultModel: "gpt-5.6-sol",
        defaultReasoning: "xhigh",
      }),
    });
    assert.equal((await legacySettingsResponse.json()).settings.grillPolicy, "auto-accept-recommendations");

    const createResponse = await createTask(origin, {
      title: "Sol task",
      description: "Use the selected model policy.",
      repositoryPath: directory,
      workflow: "investigate",
      priority: "medium",
      model: "gpt-5.6-sol",
      reasoning: "xhigh",
    });
    assert.equal(createResponse.status, 201);
    const task = (await createResponse.json()).task;
    assert.equal(task.agentConfig.model, "gpt-5.6-sol");
    assert.equal(task.agentConfig.reasoning, "xhigh");
    assert.equal(task.agentConfig.stagePolicies.plan.model, "gpt-5.6-sol");
    assert.equal(task.agentConfig.stagePolicies.test.reasoning, "xhigh");
    assert.equal(task.models[0].model, "gpt-5.6-sol");
    assert.equal(task.grillPolicy, "auto-accept-recommendations");

    const invalidPolicyResponse = await fetch(`${origin}/api/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grillPolicy: "always-automatic",
        allowedModels: ["gpt-5.6-sol", "gpt-5.6-luna", "claude-opus-5"],
        defaultModel: "gpt-5.6-sol",
        defaultReasoning: "xhigh",
      }),
    });
    assert.equal(invalidPolicyResponse.status, 400);
    assert.equal(invalidPolicyResponse.headers.get("x-agent-harness-error-category"), "request");
    assert.equal(invalidPolicyResponse.headers.get("x-agent-harness-retryable"), "false");
    assert.deepEqual(await invalidPolicyResponse.json(), {
      error: "Choose a supported Grill interaction policy.",
    });
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects a task model outside the configured allowlist", async () => {
  const { directory, origin, server } = await createServer();
  try {
    await fetch(`${origin}/api/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        allowedModels: ["gpt-5.6-luna", "claude-opus-5"],
        defaultModel: "gpt-5.6-luna",
        defaultReasoning: "medium",
        designPolicies: {
          "claude-design": { provider: "claude", model: "claude-opus-5", reasoning: "high" },
          "codex-design": { provider: "codex", model: "gpt-5.6-luna", reasoning: "high" },
        },
      }),
    });
    const response = await createTask(origin, {
      title: "Disallowed model",
      description: "This should not run with Sol.",
      repositoryPath: directory,
      workflow: "investigate",
      model: "gpt-5.6-sol",
      reasoning: "xhigh",
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /allowed runtime list/i);
  } finally {
    await cleanup(server, directory);
  }
});
