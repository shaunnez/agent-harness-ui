// Owner-only pilot artifacts (plan §Q4). Directories are 0700, files are 0600, and every
// durable write is atomic: a partial write can never masquerade as a finished report.

import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const MAX_EVENT_STRING = 4_000;

export async function createSessionDirectory(root, sessionId) {
  const directory = path.resolve(root, sessionId);
  await mkdir(directory, { recursive: true, mode: DIRECTORY_MODE });
  return directory;
}

export async function ensureDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: DIRECTORY_MODE });
  return directory;
}

export async function writeArtifact(file, contents) {
  await mkdir(path.dirname(file), { recursive: true, mode: DIRECTORY_MODE });
  const temporary = `${file}.partial`;
  await writeFile(temporary, contents, { encoding: "utf8", mode: FILE_MODE });
  await rename(temporary, file);
  return file;
}

export function writeJsonArtifact(file, value) {
  return writeArtifact(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeJsonlArtifact(file, rows) {
  return writeArtifact(file, rows.map((row) => `${JSON.stringify(row)}\n`).join(""));
}

/** An event as an artifact may hold it: bounded strings, no host paths, no raw page bodies. */
export function safeEvent(event) {
  return {
    ordinal: event.ordinal,
    timestamp: event.timestamp,
    type: event.type,
    data: boundStrings(event.data),
  };
}

function boundStrings(value, depth = 0) {
  if (depth > 6) return "[depth-bounded]";
  if (typeof value === "string")
    return value.length > MAX_EVENT_STRING ? `${value.slice(0, MAX_EVENT_STRING)}…[truncated]` : value;
  if (Array.isArray(value)) return value.slice(0, 50).map((entry) => boundStrings(entry, depth + 1));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 50)
        .map(([key, entry]) => [key, boundStrings(entry, depth + 1)]),
    );
  return value;
}
