import { ArrowLeft, X } from "@phosphor-icons/react";
import { type ReactNode, useEffect, useRef, useLayoutEffect, useState } from "react";
import type { WindowFamily } from "../app/window-layout";
import { ResizeHandles, useWindowSizing, WindowSizeControls } from "./WindowSizing";

export function Modal({
  title,
  children,
  onClose,
  onBack,
  className = "",
  focusKey,
  family = "management",
  heading,
  resizable = true,
}: {
  title: string;
  children: ReactNode;
  onClose(): void;
  onBack?: () => void;
  className?: string;
  focusKey?: string;
  family?: WindowFamily;
  heading?: string;
  resizable?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const panelFocus = useRef(new Map<string, { label: string | null; text: string }>());
  const sizing = useWindowSizing(family);
  const [scrollHint, setScrollHint] = useState(false);
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    let bodies: HTMLElement[] = [];
    const measure = () =>
      setScrollHint(bodies.some((body) => body.scrollHeight - body.clientHeight - body.scrollTop > 3));
    const resize = new ResizeObserver(measure);
    const bind = () => {
      const next = Array.from(
        dialog.querySelectorAll<HTMLElement>(".overlay-body, .settings-editor-scroll, .settings-nav"),
      );
      if (next.length !== bodies.length || next.some((body, index) => body !== bodies[index])) {
        bodies.forEach((body) => {
          body.removeEventListener("scroll", measure);
        });
        resize.disconnect();
        bodies = next;
        bodies.forEach((body) => {
          resize.observe(body);
          body.addEventListener("scroll", measure);
        });
      }
      measure();
    };
    const mutation = new MutationObserver(bind);
    mutation.observe(dialog, { childList: true, subtree: true, characterData: true });
    bind();
    return () => {
      resize.disconnect();
      mutation.disconnect();
      bodies.forEach((body) => {
        body.removeEventListener("scroll", measure);
      });
    };
  }, []);
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
    if (!focusKey) return;
    const saved = panelFocus.current.get(focusKey);
    const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    const restored =
      saved &&
      buttons.find(
        (button) =>
          !button.disabled &&
          (saved.label
            ? button.getAttribute("aria-label") === saved.label
            : button.textContent === saved.text),
      );
    (restored || ref.current?.querySelector<HTMLButtonElement>(".overlay-header button"))?.focus();
  }, [focusKey]);
  return (
    <dialog
      ref={ref}
      className={`work-overlay ${resizable ? "sized-window" : "compact-window"} ${className}`}
      style={resizable ? sizing.style : undefined}
      aria-label={title}
      onClickCapture={(event) => {
        const button = event.target instanceof Element ? event.target.closest("button") : null;
        if (focusKey && button)
          panelFocus.current.set(focusKey, {
            label: button.getAttribute("aria-label"),
            text: button.textContent ?? "",
          });
      }}
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
          <h1 title={heading ?? title}>{heading ?? title}</h1>
        </div>
        <div className="overlay-window-actions">
          {resizable && <WindowSizeControls sizing={sizing} />}
          <button type="button" className="icon-button" aria-label="Close panel" onClick={onClose}>
            <X size={22} />
          </button>
        </div>
      </header>
      {children}
      {scrollHint && (
        <span className="window-scroll-hint" aria-hidden="true">
          Scroll within the window for more ↓
        </span>
      )}
      {resizable && <ResizeHandles sizing={sizing} />}
    </dialog>
  );
}
