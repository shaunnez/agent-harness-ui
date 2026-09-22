// The parent side of the host tools: a Unix socket the CLI's MCP relay calls back into.
//
// This is the property the Deep Agents design existed to guarantee, kept intact: the process
// the model runs in holds no search credential and no general HTTP tool. The CLI spawns the
// relay (`mcp-server.mjs`); the relay knows nothing but this socket; every fetch, snapshot and
// excerpt check happens here, in the process that owns the run, through `ResearchWebTools`.
//
// The socket lives in the run's own `mkdtemp` directory, which is owner-only, so only this
// user's processes can reach it and it disappears with the run.
//
// One line, one JSON object, in each direction:
//
//   relay → host   {"id": "…", "tool": "fetch_source", "input": {…}}
//   host  → relay  {"id": "…", "ok": true, "result": {…}}
//                  {"id": "…", "ok": false, "error": {"code", "message", "recoverable"}}
//
// A failure that ends the run is answered to the relay too, so the CLI is never left waiting on
// a call, and reported through `onTerminal` so the runtime can stop the child.

import { createServer } from "node:net";
import path from "node:path";
import { classifyToolError, REPEATED_TOOL_ERROR_CODE, StrikeCounter } from "./tool-errors.mjs";

/** macOS refuses Unix socket paths longer than 104 bytes, Linux longer than 108. */
const MAX_SOCKET_PATH_BYTES = 103;

export async function openHostToolBridge({
  directory,
  webTools,
  tools,
  onTerminal = () => {},
  onLog = () => {},
  strikes = new StrikeCounter(),
}) {
  const socketPath = path.join(directory, "host.sock");
  if (Buffer.byteLength(socketPath) > MAX_SOCKET_PATH_BYTES)
    throw new Error(`The host tool socket path is too long for this platform: ${socketPath}`);
  const exposed = new Set(tools);
  let terminal = null;
  const connections = new Set();

  const answer = async (request) => {
    // The relay is spawned by the CLI, not by us, so its requests are checked here rather than
    // trusted: only the tools this run exposed can be reached, whatever the relay asks for.
    if (!exposed.has(request.tool))
      return fail(request, {
        code: "unknown_research_tool",
        message: `Tool "${request.tool}" is not available.`,
      });
    if (terminal) return fail(request, { code: terminal.code, message: terminal.message });
    try {
      const { result } = await webTools.invoke(request.tool, request.input ?? {});
      return { id: request.id, ok: true, result };
    } catch (error) {
      return failed(request, error);
    }
  };

  const failed = (request, error) => {
    const verdict = classifyToolError(error);
    if (verdict.outcome === "recoverable") {
      const { strikes: count, allowed } = strikes.record(request.tool, request.input, verdict.code);
      if (allowed) {
        onLog(`recoverable tool error returned to the model: ${verdict.code} (strike ${count})`);
        return fail(request, { code: verdict.code, message: verdict.message, recoverable: true });
      }
      return end(request, {
        outcome: "terminal",
        code: REPEATED_TOOL_ERROR_CODE,
        message: `The model repeated a failing ${request.tool} call after being told why it failed: ${verdict.message}`,
        ceiling: null,
        cause: verdict.code,
      });
    }
    return end(request, verdict);
  };

  const end = (request, verdict) => {
    if (!terminal) {
      terminal = verdict;
      onTerminal(verdict);
    }
    return fail(request, { code: verdict.code, message: verdict.message });
  };

  const server = createServer((socket) => {
    connections.add(socket);
    socket.setEncoding("utf8");
    let buffered = "";
    socket.on("data", (chunk) => {
      buffered += chunk;
      let newline = buffered.indexOf("\n");
      while (newline !== -1) {
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 1);
        newline = buffered.indexOf("\n");
        const request = parseRequest(line);
        if (!request) continue;
        void answer(request).then((response) => {
          if (!socket.destroyed) socket.write(`${JSON.stringify(response)}\n`);
        });
      }
    });
    socket.on("error", () => undefined);
    socket.on("close", () => connections.delete(socket));
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });

  return {
    socketPath,
    /** The first condition that ended the run, or null. */
    terminal: () => terminal,
    async close() {
      for (const socket of connections) socket.destroy();
      await new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

function fail(request, error) {
  return { id: request.id, ok: false, error: { recoverable: false, ...error } };
}

function parseRequest(line) {
  try {
    const value = JSON.parse(line);
    if (value && typeof value === "object" && typeof value.id === "string" && typeof value.tool === "string")
      return value;
  } catch {
    // A line that is not a request is dropped: the relay is ours, and anything else on this
    // socket is not a caller this bridge answers.
  }
  return null;
}
