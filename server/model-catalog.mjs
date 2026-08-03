import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

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
};

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

export function defaultStagePolicies() {
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

export function defaultRuntimeSettings() {
  const defaultModel = normalizeModelId(process.env.AGENT_HARNESS_MODEL ?? "gpt-5.6-luna");
  const defaultReasoning = process.env.AGENT_HARNESS_REASONING ?? "xhigh";
  return {
    allowedModels: [...new Set([defaultModel, "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"])],
    defaultModel,
    defaultReasoning,
    stagePolicies: defaultStagePolicies(),
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
  return {
    model: normalizeModelId(policy?.model ?? task?.agentConfig?.model ?? fallbackSettings.defaultModel),
    reasoning: String(policy?.reasoning ?? task?.agentConfig?.reasoning ?? fallbackSettings.defaultReasoning),
  };
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
  const models = (catalog?.models ?? []).map((entry) =>
    configuredIds.has(entry.id) && entry.provenance !== "discovered"
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
  return normalized || "gpt-5.4-mini";
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

export function enrichUsage(modelId, usage, pricing, pricingVersion = PRICING_VERSION) {
  const credits = priceCredits(modelId, usage);
  return {
    inputTokens: finite(usage?.inputTokens),
    cachedInputTokens: finite(usage?.cachedInputTokens),
    cacheWriteTokens: finite(usage?.cacheWriteTokens),
    outputTokens: finite(usage?.outputTokens),
    totalTokens: finite(usage?.totalTokens) || finite(usage?.inputTokens) + finite(usage?.outputTokens),
    cost: priceUsage(modelId, usage, pricing),
    credits,
    pricingVersion,
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
    defaultReasoning,
    reasoningLevels,
    pricing: MODEL_PRICING[id] ?? null,
    provenance: "bundled-fallback",
    availability: "unsupported",
    editable: false,
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

function roundCurrency(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
