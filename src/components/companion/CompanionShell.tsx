import { ChatCircleDots, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
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
        syncCompanionShellFocus(
          open,
          wasOpen,
          () => {},
          () => launcherRef.current?.focus(),
        );
      }
      return;
    }
    syncCompanionShellFocus(
      open,
      wasOpen,
      () => composerRef.current?.focus(),
      () => {},
    );
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
    return installCompanionShellInteractions({
      documentRef: document,
      eventTarget: window,
      getOpen: () => open,
      getNarrow: () => narrow,
      getShell: () => shellRef.current,
      onOpen,
      onClose,
      focusComposer: () => composerRef.current?.focus(),
      scheduleFocus: (focus) => window.setTimeout(focus, 0),
    });
  }, [narrow, onClose, onOpen, open]);

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

export interface CompanionShellFocusState {
  current: boolean;
}

export function syncCompanionShellFocus(
  open: boolean,
  state: CompanionShellFocusState,
  focusComposer: () => void,
  focusLauncher: () => void,
) {
  if (!open) {
    if (state.current) {
      state.current = false;
      focusLauncher();
    }
    return;
  }
  state.current = true;
  focusComposer();
}

interface CompanionShellInteractionOptions {
  documentRef: Document;
  eventTarget: Window;
  getOpen: () => boolean;
  getNarrow: () => boolean;
  getShell: () => HTMLElement | null;
  onOpen: () => void;
  onClose: () => void;
  focusComposer: () => void;
  scheduleFocus: (focus: () => void) => void;
}

export function installCompanionShellInteractions({
  documentRef,
  eventTarget,
  getOpen,
  getNarrow,
  getShell,
  onOpen,
  onClose,
  focusComposer,
  scheduleFocus,
}: CompanionShellInteractionOptions) {
  const hasNestedModal = () => hasOpenModal(documentRef, getShell());
  const handleShortcut = (event: KeyboardEvent) => {
    if (!isCompanionFocusShortcut(event) || event.defaultPrevented || hasNestedModal()) return;
    event.preventDefault();
    onOpen();
    scheduleFocus(focusComposer);
  };
  const handleEscape = (event: KeyboardEvent) => {
    if (!getOpen() || event.key !== "Escape" || event.defaultPrevented || hasNestedModal()) return;
    event.preventDefault();
    onClose();
  };
  const handleShellKeydown = (event: KeyboardEvent) => {
    if (!getNarrow() || event.key !== "Tab" || hasNestedModal()) return;
    const shell = getShell();
    const focusable = getFocusableElements(shell);
    if (!shell || !focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    const active = documentRef.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };
  const containProgrammaticFocus = (event: FocusEvent) => {
    const shell = getShell();
    const target = event.target;
    if (!target || shell?.contains(target as Node) || hasNestedModal()) return;
    event.preventDefault();
    focusComposer();
  };

  eventTarget.addEventListener("keydown", handleShortcut);
  eventTarget.addEventListener("keydown", handleEscape);
  const shell = getShell();
  shell?.addEventListener("keydown", handleShellKeydown);
  if (getOpen() && getNarrow()) documentRef.addEventListener("focusin", containProgrammaticFocus);
  return () => {
    eventTarget.removeEventListener("keydown", handleShortcut);
    eventTarget.removeEventListener("keydown", handleEscape);
    shell?.removeEventListener("keydown", handleShellKeydown);
    documentRef.removeEventListener("focusin", containProgrammaticFocus);
  };
}

export function getFocusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  return [
    ...container.querySelectorAll<HTMLElement>(
      "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
    ),
  ].filter((element) => !element.hasAttribute("aria-hidden"));
}

function hasOpenModal(documentRef: Document, owner?: HTMLElement | null) {
  return [
    ...documentRef.querySelectorAll<HTMLElement>("dialog[open], [role='dialog'][aria-modal='true']"),
  ].some((element) => element !== owner);
}
