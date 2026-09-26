import {
  API_LOOP_RESEARCH_MODELS,
  type RuntimeResearchPolicies,
} from "../../../server/research/engine/contracts/policies.ts";

/**
 * Settings → Research agent. Research runs only: delivery tasks, their stage roles and design
 * generation never read any of this, and each research run copies it when it starts.
 *
 * One engine, the API loop (Shaun, 26 September 2026), so the only choice is where DeepSeek is
 * served from.
 */
export function ResearchSettings({
  value,
  busy,
  onChange,
}: {
  value: RuntimeResearchPolicies;
  busy: boolean;
  onChange(value: RuntimeResearchPolicies): void;
}) {
  const agent = value.agent;
  return (
    <section className="workflow-card">
      <h3>Research agent</h3>
      <p className="quiet">
        The model that answers a research run. Delivery tasks, their workflow roles and design generation do
        not use this. Each research run records the choice it started with, so changing it here never alters a
        finished run.
      </p>
      <div className="design-policy-default">
        <h4>Engine</h4>
        <p>API loop</p>
        <small>
          No CLI: the companion calls the model's API with a key from its own environment (OPENCODE_API_KEY,
          FIREWORKS_API_KEY or BASETEN_API_KEY for the model, and PARALLEL_API_KEY for web search). A run
          without its keys fails before it starts and can be retried once they are set.
        </small>
      </div>
      <div className="design-policy-default">
        <h4>Model</h4>
        <div className="policy-selects">
          <label>
            <span>Research agent</span>
            <select
              aria-label="Research agent model"
              value={agent.model}
              disabled={busy}
              onChange={(event) => onChange({ agent: { ...agent, model: event.target.value } })}
            >
              {API_LOOP_RESEARCH_MODELS.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <small>
          DeepSeek 4.1 Flash with the host checking each answer before accepting it. It passed 10 of 15
          held-out eval questions against Claude Opus 5.5's 5, at about $0.15 a question on OpenCode Go.
          Fireworks' US-only endpoint serves the same model only from the US, at about three times the price.
          Dollar figures are API-rate estimates.
        </small>
      </div>
    </section>
  );
}
