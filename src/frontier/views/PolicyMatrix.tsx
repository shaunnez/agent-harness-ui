import { ArrowCounterClockwise } from "@phosphor-icons/react";
import type { RolePolicyId, RuntimeAgentPolicy, RuntimeStatus } from "../../domain";
import { policyRoles, selectableModels } from "../runtime/policies";
import { modelLabel, reasoningLabel } from "../runtime/presentation";

export function PolicyChoice({
  label,
  value,
  status,
  provider,
  disabled,
  onChange,
}: {
  label: string;
  value: RuntimeAgentPolicy;
  status: RuntimeStatus | null;
  provider?: "codex" | "claude";
  disabled?: boolean;
  onChange(value: RuntimeAgentPolicy): void;
}) {
  const models = selectableModels(status, provider);
  const selected = models.find((model) => model.id === value.model);
  return (
    <>
      <select
        aria-label={`${label} model`}
        value={value.model}
        disabled={disabled || !models.length}
        onChange={(event) => {
          const model = models.find((item) => item.id === event.target.value);
          if (model)
            onChange({
              model: model.id,
              reasoning: model.reasoningLevels.includes(value.reasoning)
                ? value.reasoning
                : model.defaultReasoning,
            });
        }}
      >
        {!selected && <option value={value.model}>{modelLabel(value.model)} · unavailable</option>}
        {provider
          ? models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))
          : providerGroups(models).map(([group, entries]) => (
              <optgroup key={group} label={group === "claude" ? "Claude" : "Codex"}>
                {entries.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </optgroup>
            ))}
      </select>
      <select
        aria-label={`${label} reasoning`}
        value={value.reasoning}
        disabled={disabled || !selected}
        onChange={(event) => onChange({ ...value, reasoning: event.target.value })}
      >
        {!selected?.reasoningLevels.includes(value.reasoning) && (
          <option value={value.reasoning}>{reasoningLabel(value.reasoning)}</option>
        )}
        {selected?.reasoningLevels.map((level) => (
          <option key={level} value={level}>
            {reasoningLabel(level)}
          </option>
        ))}
      </select>
    </>
  );
}

/**
 * Group a mixed-provider model list so one flat dropdown of Codex and Claude ids
 * still reads as two catalogues. Codex leads because it is the default provider.
 */
function providerGroups(models: ReturnType<typeof selectableModels>) {
  const groups: Array<["codex" | "claude", ReturnType<typeof selectableModels>]> = [
    ["codex", models.filter((model) => model.provider !== "claude")],
    ["claude", models.filter((model) => model.provider === "claude")],
  ];
  return groups.filter(([, entries]) => entries.length);
}

/**
 * One-click provider presets. Each applies that provider's recommended per-role
 * matrix rather than pinning every role to a single model, so the cheap roles stay
 * cheap and planning and review keep the deeper model.
 */
export function ProviderPresets({
  status,
  disabled,
  onUseProvider,
}: {
  status: RuntimeStatus | null;
  disabled?: boolean;
  onUseProvider(provider: "codex" | "claude"): void;
}) {
  return (
    <div className="policy-presets">
      <span>Apply a provider preset</span>
      {(["codex", "claude"] as const).map((provider) => (
        <button
          key={provider}
          type="button"
          className="text-button"
          disabled={disabled || !selectableModels(status, provider).length}
          onClick={() => onUseProvider(provider)}
        >
          {provider === "codex" ? "Use all Codex" : "Use all Claude"}
        </button>
      ))}
    </div>
  );
}

export function PolicyMatrix({
  policies,
  overrides,
  status,
  readOnly,
  onChange,
  onReset,
  onUseProvider,
}: {
  policies: Record<string, RuntimeAgentPolicy>;
  overrides?: Partial<Record<RolePolicyId, RuntimeAgentPolicy>>;
  status: RuntimeStatus | null;
  readOnly?: boolean;
  onChange(role: RolePolicyId, policy: RuntimeAgentPolicy): void;
  onReset(role: RolePolicyId): void;
  onUseProvider?(provider: "codex" | "claude"): void;
}) {
  return (
    <div className="policy-matrix-scroll">
      {!readOnly && onUseProvider && <ProviderPresets status={status} onUseProvider={onUseProvider} />}
      <table className="policy-matrix">
        <thead>
          <tr>
            <th>Stage / role</th>
            <th>Model</th>
            <th>Reasoning</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {policyRoles.map((role) => {
            const policy = policies[role.id];
            return (
              <tr key={role.id}>
                <th>
                  <strong>{role.label}</strong>
                  <small>{role.skill}</small>
                </th>
                {policy ? (
                  <>
                    {readOnly ? (
                      <>
                        <td>{modelLabel(policy.model)}</td>
                        <td>{reasoningLabel(policy.reasoning)}</td>
                      </>
                    ) : (
                      <td colSpan={2}>
                        <div className="policy-selects">
                          <PolicyChoice
                            label={role.label}
                            value={policy}
                            status={status}
                            onChange={(value) => onChange(role.id, value)}
                          />
                        </div>
                      </td>
                    )}
                    <td>
                      <span>{overrides?.[role.id] ? "Task override" : "Inherited"}</span>
                      {overrides?.[role.id] && !readOnly && (
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={`Reset ${role.label} to inherited policy`}
                          onClick={() => onReset(role.id)}
                        >
                          <ArrowCounterClockwise size={17} />
                        </button>
                      )}
                    </td>
                  </>
                ) : (
                  <td colSpan={3}>Policy unavailable</td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
