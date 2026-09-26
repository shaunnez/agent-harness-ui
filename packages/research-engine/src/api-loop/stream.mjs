// A chat completion read as it streams (server-sent events), assembled into the same reply a
// non-streaming call returns: `{choices: [{message, finish_reason}], usage}`.
//
// Streaming is asked for so a call that has stalled can be told from one that is thinking: a
// thinking model sends reasoning tokens the whole time, so silence for `idleMs` means the call is
// stuck and is retried, where a fixed per-call timeout had to be long enough for the slowest
// honest answer. It also marks the moment the provider has read the prompt (the first chunk), which
// is when the other runs of a question can start and find that prompt in the provider's cache.
//
// A provider that answers with plain JSON instead is read as before.

/** A stream error the caller turns into its own retryable error. */
export class StreamError extends Error {
  constructor(message, { retryable = true } = {}) {
    super(message);
    this.retryable = retryable;
  }
}

/**
 * Reads `response` (already `ok`). `onFirstChunk` is called once, when the first event arrives.
 * `idle` is `{ reset() }`, reset on every chunk so the caller's idle timer only fires on silence.
 */
export async function readChatReply(response, { onFirstChunk = () => {}, idle = null } = {}) {
  const type = response.headers?.get?.("content-type") ?? "";
  if (!/text\/event-stream/i.test(type) || !response.body) {
    const text = await response.text();
    onFirstChunk();
    try {
      return JSON.parse(text);
    } catch {
      throw new StreamError("The provider returned a body that is not JSON.");
    }
  }
  const reply = new ReplyBuilder();
  const decoder = new TextDecoder();
  let buffered = "";
  let first = true;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      idle?.reset();
      buffered += decoder.decode(value, { stream: true });
      let end = buffered.indexOf("\n");
      while (end >= 0) {
        const line = buffered.slice(0, end).replace(/\r$/, "");
        buffered = buffered.slice(end + 1);
        end = buffered.indexOf("\n");
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data) continue;
        if (data === "[DONE]") return reply.finish();
        if (first) {
          first = false;
          onFirstChunk();
        }
        let chunk;
        try {
          chunk = JSON.parse(data);
        } catch {
          throw new StreamError("The provider sent a stream event that is not JSON.");
        }
        if (chunk.error)
          throw new StreamError(
            `The provider failed mid-answer: ${String(chunk.error.message ?? JSON.stringify(chunk.error)).slice(0, 300)}`,
          );
        reply.add(chunk);
      }
    }
  } finally {
    reader.releaseLock?.();
  }
  // A stream that ends without [DONE] is complete only if the model said why it stopped.
  if (!reply.finished) throw new StreamError("The provider's stream ended before the answer did.");
  return reply.finish();
}

class ReplyBuilder {
  #content = "";
  #reasoning = "";
  #calls = [];
  #finishReason = null;
  #usage = null;
  #id = null;

  get finished() {
    return this.#finishReason != null;
  }

  add(chunk) {
    this.#id ??= chunk.id ?? null;
    if (chunk.usage) this.#usage = chunk.usage;
    const choice = chunk.choices?.[0];
    if (!choice) return;
    const delta = choice.delta ?? {};
    if (typeof delta.content === "string") this.#content += delta.content;
    // DeepSeek providers name the thinking `reasoning_content`; some use `reasoning`.
    const reasoning = delta.reasoning_content ?? delta.reasoning;
    if (typeof reasoning === "string") this.#reasoning += reasoning;
    for (const part of delta.tool_calls ?? []) {
      const index = Number.isInteger(part.index) ? part.index : this.#calls.length;
      this.#calls[index] ??= { id: null, type: "function", function: { name: "", arguments: "" } };
      const call = this.#calls[index];
      if (part.id) call.id = part.id;
      if (part.type) call.type = part.type;
      if (part.function?.name) call.function.name += part.function.name;
      if (part.function?.arguments) call.function.arguments += part.function.arguments;
    }
    if (choice.finish_reason) this.#finishReason = choice.finish_reason;
  }

  finish() {
    const calls = this.#calls.filter(Boolean);
    return {
      ...(this.#id ? { id: this.#id } : {}),
      choices: [
        {
          index: 0,
          finish_reason: this.#finishReason,
          message: {
            role: "assistant",
            content: this.#content,
            ...(this.#reasoning ? { reasoning_content: this.#reasoning } : {}),
            ...(calls.length ? { tool_calls: calls } : {}),
          },
        },
      ],
      usage: this.#usage,
    };
  }
}
