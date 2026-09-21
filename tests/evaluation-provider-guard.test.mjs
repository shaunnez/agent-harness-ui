import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const exec = promisify(execFile);
const guard = new URL("../scripts/evaluation/provider-guard.py", import.meta.url).pathname;
const mac = process.platform === "darwin";

async function fixture(body, script, { deadline = 60, count = 3, tokens = 100 } = {}) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "provider-guard-")));
  const cli = path.join(root, "fake-cli");
  const configPath = path.join(root, "config.json");
  const ledger = path.join(root, "ledger.json");
  const secret = path.join(root, "reference.txt");
  const profile = path.join(root, "guard.sb");
  await writeFile(secret, "private reference");
  await writeFile(cli, `#!/usr/bin/env python3\nimport json,sys,time,subprocess,os\n${script}\n`);
  await chmod(cli, 0o700);
  await writeFile(
    profile,
    `(version 1) (allow default) (deny file-read* (literal ${JSON.stringify(secret)}))`,
  );
  await writeFile(ledger, JSON.stringify({ deadline: Date.now() / 1000 + deadline, invocations: [] }));
  await writeFile(
    configPath,
    JSON.stringify({
      executables: { codex: cli, claude: cli },
      confinement: "command-only",
      ledger,
      profile,
      maxProviderInvocations: count,
      maxTotalTokens: tokens,
    }),
  );
  const run = (provider = "codex", extra = []) =>
    exec("python3", [guard, configPath, provider, "--model", "fixture-model", ...extra]);
  try {
    await body({
      run,
      ledger: async () => JSON.parse(await readFile(ledger, "utf8")),
      secret,
      cli,
      async native(provider, args) {
        const config = JSON.parse(await readFile(configPath, "utf8"));
        await writeFile(
          configPath,
          JSON.stringify({ ...config, confinement: "native-provider", deniedReadPaths: [secret, secret] }),
        );
        return exec("python3", [guard, configPath, provider, ...args]);
      },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test(
  "provider guard records calls, forwards output and refuses a further call at its token cap",
  { skip: !mac },
  () =>
    fixture(
      async ({ run, ledger }) => {
        const output = await run();
        assert.match(output.stdout, /turn.completed/);
        assert.equal((await ledger()).invocations[0].totalTokens, 15);
        await assert.rejects(run(), /allowance exhausted/);
        assert.equal((await ledger()).invocations.length, 1);
      },
      'print(json.dumps({"type":"turn.completed","usage":{"input_tokens":10,"cached_input_tokens":4,"output_tokens":5}}))',
      { tokens: 15 },
    ),
);

test("Claude helper consumption includes cache writes and reads", { skip: !mac }, () =>
  fixture(async ({ run, ledger }) => {
    await run("claude");
    const entry = (await ledger()).invocations[0];
    assert.equal(entry.totalTokens, 23);
    assert.equal(entry.usage.cachedInputTokens, 4);
    assert.equal(entry.usage.cacheWriteTokens, 6);
  }, 'print(json.dumps({"type":"result","usage":{"input_tokens":10,"cache_read_input_tokens":4,"cache_creation_input_tokens":6,"output_tokens":3},"total_cost_usd":0.02}))'),
);

test("missing usage remains unknown and stops further dispatch", { skip: !mac }, () =>
  fixture(async ({ run, ledger }) => {
    await run();
    assert.equal((await ledger()).invocations[0].totalTokens, null);
    await assert.rejects(run(), /Missing prior provider usage/);
  }, 'print("no usage")'),
);

test("the command fixture cannot read a protected reference", { skip: !mac }, () =>
  fixture(async ({ run, secret }) => {
    const result = await run("codex", [secret]);
    assert.match(result.stdout, /isolated/);
  }, 'result = subprocess.run(["/bin/cat", sys.argv[-1]], capture_output=True)\nassert result.returncode != 0\nassert b"Operation not permitted" in result.stderr\nprint("isolated")'),
);

test("the wall deadline terminates an active child and retains its missing usage", { skip: !mac }, () =>
  fixture(
    async ({ run, ledger }) => {
      await assert.rejects(run());
      const entry = (await ledger()).invocations[0];
      assert.equal(entry.endReason, "deadline");
      assert.equal(entry.totalTokens, null);
    },
    "time.sleep(30)",
    { deadline: 1 },
  ),
);

test("Codex starts in its explicit repository, not the evaluator working directory", { skip: !mac }, () =>
  fixture(async ({ run, cli }) => {
    const cwd = path.dirname(cli);
    const result = await run("codex", ["--cd", cwd]);
    assert.equal(result.stdout.trim(), await realpath(cwd));
  }, "print(os.getcwd())"),
);

test("native Codex profile preserves posture and adds protected paths without legacy overrides", () =>
  fixture(async ({ native, secret }) => {
    const result = await native("codex", ["exec", "--model", "fixture", "--sandbox", "read-only"]);
    const args = JSON.parse(result.stdout);
    assert.equal(args[0], "exec");
    assert.ok(!args.includes("--sandbox"));
    const profile = args.find((value) => value.startsWith("permissions.evaluation="));
    assert.ok(profile.includes('extends=":read-only"'));
    assert.ok(profile.includes(`${JSON.stringify(secret)}="deny"`));
    assert.equal(profile.split(JSON.stringify(secret)).length - 1, 1);
    assert.ok(profile.includes("network={enabled=false}"));
  }, "print(json.dumps(sys.argv[1:]))"));

test("native Claude profile retains enforcement and adds OS and Read exclusions", () =>
  fixture(async ({ native, secret }) => {
    const settings = {
      sandbox: { enabled: true, failIfUnavailable: true, filesystem: { denyRead: ["/prior"] } },
      permissions: { deny: ["WebFetch"] },
    };
    const result = await native("claude", ["--model", "fixture", "--settings", JSON.stringify(settings)]);
    const args = JSON.parse(result.stdout);
    const actual = JSON.parse(args[args.indexOf("--settings") + 1]);
    assert.equal(actual.sandbox.failIfUnavailable, true);
    assert.deepEqual(actual.sandbox.filesystem.denyRead, ["/prior", secret]);
    assert.deepEqual(actual.permissions.deny, ["WebFetch", `Read(/${secret}/**)`]);
  }, "print(json.dumps(sys.argv[1:]))"));

test("a disabled native Claude sandbox is refused before a call is reserved", () =>
  fixture(async ({ native, ledger }) => {
    await assert.rejects(
      native("claude", ["--model", "fixture", "--settings", JSON.stringify({ sandbox: { enabled: false } })]),
      /requires its existing enforced sandbox/,
    );
    assert.equal((await ledger()).invocations.length, 0);
  }, 'print("should not run")'));
