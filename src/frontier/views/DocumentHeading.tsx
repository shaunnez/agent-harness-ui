import { Binoculars, CheckCircle, Cube, FileText, ShieldCheck, Target } from "@phosphor-icons/react";
import type { ReactNode } from "react";

/** Decorate actual Markdown headings without parsing away any document content. */
export function DocumentHeading({ children, level }: { children?: ReactNode; level: 2 | 3 }) {
  const label = (
    Array.isArray(children) ? children.join(" ") : typeof children === "string" ? children : ""
  ).toLowerCase();
  const Icon = /outcome|objective/.test(label)
    ? Target
    : /scope|contract/.test(label)
      ? Cube
      : /acceptance/.test(label)
        ? CheckCircle
        : /verification/.test(label)
          ? ShieldCheck
          : /investigation/.test(label)
            ? Binoculars
            : FileText;
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <Heading
      className="document-section-heading"
      data-section={/acceptance/.test(label) ? "acceptance" : undefined}
    >
      <Icon size={18} aria-hidden="true" />
      {children}
    </Heading>
  );
}
