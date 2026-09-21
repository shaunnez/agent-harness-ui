import { CaretDown } from "@phosphor-icons/react";

export function CollapsibleText({ text, label }: { text: string; label: string }) {
  return (
    <details className="collapsible-text">
      <summary>
        <span className="collapsible-text-preview">{text}</span>
        <span className="collapsible-text-action">
          <CaretDown size={15} aria-hidden="true" />
          <span className="collapsible-text-show">Show full {label}</span>
          <span className="collapsible-text-hide">Hide full {label}</span>
        </span>
      </summary>
      <p className="collapsible-text-full">{text}</p>
    </details>
  );
}
