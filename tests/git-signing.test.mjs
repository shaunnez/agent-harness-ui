import "./git-env.mjs";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const git = (cwd, args) => execFileAsync("git", args, { cwd, windowsHide: true });

/**
 * Configure a repository the way a developer machine with commit signing is configured,
 * using a signer that always fails. Without the opt-out this is exactly the failure the
 * suite hit on a machine whose 1Password agent was refusing: `failed to write commit
 * object`, roughly thirty tests down, and a harness gate reading it as a candidate defect.
 */
async function signingRepository() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-signing-"));
  await git(directory, ["init", "--quiet", "."]);
  await git(directory, ["config", "user.email", "fixture@example.com"]);
  await git(directory, ["config", "user.name", "Fixture"]);
  await git(directory, ["config", "commit.gpgsign", "true"]);
  await git(directory, ["config", "tag.gpgsign", "true"]);
  await git(directory, ["config", "gpg.format", "ssh"]);
  await git(directory, ["config", "user.signingkey", "ssh-ed25519 AAAAUNUSABLE"]);
  await git(directory, ["config", "gpg.ssh.program", "/bin/false"]);
  return directory;
}

test("fixture commits do not depend on the machine's commit signing setup", async () => {
  const directory = await signingRepository();
  try {
    await writeFile(path.join(directory, "a.txt"), "one", "utf8");
    await git(directory, ["add", "a.txt"]);
    // Repository-local `commit.gpgsign = true` is deliberately the hardest case: the
    // opt-out has to outrank it, which is why it is set through `GIT_CONFIG_*` rather than
    // a global default a repository can override.
    await git(directory, ["commit", "-m", "fixture commit"]);
    const { stdout } = await git(directory, ["log", "--oneline"]);
    assert.match(stdout, /fixture commit/);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("the opt-out reaches every git subprocess, not just directly invoked ones", () => {
  const count = Number(process.env.GIT_CONFIG_COUNT ?? 0);
  assert.ok(count >= 2, "GIT_CONFIG_COUNT covers the signing overrides");
  const pairs = new Map(
    Array.from({ length: count }, (_, index) => [
      process.env[`GIT_CONFIG_KEY_${index}`],
      process.env[`GIT_CONFIG_VALUE_${index}`],
    ]),
  );
  assert.equal(pairs.get("commit.gpgsign"), "false");
  assert.equal(pairs.get("tag.gpgsign"), "false");
});

test("the opt-out appends to a caller's existing GIT_CONFIG entries rather than replacing them", async () => {
  const before = { ...process.env };
  try {
    process.env.GIT_CONFIG_COUNT = "1";
    process.env.GIT_CONFIG_KEY_0 = "core.abbrev";
    process.env.GIT_CONFIG_VALUE_0 = "12";
    for (const key of Object.keys(process.env)) {
      if (/^GIT_CONFIG_(KEY|VALUE)_[1-9]/.test(key)) delete process.env[key];
    }
    await import(`./git-env.mjs?reload=${Date.now()}`);
    assert.equal(process.env.GIT_CONFIG_COUNT, "3", "the caller's entry survives");
    assert.equal(process.env.GIT_CONFIG_KEY_0, "core.abbrev");
    assert.equal(process.env.GIT_CONFIG_KEY_1, "commit.gpgsign");
    assert.equal(process.env.GIT_CONFIG_KEY_2, "tag.gpgsign");
  } finally {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("GIT_CONFIG_")) delete process.env[key];
    }
    Object.assign(process.env, before);
  }
});
