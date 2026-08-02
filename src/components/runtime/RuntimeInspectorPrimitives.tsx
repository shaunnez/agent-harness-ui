import type { ReactNode } from "react";

export function InspectorSection({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: string;
  children: ReactNode;
}) {
  return (
    <section className="runtime-inspector-section">
      <header>
        <strong>{title}</strong>
        {meta ? <small>{meta}</small> : null}
      </header>
      {children}
    </section>
  );
}

export function RuntimeRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <span className="runtime-meta-row">
      <small>{label}</small>
      <strong className={mono ? "mono" : ""}>{value}</strong>
    </span>
  );
}
