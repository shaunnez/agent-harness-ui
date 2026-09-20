import assert from "node:assert/strict";
import test from "node:test";
import {
  REDACTION_PLACEHOLDER,
  RETAINED_OUTPUT_BYTE_LIMIT,
  RETAINED_OUTPUT_LINE_LIMIT,
  redactSecrets,
  retainFailedCommandOutput,
} from "../server/command-output-retention.mjs";

test("empty and whitespace-only output retains nothing", () => {
  for (const value of [null, undefined, "", "   \n\n  ", [], 42]) {
    assert.equal(retainFailedCommandOutput(value), null);
  }
});

test("short output is retained whole, with no truncation marker", () => {
  const output = "FAIL tests/auth.spec.ts\n  expected 200, received 401";
  assert.equal(retainFailedCommandOutput(output), output);
});

test("only the tail survives a long output, and the cut is declared", () => {
  const lines = Array.from({ length: 500 }, (_, index) => `line ${index}`);
  const retained = retainFailedCommandOutput(lines.join("\n"));

  assert.match(retained, /output truncated/);
  assert.ok(retained.includes("line 499"), "the last line is what explains the exit code");
  assert.ok(!retained.includes("line 100"), "the head is dropped");
  // The marker occupies its own line on top of the retained lines.
  assert.equal(retained.split("\n").length, RETAINED_OUTPUT_LINE_LIMIT + 1);
});

test("a single enormous line is capped by bytes, not just by line count", () => {
  const retained = retainFailedCommandOutput("x".repeat(500_000));
  assert.match(retained, /output truncated/);
  assert.ok(
    Buffer.byteLength(retained, "utf8") <= RETAINED_OUTPUT_BYTE_LIMIT + 64,
    "one unbroken line must not escape the cap through the line rule",
  );
});

test("a byte cut never leaves a broken multi-byte character behind", () => {
  // Every character is 4 bytes, so the cap lands mid-character by construction.
  const retained = retainFailedCommandOutput("😀".repeat(2_000));
  assert.ok(!retained.includes("�"), "a split code point must be dropped, not stored as U+FFFD");
});

test("trailing blank lines do not consume the retention budget", () => {
  const retained = retainFailedCommandOutput("real failure detail\n\n\n\n");
  assert.equal(retained, "real failure detail");
});

for (const [label, secret] of [
  ["OpenAI-style key", "sk-abcdefghijklmnopqrstuvwxyz012345"],
  ["GitHub token", "ghp_abcdefghijklmnopqrstuvwxyz0123456789"],
  ["GitHub fine-grained PAT", "github_pat_11ABCDEFG0abcdefghijklmnop"],
  ["Slack token", "xoxb-1234567890-abcdefghijkl"],
  ["AWS access key id", "AKIAIOSFODNN7EXAMPLE"],
  ["Google API key", "AIzaSyA1234567890abcdefghijklmnopqrstuvw"],
  ["GitLab PAT", "glpat-abcdefghijklmnopqrstu"],
  ["npm token", "npm_abcdefghijklmnopqrstuvwxyz0123456789ab"],
]) {
  test(`a ${label} never reaches the store`, () => {
    const retained = retainFailedCommandOutput(`curl failed using ${secret} as credential`);
    assert.ok(!retained.includes(secret), `${label} survived redaction`);
    assert.match(retained, /curl failed using \[redacted\] as credential/);
  });
}

test("a named credential keeps its key and loses its value", () => {
  const retained = retainFailedCommandOutput(
    ["env check:", "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY", "NODE_ENV=test"].join(
      "\n",
    ),
  );
  assert.match(
    retained,
    /AWS_SECRET_ACCESS_KEY=\[redacted\]/,
    "the key name is the diagnostic and must survive",
  );
  assert.ok(!retained.includes("wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY"));
  assert.match(retained, /NODE_ENV=test/, "an unremarkable variable is left alone");
});

test("a bearer credential is masked even though it names no key", () => {
  const retained = retainFailedCommandOutput("> Authorization: Bearer eyJhbGciOi.eyJzdWIiOi.SflKxwRJSM");
  assert.equal(retained, "> Authorization: Bearer [redacted]");
});

test("a password in a URL authority is masked and the host is kept", () => {
  const retained = retainFailedCommandOutput(
    "psql: could not connect to postgres://admin:hunter2@db.internal:5432/app",
  );
  assert.match(retained, /postgres:\/\/admin:\[redacted\]@db\.internal:5432\/app/);
});

test("a private key block is replaced entirely rather than masked in place", () => {
  const retained = retainFailedCommandOutput(
    [
      "ssh failed:",
      "-----BEGIN OPENSSH PRIVATE KEY-----",
      "b3BlbnNzaC1rZXktdjE",
      "-----END OPENSSH PRIVATE KEY-----",
    ].join("\n"),
  );
  assert.ok(
    !retained.includes("b3BlbnNzaC1rZXktdjE"),
    "half a private key is still a compromised private key",
  );
  assert.match(retained, /ssh failed:\n\[redacted\]/);
});

test("redaction runs after truncation, so a secret in the tail is still caught", () => {
  const noise = Array.from({ length: 200 }, (_, index) => `step ${index}`);
  const retained = retainFailedCommandOutput(
    [...noise, "token=ghp_abcdefghijklmnopqrstuvwxyz0123456789"].join("\n"),
  );
  assert.ok(!retained.includes("ghp_abcdefghijklmnopqrstuvwxyz0123456789"));
  assert.match(retained, /token=\[redacted\]/);
});

test("output that is nothing but a secret retains nothing rather than a bare placeholder", () => {
  assert.equal(retainFailedCommandOutput("ghp_abcdefghijklmnopqrstuvwxyz0123456789"), REDACTION_PLACEHOLDER);
});

test("redactSecrets leaves ordinary diagnostic text untouched", () => {
  const text =
    "Error: Cannot find module './verify_manifest.mjs'\n    at Module._resolveFilename (node:internal/modules)";
  assert.equal(redactSecrets(text), text);
});
