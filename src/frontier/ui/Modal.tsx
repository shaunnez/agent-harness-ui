import { ArrowLeft, X } from "@phosphor-icons/react";
import { type ReactNode, useEffect, useRef } from "react";

export function Modal({
  title,
  children,
  onClose,
  onBack,
  className = "",
  focusKey,
}: {
  title: string;
  children: ReactNode;
  onClose(): void;
  onBack?: () => void;
  className?: string;
  focusKey?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = ref.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal();
    return () => {
      element?.close();
      previous?.focus();
    };
  }, []);
  useEffect(() => {
    if (focusKey) ref.current?.querySelector<HTMLButtonElement>(".overlay-header button")?.focus();
  }, [focusKey]);
  return (
    <dialog
      ref={ref}
      className={`work-overlay ${className}`}
      aria-label={title}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button, a[href], input, select, textarea, iframe, [tabindex], [contenteditable="true"]',
          ),
        ).filter(
          (element) =>
            element.tabIndex >= 0 && !element.matches(":disabled") && element.getClientRects().length,
        );
        const first = controls[0];
        const last = controls.at(-1);
        if (
          (event.shiftKey && document.activeElement === first) ||
          (!event.shiftKey && document.activeElement === last)
        ) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        (onBack ?? onClose)();
      }}
    >
      <header className="overlay-header">
        <div>
          {onBack && (
            <button
              type="button"
              className="icon-button"
              aria-label="Back to previous panel"
              onClick={onBack}
            >
              <ArrowLeft size={20} />
            </button>
          )}
          <h1>{title}</h1>
        </div>
        <button type="button" className="icon-button" aria-label="Close panel" onClick={onClose}>
          <X size={22} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
