import type { RuntimeStatus } from "../../domain";
import type { ResearchRole } from "../../domain/research";
import {
  DEFAULT_RESEARCH_POLICIES,
  OPENCODE_RESEARCH_MODELS,
  RESEARCH_ENGINES,
  RESEARCH_ROLE_IDS,
  type ResearchEngineId,
  type RuntimeResearchPolicies,
} from "../../research-policies";
import { selectableModels } from "../runtime/policies";
import { PolicyChoice } from "./PolicyMatrix";

/** The model a newly chosen engine starts on, when the operator's allowlist offers it. */
const ENGINE_DEFAULTS: Record<ResearchEngineId, { model: string; reasoning: string }> = {
  "claude-cli": { model: "claude-opus-5-5", reasoning: "high" },
  "codex-cli": { model: "gpt-6-sol", reasoning: "high" },
  "opencode-cli": { model: "opencode-go/deepseek-v4.1-flash", reasoning: "default" },
};

/** OpenCode's models are research-only and not in the runtime's delivery catalogue. */
const isOpenCode = (runtime: ResearchEngineId) => RESEARCH_ENGINES[runtime].provider === "opencode";

const ROLE_COPY: Record<ResearchRole, { label: string; detail: string }> = {
  planner: { label: "Planner", detail: "Surveys the QV catalogue; no web access" },
  researcher: { label: "Researcher", detail: "Prices each component from QV, then the web" },
  verifier: { label: "Verifier", detail: "Checks the researcher's citations" },
  synthesiser: { label: "Synthesiser", detail: "Writes the final cost band" },
};

/** Sign-in only. The provider's `detail` describes delivery-stage confinement, which a research
 *  run does not use, and the run itself refuses to start off the plan whatever this says. */
function signInLabel(provider: NonNullable<RuntimeStatus["providers"]>[number] | undefined) {
  if (!provider) return "Sign-in not reported by the runtime.";
  if (!provider.available) return `${provider.label} CLI not found.`;
  return provider.authenticated ? `${provider.label} is signed in.` : `${provider.label} is not signed in.`;
}

/**
 * Settings → Research agent. Research runs only: delivery tasks, their stage roles and design
 * generation never read any of this, and each research run copies it when it starts.
 */
export function ResearchSettings({
  value,
  status,
  busy,
  onChange,
}: {
  value: RuntimeResearchPolicies;
  status: RuntimeStatus;
  busy: boolean;
  onChange(value: RuntimeResearchPolicies): void;
}) {
  const agent = value.agent;
  const engine = RESEARCH_ENGINES[agent.runtime];
  function chooseEngine(runtime: ResearchEngineId) {
    if (runtime === agent.runtime) return;
    const provider = RESEARCH_ENGINES[runtime].provider;
    if (provider === "opencode") {
      onChange({ ...value, agent: { runtime, provider, ...ENGINE_DEFAULTS[runtime] } });
      return;
    }
    const offered = selectableModels(status, provider);
    const preferred = offered.find((model) => model.id === ENGINE_DEFAULTS[runtime].model) ?? offered[0];
    const reasoning =
      preferred && preferred.reasoningLevels.includes(ENGINE_DEFAULTS[runtime].reasoning)
        ? ENGINE_DEFAULTS[runtime].reasoning
        : (preferred?.defaultReasoning ?? ENGINE_DEFAULTS[runtime].reasoning);
    onChange({
      ...value,
      agent: {
        runtime,
        provider,
        model: preferred?.id ?? ENGINE_DEFAULTS[runtime].model,
        reasoning,
      },
    });
  }
  return (
    <>
      <section className="workflow-card">
        <h3>Research agent</h3>
        <p className="quiet">
          The engine and model that answer a research run. Delivery tasks, their workflow roles and design
          generation do not use these. Each research run records the choice it started with, so changing it
          here never alters a finished run.
        </p>
        <div className="design-policy-default">
          <h4 id="research-engine-label">Engine</h4>
          <div className="segmented-radio" role="radiogroup" aria-labelledby="research-engine-label">
            {(Object.keys(RESEARCH_ENGINES) as ResearchEngineId[]).map((id) => (
              <label key={id} className={agent.runtime === id ? "is-selected" : undefined}>
                <input
                  type="radio"
                  name="research-engine"
                  aria-label={`${RESEARCH_ENGINES[id].label} on the ${RESEARCH_ENGINES[id].plan}`}
                  checked={agent.runtime === id}
                  disabled={
                    busy ||
                    (!isOpenCode(id) &&
                      !selectableModels(status, RESEARCH_ENGINES[id].provider as "claude" | "codex").length)
                  }
                  onChange={() => chooseEngine(id)}
                />
                <span>{RESEARCH_ENGINES[id].label}</span>
              </label>
            ))}
          </div>
          <small>
            Runs on the operator's {engine.plan}, never on an API key.{" "}
            {isOpenCode(agent.runtime)
              ? "Each run checks the OpenCode Go sign-in when it starts."
              : signInLabel(status.providers?.find((provider) => provider.id === engine.provider))}
          </small>
        </div>
        <div className="design-policy-default">
          <h4>Model & reasoning</h4>
          <div className="policy-selects">
            {isOpenCode(agent.runtime) ? (
              <label>
                <span>Research agent</span>
                <select
                  aria-label="Research agent model"
                  value={agent.model}
                  disabled={busy}
                  onChange={(event) => onChange({ ...value, agent: { ...agent, model: event.target.value } })}
                >
                  {OPENCODE_RESEARCH_MODELS.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <PolicyChoice
                label="Research agent"
                provider={engine.provider as "claude" | "codex"}
                value={{ model: agent.model, reasoning: agent.reasoning }}
                status={status}
                disabled={busy}
                onChange={(policy) => onChange({ ...value, agent: { ...agent, ...policy } })}
              />
            )}
          </div>
          {isOpenCode(agent.runtime) ? (
            <small>
              Default: DeepSeek 4.1 Flash, which passed 7 of 13 eval questions against Claude Opus 5.5's 5, at
              about $0.09 a question. It sometimes prices an item that should have no price, so read Review
              answers. Dollar figures are API-rate estimates; the Go plan bills nothing per call.
            </small>
          ) : agent.runtime === "codex-cli" ? (
            <small>
              The recorded research results were produced by Claude Opus, so Codex has no baseline of its own
              yet. Token counts are real; dollar figures are API-rate estimates, because the ChatGPT plan
              bills nothing per call.
            </small>
          ) : (
            <small>Claude Opus 5.5 passed 5 of 13 eval questions, at about $2.99 a question.</small>
          )}
        </div>
      </section>
      <section className="workflow-card">
        <h3>Four-role comparison</h3>
        <p className="quiet">
          Only for the comparison runtime that splits a research run into planner, researcher, verifier and
          synthesiser. Every role runs on the Claude CLI.
        </p>
        <table className="policy-matrix">
          <thead>
            <tr>
              <th>Research role</th>
              <th>Model & reasoning</th>
            </tr>
          </thead>
          <tbody>
            {RESEARCH_ROLE_IDS.map((role) => {
              const policy = value.roles[role] ?? DEFAULT_RESEARCH_POLICIES.roles[role];
              return (
                <tr key={role}>
                  <th>
                    <strong>{ROLE_COPY[role].label}</strong>
                    <small>{ROLE_COPY[role].detail}</small>
                  </th>
                  <td>
                    <div className="policy-selects">
                      <PolicyChoice
                        label={`Research ${ROLE_COPY[role].label}`}
                        provider="claude"
                        value={{ model: policy.model, reasoning: policy.reasoning }}
                        status={status}
                        disabled={busy}
                        onChange={(next) =>
                          onChange({
                            ...value,
                            roles: { ...value.roles, [role]: { provider: "claude", ...next } },
                          })
                        }
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </>
  );
}
