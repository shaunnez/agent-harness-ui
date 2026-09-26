// Shared parchment sections: the Council's questions, the Workshop yards and the scrolls.
import { Gavel } from "@phosphor-icons/react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { RuntimeTask, StageId } from "../../domain";
import { buildingFor } from "../realm";

export function Council({ task }: { task: RuntimeTask }) {
  const [decrees, setDecrees] = useState<Record<string, string>>({});
  const grill = task.grillSession;
  if (!grill) return null;
  return (
    <section className="ae-parchment">
      <div className="ae-eyebrow">
        <Gavel /> The Council · {grill.questions.length} question{grill.questions.length === 1 ? "" : "s"}
      </div>
      {grill.questions.map((q) => {
        const answer = q.answer ?? decrees[q.id];
        return (
          <article key={q.id} className={`ae-council-q${answer ? " is-answered" : ""}`}>
            <h4>
              {q.id}. {q.question}
            </h4>
            <p className="ae-muted">{q.whyItMatters}</p>
            {answer ? (
              <p className="ae-decree">
                Decree: <b>{answer}</b> {!q.answer && <em>(this tab only)</em>}
              </p>
            ) : (
              <div className="ae-options">
                {q.options.map((o) => (
                  <button
                    type="button"
                    key={o.id}
                    className={`ae-option${o.recommended ? " is-recommended" : ""}`}
                    onClick={() => setDecrees((d) => ({ ...d, [q.id]: o.label }))}
                  >
                    <b>
                      {o.label} {o.recommended && <span className="ae-tag">Counsel recommends</span>}
                    </b>
                    <span>{o.description}</span>
                  </button>
                ))}
              </div>
            )}
          </article>
        );
      })}
    </section>
  );
}

export function Yards({ task }: { task: RuntimeTask }) {
  const packages = task.workPackages ?? [];
  return (
    <section className="ae-parchment">
      <div className="ae-eyebrow">Workshop yards · {packages.length} packages</div>
      <div className="ae-yards">
        {packages.map((pkg, i) => (
          <div key={pkg.id} className={`ae-yard is-${pkg.status}`}>
            <b>{pkg.id}</b>
            <span>{pkg.title}</span>
            <em>{pkg.status.replaceAll("_", " ")}</em>
            {pkg.dependencies.length > 0 && <small>after {pkg.dependencies.join(", ")}</small>}
            {i < packages.length - 1 && <span className="ae-yard-arrow">→</span>}
          </div>
        ))}
      </div>
      {packages
        .filter((p) => p.error)
        .map((p) => (
          <pre key={p.id} className="ae-reason">
            {p.error}
          </pre>
        ))}
    </section>
  );
}

/** The campaign's retained artifacts, optionally only those of some stages. */
export function Scrolls({ task, stages }: { task: RuntimeTask; stages?: StageId[] }) {
  const artifacts = (task.artifacts ?? []).filter((a) => !stages || stages.includes(a.stage));
  const [artifactId, setArtifactId] = useState(artifacts[0]?.id ?? null);
  const artifact = artifacts.find((a) => a.id === artifactId) ?? artifacts[0];
  if (!artifact) return null;
  return (
    <section className="ae-parchment ae-scroll">
      <div className="ae-eyebrow">Scrolls</div>
      <div className="ae-scroll-tabs">
        {artifacts.map((a) => (
          <button
            type="button"
            key={a.id}
            className={a.id === artifact.id ? "is-active" : ""}
            onClick={() => setArtifactId(a.id)}
          >
            {buildingFor(a.stage).name} · {a.name}
          </button>
        ))}
      </div>
      <div className="ae-markdown">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{artifact.content}</ReactMarkdown>
      </div>
    </section>
  );
}
