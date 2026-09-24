// Where the API loop sends a model call: an OpenAI-compatible chat-completions endpoint, chosen by
// the model string's prefix, with the key read from the host's environment. The key never leaves
// this process: there is no child process on this runtime.
//
// DeepSeek's own API (api.deepseek.com) is deliberately absent. Shaun wants DeepSeek traffic
// ring-fenced from China; Baseten serves the open weights on its own infrastructure. OpenCode Go is
// here for testing on the plan the eval already used.
//
// Rates are USD per million tokens, from models.dev (`https://models.opencode.ai/api.json`),
// 24 September 2026. A figure computed from them is an API-rate estimate, never a charge.

export const API_LOOP_PROVIDERS = Object.freeze({
  "opencode-go": Object.freeze({
    label: "OpenCode Go",
    endpoint: "https://opencode.ai/zen/go/v1",
    keyEnv: "OPENCODE_API_KEY",
    rates: { "deepseek-v4.1-flash": { input: 0.15, output: 0.6, cacheRead: 0.003 } },
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

/** The API-rate estimate for a run's summed usage, or null when the model has no rate here. */
export function priceApiUsage(model, { inputTokens, cachedTokens, outputTokens }) {
  const { provider, remoteModel } = resolveApiModel(model);
  const rate = provider.rates[remoteModel];
  if (!rate) return null;
  const uncached = Math.max(0, inputTokens - cachedTokens);
  const usd = (uncached * rate.input + cachedTokens * rate.cacheRead + outputTokens * rate.output) / 1e6;
  return Math.round(usd * 1e6) / 1e6;
}
