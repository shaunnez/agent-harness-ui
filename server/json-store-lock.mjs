import { acquireExclusiveFileLock } from "./exclusive-file-lock.mjs";

export async function acquireJsonStoreLock(storePath) {
  const lockPath = `${storePath}.lock`;
  return acquireExclusiveFileLock(lockPath, {
    purpose: "JSON store",
    conflictCode: "JSON_STORE_LOCKED",
    conflictMessage: (path) =>
      `JSON rollback mode is single-process-only and ${path} already exists. Stop the active runtime, or remove the stale lock only after verifying no JSON runtime is using this store.`,
  });
}
