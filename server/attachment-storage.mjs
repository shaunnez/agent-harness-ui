import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

const ATTACHMENT_SET_PATTERN =
  /^set-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIN_ORPHAN_AGE_MS = 5 * 60 * 1_000;

export async function cleanupOrphanAttachmentSets(dataDirectory, tasks) {
  const attachmentRoot = path.resolve(dataDirectory, "attachments");
  let entries;
  try {
    entries = await readdir(attachmentRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return { removed: [], retained: [] };
    throw error;
  }

  const referencedPaths = (tasks ?? []).flatMap((task) =>
    (task.attachments ?? [])
      .map((attachment) => attachment?.path)
      .filter((attachmentPath) => typeof attachmentPath === "string")
      .map((attachmentPath) => path.resolve(attachmentPath)),
  );
  const removed = [];
  const retained = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !ATTACHMENT_SET_PATTERN.test(entry.name)) continue;
    const setPath = path.join(attachmentRoot, entry.name);
    const setPrefix = `${setPath}${path.sep}`;
    if (referencedPaths.some((attachmentPath) => attachmentPath.startsWith(setPrefix))) {
      retained.push(setPath);
      continue;
    }
    let metadata;
    try {
      metadata = await stat(setPath);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    if (Date.now() - metadata.mtimeMs < MIN_ORPHAN_AGE_MS) {
      retained.push(setPath);
      continue;
    }
    await rm(setPath, { recursive: true, force: true });
    removed.push(setPath);
  }

  return { removed, retained };
}
