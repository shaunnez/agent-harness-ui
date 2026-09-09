import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

/** A focusable scroll region with a cue even when the OS hides scrollbar tracks. */
export function ScrollArea({
  children,
  className = "",
  label,
}: {
  children: ReactNode;
  className?: string;
  label: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const [more, setMore] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => setMore(element.scrollHeight - element.clientHeight - element.scrollTop > 2);
    const resize = new ResizeObserver(update);
    resize.observe(element);
    if (element.firstElementChild) resize.observe(element.firstElementChild);
    const mutation = new MutationObserver(update);
    mutation.observe(element, { childList: true, subtree: true, characterData: true });
    element.addEventListener("scroll", update);
    update();
    return () => {
      resize.disconnect();
      mutation.disconnect();
      element.removeEventListener("scroll", update);
    };
  }, []);
  return (
    <div className={`scroll-frame ${className}-frame`}>
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: A named scroll region must support keyboard scrolling. */}
      <section ref={ref} className={`scroll-region ${className}`} aria-label={label} tabIndex={0}>
        {children}
      </section>
      {more && (
        <span className="scroll-cue" aria-hidden="true">
          Scroll for more ↓
        </span>
      )}
    </div>
  );
}
