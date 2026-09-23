import { DEFAULT_EXECUTION_PROVIDER } from "./run-activity.mjs";

/**
 * Single source for the runtime default policy. The settings store and the Codex
 * runtime both resolve their defaults from here so runtime status, allowed models,
 * and spawned agents cannot advertise different models.
 */
export const DEFAULT_RUNTIME_MODEL = "gpt-6-sol";
export const DEFAULT_RUNTIME_REASONING = "high";

/** Codex's own default, which is not the global one and must not follow it. */
export const DEFAULT_CODEX_MODEL = "gpt-6-sol";

/**
 * Provider-specific default stage policies, in a module with no Node built-in
 * imports so the browser bundle can reuse them. `model-catalog.mjs` re-exports
 * these, keeping one definition behind both the runtime and the settings UI's
 * "use all Claude" / "use all Codex" actions.
 */
export function defaultStagePolicies(provider = DEFAULT_EXECUTION_PROVIDER) {
  return defaultProfileStagePolicies(provider).standard;
}

export function defaultProfileStagePolicies(provider = DEFAULT_EXECUTION_PROVIDER) {
  if (provider === "claude") {
    const opusHigh = { model: "claude-opus-5-5", reasoning: "high" };
    const sonnetMedium = { model: "claude-sonnet-5", reasoning: "medium" };
    const sonnetHigh = { model: "claude-sonnet-5", reasoning: "high" };
    const sonnetXHigh = { model: "claude-sonnet-5", reasoning: "xhigh" };
    return {
      fast: profilePolicy(sonnetMedium, opusHigh, sonnetHigh, sonnetHigh, sonnetMedium),
      standard: profilePolicy(sonnetXHigh, opusHigh, sonnetHigh, sonnetHigh, sonnetMedium),
      "high-risk": profilePolicy(sonnetXHigh, opusHigh, sonnetHigh, sonnetHigh, sonnetMedium),
    };
  }
  const lunaMedium = { model: "gpt-6-luna", reasoning: "medium" };
  const lunaHigh = { model: "gpt-6-luna", reasoning: "high" };
  const solHigh = { model: "gpt-6-sol", reasoning: "high" };
  const codexProfile = (implementation) => ({
    ...profilePolicy(lunaHigh, solHigh, implementation, implementation, solHigh),
    grill: { ...solHigh },
    specification: { ...solHigh },
    test: { ...lunaMedium },
  });
  return {
    fast: codexProfile(lunaHigh),
    standard: codexProfile(solHigh),
    "high-risk": codexProfile(solHigh),
  };
}

/** Optional Settings preset; new tasks do not consume Claude unless an operator selects it. */
export function codexSonnetProfileStagePolicies() {
  const profiles = defaultProfileStagePolicies("codex");
  const sonnetHigh = { model: "claude-sonnet-5", reasoning: "high" };
  profiles["high-risk"].implement = { ...sonnetHigh };
  profiles["high-risk"].repair = { ...sonnetHigh };
  return profiles;
}

function profilePolicy(gathering, planning, implementation, repair, finalReview) {
  return {
    triage: { ...gathering },
    scouts: { ...gathering },
    grill: { ...gathering },
    specification: { ...gathering },
    plan: { ...planning },
    implement: { ...implementation },
    repair: { ...repair },
    "dev-review": { ...planning },
    test: { ...gathering },
    "final-review": { ...finalReview },
  };
}

/**
 * Per-provider fallback defaults behind one selected provider. This keeps the
 * single-source-of-truth property: only the *fallback* becomes provider-aware. Each provider's
 * entry names its own model — a Codex stage must not inherit a Claude id just because the global
 * default moved.
 */
export const PROVIDER_RUNTIME_DEFAULTS = Object.freeze({
  codex: Object.freeze({ model: DEFAULT_CODEX_MODEL, reasoning: DEFAULT_RUNTIME_REASONING }),
  claude: Object.freeze({ model: "claude-sonnet-5", reasoning: "xhigh" }),
});

export function providerRuntimeDefaults(providerId = DEFAULT_EXECUTION_PROVIDER) {
  const defaults = PROVIDER_RUNTIME_DEFAULTS[providerId ?? DEFAULT_EXECUTION_PROVIDER];
  if (!defaults) throw new Error(`No runtime defaults for execution provider: ${providerId}`);
  return { ...defaults };
}
