import { ArrowRight, GearSix, WarningCircle } from "@phosphor-icons/react";
import { useState } from "react";
import type { RuntimeProject, RuntimeStatus } from "../../../domain";
import { researchPoliciesOf } from "../../../research-policies";
import { errorMessage } from "../../runtime/coordinator";
import {
  type ResearchEngineSnapshot,
  type ResearchGateway,
  type ResearchScopeDraft,
  researchEngineLabel,
  researchEnginePlan,
  scopedByLabel,
} from "../../runtime/research";
import { cleanScope, ResearchScopeEditor } from "./ResearchScope";

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
  const [runs, setRuns] = useState<1 | 3 | 5>(5);
  const [busy, setBusy] = useState<"scoping" | "asking" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // The draft scope, once drafted. Editing the question drops it: a scope answers one question.
  const [draft, setDraft] = useState<ResearchScopeDraft | null>(null);
  const [scopeFailed, setScopeFailed] = useState(false);
  const engine = researchEngineFromSettings(status);
  async function scopeIt() {
    if (!research) return;
    setBusy("scoping");
    setProblem(null);
    try {
      setDraft(await research.scope(project.id, objective));
      setScopeFailed(false);
    } catch (reason) {
      setProblem(errorMessage(reason));
      setScopeFailed(true);
    } finally {
      setBusy(null);
    }
  }
  async function submit(withScope: boolean) {
    if (!research) return;
    setBusy("asking");
    setProblem(null);
    try {
      const question = await research.ask(project.id, {
        objective,
        runs,
        engine,
        ...(withScope && draft ? { scope: cleanScope(draft.scope), scopedBy: draft.scopedBy } : {}),
      });
      onAsked(question.id);
    } catch (reason) {
      setProblem(errorMessage(reason));
    } finally {
      setBusy(null);
    }
  }
  const ready = Boolean(connected && research && objective.trim().length >= 12 && !busy);
  return (
    <>
      <div className="overlay-body research-ask">
        <form
          id="research-ask-form"
          className="form-surface"
          onSubmit={(event) => {
            event.preventDefault();
            void (draft ? submit(true) : scopeIt());
          }}
        >
          <label className="form-row research-ask-question">
            <span>Question</span>
            <textarea
              required
              rows={5}
              value={objective}
              onChange={(event) => {
                setObjective(event.target.value);
                setDraft(null);
              }}
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
                onClick={() => {
                  setObjective(example);
                  setDraft(null);
                }}
              >
                {example}
              </button>
            ))}
          </div>
          {draft && (
            <>
              <p className="quiet research-scope-origin">
                {scopedByLabel(draft.scopedBy)}. Correct anything it got wrong before asking.
              </p>
              <ResearchScopeEditor scope={draft.scope} onChange={(scope) => setDraft({ ...draft, scope })} />
            </>
          )}
          <fieldset className="research-ask-runs">
            <legend>Runs</legend>
            <label className={runs === 5 ? "is-selected" : undefined}>
              <input type="radio" name="research-runs" checked={runs === 5} onChange={() => setRuns(5)} />
              <span>
                <strong>Five runs</strong>
                <small>
                  Recommended. The three that agree best are compared, so one or two stray runs cannot split
                  the answer.
                </small>
              </span>
            </label>
            <label className={runs === 3 ? "is-selected" : undefined}>
              <input type="radio" name="research-runs" checked={runs === 3} onChange={() => setRuns(3)} />
              <span>
                <strong>Three runs</strong>
                <small>Cheaper. Agreement between independent runs is the only check on the band.</small>
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
          <p>
            First the question is scoped: one fast model call, no research, that pins what is priced and in
            which measure. Every run is then given the same scope, so their bands can be compared.
          </p>
          {research?.mode === "live" ? (
            <p className="sample-note">
              Scoping calls GPT-6 Luna on your ChatGPT plan and starts nothing. Asking starts{" "}
              {runs === 5 ? "five runs" : runs === 3 ? "three runs" : "one run"} on your plan with the engine
              shown. Three Claude runs measured about 2½ minutes and $4–5 of plan usage.
            </p>
          ) : (
            <p className="sample-note">
              Prototype: asking adds the question to this tab only. Nothing is sent to a model.
            </p>
          )}
        </aside>
      </div>
      <footer className="overlay-footer">
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        {scopeFailed && !draft && (
          <button type="button" disabled={!ready} onClick={() => void submit(false)}>
            Ask without a scope
          </button>
        )}
        <button type="submit" form="research-ask-form" className="primary" disabled={!ready}>
          {busy === "scoping"
            ? "Scoping…"
            : busy === "asking"
              ? "Asking…"
              : !draft
                ? "Scope it"
                : runs === 5
                  ? "Ask · five runs"
                  : runs === 3
                    ? "Ask · three runs"
                    : "Ask · one quick run"}
          <ArrowRight size={19} />
        </button>
      </footer>
    </>
  );
}
