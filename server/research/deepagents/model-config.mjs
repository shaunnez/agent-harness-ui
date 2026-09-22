// Adapter-owned model configuration (architecture §5, §8.2). No `deepagents`/`langchain`
// import here: this module produces a plain object, and worker.mjs — the only file allowed to
// import a chat-model integration — is what turns it into an actual model instance.
//
// Model identifiers never reach the neutral `ResearchRuntime` contract. They live entirely
// behind this adapter, resolved from environment at `start()` time, exactly the way
// `execution-providers.mjs` keeps CLI credentials out of `orchestrator-*.mjs`.

export const FAKE_MODEL_PROVIDER = "fake";
export const ANTHROPIC_MODEL_PROVIDER = "anthropic";
export const OPENAI_COMPATIBLE_MODEL_PROVIDER = "openai-compatible";

const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_OPENAI_COMPATIBLE_MODEL = "gpt-4o-mini";
const DEFAULT_OPENAI_COMPATIBLE_BASE_URL = "https://api.openai.com/v1";

/** The single env var name the child reads its model credential from, whatever the
 *  credential's original source. See `child-env.mjs` for why the provider's own conventional
 *  variable name (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) never itself reaches the child. */
export const MODEL_API_KEY_ENV_VAR = "RESEARCH_MODEL_API_KEY";

/**
 * Resolve which model the child should use, from environment, in this order:
 *
 * 1. `RESEARCH_MODEL_PROVIDER=openai-compatible` (or `OPENAI_API_KEY` present with no explicit
 *    provider) — any OpenAI-compatible endpoint, `RESEARCH_MODEL_BASE_URL` and
 *    `RESEARCH_MODEL_ID` override the defaults. This is the shape a later self-hosted or
 *    private endpoint (Qwen, etc.) plugs into without an adapter code change.
 * 2. `RESEARCH_MODEL_PROVIDER=anthropic` (or `ANTHROPIC_API_KEY` present with no explicit
 *    provider) — Anthropic, already an approved credential in this repository and the
 *    simplest real provider available for an actual execution test in this slice.
 * 3. No credential available — a deterministic in-process fake requiring no network and no
 *    key. Every test in this slice runs on this path by default.
 */
export function resolveModelConfig(env = process.env) {
  const provider = env.RESEARCH_MODEL_PROVIDER;
  if (provider === OPENAI_COMPATIBLE_MODEL_PROVIDER || (!provider && env.OPENAI_API_KEY)) {
    const apiKey = env.RESEARCH_MODEL_API_KEY ?? env.OPENAI_API_KEY;
    if (!apiKey)
      throw new Error(
        `RESEARCH_MODEL_PROVIDER=${OPENAI_COMPATIBLE_MODEL_PROVIDER} requires RESEARCH_MODEL_API_KEY or OPENAI_API_KEY.`,
      );
    return {
      provider: OPENAI_COMPATIBLE_MODEL_PROVIDER,
      model: env.RESEARCH_MODEL_ID ?? DEFAULT_OPENAI_COMPATIBLE_MODEL,
      baseURL: env.RESEARCH_MODEL_BASE_URL ?? DEFAULT_OPENAI_COMPATIBLE_BASE_URL,
      apiKeyEnvVar: MODEL_API_KEY_ENV_VAR,
      apiKey,
    };
  }
  if (provider === ANTHROPIC_MODEL_PROVIDER || (!provider && env.ANTHROPIC_API_KEY)) {
    const apiKey = env.RESEARCH_MODEL_API_KEY ?? env.ANTHROPIC_API_KEY;
    if (!apiKey)
      throw new Error(
        `RESEARCH_MODEL_PROVIDER=${ANTHROPIC_MODEL_PROVIDER} requires RESEARCH_MODEL_API_KEY or ANTHROPIC_API_KEY.`,
      );
    return {
      provider: ANTHROPIC_MODEL_PROVIDER,
      model: env.RESEARCH_MODEL_ID ?? DEFAULT_ANTHROPIC_MODEL,
      apiKeyEnvVar: MODEL_API_KEY_ENV_VAR,
      apiKey,
    };
  }
  return {
    provider: FAKE_MODEL_PROVIDER,
    model: "fake-research-model",
    // Test-only knobs. `fakeDelayMs` lets a cancellation test give the child something to be
    // cancelled *during*, without needing a live model call to take real wall-clock time.
    // `fakeMisbehavior` scripts the fake model to submit an invalid `submit_finding` call
    // first, so the malformed-output failure experiment does not depend on a live model
    // actually producing bad output on demand.
    ...(env.RESEARCH_MODEL_FAKE_DELAY_MS ? { fakeDelayMs: Number(env.RESEARCH_MODEL_FAKE_DELAY_MS) } : {}),
    ...(env.RESEARCH_MODEL_FAKE_MISBEHAVIOR ? { fakeMisbehavior: env.RESEARCH_MODEL_FAKE_MISBEHAVIOR } : {}),
    ...(env.RESEARCH_MODEL_FAKE_SCENARIO ? { fakeScenario: env.RESEARCH_MODEL_FAKE_SCENARIO } : {}),
  };
}

/** Split a resolved config into what may cross into the child's JSON config (over stdin) and
 *  what may only reach the child as an environment variable. Keeping the key out of the config
 *  object is a small hygiene measure — stdin content is not a place secrets belong even though
 *  nothing in this repository currently logs it. */
export function splitModelConfigForChild(modelConfig) {
  const { apiKey, ...forChild } = modelConfig;
  return { forChild, apiKey };
}
