import { PaperPlaneTilt } from "@phosphor-icons/react";
import { type KeyboardEvent, type Ref, useId, useState } from "react";

export interface CompanionComposerProps {
  onSubmit: (value: string) => void | Promise<void>;
  disabled?: boolean;
  isSubmitting?: boolean;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  textareaRef?: Ref<HTMLTextAreaElement>;
  placeholder?: string;
}

/**
 * The composer is deliberately a plain textarea/form boundary. It emits text
 * only; intent parsing and every side effect remain with the parent workflow.
 */
export function CompanionComposer({
  onSubmit,
  disabled = false,
  isSubmitting = false,
  value,
  defaultValue = "",
  onChange,
  textareaRef,
  placeholder = "Ask about this task or choose an action…",
}: CompanionComposerProps) {
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue);
  const [localSubmitting, setLocalSubmitting] = useState(false);
  const inputId = useId();
  const hintId = `${inputId}-hint`;
  const isControlled = value !== undefined;
  const draft = isControlled ? value : uncontrolledValue;
  const busy = disabled || isSubmitting || localSubmitting;

  const setDraft = (nextValue: string) => {
    if (!isControlled) setUncontrolledValue(nextValue);
    onChange?.(nextValue);
  };

  const submit = async () => {
    const nextValue = draft.trim();
    if (!nextValue || busy) return;

    setLocalSubmitting(true);
    try {
      await onSubmit(nextValue);
      if (!isControlled) setUncontrolledValue("");
    } finally {
      setLocalSubmitting(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      shouldSubmitCompanionKey({
        key: event.key,
        shiftKey: event.shiftKey,
        isComposing: event.nativeEvent.isComposing,
      })
    ) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <form
      className="companion-composer"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      aria-label="Message the contextual companion"
    >
      <label className="sr-only" htmlFor={inputId}>
        Message Agent Harness
      </label>
      <textarea
        ref={textareaRef}
        id={inputId}
        className="companion-composer__input"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={2}
        disabled={disabled}
        aria-describedby={hintId}
        aria-keyshortcuts="Enter Shift+Enter"
        autoComplete="off"
      />
      <div className="companion-composer__footer">
        <span id={hintId}>Enter to send · Shift+Enter for a new line</span>
        <button
          type="submit"
          className="button button--primary button--compact companion-composer__submit"
          disabled={busy || !draft.trim()}
          aria-label={localSubmitting || isSubmitting ? "Sending message" : "Send message"}
        >
          <PaperPlaneTilt aria-hidden size={15} weight="bold" />
          {localSubmitting || isSubmitting ? "Sending…" : "Send"}
        </button>
      </div>
    </form>
  );
}

export function shouldSubmitCompanionKey({
  key,
  shiftKey,
  isComposing,
}: {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
}) {
  return key === "Enter" && !shiftKey && !isComposing;
}
