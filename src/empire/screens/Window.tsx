import { X } from "@phosphor-icons/react";
import { type ReactNode, useEffect, useRef } from "react";

export function Window({
  title,
  kicker,
  onClose,
  children,
  wide = false,
  footer,
}: {
  title: ReactNode;
  kicker?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div
      className="ae-window-backdrop"
      onPointerDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        ref={ref}
        className={`ae-window${wide ? " is-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
      >
        <header className="ae-window-head">
          <div>
            {kicker && <div className="ae-window-kicker">{kicker}</div>}
            <h1>{title}</h1>
          </div>
          <button type="button" className="ae-window-close" onClick={onClose} aria-label="Close">
            <X weight="bold" />
          </button>
        </header>
        <div className="ae-window-body">{children}</div>
        {footer && <footer className="ae-window-foot">{footer}</footer>}
      </div>
    </div>
  );
}
