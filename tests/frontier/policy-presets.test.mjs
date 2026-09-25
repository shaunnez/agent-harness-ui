import assert from "node:assert/strict";
import test from "node:test";
import { defaultProfileStagePolicies } from "../../server/policy-defaults.mjs";
import { providerProfilePolicyMatrices } from "../../src/frontier/runtime/policies.ts";

const model = (id, provider) => ({
  id,
  provider,
  editable: true,
  reasoningLevels: ["medium", "high", "xhigh"],
});

function status(allowedModels = ["gpt-6-luna", "gpt-6-sol", "claude-sonnet-5", "claude-opus-5-5"]) {
  return {
    catalog: {
      models: [
        model("gpt-6-luna", "codex"),
        model("gpt-6-sol", "codex"),
        model("claude-sonnet-5", "claude"),
        model("claude-opus-5-5", "claude"),
      ],
    },
    settings: { allowedModels },
  };
}

test("Frontier provider buttons apply the complete profile-aware default matrix", () => {
  for (const provider of ["codex", "claude"]) {
    assert.deepEqual(
      providerProfilePolicyMatrices(provider, status()),
      defaultProfileStagePolicies(provider),
    );
  }
});

test("Frontier refuses a provider preset when one required model is disallowed", () => {
  const allowed = ["gpt-6-luna", "gpt-6-sol", "claude-sonnet-5"];
  assert.equal(providerProfilePolicyMatrices("claude", status(allowed)), null);
  assert.ok(providerProfilePolicyMatrices("codex", status(allowed)));
});
