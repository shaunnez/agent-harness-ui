import { randomUUID } from "node:crypto";
import { open, readFile, unlink } from "node:fs/promises";

export async function acquireJsonStoreLock(storePath) {
  const lockPath = `${storePath}.lock`;
  const ownership = {
    token: randomUUID(),
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
  };
  let handle;
  try {
    handle = await open(lockPath, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(ownership)}\n`, "utf8");
    await handle.close();
  } catch (error) {
    await handle?.close().catch(() => undefined);
    if (error.code === "EEXIST") {
      const conflict = new Error(
        `JSON rollback mode is single-process-only and ${lockPath} already exists. Stop the active runtime, or remove the stale lock only after verifying no JSON runtime is using this store.`,
        { cause: error },
      );
      conflict.code = "JSON_STORE_LOCKED";
      throw conflict;
    }
    await unlink(lockPath).catch((cleanupError) => {
      if (cleanupError.code !== "ENOENT") throw cleanupError;
    });
    throw error;
  }

  let released = false;
  return {
    path: lockPath,
    async release() {
      if (released) return;
      let current;
      try {
        current = JSON.parse(await readFile(lockPath, "utf8"));
      } catch (error) {
        if (error.code === "ENOENT") {
          released = true;
          return;
        }
        throw error;
      }
      if (current.token !== ownership.token) {
        throw new Error(`Refusing to remove JSON store lock ${lockPath} because ownership changed.`);
      }
      await unlink(lockPath);
      released = true;
    },
  };
}
