import { ArrowRight, Buildings, Clock, MagnifyingGlass, Plus } from "@phosphor-icons/react";
import { type RefObject, useEffect, useMemo, useState } from "react";
import type { RuntimeProject } from "../../domain";
import { usePanelState } from "../app/panel-state";
import type { TaskSummary } from "../runtime/contracts";
import { formatCount, isExecuting, isOpen, needsYou } from "../runtime/presentation";
import { tasksInProject } from "../scene/tasks";
import { type BaseAppearance, baseNames, basePalettes, projectAppearanceKey } from "../world-3d/appearance";
import type { ProofControls } from "../world-3d/model";
import { useBaseAppearance } from "../world-3d/useBaseAppearance";

function nextFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

function useProjectPreviews(
  projects: RuntimeProject[],
  appearances: Record<string, BaseAppearance>,
  rendererRef: RefObject<ProofControls | null>,
) {
  const signature = useMemo(
    () =>
      JSON.stringify(
        projects.map((project) => {
          const appearance = appearances[projectAppearanceKey(project)];
          return {
            id: project.id,
            variant: appearance?.variant ?? "",
            palette: appearance?.palette ?? "",
          };
        }),
      ),
    [projects, appearances],
  );
  const [previews, setPreviews] = useState<Record<string, string>>({});
  useEffect(() => {
    let active = true;
    setPreviews({});
    void (async () => {
      const targets = JSON.parse(signature) as Array<{ id: string }>;
      await nextFrame();
      for (let attempt = 0; active && attempt < 20 && !rendererRef.current; attempt++)
        await new Promise((resolve) => setTimeout(resolve, 100));
      if (!active || !rendererRef.current) return;
      for (const project of targets) {
        const image = await rendererRef.current?.basePreview(project.id);
        if (!active) return;
        if (image) setPreviews((current) => ({ ...current, [project.id]: image }));
      }
    })();
    return () => {
      active = false;
    };
  }, [rendererRef, signature]);
  return previews;
}

function ProjectBasePreview({
  project,
  appearance,
  image,
  compact = false,
}: {
  project: RuntimeProject;
  appearance: BaseAppearance;
  image?: string;
  compact?: boolean;
}) {
  const palette = basePalettes[appearance.palette];
  return (
    <div className={`captured-base-preview ${compact ? "compact" : "base-preview-art"}`}>
      {image ? (
        <img src={image} alt={`${project.name} ${baseNames[appearance.variant]} headquarters`} />
      ) : (
        <span className="captured-base-loading" role="status">
          Rendering 3D base…
        </span>
      )}
      <span className="captured-base-labels" aria-hidden="true">
        <span>{baseNames[appearance.variant]}</span>
        <span>
          <i style={{ background: palette.color }} /> {palette.label}
        </span>
      </span>
    </div>
  );
}

export function Projects({
  projects,
  tasks,
  rendererRef,
  onAdd,
  onManage,
  onEnter,
  onTasks,
}: {
  projects: RuntimeProject[];
  tasks: TaskSummary[];
  rendererRef: RefObject<ProofControls | null>;
  onAdd(): void;
  onManage(id: string): void;
  onEnter(id: string): void;
  onTasks(id: string): void;
}) {
  const [query, setQuery] = usePanelState("projects-query", "");
  const [archived, setArchived] = usePanelState("projects-archived", false);
  const [selectedId, select] = usePanelState<string | null>("projects-selected", null);
  const { appearances } = useBaseAppearance(projects);
  const previews = useProjectPreviews(projects, appearances, rendererRef);
  const visible = projects.filter(
    (project) =>
      Boolean(project.archivedAt) === archived &&
      `${project.name} ${project.repositoryPath}`.toLowerCase().includes(query.toLowerCase()),
  );
  const selected = visible.find((project) => project.id === selectedId) ?? visible[0];
  const selectedTasks = selected ? tasksInProject(tasks, selected) : [];
  const selectedAppearance = selected ? appearances[projectAppearanceKey(selected)] : undefined;
  return (
    <div className="overlay-body projects-layout">
      <section className="project-directory">
        <div className="section-heading">
          <div>
            <h2>Your projects</h2>
            <p className="quiet">Headquarters across your world</p>
          </div>
          <button type="button" className="primary" onClick={onAdd}>
            <Plus size={19} />
            Add project
          </button>
        </div>
        <div className="journal-tools">
          <label>
            <MagnifyingGlass size={18} />
            <input
              aria-label="Search projects"
              placeholder="Search projects"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <select
            aria-label="Project status"
            value={archived ? "archived" : "active"}
            onChange={(event) => setArchived(event.target.value === "archived")}
          >
            <option value="active">Active projects</option>
            <option value="archived">Archived projects</option>
          </select>
        </div>
        <div className="project-list">
          {visible.map((project) => {
            const items = tasksInProject(tasks, project);
            const updated = items.reduce(
              (latest, task) => (task.updatedAt > latest ? task.updatedAt : latest),
              project.createdAt ?? "",
            );
            const appearance = appearances[projectAppearanceKey(project)];
            if (!appearance) return null;
            return (
              <button
                type="button"
                className={`project-row ${selected?.id === project.id ? "selected" : ""}`}
                key={project.id}
                onClick={() => select(project.id)}
                aria-pressed={selected?.id === project.id}
              >
                <ProjectBasePreview
                  project={project}
                  appearance={appearance}
                  image={previews[project.id]}
                  compact
                />
                <span className="project-row-identity">
                  <strong>{project.name}</strong>
                  <small>{project.kind === "research" ? "Research project" : project.repositoryPath}</small>
                  {project.kind === "research" ? (
                    <span className="project-counts">
                      <span>Costing questions, five runs each</span>
                    </span>
                  ) : (
                    <span className="project-counts">
                      <span>{items.filter(isOpen).length} active</span>
                      <span className="waiting-icon">{items.filter(needsYou).length} need you</span>
                      <span>{items.filter((task) => task.status === "completed").length} completed</span>
                    </span>
                  )}
                </span>
                <span className="project-updated">
                  <Clock size={16} />
                  {updated ? new Date(updated).toLocaleDateString() : "No tasks yet"}
                </span>
                <ArrowRight size={20} />
              </button>
            );
          })}
        </div>
        {!visible.length && (
          <div className="empty-state">
            <Buildings size={34} />
            <h3>
              {query
                ? "No matching projects"
                : archived
                  ? "No archived projects"
                  : projects.length
                    ? "No active projects"
                    : "Connect your first project"}
            </h3>
            <p>
              {query
                ? "Try a different name or repository."
                : "Each project gets a headquarters in your world."}
            </p>
            {!archived && !query && (
              <button type="button" onClick={onAdd}>
                Add project
              </button>
            )}
          </div>
        )}
      </section>
      {selected && (
        <aside className="project-detail mission-briefing">
          <div className="section-heading">
            <h2>{selected.name}</h2>
            <Buildings size={22} />
          </div>
          {selectedAppearance && (
            <ProjectBasePreview
              project={selected}
              appearance={selectedAppearance}
              image={previews[selected.id]}
            />
          )}
          <p className="repository-path">
            {selected.kind === "research" ? "Research project · no repository" : selected.repositoryPath}
          </p>
          {selected.kind !== "research" && (
            <div className="metric-grid">
              <div>
                <strong>{selectedTasks.filter(isOpen).length}</strong>
                <small>Active tasks</small>
              </div>
              <div>
                <strong>{selectedTasks.filter(isExecuting).length}</strong>
                <small>Executing</small>
              </div>
              <div>
                <strong>{selectedTasks.filter(needsYou).length}</strong>
                <small>Need you</small>
              </div>
              <div>
                <strong>
                  {formatCount(selectedTasks.reduce((sum, task) => sum + task.usage.totalTokens, 0))}
                </strong>
                <small>Recorded tokens</small>
              </div>
            </div>
          )}
          <p className="quiet">
            {selected.archivedAt
              ? `Archived ${new Date(selected.archivedAt).toLocaleDateString()}`
              : selected.kind === "research"
                ? "Questions, runs and reviews open in the research window."
                : "Task stages and agent activity come from retained runtime state."}
          </p>
          <div className="project-detail-actions">
            <button
              type="button"
              className="primary"
              disabled={Boolean(selected.archivedAt)}
              onClick={() => onEnter(selected.id)}
            >
              {selected.kind === "research" ? "Open research" : "Enter base"}
              <ArrowRight size={19} />
            </button>
            {selected.kind !== "research" && (
              <button type="button" onClick={() => onTasks(selected.id)}>
                View tasks
              </button>
            )}
            <button type="button" onClick={() => onManage(selected.id)}>
              {selected.archivedAt ? "Manage / restore" : "Manage project"}
            </button>
          </div>
        </aside>
      )}
    </div>
  );
}
