import { ArrowCounterClockwise } from "@phosphor-icons/react";
import type { RuntimeAgentPolicy, RuntimeModelOption } from "../domain";
import { Button } from "./Primitives";

export function AgentPolicyEditor({
  value,
  globalDefault,
  models,
  allowedModels,
  onChange,
  onReset,
  disabled = false,
  idPrefix,
}: {
  value: RuntimeAgentPolicy;
  globalDefault?: RuntimeAgentPolicy;
  models: RuntimeModelOption[];
  allowedModels: string[];
  onChange: (policy: RuntimeAgentPolicy) => void;
  onReset?: () => void;
  disabled?: boolean;
  idPrefix: string;
}) {
  const availableModels = models.filter((model) => allowedModels.includes(model.id));
  const selectedModel = availableModels.find((model) => model.id === value.model);
  const isGlobalDefault = Boolean(globalDefault && value.model === globalDefault.model && value.reasoning === globalDefault.reasoning);
  const updateModel = (modelId: string) => {
    const nextModel = availableModels.find((model) => model.id === modelId);
    onChange({
      model: modelId,
      reasoning: nextModel?.reasoningLevels.includes(value.reasoning)
        ? value.reasoning
        : nextModel?.defaultReasoning ?? value.reasoning,
    });
  };
  return (
    <div className="agent-policy-editor">
      <label htmlFor={`${idPrefix}-model`}>
        Model
        <select
          id={`${idPrefix}-model`}
          value={value.model}
          disabled={disabled || !availableModels.length}
          onChange={(event) => updateModel(event.target.value)}
        >
          {availableModels.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
        </select>
      </label>
      <label htmlFor={`${idPrefix}-reasoning`}>
        Reasoning
        <select
          id={`${idPrefix}-reasoning`}
          value={value.reasoning}
          disabled={disabled || !selectedModel}
          onChange={(event) => onChange({ ...value, reasoning: event.target.value })}
        >
          {(selectedModel?.reasoningLevels ?? [value.reasoning]).map((level) => <option key={level} value={level}>{level}</option>)}
        </select>
      </label>
      {onReset ? (
        <Button
          type="button"
          tone="ghost"
          compact
          icon={ArrowCounterClockwise}
          disabled={disabled || isGlobalDefault}
          onClick={onReset}
          title={isGlobalDefault ? "This policy already matches the global default." : "Stage the global default in this editor."}
        >
          Reset to global default
        </Button>
      ) : null}
    </div>
  );
}
