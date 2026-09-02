import type { RuntimeDesignPolicy, RuntimeModelOption } from "../domain";

export function isDesignPolicyValid(
  policy: RuntimeDesignPolicy | undefined,
  provider: "claude" | "codex",
  models: RuntimeModelOption[],
  allowedModels: string[],
) {
  const model = models.find((entry) => entry.id === policy?.model);
  return Boolean(
    policy &&
      policy.provider === provider &&
      policy.reasoning &&
      model?.editable &&
      model.provider === provider &&
      allowedModels.includes(model.id) &&
      model.reasoningLevels.includes(policy.reasoning),
  );
}

export function DesignPolicyEditor({
  label,
  provider,
  value,
  models,
  allowedModels,
  onChange,
  disabled = false,
  idPrefix,
}: {
  label: string;
  provider: "claude" | "codex";
  value: RuntimeDesignPolicy;
  models: RuntimeModelOption[];
  allowedModels: string[];
  onChange: (policy: RuntimeDesignPolicy) => void;
  disabled?: boolean;
  idPrefix: string;
}) {
  const eligibleModels = models.filter(
    (model) => model.provider === provider && allowedModels.includes(model.id) && model.editable,
  );
  const selectedModel = models.find((model) => model.id === value.model);
  const valid = isDesignPolicyValid(value, provider, models, allowedModels);
  const updateModel = (modelId: string) => {
    const nextModel = eligibleModels.find((model) => model.id === modelId);
    if (!nextModel) return;
    onChange({
      provider,
      model: nextModel.id,
      reasoning: nextModel.reasoningLevels.includes(value.reasoning ?? "")
        ? value.reasoning
        : nextModel.defaultReasoning,
    });
  };

  return (
    <fieldset className={`design-policy-editor ${valid ? "" : "design-policy-editor--invalid"}`}>
      <legend>{label}</legend>
      <label htmlFor={`${idPrefix}-model`}>
        Model
        <select
          id={`${idPrefix}-model`}
          value={value.model}
          disabled={disabled || !eligibleModels.length}
          onChange={(event) => updateModel(event.target.value)}
        >
          {!eligibleModels.some((model) => model.id === value.model) ? (
            <option value={value.model}>{selectedModel?.label ?? value.model} — unavailable</option>
          ) : null}
          {eligibleModels.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor={`${idPrefix}-reasoning`}>
        Reasoning
        <select
          id={`${idPrefix}-reasoning`}
          value={value.reasoning ?? ""}
          disabled={disabled || !selectedModel || !eligibleModels.some((model) => model.id === value.model)}
          onChange={(event) => onChange({ ...value, reasoning: event.target.value })}
        >
          {(selectedModel?.reasoningLevels ?? []).map((level) => (
            <option key={level} value={level}>
              {formatReasoning(level)}
            </option>
          ))}
        </select>
      </label>
      <small className={valid ? "design-policy-editor__status" : "design-policy-editor__error"}>
        {valid
          ? `Source: ${selectedModel?.provenance.replace("-", " ")} · Availability: ${selectedModel?.availability}`
          : `${selectedModel?.label ?? value.model} is not an eligible ${label} model. Choose an allowed, discovered model and supported reasoning level.`}
      </small>
    </fieldset>
  );
}

function formatReasoning(reasoning: string) {
  if (reasoning.toLowerCase() === "xhigh") return "XHigh";
  return reasoning.charAt(0).toUpperCase() + reasoning.slice(1);
}
