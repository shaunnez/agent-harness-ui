import { ArrowRight, Plus } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { RuntimeProject } from "../../../domain";
import { type ResearchGateway, reviewState } from "../../runtime/research";
import { useProjectQuestions } from "./use-research";

/** The selected-base dock for a research project: questions in place of tasks. */
export function ResearchBaseSelection({
  project,
  research,
  rendererRef,
  onOpen,
  onAsk,
}: {
  project: RuntimeProject;
  research: ResearchGateway | undefined;
  rendererRef: React.RefObject<{ headquartersPreview(projectId: string): Promise<string | null> } | null>;
  onOpen(): void;
  onAsk(): void;
}) {
  const [preview, setPreview] = useState<{ projectId: string; image: string } | null>(null);
  useEffect(() => {
    let disposed = false;
    rendererRef.current?.headquartersPreview(project.id).then(
      (image) => {
        if (!disposed && image) setPreview({ projectId: project.id, image });
      },
      () => {},
    );
    return () => {
      disposed = true;
    };
  }, [project.id, rendererRef]);
  const { value: questions } = useProjectQuestions(research, project.id);
  const all = questions ?? [];
  const awaiting = all.filter((question) =>
    ["awaiting", "out-of-date"].includes(reviewState(question)),
  ).length;
  return (
    <section className="selection-hud panel project-selection" aria-label="Selected base">
      <div className="selection-main">
        <div className="base-selection-copy">
          <small>Research project</small>
          <h2>{project.name}</h2>
          <p>Costing questions, five runs each by default</p>
          <dl className="base-selection-counts">
            <div>
              <dt>Questions</dt>
              <dd>{questions ? all.length : "…"}</dd>
            </div>
            <div>
              <dt>Running</dt>
              <dd>{questions ? all.filter((question) => question.status === "running").length : "…"}</dd>
            </div>
            <div>
              <dt>Awaiting review</dt>
              <dd>{questions ? awaiting : "…"}</dd>
            </div>
          </dl>
          <div className="inline-controls">
            <button type="button" className="primary" onClick={onOpen}>
              Open research <ArrowRight size={20} />
            </button>
            <button type="button" onClick={onAsk}>
              <Plus size={18} /> Ask
            </button>
          </div>
        </div>
        {preview?.projectId === project.id && (
          <img
            className="base-headquarters-preview"
            src={preview.image}
            alt={`${project.name} research base preview`}
          />
        )}
      </div>
    </section>
  );
}
