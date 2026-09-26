// The API loop's side of a run's host-tool socket: the one-line JSON protocol the bridge speaks
// (`../engine/host-tools/bridge.mjs`), so every tool call passes the same
// exposure check, error classification, repeat-call strikes and terminal stop as a CLI's would.

import { createConnection } from "node:net";

export async function connectHostTools(socketPath) {
  const socket = await new Promise((resolve, reject) => {
    const connection = createConnection(socketPath);
    connection.once("connect", () => resolve(connection));
    connection.once("error", reject);
  });
  socket.setEncoding("utf8");
  const pending = new Map();
  let buffered = "";
  let sequence = 0;
  socket.on("data", (chunk) => {
    buffered += chunk;
    let newline = buffered.indexOf("\n");
    while (newline !== -1) {
      const line = buffered.slice(0, newline);
      buffered = buffered.slice(newline + 1);
      newline = buffered.indexOf("\n");
      let response;
      try {
        response = JSON.parse(line);
      } catch {
        continue;
      }
      const waiter = pending.get(response?.id);
      if (!waiter) continue;
      pending.delete(response.id);
      waiter(response);
    }
  });
  const closed = new Promise((resolve) => socket.once("close", resolve));
  socket.on("close", () => {
    for (const waiter of pending.values())
      waiter({ ok: false, error: { code: "host_closed", message: "The host tool socket closed." } });
    pending.clear();
  });
  return {
    /** `{ok: true, result}` or `{ok: false, error: {code, message, recoverable}}`. Never throws. */
    call(tool, input) {
      const id = `api-loop-${++sequence}`;
      return new Promise((resolve) => {
        pending.set(id, resolve);
        socket.write(`${JSON.stringify({ id, tool, input })}\n`);
      });
    },
    async close() {
      socket.end();
      await closed;
    },
  };
}
