import { CaretDown, CheckCircle } from "@phosphor-icons/react";
import { useState } from "react";
import type { RuntimeGrillQuestion, RuntimeTask } from "../../domain";
import { Button, StateBadge } from "../Primitives";

export function RuntimeGrillPanel({
  task,
  onAnswer,
}: {
  task: RuntimeTask;
  onAnswer: (questionId: string, answer: string) => Promise<void>;
}) {
  const session = task.grillSession;
  if (!session) return null;
  const settled = session.questions.filter((question) => question.answer).length;
  const interactive = session.status === "open" && task.status === "awaiting-grill";
  const activeQuestion = session.questions.find((question) => !question.answer);
  return (
    <section className="runtime-grill" aria-label="Grill Me decision session">
      <header>
        <span>
          <small>Decision frontier</small>
          <strong>
            {settled} of {session.questions.length} material questions settled
          </strong>
        </span>
        <StateBadge state={session.status === "completed" ? "completed" : "needs-input"} />
      </header>
      {session.completionReason ? <p className="runtime-grill__reason">{session.completionReason}</p> : null}
      {activeQuestion ? (
        <div className="runtime-grill__questions">
          <RuntimeGrillQuestionCard
            key={activeQuestion.id}
            question={activeQuestion}
            index={session.questions.indexOf(activeQuestion)}
            interactive={interactive}
            onAnswer={onAnswer}
          />
          {settled ? (
            <details className="runtime-grill-history">
              <summary><span>{settled} accumulated decision{settled === 1 ? "" : "s"}</span><CaretDown className="disclosure-caret" size={15} /></summary>
              {session.questions.filter((question) => question.answer).map((question) => (
                <RuntimeGrillQuestionCard
                  key={question.id}
                  question={question}
                  index={session.questions.indexOf(question)}
                  interactive={false}
                  onAnswer={onAnswer}
                />
              ))}
            </details>
          ) : null}
        </div>
      ) : session.questions.length ? (
        <div className="runtime-grill__questions">
          {session.questions.map((question) => (
            <RuntimeGrillQuestionCard
              key={question.id}
              question={question}
              index={session.questions.indexOf(question)}
              interactive={false}
              onAnswer={onAnswer}
            />
          ))}
        </div>
      ) : (
        <div className="runtime-stage-empty">
          <CheckCircle size={22} weight="fill" />
          <strong>No material questions remain</strong>
          <span>
            Repository evidence and safe reversible defaults are sufficient to build the specification.
          </span>
        </div>
      )}
      {task.decisions.length ? (
        <details className="runtime-grill-history runtime-grill-history--all" open>
          <summary>
            <span>{task.decisions.length} accumulated task decision{task.decisions.length === 1 ? "" : "s"}</span>
            <CaretDown size={16} />
          </summary>
          <div className="runtime-task-decisions">
            {task.decisions.map((decision) => (
              <article key={decision.id}>
                <small>{new Date(decision.createdAt).toLocaleString()}</small>
                <strong>{decision.question}</strong>
                <p>{decision.answer}</p>
              </article>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}

function RuntimeGrillQuestionCard({
  question,
  index,
  interactive,
  onAnswer,
}: {
  question: RuntimeGrillQuestion;
  index: number;
  interactive: boolean;
  onAnswer: (questionId: string, answer: string) => Promise<void>;
}) {
  const recommended = question.options.find((option) => option.recommended);
  const [choice, setChoice] = useState(recommended?.id ?? question.options[0]?.id ?? "custom");
  const [custom, setCustom] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (question.answer) {
    return (
      <details className="runtime-grill-question runtime-grill-question--settled">
        <summary>
          <CheckCircle size={18} weight="fill" />
          <span>
            <small>Question {index + 1} &middot; settled</small>
            <strong>{question.question}</strong>
          </span>
          <CaretDown className="disclosure-caret" size={15} />
        </summary>
        <p>{question.whyItMatters}</p>
        <div className="runtime-grill-answer">
          <small>
            {question.answerSource === "accepted-assumption" ? "Accepted recommendation" : "Your answer"}
          </small>
          <strong>{question.answer}</strong>
        </div>
      </details>
    );
  }
  return (
    <article className="runtime-grill-question">
      <header>
        <span>
          <small>Question {index + 1}</small>
          <strong>{question.question}</strong>
        </span>
        <StateBadge state="needs-input" />
      </header>
      <p>{question.whyItMatters}</p>
      {recommended ? (
        <div className="runtime-grill-recommendation">
          <small>Recommended answer</small>
          <strong>{recommended.label}</strong>
          <span>{recommended.description}</span>
        </div>
      ) : null}
      {interactive ? (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            const selected = question.options.find((option) => option.id === choice);
            const answer = choice === "custom" ? custom.trim() : selected?.label;
            if (!answer) return;
            setPending(true);
            setError(null);
            try {
              await onAnswer(question.id, answer);
            } catch (reason) {
              setError(reason instanceof Error ? reason.message : "Answer could not be saved.");
            } finally {
              setPending(false);
            }
          }}
        >
          <fieldset>
            <legend className="sr-only">Answer {question.question}</legend>
            {question.options.map((option) => (
              <label key={option.id} className={choice === option.id ? "selected" : ""}>
                <input
                  type="radio"
                  name={`answer-${question.id}`}
                  value={option.id}
                  checked={choice === option.id}
                  onChange={() => setChoice(option.id)}
                />
                <span>
                  <strong>
                    {option.label} {option.recommended ? <em>Recommended</em> : null}
                  </strong>
                  <small>{option.description}</small>
                </span>
              </label>
            ))}
            {question.allowCustom ? (
              <label className={choice === "custom" ? "selected" : ""}>
                <input
                  type="radio"
                  name={`answer-${question.id}`}
                  value="custom"
                  checked={choice === "custom"}
                  onChange={() => setChoice("custom")}
                />
                <span>
                  <strong>Custom answer</strong>
                  <small>Provide a different authoritative decision.</small>
                </span>
              </label>
            ) : null}
          </fieldset>
          {choice === "custom" ? (
            <textarea
              aria-label={`Custom answer for ${question.question}`}
              rows={3}
              value={custom}
              onChange={(event) => setCustom(event.target.value)}
              placeholder="Describe the decision and any constraints"
            />
          ) : null}
          <Button
            tone="primary"
            compact
            type="submit"
            disabled={pending || (choice === "custom" && !custom.trim())}
          >
            {pending ? "Saving..." : "Confirm answer"}
          </Button>
          {error ? <small className="text-red">{error}</small> : null}
        </form>
      ) : (
        <small>This question was not settled before the session closed.</small>
      )}
    </article>
  );
}
