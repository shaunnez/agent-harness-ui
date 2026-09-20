import { randomUUID } from "node:crypto";
import process from "node:process";
import readline from "node:readline";
import { decodeHostLine, encodeWorkerMessage } from "./event-protocol.mjs";

export async function openHostToolChannel() {
  const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  const iterator = lines[Symbol.asyncIterator]();
  const first = await iterator.next();
  if (first.done || !first.value) throw new Error("The research worker received no configuration.");
  const config = JSON.parse(first.value);
  const pending = new Map();
  const reader = (async () => {
    for await (const line of iterator) {
      const message = decodeHostLine(line);
      if (!message) continue;
      const waiter = pending.get(message.requestId);
      if (!waiter) continue;
      pending.delete(message.requestId);
      if (message.ok) waiter.resolve(message);
      else {
        const ceiling = message.error?.ceiling;
        const prefix = ceiling ? `[research_ceiling:${ceiling}] ` : "";
        const error = new Error(`${prefix}${message.error?.message ?? "The host research tool failed."}`);
        error.code = message.error?.code;
        error.ceiling = ceiling;
        error.budgetState = message.budgetState;
        waiter.reject(error);
      }
    }
    for (const waiter of pending.values()) waiter.reject(new Error("The host tool channel closed."));
    pending.clear();
  })();
  return {
    config,
    invoke(toolName, input) {
      const requestId = randomUUID();
      process.stdout.write(encodeWorkerMessage({ type: "tool_request", requestId, tool: toolName, input }));
      return new Promise((resolve, reject) => pending.set(requestId, { resolve, reject }));
    },
    close() {
      lines.close();
      process.stdin.pause();
    },
    reader,
  };
}
