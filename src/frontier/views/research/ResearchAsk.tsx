import { ArrowRight, GearSix, WarningCircle } from "@phosphor-icons/react";
import { useState } from "react";
import type { RuntimeProject, RuntimeStatus } from "../../../domain";
import { researchPoliciesOf } from "../../../research-policies";
import { errorMessage } from "../../runtime/coordinator";
import {
  type ResearchEngineSnapshot,
  type ResearchGateway,
  researchEngineLabel,
  researchEnginePlan,
} from "../../runtime/research";

/** Worked questions from the recorded ask feed (`18c-ask-feed.json`). */
const examples = [
  "How come you couldn't price the asbestos soffit removal on our tender? What does that actually cost?",
  "Our tender flagged liquefaction-prone ground. What does ground improvement cost for a single-storey light commercial building in Christchurch?",
  "Client wants to know the cost impact of switching the roof from long-run coloursteel to a membrane on a 1200m2 warehouse.",
];

export function researchEngineFromSettings(status: RuntimeStatus | null): ResearchEngineSnapshot {
  const agent = researchPoliciesOf(status?.settings ?? null).agent;
  return { runtime: agent.runtime, model: agent.model, reasoning: agent.reasoning };
}

export function ResearchAsk({
  project,
  research,
  status,
  connected,
  onAsked,
  onSettings,
  onClose,
}: {
  project: RuntimeProject;
  research: ResearchGateway | undefined;
  status: RuntimeStatus | null;
  connected: boolean;
  onAsked(questionId: string): void;
  onSettings(): void;
  onClose(): void;
}) {
  const [objective, setObjective] = useState("");
  const [runs, setRuns] = useState<1 | 3>(3);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const engine = researchEngineFromSettings(status);
  async function submit() {
    if (!research) return;
    setBusy(true);
    setProblem(null);
    try {
      const question = await research.ask(project.id, { objective, runs, engine });
      onAsked(question.id);
    } catch (reason) {
      setProblem(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="overlay-body research-ask">
        <form
          id="research-ask-form"
          className="form-surface"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label className="form-row research-ask-question">
            <span>Question</span>
            <textarea
              required
              rows={5}
              value={objective}
              onChange={(event) => setObjective(event.target.value)}
              placeholder={examples[0]}
            />
          </label>
          <div className="research-ask-examples">
            <small>Examples from the recorded asks</small>
            {examples.map((example) => (
              <button
                type="button"
                key={example}
                className="link-button"
                onClick={() => setObjective(example)}
              >
                {example}
              </button>
            ))}
          </div>
          <fieldset className="research-ask-runs">
            <legend>Runs</legend>
            <label className={runs === 3 ? "is-selected" : undefined}>
              <input type="radio" name="research-runs" checked={runs === 3} onChange={() => setRuns(3)} />
              <span>
                <strong>Three runs</strong>
                <small>Recommended. Agreement between independent runs is the only check on the band.</small>
              </span>
            </label>
            <label className={runs === 1 ? "is-selected" : undefined}>
              <input type="radio" name="research-runs" checked={runs === 1} onChange={() => setRuns(1)} />
              <span>
                <strong>Quick · one run</strong>
                <small>
                  <WarningCircle size={15} /> Unverified: one run cannot show whether the band would hold up.
                </small>
              </span>
            </label>
          </fieldset>
          <section className="research-ask-engine" aria-label="Research engine">
            <div>
              <small>Engine, from Settings → Research agent</small>
              <strong>{researchEngineLabel(engine)}</strong>
              <span className="quiet">{researchEnginePlan(engine)}, never an API key</span>
            </div>
            <button type="button" onClick={onSettings}>
              <GearSix size={18} />
              Change
            </button>
          </section>
          {problem && (
            <p role="alert" className="form-error">
              {problem}
            </p>
          )}
        </form>
        <aside className="mission-briefing research-ask-aside">
          <h2>{project.name}</h2>
          <p>
            Each run researches the question on its own: QV CostBuilder first, then the web for what QV does
            not publish. Every figure is marked by how it was checked.
          </p>
          <p className="sample-note">
            {research?.live
              ? "Asking starts real runs on the selected subscription engine. Their results and review are saved in this project."
              : "Prototype: asking adds the question to this tab only. Nothing is sent to a model."}
          </p>
        </aside>
      </div>
      <footer className="overlay-footer">
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button
          type="submit"
          form="research-ask-form"
          className="primary"
          disabled={busy || !connected || !research || objective.trim().length < 12}
        >
          {busy ? "Asking…" : runs === 3 ? "Ask · three runs" : "Ask · one quick run"}
          <ArrowRight size={19} />
        </button>
      </footer>
    </>
  );
}
