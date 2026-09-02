import type { RuntimeDesignPolicies, RuntimeModelOption } from "../domain";
import { DesignPolicyEditor } from "./DesignPolicyEditor";

export function SettingsDesignPolicies({
  value,
  models,
  allowedModels,
  disabled,
  onChange,
}: {
  value: RuntimeDesignPolicies | null;
  models: RuntimeModelOption[];
  allowedModels: string[];
  disabled: boolean;
  onChange: (value: RuntimeDesignPolicies) => void;
}) {
  return (
    <div className="settings-design-policy">
      <span>
        <h4>Design generation</h4>
        <p>
          New design requests snapshot one policy per provider. Retries keep that snapshot and never
          substitute another model.
        </p>
      </span>
      {value ? (
        <div className="settings-design-policy__grid">
          <DesignPolicyEditor
            label="Claude Design"
            provider="claude"
            value={value["claude-design"]}
            models={models}
            allowedModels={allowedModels}
            idPrefix="settings-claude-design"
            disabled={disabled}
            onChange={(policy) => onChange({ ...value, "claude-design": policy })}
          />
          <DesignPolicyEditor
            label="Codex Design"
            provider="codex"
            value={value["codex-design"]}
            models={models}
            allowedModels={allowedModels}
            idPrefix="settings-codex-design"
            disabled={disabled}
            onChange={(policy) => onChange({ ...value, "codex-design": policy })}
          />
        </div>
      ) : (
        <p className="dialog-error" role="alert">
          Design model defaults are unavailable.
        </p>
      )}
    </div>
  );
}
