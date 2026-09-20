import { ArrowRight } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { RuntimeProject } from "../../domain";
import type { TaskSummary } from "../runtime/contracts";
import { isExecuting, isOpen, needsYou } from "../runtime/presentation";

export function BaseSelection({
  project,
  tasks,
  rendererRef,
  onEnter,
}: {
  project: RuntimeProject;
  tasks: TaskSummary[];
  rendererRef: React.RefObject<{ headquartersPreview(projectId: string): Promise<string | null> } | null>;
  onEnter(): void;
}) {
  const [preview, setPreview] = useState<{ projectId: string; image: string } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    setPreviewError(null);
    rendererRef.current?.headquartersPreview(project.id).then(
      (image) => {
        if (!disposed && image) setPreview({ projectId: project.id, image });
      },
      () => {
        if (!disposed) setPreviewError("Headquarters preview unavailable");
      },
    );
    return () => {
      disposed = true;
    };
  }, [project.id, rendererRef]);
  const open = tasks.filter(isOpen);
  return (
    <section className="selection-hud panel project-selection" aria-label="Selected base">
      <div className="selection-main">
        <div className="base-selection-copy">
          <small>Project headquarters</small>
          <h2>{project.name}</h2>
          <p>{project.repositoryPath.split("/").filter(Boolean).at(-1)}</p>
          <dl className="base-selection-counts">
            <div>
              <dt>Open tasks</dt>
              <dd>{open.length}</dd>
            </div>
            <div>
              <dt>Executing</dt>
              <dd>{open.filter(isExecuting).length}</dd>
            </div>
            <div>
              <dt>Needs you</dt>
              <dd>{open.filter(needsYou).length}</dd>
            </div>
          </dl>
          <button type="button" className="primary" onClick={onEnter}>
            Enter base <ArrowRight size={20} />
          </button>
        </div>
        {preview?.projectId === project.id && (
          <img
            className="base-headquarters-preview"
            src={preview.image}
            alt={`${project.name} headquarters preview`}
          />
        )}
        {previewError && <small>{previewError}</small>}
      </div>
    </section>
  );
}
