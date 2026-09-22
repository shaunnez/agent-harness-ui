// Adapter-owned model configuration (architecture §5, §8.2). No `deepagents`/`langchain`
// import here: this module produces a plain object, and worker.mjs — the only file allowed to
// import a chat-model integration — is what turns it into an actual model instance.
//
// Model *selection* never reaches the neutral `ResearchRuntime` contract: credentials, base
// URLs, constructor options and the provider's own environment variable names live entirely
// behind this adapter, resolved at `start()` time, exactly the way `execution-providers.mjs`
// keeps CLI credentials out of `orchestrator-*.mjs`.
//
// What a run *was* answered by is a different thing from how it was selected, and it does
// reach the contract, as the `ResearchModelIdentity` an adapter reports on its run handle.
// Without it nothing downstream can tell a fake run from a live one — which is the failure
// this module used to create by falling back to the fake model silently.

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

/** Bounded generated output per model call. This is a call-shape ceiling, not a billing
 *  guarantee: it caps what a model may generate, and says nothing about input token cost. It
 *  is deliberately absent unless configured, so ordinary runs and the deterministic fake model
 *  keep the behaviour they already had.
 *
 *  The ceiling is 8,192 rather than a smaller number because a model that thinks before it
 *  answers spends this same allowance on the thinking. Too low a cap truncates the answer, and
 *  a truncated answer is a harness artifact that would be scored as a model-quality failure. */
export const MODEL_MAX_OUTPUT_TOKENS_ENV_VAR = "RESEARCH_MODEL_MAX_OUTPUT_TOKENS";
export const MIN_MODEL_MAX_OUTPUT_TOKENS = 256;
export const MAX_MODEL_MAX_OUTPUT_TOKENS = 8_192;

export function resolveModelMaxOutputTokens(env = process.env) {
  const raw = env[MODEL_MAX_OUTPUT_TOKENS_ENV_VAR];
  if (raw == null || raw === "") return null;
  if (!/^\d+$/.test(String(raw)))
    throw new Error(
      `${MODEL_MAX_OUTPUT_TOKENS_ENV_VAR} must be an integer from ${MIN_MODEL_MAX_OUTPUT_TOKENS} to ${MAX_MODEL_MAX_OUTPUT_TOKENS}.`,
    );
  const parsed = Number(raw);
  if (parsed < MIN_MODEL_MAX_OUTPUT_TOKENS || parsed > MAX_MODEL_MAX_OUTPUT_TOKENS)
    throw new Error(
      `${MODEL_MAX_OUTPUT_TOKENS_ENV_VAR} must be an integer from ${MIN_MODEL_MAX_OUTPUT_TOKENS} to ${MAX_MODEL_MAX_OUTPUT_TOKENS}.`,
    );
  return parsed;
}

/** What to set, named in the failure a run gets when nothing is configured. A message that
 *  only says "not configured" makes an operator go and read this file; this one does not. */
export const NO_MODEL_PROVIDER_MESSAGE =
  "No research model provider is configured. Set RESEARCH_MODEL_PROVIDER=anthropic with " +
  "RESEARCH_MODEL_API_KEY or ANTHROPIC_API_KEY, RESEARCH_MODEL_PROVIDER=openai-compatible with " +
  "RESEARCH_MODEL_API_KEY or OPENAI_API_KEY, or RESEARCH_MODEL_PROVIDER=fake to select the " +
  "deterministic fake model deliberately.";

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
 * 3. `RESEARCH_MODEL_PROVIDER=fake` — a deterministic in-process fake requiring no network and
 *    no key. Reachable ONLY by naming it. It used to be the fallback when no credential was
 *    present, which meant a run with a missing key silently produced invented findings that
 *    nothing downstream distinguished from real ones. Falling back to a fake is worse than
 *    failing, because a failure is visible; this now throws instead.
 */
export function resolveModelConfig(env = process.env) {
  const provider = env.RESEARCH_MODEL_PROVIDER;
  const maxOutputTokens = resolveModelMaxOutputTokens(env);
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
      ...(maxOutputTokens == null ? {} : { maxOutputTokens }),
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
      ...(maxOutputTokens == null ? {} : { maxOutputTokens }),
      apiKey,
    };
  }
  if (provider !== FAKE_MODEL_PROVIDER) {
    if (!provider) throw new Error(NO_MODEL_PROVIDER_MESSAGE);
    throw new Error(
      `RESEARCH_MODEL_PROVIDER must be one of ${ANTHROPIC_MODEL_PROVIDER}, ${OPENAI_COMPATIBLE_MODEL_PROVIDER} or ${FAKE_MODEL_PROVIDER}; received "${provider}".`,
    );
  }
  return {
    provider: FAKE_MODEL_PROVIDER,
    model: "fake-research-model",
    ...(maxOutputTokens == null ? {} : { maxOutputTokens }),
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

/**
 * The exact keyword arguments the child must give a live chat-model constructor. Kept here,
 * away from `worker.mjs`, so the output-token ceiling can be asserted by a test that neither
 * installs a graph engine nor constructs a model — and so a future provider cannot quietly
 * gain a constructor that forgets it.
 */
export function modelConstructorOptions(modelConfig, apiKey) {
  const maxTokens = modelConfig.maxOutputTokens ?? null;
  if (modelConfig.provider === ANTHROPIC_MODEL_PROVIDER)
    return {
      provider: ANTHROPIC_MODEL_PROVIDER,
      options: { model: modelConfig.model, apiKey, ...(maxTokens ? { maxTokens } : {}) },
    };
  if (modelConfig.provider === OPENAI_COMPATIBLE_MODEL_PROVIDER)
    return {
      provider: OPENAI_COMPATIBLE_MODEL_PROVIDER,
      options: {
        model: modelConfig.model,
        apiKey,
        configuration: { baseURL: modelConfig.baseURL },
        ...(maxTokens ? { maxTokens } : {}),
      },
    };
  return { provider: FAKE_MODEL_PROVIDER, options: { label: modelConfig.model } };
}

/** A model identity a report may contain: no key value, and no key prefix. */
export function modelIdentitySnapshot(modelConfig, env = process.env) {
  return {
    provider: modelConfig.provider,
    model: modelConfig.model,
    ...(modelConfig.baseURL ? { baseUrl: modelConfig.baseURL } : {}),
    maxOutputTokens: modelConfig.maxOutputTokens ?? null,
    apiKeyEnvVar: modelConfig.apiKeyEnvVar ?? null,
    apiKeyPresent: Boolean(modelConfig.apiKey ?? env[modelConfig.apiKeyEnvVar ?? ""]),
  };
}

/** A paid pilot may not inherit a model from a stray credential (plan §7). */
export function requireExplicitModelIdentity(env = process.env) {
  const provider = env.RESEARCH_MODEL_PROVIDER;
  const model = env.RESEARCH_MODEL_ID;
  if (!provider || !model)
    throw new Error(
      "A live model pilot requires both RESEARCH_MODEL_PROVIDER and RESEARCH_MODEL_ID; a model is never inherited from an available credential.",
    );
  if (provider === FAKE_MODEL_PROVIDER)
    throw new Error("A live model pilot cannot select the deterministic fake model.");
  if (![ANTHROPIC_MODEL_PROVIDER, OPENAI_COMPATIBLE_MODEL_PROVIDER].includes(provider))
    throw new Error(
      `RESEARCH_MODEL_PROVIDER must be ${ANTHROPIC_MODEL_PROVIDER} or ${OPENAI_COMPATIBLE_MODEL_PROVIDER} for a live pilot.`,
    );
  return { provider, model };
}
