import { ArrowRight, CheckCircle, FileText, Question } from "@phosphor-icons/react";
import { useState } from "react";
import type { TaskCore } from "../runtime/contracts";

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
}: {
  task: TaskCore;
  busy: boolean;
  error: string | null;
  connected: boolean;
  onAnswer(questionId: string, answer: string): void;
  onFinish(acceptRemaining?: boolean): void;
  onArtifact(id: string): void;
  answers: Record<string, string>;
  onDraft(key: string, value: string): void;
}) {
  const questions = task.grillSession?.questions ?? [];
  const [reviewRecommendations, setReviewRecommendations] = useState(false);
  const unanswered = questions.filter((item) => !item.answer);
  const question = questions.find((item) => !item.answer);
  const draftKey = `${task.id}:${question?.id ?? ""}`;
  const value = answers[draftKey] ?? "";
  return (
    <>
      <div className="overlay-body grill-layout">
        <section>
          <header className="grill-title">
            <Question size={34} />
            <div>
              <small>{task.id} · Grill</small>
              <h2>{question ? "A decision needs you" : "Decisions recorded"}</h2>
            </div>
            <span>
              {questions.filter((item) => item.answer).length} of {questions.length} answered
            </span>
          </header>
          {question ? (
            <>
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
              <fieldset className="answer-options">
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
      </div>
      {reviewRecommendations && (
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
              unanswered.some((item) => !item.options.some((option) => option.recommended))
            }
            onClick={() => onFinish(true)}
          >
            Confirm recommendations & continue
          </button>
        </section>
      )}
      <footer className="overlay-footer">
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
          onClick={() => (question ? onAnswer(question.id, value) : onFinish())}
        >
          {busy ? "Saving…" : question ? "Record answer & next" : "Create specification"}
          <ArrowRight size={20} />
        </button>
      </footer>
    </>
  );
}
