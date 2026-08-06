import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { DEFAULT_EXECUTION_PROVIDER } from "./run-activity.mjs";

export const PRICING_SOURCE_URL = "https://platform.openai.com/docs/pricing";
export const CREDIT_SOURCE_URL = "https://learn.chatgpt.com/docs/pricing";
export const PRICING_VERSION = "2026-08-02";

// Standard API-equivalent prices per 1M tokens. ChatGPT-plan Codex sessions do
// not report a dollar charge, so callers must label calculated values as estimates.
export const MODEL_PRICING = {
  "gpt-5.6-sol": rate(5, 0.5, 6.25, 30, 10, 1, 12.5, 45),
  "gpt-5.6-terra": rate(2, 0.2, 2.5, 12, 4, 0.4, 5, 18),
  "gpt-5.6-luna": rate(0.2, 0.02, 0.25, 1.2, 0.4, 0.04, 0.5, 1.8),
  "gpt-5.5": rate(5, 0.5, null, 30, 10, 1, null, 45),
  "gpt-5.4": rate(2.5, 0.25, null, 15, 5, 0.5, null, 22.5),
  "gpt-5.4-mini": rate(0.75, 0.075, null, 4.5),
  "gpt-5.4-nano": rate(0.2, 0.02, null, 1.25),
  "gpt-5.3-codex": rate(1.75, 0.175, null, 14),
  // Anthropic first-party rates. Cache write is 2x input — the 1-hour TTL
  // multiplier, not the 5-minute 1.25x — because recorded Claude Code sessions
  // report all cache creation as `ephemeral_1h_input_tokens`. These match what the
  // CLI itself bills to the cent, including Sonnet 5 at the standard $3/$15 rather
  // than the live introductory $2/$10: a harness whose cost figures disagree with
  // the tool doing the spending is worse than one that is uniformly slightly high.
  // `long` is null for every entry — these are 1M-context models at standard
  // rates, so the >272k long-context branch must never fire for them.
  "claude-fable-5": rate(10, 1, 20, 50),
  "claude-opus-5": rate(5, 0.5, 10, 25),
  "claude-sonnet-5": rate(3, 0.3, 6, 15),
  "claude-haiku-4-5": rate(1, 0.1, 2, 5),
};

export const CLAUDE_MODEL_IDS = Object.freeze([
  "claude-opus-5",
  "claude-sonnet-5",
  "claude-fable-5",
  "claude-haiku-4-5",
]);

const CLAUDE_MODEL_ID_SET = new Set(CLAUDE_MODEL_IDS);

// Current ChatGPT Work / Codex credit rates per 1M tokens. Credits are a
// usage-comparison unit, not an attributable dollar charge for plan sessions.
export const MODEL_CREDIT_RATES = {
  "gpt-5.6-sol": { input: 125, cachedInput: 12.5, output: 750 },
  "gpt-5.6-terra": { input: 50, cachedInput: 5, output: 300 },
  "gpt-5.6-luna": { input: 5, cachedInput: 0.5, output: 30 },
};

export const POLICY_IDS = [
  "triage",
  "scouts",
  "grill",
  "specification",
  "plan",
  "implement",
  "repair",
  "dev-review",
  "test",
  "final-review",
];

export function defaultStagePolicies(provider = DEFAULT_EXECUTION_PROVIDER) {
  if (provider === "claude") {
    // Mirrors the sol/luna split: the deeper model for planning and every gate,
    // the faster one for gathering and execution.
    const opus = { model: "claude-opus-5", reasoning: "xhigh" };
    const sonnet = { model: "claude-sonnet-5", reasoning: "high" };
    return {
      triage: { ...sonnet },
      scouts: { ...sonnet },
      grill: { ...sonnet },
      specification: { ...sonnet },
      plan: { ...opus },
      implement: { ...sonnet },
      repair: { ...opus },
      "dev-review": { ...opus },
      test: { ...sonnet },
      "final-review": { ...opus },
    };
  }
  const luna = { model: "gpt-5.6-luna", reasoning: "xhigh" };
  const sol = { model: "gpt-5.6-sol", reasoning: "high" };
  return {
    triage: { ...luna },
    scouts: { ...luna },
    grill: { ...luna },
    specification: { ...luna },
    plan: { ...sol },
    implement: { ...luna },
    repair: { ...sol },
    "dev-review": { ...sol },
    test: { ...luna },
    "final-review": { ...sol },
  };
}

const FALLBACK_MODELS = [
  model("gpt-5.6-sol", "GPT-5.6 Sol", "Latest frontier agentic coding model.", "low", ["low", "medium", "high", "xhigh", "max", "ultra"]),
  model("gpt-5.6-terra", "GPT-5.6 Terra", "Balanced agentic coding model for everyday work.", "medium", ["low", "medium", "high", "xhigh", "max", "ultra"]),
  model("gpt-5.6-luna", "GPT-5.6 Luna", "Fast and affordable agentic coding model.", "medium", ["low", "medium", "high", "xhigh", "max"]),
  model("gpt-5.4-mini", "GPT-5.4 Mini", "Small, fast, and cost-efficient model for simpler coding tasks.", "medium", ["low", "medium", "high", "xhigh"]),
];

/**
 * There is no Claude analogue of `models_cache.json` and `--help` lists only
 * aliases, so the Claude catalogue is bundled: the harness must not depend on
 * network access, and the model set changes slowly. `modelUsage` on a completed
 * run carries better metadata than this (canonicalModel, contextWindow,
 * maxOutputTokens) and is persisted for exactly that reason.
 *
 * `claude-haiku-4-5` supports no effort levels, so it is deliberately visible and
 * priced but not selectable as a stage policy: a policy requires a reasoning
 * value, and the provider must omit `--effort` entirely for this model.
 */
const CLAUDE_EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"];

/**
 * Explicit "this model takes no reasoning effort" policy value.
 *
 * A stage policy is `{model, reasoning}` and every code path expects a reasoning
 * value, so a model with no effort control needs a nameable level rather than an
 * empty one. `"none"` is that level: it validates like any other, and the Claude
 * provider omits `--effort` entirely when it is selected. No Codex model lists it,
 * so a Codex spawn can never receive it.
 */
export const NO_REASONING_EFFORT = "none";

const CLAUDE_MODELS = [
  claudeModel("claude-opus-5", "Claude Opus 5", "Deepest Claude coding model for planning and gates.", "xhigh", CLAUDE_EFFORT_LEVELS),
  claudeModel("claude-sonnet-5", "Claude Sonnet 5", "Balanced Claude coding model for everyday work.", "xhigh", CLAUDE_EFFORT_LEVELS),
  claudeModel("claude-fable-5", "Claude Fable 5", "Highest-capability Claude model at a premium rate.", "xhigh", CLAUDE_EFFORT_LEVELS),
  claudeModel("claude-haiku-4-5", "Claude Haiku 4.5", "Fast Claude model with no reasoning-effort control.", NO_REASONING_EFFORT, [NO_REASONING_EFFORT]),
];

export async function readClaudeModelCatalog() {
  return {
    models: structuredClone(CLAUDE_MODELS),
    fetchedAt: null,
    source: "Bundled Claude model catalog",
  };
}

/**
 * Every execution provider's models in one catalogue.
 *
 * Settings validation and task creation validate a policy's reasoning against its
 * model's own `reasoningLevels`, and those differ per model: `gpt-5.6-sol` has
 * `ultra`, Claude does not, and `claude-haiku-4-5` takes only `none`. Reading a
 * single provider's catalogue would leave the other's models with no levels at all,
 * so every reasoning value for them would be rejected.
 */
export async function readExecutionProviderCatalog() {
  const [codex, claude] = await Promise.all([readCodexModelCatalog(), readClaudeModelCatalog()]);
  const known = new Set(codex.models.map((model) => model.id));
  return {
    models: [...codex.models, ...claude.models.filter((model) => !known.has(model.id))],
    fetchedAt: codex.fetchedAt,
    source: `${codex.source} · ${claude.source}`,
  };
}

/**
 * Attribute a model id to an execution provider. An id no provider claims returns
 * `null` rather than being attributed to whichever provider happens to be default,
 * so a typo in persisted settings surfaces as unsupported instead of being routed
 * to the wrong CLI.
 */
export function providerForModelId(value) {
  const id = normalizeModelId(value);
  if (CLAUDE_MODEL_ID_SET.has(id) || id.startsWith("claude-")) return "claude";
  if (id.startsWith("gpt-")) return "codex";
  return null;
}

/**
 * Derive which execution provider a task's model selection implies.
 *
 * The provider follows from the models chosen, so picking `claude-opus-5` routes to
 * the Claude CLI without anyone having to name the provider separately — and an
 * explicit provider that contradicts the chosen models is rejected rather than
 * silently sending one runtime's model to the other's CLI.
 */
export function resolveTaskProvider(stagePolicies, fallbackModel, explicit = null) {
  if (explicit) return explicit;
  // Only a default, for policies whose model no provider claims. Stage policies may
  // freely mix providers — each stage runs on the runtime its own model belongs to —
  // so a mixed selection is the feature, not an inconsistency to reject.
  const providers = new Set(
    [...Object.values(stagePolicies ?? {}).map((policy) => policy?.model), fallbackModel]
      .filter(Boolean)
      .map(providerForModelId)
      .filter(Boolean),
  );
  return providers.size === 1 ? [...providers][0] : DEFAULT_EXECUTION_PROVIDER;
}

/**
 * Single source for the runtime default policy. The settings store and the Codex
 * runtime both resolve their defaults from here so runtime status, allowed models,
 * and spawned agents cannot advertise different models.
 */
export const DEFAULT_RUNTIME_MODEL = "claude-sonnet-5";
export const DEFAULT_RUNTIME_REASONING = "xhigh";

/** Codex's own default, which is not the global one and must not follow it. */
export const DEFAULT_CODEX_MODEL = "gpt-5.6-luna";

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

/**
 * Validate a reasoning level against a model's catalogue entry and return the
 * effort to spawn with, or `null` when the model takes none. An unsupported level
 * refuses rather than silently downgrading, mirroring the existing
 * `Unsupported Codex sandbox` throw.
 */
export function assertSupportedReasoning(modelId, reasoning, models = CLAUDE_MODELS) {
  const id = normalizeModelId(modelId);
  const entry = models.find((model) => model.id === id);
  if (!entry) throw new Error(`Unknown model for reasoning validation: ${id}`);
  const level = String(reasoning ?? "");
  if (!entry.reasoningLevels.includes(level)) {
    throw new Error(`${entry.label} does not support ${level || "that"} reasoning effort.`);
  }
  return level === NO_REASONING_EFFORT ? null : level;
}

export function defaultRuntimeSettings() {
  const defaultModel = normalizeModelId(process.env.AGENT_HARNESS_MODEL ?? DEFAULT_RUNTIME_MODEL);
  const defaultReasoning = process.env.AGENT_HARNESS_REASONING ?? DEFAULT_RUNTIME_REASONING;
  return {
    // Both providers' models are selectable, because a stage policy is validated
    // against this list and a Claude task's policies must name Claude models. The
    // selected provider, not this list, decides which runtime executes.
    allowedModels: [...new Set([defaultModel, "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", ...CLAUDE_MODEL_IDS])],
    defaultModel,
    defaultReasoning,
    // Nothing moves to another provider until an operator changes this.
    defaultProvider: providerForModelId(defaultModel) ?? DEFAULT_EXECUTION_PROVIDER,
    // Claude by default now that no stage needs network access (#47): the test stage was the
    // only one pinned to Codex, and it no longer runs commands itself. Sonnet for gathering and
    // execution, Opus wherever the Codex set used Sol — planning and every gate.
    stagePolicies: defaultStagePolicies(providerForModelId(defaultModel) ?? DEFAULT_EXECUTION_PROVIDER),
    pricing: {
      version: PRICING_VERSION,
      sourceUrl: PRICING_SOURCE_URL,
      verifiedAt: "2026-08-02T00:00:00.000Z",
      verifiedBy: "Bundled official API rate card",
      rates: structuredClone(MODEL_PRICING),
      creditRates: structuredClone(MODEL_CREDIT_RATES),
      creditSourceUrl: CREDIT_SOURCE_URL,
    },
  };
}

export function resolveAgentPolicy(task, policyId, fallbackSettings = defaultRuntimeSettings()) {
  const policy = task?.agentConfig?.stagePolicies?.[policyId] ?? fallbackSettings.stagePolicies?.[policyId];
  const model = normalizeModelId(policy?.model ?? task?.agentConfig?.model ?? fallbackSettings.defaultModel);
  return {
    // The provider follows this policy's own model, so each stage can run on whichever
    // runtime its model belongs to. A model no provider claims falls back to the task's
    // recorded provider, then the configured default — so a task persisted before
    // provider identity existed stays on Codex whatever the setting later becomes.
    provider: providerForModelId(model)
      ?? task?.agentConfig?.provider
      ?? fallbackSettings.defaultProvider
      ?? DEFAULT_EXECUTION_PROVIDER,
    model,
    reasoning: String(policy?.reasoning ?? task?.agentConfig?.reasoning ?? fallbackSettings.defaultReasoning),
  };
}

/**
 * Which stage policy governs a run of this kind. A reservation is per stage, but
 * `implement` is reached by two different policies — `implement` and `repair` — so the
 * kind decides which one owns the provider for that attempt.
 */
export function policyIdForRun(kind, stage) {
  if (kind === "repair") return "repair";
  if (kind === "implementation") return "implement";
  return stage;
}

export async function readCodexModelCatalog() {
  const codexRoot = process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
  const cachePath = path.join(codexRoot, "models_cache.json");
  try {
    const cache = JSON.parse(await readFile(cachePath, "utf8"));
    const models = (Array.isArray(cache.models) ? cache.models : [])
      .filter((entry) => entry?.visibility === "list" && entry?.slug)
      .map((entry) => ({
        id: String(entry.slug),
        label: String(entry.display_name ?? entry.slug).replace(/^GPT-([0-9.]+)-/i, "GPT-$1 "),
        description: String(entry.description ?? "Available through the installed Codex runtime."),
        provider: "codex",
        defaultReasoning: String(entry.default_reasoning_level ?? "medium"),
        reasoningLevels: (entry.supported_reasoning_levels ?? []).map((level) => String(level.effort)).filter(Boolean),
        pricing: MODEL_PRICING[entry.slug] ?? null,
        provenance: "discovered",
        availability: "discovered",
        editable: true,
      }));
    return {
      models: models.length ? models : FALLBACK_MODELS,
      fetchedAt: cache.fetched_at ?? null,
      source: "Codex local model cache",
    };
  } catch {
    return { models: FALLBACK_MODELS, fetchedAt: null, source: "Bundled fallback catalog" };
  }
}

export function withConfiguredModels(catalog, settings) {
  const configuredIds = new Set([
    settings?.defaultModel,
    ...(settings?.allowedModels ?? []),
    ...Object.values(settings?.stagePolicies ?? {}).map((policy) => policy?.model),
  ].filter(Boolean).map(normalizeModelId));
  // Keyed on availability, not provenance. "configured" means the runtime could not confirm the
  // model exists, and the downgrade to `editable: false` exists to stop an operator selecting one.
  // Claude entries are `provenance: "bundled"` with `availability: "discovered"` — bundled is how
  // the harness knows them, discovered is the claim that matters — so testing provenance
  // downgraded every Claude model the settings referenced, leaving them tickable in the allowlist
  // but absent from every policy dropdown.
  const models = (catalog?.models ?? []).map((entry) =>
    configuredIds.has(entry.id) && entry.availability !== "discovered"
      ? { ...entry, provenance: "configured", availability: "configured", editable: false }
      : entry,
  );
  const known = new Set(models.map((entry) => entry.id));
  for (const id of configuredIds) {
    if (known.has(id)) continue;
    models.push({
      id,
      label: id,
      description: "Configured in persisted settings but not reported by the local Codex model catalog.",
      // A configured id no provider claims stays unattributed rather than being
      // credited to whichever provider is currently selected.
      provider: providerForModelId(id),
      defaultReasoning: settings?.defaultReasoning ?? "medium",
      reasoningLevels: [],
      pricing: MODEL_PRICING[id] ?? null,
      provenance: "configured",
      availability: "unsupported",
      editable: false,
    });
  }
  return { ...(catalog ?? { fetchedAt: null, source: "Unavailable model catalog" }), models };
}

export function normalizeModelId(value) {
  let source = String(value ?? "").trim();
  const planIndex = source.toLowerCase().indexOf("chatgpt plan");
  if (planIndex >= 0) source = source.slice(0, planIndex).replace(/[\s\p{P}\p{S}]+$/gu, "");
  const normalized = source
    .trim()
    .toLowerCase()
    .replaceAll("_", "-")
    .replace(/\s+/g, "-");
  return normalized || DEFAULT_RUNTIME_MODEL;
}

export function priceUsage(modelId, usage, pricing = MODEL_PRICING) {
  const normalizedModel = normalizeModelId(modelId);
  const configured = pricing?.[normalizedModel] ?? MODEL_PRICING[normalizedModel];
  if (!configured) return null;
  const inputTokens = finite(usage?.inputTokens);
  const cachedInputTokens = Math.min(inputTokens, finite(usage?.cachedInputTokens));
  const cacheWriteTokens = finite(usage?.cacheWriteTokens);
  const outputTokens = finite(usage?.outputTokens);
  const selected = configured.long && inputTokens > 272_000 ? configured.long : configured.short;
  const uncachedInputTokens = Math.max(0, inputTokens - cachedInputTokens - cacheWriteTokens);
  return roundCurrency(
    (uncachedInputTokens * selected.input +
      cachedInputTokens * selected.cachedInput +
      cacheWriteTokens * (selected.cacheWrite ?? selected.input) +
      outputTokens * selected.output) /
      1_000_000,
  );
}

/**
 * Price a provider's per-model breakdown with the rate card.
 *
 * This is the correct cross-check against a reported total, and pricing the
 * aggregate as if it were all one model is not: a run reports usage for every model
 * it actually used, including ones the harness never asked for, so the single-model
 * estimate is systematically low and would flag a divergence on almost every run.
 * Returns null unless every entry could be priced, so a partial sum is never
 * compared against a complete total.
 */
export function priceModelUsage(modelUsage, pricing = MODEL_PRICING) {
  if (!modelUsage || typeof modelUsage !== "object" || Array.isArray(modelUsage)) return null;
  const entries = Object.entries(modelUsage);
  if (!entries.length) return null;
  let total = 0;
  for (const [id, entry] of entries) {
    const cachedInputTokens = finite(entry?.cacheReadInputTokens);
    const cacheWriteTokens = finite(entry?.cacheCreationInputTokens);
    const cost = priceUsage(entry?.canonicalModel ?? id, {
      inputTokens: finite(entry?.inputTokens) + cachedInputTokens + cacheWriteTokens,
      cachedInputTokens,
      cacheWriteTokens,
      outputTokens: finite(entry?.outputTokens),
    }, pricing);
    if (cost == null) return null;
    total += cost;
  }
  return roundCurrency(total);
}

/** Relative divergence beyond which a reported cost and the rate card disagree materially. */
export const COST_DIVERGENCE_TOLERANCE = 0.05;

/**
 * Compare a provider-reported cost against the bundled rate card. This is how the
 * harness notices the provider changing its prices: the card stays necessary for
 * pre-run estimation and the model picker, but it stops being the source of truth
 * once a run has reported its own accounting.
 */
export function costDivergence(reportedCost, estimatedCost) {
  if (!Number.isFinite(reportedCost) || !Number.isFinite(estimatedCost)) return null;
  const scale = Math.max(Math.abs(reportedCost), Math.abs(estimatedCost));
  if (scale === 0) return { reportedCost, estimatedCost, ratio: 0, material: false };
  const ratio = Math.abs(reportedCost - estimatedCost) / scale;
  return { reportedCost, estimatedCost, ratio, material: ratio > COST_DIVERGENCE_TOLERANCE };
}

/**
 * `options.reportedCost` is the provider's own accounting and takes precedence over
 * the rate card; `options.modelUsage` is its per-model breakdown. Both are also read
 * back off the persisted usage record, so re-enriching on boot cannot silently
 * replace a reported cost with an estimate.
 *
 * The extra fields are only present when a cost was actually reported, so a Codex
 * usage record keeps exactly the shape it has today.
 */
export function enrichUsage(modelId, usage, pricing, pricingVersion = PRICING_VERSION, options = {}) {
  const credits = priceCredits(modelId, usage);
  const reportedCost = firstFinite(options.reportedCost, usage?.reportedCost);
  const modelUsage = options.modelUsage ?? usage?.modelUsage ?? null;
  const estimatedCost = priceModelUsage(modelUsage, pricing) ?? priceUsage(modelId, usage, pricing);
  return {
    inputTokens: finite(usage?.inputTokens),
    cachedInputTokens: finite(usage?.cachedInputTokens),
    cacheWriteTokens: finite(usage?.cacheWriteTokens),
    outputTokens: finite(usage?.outputTokens),
    totalTokens: finite(usage?.totalTokens) || finite(usage?.inputTokens) + finite(usage?.outputTokens),
    cost: reportedCost ?? estimatedCost,
    credits,
    pricingVersion,
    ...(reportedCost == null
      ? {}
      : {
          reportedCost,
          estimatedCost,
          // Still the provider's API-equivalent computation, not money leaving an
          // account: the harness runs on a subscription.
          costBasis: "api-equivalent",
        }),
    ...(modelUsage ? { modelUsage: structuredClone(modelUsage) } : {}),
  };
}

export function priceCredits(modelId, usage, creditRates = MODEL_CREDIT_RATES) {
  const configured = creditRates?.[normalizeModelId(modelId)];
  if (!configured) return null;
  const inputTokens = finite(usage?.inputTokens);
  const cachedInputTokens = Math.min(inputTokens, finite(usage?.cachedInputTokens));
  const cacheWriteTokens = finite(usage?.cacheWriteTokens);
  const outputTokens = finite(usage?.outputTokens);
  const uncachedInputTokens = Math.max(0, inputTokens - cachedInputTokens - cacheWriteTokens);
  return roundCurrency(
    (uncachedInputTokens * configured.input +
      cachedInputTokens * configured.cachedInput +
      cacheWriteTokens * configured.input +
      outputTokens * configured.output) /
      1_000_000,
  );
}

export function validatePricingRates(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Pricing verification did not return a rate map.");
  const validated = {};
  for (const [modelId, entry] of Object.entries(value)) {
    const normalized = normalizeModelId(modelId);
    if (!MODEL_PRICING[normalized]) continue;
    const short = validateRate(entry?.short ?? entry);
    const long = entry?.long ? validateRate(entry.long) : MODEL_PRICING[normalized].long;
    validated[normalized] = { short, long: long ?? null };
  }
  if (!["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"].every((id) => validated[id])) {
    throw new Error("Pricing verification omitted one or more GPT-5.6 family rates.");
  }
  return validated;
}

function rate(input, cachedInput, cacheWrite, output, longInput, longCachedInput, longCacheWrite, longOutput) {
  return {
    short: { input, cachedInput, cacheWrite, output },
    long:
      longInput == null
        ? null
        : { input: longInput, cachedInput: longCachedInput, cacheWrite: longCacheWrite, output: longOutput },
  };
}

function model(id, label, description, defaultReasoning, reasoningLevels) {
  return {
    id,
    label,
    description,
    provider: "codex",
    defaultReasoning,
    reasoningLevels,
    pricing: MODEL_PRICING[id] ?? null,
    provenance: "bundled-fallback",
    availability: "unsupported",
    editable: false,
  };
}

function claudeModel(id, label, description, defaultReasoning, reasoningLevels) {
  return {
    id,
    label,
    description,
    provider: "claude",
    defaultReasoning,
    reasoningLevels: [...reasoningLevels],
    pricing: MODEL_PRICING[id] ?? null,
    provenance: "bundled",
    availability: "discovered",
    editable: true,
  };
}

function validateRate(entry) {
  const validated = {
    input: Number(entry?.input),
    cachedInput: Number(entry?.cachedInput),
    cacheWrite: entry?.cacheWrite == null ? null : Number(entry.cacheWrite),
    output: Number(entry?.output),
  };
  if (![validated.input, validated.cachedInput, validated.output].every((number) => Number.isFinite(number) && number >= 0)) {
    throw new Error("Pricing verification returned an invalid token rate.");
  }
  if (validated.cacheWrite != null && (!Number.isFinite(validated.cacheWrite) || validated.cacheWrite < 0)) {
    throw new Error("Pricing verification returned an invalid cache-write rate.");
  }
  return validated;
}

function finite(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function firstFinite(...values) {
  for (const value of values) {
    if (value == null) continue;
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0) return number;
  }
  return null;
}

function roundCurrency(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
