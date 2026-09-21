// NDJSON wire schema shared by the Deep Agents adapter (parent, companion process) and
// worker.mjs (child process). Deliberately free of any `deepagents`, `langchain`,
// `@langchain/*` or `langsmith` import: both processes load this file, and worker.mjs is the
// only file in the repository permitted to import those (architecture §5.4,
// `tests/research-deepagents-import-containment.test.mjs`).
//
// One line, one JSON object, one message. The child never writes anything else to stdout —
// any interleaved third-party log line would corrupt the stream, so worker.mjs routes
// everything that is not one of these messages to stderr instead.

export const WORKER_MESSAGE_TYPES = Object.freeze([
  "research_event",
  "usage",
  "result",
  "error",
  "log",
  "tool_request",
]);
export const HOST_MESSAGE_TYPES = Object.freeze(["tool_response"]);

export function encodeWorkerMessage(message) {
  return `${JSON.stringify(message)}\n`;
}

export function encodeHostMessage(message) {
  return `${JSON.stringify(message)}\n`;
}

/** Parse one stdout line. Returns `null` for anything that is not a well-formed worker
 *  message — a stray line from a dependency that ignored the stdout contract, for instance —
 *  so the adapter can log it as noise instead of crashing the run over it. */
export function decodeWorkerLine(line) {
  return decodeLine(line, WORKER_MESSAGE_TYPES);
}

export function decodeHostLine(line) {
  return decodeLine(line, HOST_MESSAGE_TYPES);
}

function decodeLine(line, allowedTypes) {
  let value;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (!allowedTypes.includes(value.type)) return null;
  return value;
}
