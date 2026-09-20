import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const checkerPath = path.resolve(process.cwd(), "scripts/check-verification-manifest.mjs");

async function createFixture({ scripts, commands }) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-manifest-check-"));
  await mkdir(path.join(directory, ".agent-harness"));
  await writeFile(path.join(directory, "package.json"), JSON.stringify({ scripts }), "utf8");
  await writeFile(
    path.join(directory, ".agent-harness", "verification.json"),
    JSON.stringify({ version: 1, commands }),
    "utf8",
  );
  return directory;
}

function runChecker(directory) {
  return spawnSync(process.execPath, [checkerPath], {
    cwd: directory,
    encoding: "utf8",
  });
}

test("accepts npm run scripts and the repository's npm test alias", async () => {
  const directory = await createFixture({
    scripts: { lint: "true", test: "node --test" },
    commands: [
      { id: "lint", command: ["npm", "run", "lint"] },
      { id: "test", command: ["npm", "test"] },
    ],
  });

  try {
    const result = runChecker(directory);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Verified 2 commands/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("reports every unresolved command and preserves its original argv", async () => {
  const directory = await createFixture({
    scripts: { lint: "true" },
    commands: [
      { id: "missing-script", command: ["npm", "run", "missing"] },
      { id: "unsupported-tool", command: ["pnpm", "run", "lint"] },
      { id: "malformed-npm", command: ["npm", "run"] },
    ],
  });

  try {
    const result = runChecker(directory);
    const output = `${result.stdout}\n${result.stderr}`;
    assert.notEqual(result.status, 0);
    assert.match(output, /missing-script/);
    assert.match(output, /\["npm","run","missing"\]/);
    assert.match(output, /unsupported-tool/);
    assert.match(output, /\["pnpm","run","lint"\]/);
    assert.match(output, /malformed-npm/);
    assert.match(output, /\["npm","run"\]/);
    assert.match(output, /only npm commands are supported/);
    assert.match(output, /expected \["npm", "run", "<script>"\]/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
