import { normalizeModelId, providerForModelId } from "./model-catalog.mjs";

export const DESIGN_GENERATOR_PROVIDERS = Object.freeze({
  "claude-design": "claude",
  "codex-design": "codex",
});

export function validateDesignPolicies(input, knownModels, allowedModels, fallbackPolicies) {
  const source = input ?? fallbackPolicies;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error("Choose one Claude Design policy and one Codex Design policy.");
  }
  const unexpected = Object.keys(source).filter((key) => !(key in DESIGN_GENERATOR_PROVIDERS));
  if (unexpected.length) throw new Error(`Unsupported design generator: ${unexpected.join(", ")}.`);

  return Object.fromEntries(
    Object.entries(DESIGN_GENERATOR_PROVIDERS).map(([generator, expectedProvider]) => {
      const policy = source[generator];
      if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
        throw new Error(`Choose a model for ${generator}.`);
      }
      if (policy.provider !== expectedProvider) {
        throw new Error(`${generator} requires a ${expectedProvider} model.`);
      }
      const modelId = normalizeModelId(policy.model);
      const model = knownModels.get(modelId);
      if (!model || !allowedModels.includes(modelId)) {
        throw new Error(`${generator} model ${modelId || "is missing"} is not available in Settings.`);
      }
      if ((model.provider ?? providerForModelId(modelId)) !== expectedProvider) {
        throw new Error(`${generator} cannot run model ${modelId}; it belongs to another provider.`);
      }
      const reasoning = String(policy.reasoning ?? "");
      if (!model.reasoningLevels.includes(reasoning)) {
        throw new Error(`${model.label} does not support ${reasoning || "that"} reasoning.`);
      }
      return [generator, { provider: expectedProvider, model: modelId, reasoning }];
    }),
  );
}
