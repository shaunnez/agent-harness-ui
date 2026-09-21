// Zero-inference proof that the installed Codex profile preserves read/write
// posture while excluding the evaluator. This is a CLI sandbox command, not exec.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = await mkdtemp(path.join(os.tmpdir(), "eval-native-"));
const protectedFile = path.join(root, "reference.txt");
await writeFile(protectedFile, "protected fixture");
const allowed = path.join(root, "readable.txt");
await writeFile(allowed, "public fixture");
try {
  for (const parent of [":read-only", ":workspace"]) {
    const profile = `permissions.evaluation={extends=${JSON.stringify(parent)},filesystem={${JSON.stringify(protectedFile)}="deny"},network={enabled=false}}`;
    const run = (command) =>
      exec("codex", ["sandbox", "-P", "evaluation", "-c", profile, "-C", root, "--", ...command], {
        cwd: root,
      });
    assert.equal((await run(["/bin/cat", allowed])).stdout, "public fixture");
    await assert.rejects(run(["/bin/cat", protectedFile]), /Operation not permitted/);
    await assert.rejects(
      run(["/bin/sh", "-c", 'echo changed > "$1"', "probe", protectedFile]),
      /Operation not permitted/,
    );
    const own = path.join(root, "own.txt");
    const write = () => run(["/bin/sh", "-c", 'echo allowed > "$1"', "probe", own]);
    if (parent === ":read-only") await assert.rejects(write(), /Operation not permitted/);
    else {
      await write();
      assert.equal((await readFile(own, "utf8")).trim(), "allowed");
    }
  }
  assert.equal(await readFile(protectedFile, "utf8"), "protected fixture");
  console.log(
    JSON.stringify({
      nativeProfiles: [":read-only", ":workspace"],
      protectedReads: "denied",
      protectedWrites: "denied",
      workspaceWrites: "allowed",
      readOnlyWrites: "denied",
      inferenceCalls: 0,
    }),
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
