import { mkdir } from "node:fs/promises";
import path from "node:path";
import { acquireExclusiveFileLock } from "./exclusive-file-lock.mjs";

export async function acquireRuntimeLock(storePath) {
  const lockPath = `${storePath}.runtime.lock`;
  await mkdir(path.dirname(lockPath), { recursive: true });
  return acquireExclusiveFileLock(lockPath, {
    purpose: "local runtime",
    conflictCode: "LOCAL_RUNTIME_LOCKED",
    conflictMessage: (path) =>
      `The Agent Harness store already has an active local runtime (${path}). Stop that companion before starting another one. Remove a stale lock only after verifying its recorded process is no longer running.`,
  });
}
