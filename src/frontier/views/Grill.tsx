import { ArrowRight, CheckCircle, FileText, Question, Robot } from "@phosphor-icons/react";
import { useState } from "react";
import type { RuntimeRun } from "../../domain";
import type { TaskCore } from "../runtime/contracts";
import { modelLabel, reasoningLabel } from "../runtime/presentation";

export interface GrillProps {
  task: TaskCore;
  busy: boolean;
  error: string | null;
  connected: boolean;
  onAnswer(questionId: string, answer: string): void;
  onFinish(acceptRemaining?: boolean): void;
  onArtifact(id: string): void;
  answers: Record<string, string>;
  onDraft(key: string, value: string): void;
}

export function Grill({
  task,
  busy,
  error,
  connected,
  onAnswer,
  onFinish,
  onArtifact,
  answers,
  onDraft,
  embedded = false,
  run,
}: GrillProps & { embedded?: boolean; run?: RuntimeRun }) {
  const questions = task.grillSession?.questions ?? [];
  const question = questions.find((item) => !item.answer);
  const draftKey = `${task.id}:${question?.id ?? ""}`;
  const value = answers[draftKey] ?? "";
  return (
    <>
      <div className={embedded ? "workspace-grill workflow-card" : "overlay-body grill-layout"}>
        <section>
          <header className="grill-title panel-heading">
            <Question size={34} />
            <div>
              <small>{task.id} · Grill</small>
              <h2>
                {question
                  ? `Question ${questions.indexOf(question) + 1} of ${questions.length}`
                  : "Decisions recorded"}
              </h2>
            </div>
            <span>
              {questions.filter((item) => item.answer).length} of {questions.length} answered
            </span>
          </header>
          {question ? (
            <>
              <div className="grill-agent-intro">
                <img src="/assets/mf.worker.standard.portrait.r1.png" alt="Grill reviewer role" />
                <div>
                  <strong>
                    <Robot size={18} /> Decision room
                  </strong>
                  <small>
                    {run
                      ? `${modelLabel(run.model)} · ${reasoningLabel(run.reasoning)} · ${run.status}`
                      : "No reviewer run loaded"}
                  </small>
                  <small>
                    {questions.filter((item) => item.answer).length} of {questions.length} answered ·{" "}
                    {task.grillPolicy ?? "manual"} policy
                  </small>
                </div>
              </div>
              <h2 className="question-copy">{question.question}</h2>
              <section className="repository-evidence">
                <h3>Repository evidence</h3>
                <p>{question.whyItMatters}</p>
                {task.artifacts
                  .filter((artifact) => ["triage", "scouts", "grill"].includes(artifact.stage))
                  .map((artifact) => (
                    <button
                      type="button"
                      className="text-row"
                      key={artifact.id}
                      onClick={() => onArtifact(artifact.id)}
                    >
                      <FileText size={18} />
                      {artifact.name}
                      <ArrowRight size={18} />
                    </button>
                  ))}
              </section>
              <fieldset
                className="answer-options"
                disabled={busy || !connected || task.status !== "awaiting-grill"}
              >
                <legend>Your answer</legend>
                {question.options.map((option) => (
                  <label className={value === option.label ? "selected" : ""} key={option.id}>
                    <input
                      type="radio"
                      name={`answer-${question.id}`}
                      checked={value === option.label}
                      onChange={() => onDraft(draftKey, option.label)}
                    />
                    <span>
                      <strong>
                        {option.label}
                        {option.recommended && <em> Recommended</em>}
                      </strong>
                      <small>{option.description}</small>
                    </span>
                  </label>
                ))}
              </fieldset>
              {question.allowCustom && (
                <label className="custom-answer">
                  Or write your answer
                  <textarea
                    rows={3}
                    disabled={busy || !connected || task.status !== "awaiting-grill"}
                    maxLength={5000}
                    value={question.options.some((option) => option.label === value) ? "" : value}
                    onChange={(event) => onDraft(draftKey, event.target.value)}
                    placeholder="Add the decision that fits this task"
                  />
                </label>
              )}
            </>
          ) : (
            <p>All questions have answers. Continue to turn the recorded decisions into a specification.</p>
          )}
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
        </section>
        {!embedded && <GrillDecisions task={task} />}
      </div>
      {!embedded && (
        <GrillActions
          task={task}
          busy={busy}
          connected={connected}
          answers={answers}
          onAnswer={onAnswer}
          onFinish={onFinish}
        />
      )}
    </>
  );
}

export function GrillDecisions({ task }: { task: TaskCore }) {
  const questions = task.grillSession?.questions ?? [];
  return (
    <aside className="decisions-panel">
      <h3>Decisions so far</h3>
      {questions.map((item, index) => (
        <section key={item.id}>
          <div>
            <span>Q{index + 1}</span>
            {item.answer && <CheckCircle size={18} />}
          </div>
          <strong>{item.question}</strong>
          <p>{item.answer ?? "Awaiting your answer"}</p>
          {item.answerSource && <small>Source: {item.answerSource.replaceAll("-", " ")}</small>}
        </section>
      ))}
    </aside>
  );
}

export function GrillActions({
  task,
  busy,
  connected,
  answers,
  onAnswer,
  onFinish,
}: Pick<GrillProps, "task" | "busy" | "connected" | "answers" | "onAnswer" | "onFinish">) {
  const questions = task.grillSession?.questions ?? [];
  const unanswered = questions.filter((item) => !item.answer);
  const question = unanswered[0];
  const value = answers[`${task.id}:${question?.id ?? ""}`] ?? "";
  const [reviewRecommendations, setReviewRecommendations] = useState(false);
  return (
    <div className="grill-actions">
      {reviewRecommendations && unanswered.length > 0 && (
        <section className="recommendation-review">
          <h3>Accept {unanswered.length} remaining recommendations?</h3>
          {unanswered.map((item) => (
            <p key={item.id}>
              <strong>{item.question}</strong>
              <br />
              {item.options.find((option) => option.recommended)?.label ?? "No recommendation available"}
            </p>
          ))}
          <button type="button" onClick={() => setReviewRecommendations(false)}>
            Keep answering
          </button>
          <button
            type="button"
            disabled={
              busy ||
              !connected ||
              task.status !== "awaiting-grill" ||
              unanswered.some((item) => !item.options.some((option) => option.recommended))
            }
            onClick={() => onFinish(true)}
          >
            Confirm recommendations & continue
          </button>
        </section>
      )}
      <footer className="grill-action-buttons">
        <span className="quiet">Answers are submitted only when you choose the action.</span>
        {unanswered.length > 0 && (
          <button
            type="button"
            disabled={busy || !connected || task.status !== "awaiting-grill"}
            onClick={() => setReviewRecommendations(true)}
          >
            Accept remaining recommendations
          </button>
        )}
        <button
          type="button"
          className="primary"
          disabled={
            busy || !connected || Boolean(question && !value.trim()) || task.status !== "awaiting-grill"
          }
          onClick={(event) => {
            // A fast second click must not submit the next question or finish the session.
            if (event.detail > 1) return;
            if (question) onAnswer(question.id, value);
            else onFinish();
          }}
        >
          {busy ? "Saving…" : question ? "Record answer & next" : "Create specification"}
          <ArrowRight size={20} />
        </button>
      </footer>
    </div>
  );
}
