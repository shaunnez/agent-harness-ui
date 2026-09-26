// Where the API loop sends a model call: an OpenAI-compatible chat-completions endpoint, chosen by
// the model string's prefix, with the key read from the host's environment. The key never leaves
// this process: there is no child process on this runtime.
//
// DeepSeek's own API (api.deepseek.com) is deliberately absent. Shaun wants DeepSeek traffic
// ring-fenced from China. Fireworks' US-only endpoint serves inference only from the US and keeps
// no prompt or output data for open models by default; Baseten serves the open weights on its own
// infrastructure. OpenCode Go is here for testing on the plan the eval already used.
//
// Rates are USD per million tokens, from models.dev (`https://models.opencode.ai/api.json`),
// 24 September 2026. A figure computed from them is an API-rate estimate, never a charge.

export const API_LOOP_PROVIDERS = Object.freeze({
  "opencode-go": Object.freeze({
    label: "OpenCode Go",
    endpoint: "https://opencode.ai/zen/go/v1",
    keyEnv: "OPENCODE_API_KEY",
    // Go refuses a request without it ("MissingSessionID … cannot be routed efficiently"); one id per
    // run keeps a run's calls on one route, which is also what lets its prompt cache hit.
    sessionHeaders: ["x-opencode-session"],
    rates: { "deepseek-v4.1-flash": { input: 0.15, output: 0.6, cacheRead: 0.003 } },
  }),
  // Fireworks' US-only serverless (`https://docs.fireworks.ai/serverless/us-only-serverless`),
  // priced at 1.5x its global rate. Rates from its pricing page, 26 September 2026, which already
  // show the DeepSeek V4.1 Flash increase that takes effect on 1 October.
  "fireworks-us": Object.freeze({
    label: "Fireworks (US only)",
    endpoint: "https://us.api.fireworks.ai/inference/v1",
    keyEnv: "FIREWORKS_API_KEY",
    // Sticky routing, so a run's turns reach the replica that cached its prefix
    // (`https://docs.fireworks.ai/guides/prompt-caching`). Cached tokens are cheaper and count less
    // toward the per-minute prompt limit, so this raises throughput as well as cutting cost.
    sessionHeaders: ["x-session-affinity", "x-multi-turn-session-id"],
    rates: {
      "accounts/fireworks/routers/deepseek-v4p1-flash-us": { input: 0.45, output: 1.8, cacheRead: 0.009 },
    },
  }),
  // DeepInfra's OpenAI-compatible endpoint (`https://deepinfra.com/docs/openai_api`), added to try
  // the API loop on it. List rates from its `/v1/openai/models` metadata, 26 September 2026; that
  // listing also shows a 30% discount, left out here so the estimate does not rest on a promotion.
  deepinfra: Object.freeze({
    label: "DeepInfra",
    endpoint: "https://api.deepinfra.com/v1/openai",
    keyEnv: "DEEPINFRA_API_KEY",
    // DeepInfra serves DeepSeek 4.1 Flash with thinking off unless asked; the eval measured it
    // thinking (A10 and F10 averaged about 2k output tokens a call, tool calls included), so ask.
    // Its prompt cache needs no session header: a repeated prefix is read from cache as it is.
    requestDefaults: Object.freeze({ reasoning_effort: "high" }),
    // The levels a run or call may ask for instead. `off` is DeepInfra's `none`, which it
    // honours; the scoper, one tools-less JSON call, asks for it.
    reasoning: Object.freeze({
      high: Object.freeze({ reasoning_effort: "high" }),
      max: Object.freeze({ reasoning_effort: "max" }),
      off: Object.freeze({ reasoning_effort: "none" }),
    }),
    rates: { "deepseek-ai/DeepSeek-V4.1-Flash": { input: 0.2, output: 0.6, cacheRead: 0.006 } },
  }),
  baseten: Object.freeze({
    label: "Baseten",
    endpoint: "https://inference.baseten.co/v1",
    keyEnv: "BASETEN_API_KEY",
    rates: { "deepseek-ai/DeepSeek-V4.1-Flash": { input: 0.3, output: 1.2, cacheRead: 0.03 } },
  }),
});

export const API_LOOP_KEY_VARS = Object.freeze(Object.values(API_LOOP_PROVIDERS).map((p) => p.keyEnv));

/** `opencode-go/deepseek-v4.1-flash` → the provider and the model id it expects. */
export function resolveApiModel(model) {
  const text = String(model ?? "");
  const slash = text.indexOf("/");
  const providerId = slash === -1 ? "" : text.slice(0, slash);
  const provider = API_LOOP_PROVIDERS[providerId];
  if (!provider)
    throw new Error(
      `"${text}" names no API-loop provider. Use ${Object.keys(API_LOOP_PROVIDERS)
        .map((id) => `${id}/<model>`)
        .join(" or ")}.`,
    );
  return { providerId, provider, remoteModel: text.slice(slash + 1) };
}

/**
 * The request fields for a reasoning level on this provider. Null and "default" add nothing, so
 * the provider's `requestDefaults` answer. A level the provider cannot set (every provider but
 * DeepInfra thinks as it always has) also adds nothing: the call is made as before, never refused.
 */
export function reasoningSettings(provider, level) {
  if (level == null || level === "default") return {};
  return provider.reasoning?.[level] ?? {};
}

/** The API-rate estimate for a run's summed usage, or null when the model has no rate here. */
export function priceApiUsage(model, { inputTokens, cachedTokens, outputTokens }) {
  const { provider, remoteModel } = resolveApiModel(model);
  const rate = provider.rates[remoteModel];
  if (!rate) return null;
  const uncached = Math.max(0, inputTokens - cachedTokens);
  const usd = (uncached * rate.input + cachedTokens * rate.cacheRead + outputTokens * rate.output) / 1e6;
  return Math.round(usd * 1e6) / 1e6;
}
