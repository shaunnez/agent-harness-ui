import { ChatCircleDots, X } from "@phosphor-icons/react";
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from "react";
import { CompanionPanel, type CompanionPanelProps, isCompanionFocusShortcut } from "./CompanionPanel";

export interface CompanionShellProps
  extends Omit<CompanionPanelProps, "className" | "composerRef" | "onClose"> {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}

/**
 * App-owned companion chrome. The shell is mounted once beside routed content;
 * the panel itself is deliberately kept mounted only while open so the route
 * cannot own conversation, proposal, or draft state.
 */
export function CompanionShell({ open, onOpen, onClose, ...panelProps }: CompanionShellProps) {
  const launcherRef = useRef<HTMLButtonElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(() => isCompanionNarrowViewport());
  const wasOpen = useRef(false);

  useEffect(() => {
    const media = window.matchMedia?.("(max-width: 760px)");
    if (!media) return;
    const update = () => setNarrow(media.matches);
    update();
    if (media.addEventListener) media.addEventListener("change", update);
    else media.addListener?.(update);
    return () => {
      if (media.removeEventListener) media.removeEventListener("change", update);
      else media.removeListener?.(update);
    };
  }, []);

  useEffect(() => {
    if (!open) {
      if (wasOpen.current) {
        wasOpen.current = false;
        launcherRef.current?.focus();
      }
      return;
    }
    wasOpen.current = true;
    composerRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const background = [...document.querySelectorAll<HTMLElement>(".app-main, .sidebar")];
    if (!open || !narrow) return;
    const previous = new Map<HTMLElement, string | null>();
    for (const element of background) {
      previous.set(element, element.getAttribute("aria-hidden"));
      element.setAttribute("aria-hidden", "true");
    }
    return () => {
      for (const element of background) {
        const value = previous.get(element);
        if (value === null || value === undefined) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", value);
      }
    };
  }, [narrow, open]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (
        !isCompanionFocusShortcut(event) ||
        event.defaultPrevented ||
        (open ? hasOpenModal(shellRef.current) : hasOpenModal())
      )
        return;
      event.preventDefault();
      onOpen();
      window.setTimeout(() => composerRef.current?.focus(), 0);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (!open || event.key !== "Escape" || event.defaultPrevented || hasOpenModal(shellRef.current)) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", handleShortcut);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("keydown", handleShortcut);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [onClose, onOpen, open]);

  const containFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!narrow || event.key !== "Tab" || hasOpenModal(shellRef.current)) return;
    const focusable = getFocusableElements(shellRef.current);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  useEffect(() => {
    if (!open || !narrow) return;
    const containProgrammaticFocus = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || shellRef.current?.contains(target) || hasOpenModal(shellRef.current))
        return;
      event.preventDefault();
      composerRef.current?.focus();
    };
    document.addEventListener("focusin", containProgrammaticFocus);
    return () => document.removeEventListener("focusin", containProgrammaticFocus);
  }, [narrow, open]);

  return (
    <>
      <button
        ref={launcherRef}
        type="button"
        className={`companion-launcher ${open ? "companion-launcher--open" : ""}`}
        aria-label={open ? "Close contextual companion" : "Open contextual companion"}
        aria-controls="companion-surface"
        aria-expanded={open}
        aria-keyshortcuts="Control+K Meta+K"
        onClick={open ? onClose : onOpen}
      >
        {open ? <X aria-hidden size={18} /> : <ChatCircleDots aria-hidden size={18} weight="fill" />}
        <span>{open ? "Close companion" : "Open companion"}</span>
        <kbd>⌘K</kbd>
      </button>
      {open ? (
        <>
          {narrow ? (
            <button
              type="button"
              className="companion-shell__backdrop"
              aria-label="Close contextual companion"
              onClick={onClose}
            />
          ) : null}
          <div
            ref={shellRef}
            id="companion-surface"
            className={`companion-shell ${narrow ? "companion-shell--sheet" : "companion-shell--desktop"}`}
            data-companion-surface="global"
            role="dialog"
            aria-modal={narrow ? true : undefined}
            aria-label="Contextual companion"
            onKeyDown={containFocus}
          >
            <CompanionPanel
              {...panelProps}
              composerRef={composerRef}
              onClose={onClose}
              className="companion-panel--shell"
            />
          </div>
        </>
      ) : null}
    </>
  );
}

export function isCompanionNarrowViewport() {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(max-width: 760px)").matches);
}

export function getFocusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  return [
    ...container.querySelectorAll<HTMLElement>(
      "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
    ),
  ].filter((element) => !element.hasAttribute("aria-hidden"));
}

function hasOpenModal(owner?: HTMLElement | null) {
  return [...document.querySelectorAll<HTMLElement>("dialog[open], [role='dialog'][aria-modal='true']")].some(
    (element) => element !== owner && !owner?.contains(element),
  );
}
