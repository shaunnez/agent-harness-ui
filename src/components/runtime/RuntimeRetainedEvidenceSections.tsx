import { FileCode } from "@phosphor-icons/react";
import { useState } from "react";
import { type RuntimeArtifact, type StageId, workflowStages } from "../../domain";
import { Button } from "../Primitives";
import type { RuntimeTaskWorkspaceProps } from "./contracts";
import { RuntimeWorktreeInventory } from "./RuntimeEvidencePanels";
import { InspectorSection } from "./RuntimeInspectorPrimitives";
import { getRuntimeArtifactFreshness, isArtifactFresh } from "./workflow";

type Props = {
  task: RuntimeTaskWorkspaceProps["task"];
  readOnlyPreview?: boolean;
  initialSelectedWorktreeId?: string | null;
  onRemoveWorktree: RuntimeTaskWorkspaceProps["onRemoveWorktree"];
  onLoadMoreArtifacts: RuntimeTaskWorkspaceProps["onLoadMoreArtifacts"];
  onSelectStage: (stageId: StageId) => void;
  onOpenArtifact: (artifact: RuntimeArtifact) => void;
};

export function RuntimeRetainedEvidenceSections({
  task,
  readOnlyPreview = false,
  initialSelectedWorktreeId,
  onRemoveWorktree,
  onLoadMoreArtifacts,
  onSelectStage,
  onOpenArtifact,
}: Props) {
  const [selectedWorktreeId, setSelectedWorktreeId] = useState<string | null>(
    initialSelectedWorktreeId ?? null,
  );
  const [artifactPageLoading, setArtifactPageLoading] = useState(false);
  const worktreeInventory = task.worktreeInventory ?? [];
  const candidate = task.candidates?.at(-1);

  return (
    <>
      {worktreeInventory.length ? (
        <InspectorSection title="Isolated worktrees" meta={`${worktreeInventory.length} for this task`}>
          <p className="runtime-worktree-explainer">
            Temporary Git copies that keep Implement and Repair changes away from your main checkout until
            approval. A <strong>slice</strong> backs one work package; a candidate worktree backs the
            assembled patch. <strong>Retained</strong> means the copy still exists on disk so its evidence
            stays inspectable, and <strong>keep retained</strong> means it cannot be removed yet — it is still
            required by the workflow, still in use, or has uncommitted changes. Removal is re-checked when you
            ask for it, so a required candidate or a worktree an agent is currently running in is refused
            rather than pulled out from under it.
          </p>
          <RuntimeWorktreeInventory
            inventory={worktreeInventory}
            selectedId={selectedWorktreeId}
            onSelect={setSelectedWorktreeId}
            onRemove={onRemoveWorktree}
            allowRemove={!readOnlyPreview}
          />
        </InspectorSection>
      ) : null}
      <InspectorSection
        title="Living artifacts"
        meta={
          (task.artifactCount ?? task.artifacts.length) > task.artifacts.length
            ? `${task.artifacts.length} of ${task.artifactCount} retained`
            : `${task.artifacts.length} retained`
        }
      >
        <div className="runtime-artifact-list">
          {task.artifacts.length ? (
            task.artifacts.map((artifact) => {
              const freshness = getRuntimeArtifactFreshness(task, artifact);
              const staleReason =
                freshness && !isArtifactFresh(artifact, candidate, freshness) ? freshness.reasonCopy : null;
              return (
                <button
                  type="button"
                  key={artifact.id}
                  onClick={() => {
                    onSelectStage(artifact.stage);
                    onOpenArtifact(artifact);
                  }}
                >
                  <FileCode size={15} />
                  <span>
                    <strong>{artifact.name}</strong>
                    <small>
                      {workflowStages.find((stage) => stage.id === artifact.stage)?.label}
                      {" · "}
                      {new Date(artifact.createdAt).toLocaleString()}
                      {staleReason ? ` · Rerun required · ${staleReason}` : ""}
                    </small>
                  </span>
                </button>
              );
            })
          ) : (
            <small>Artifacts appear as stage agents complete.</small>
          )}
        </div>
        {task.artifactNextCursor && onLoadMoreArtifacts ? (
          <Button
            tone="secondary"
            disabled={artifactPageLoading}
            onClick={async () => {
              setArtifactPageLoading(true);
              try {
                await onLoadMoreArtifacts();
              } finally {
                setArtifactPageLoading(false);
              }
            }}
          >
            {artifactPageLoading
              ? "Loading older artifacts…"
              : `Load ${Math.min(60, Math.max(0, (task.artifactCount ?? 0) - task.artifacts.length))} older artifacts`}
          </Button>
        ) : null}
      </InspectorSection>
    </>
  );
}
