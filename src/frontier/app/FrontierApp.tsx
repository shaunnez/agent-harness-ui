import {
  ArrowLeft,
  ArrowRight,
  Buildings,
  GlobeHemisphereWest,
  ListBullets,
  Plus,
  RocketLaunch,
  Robot,
  Books,
  ChartBar,
  GearSix,
} from "@phosphor-icons/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { NewTaskDraft } from "../../domain";
import { createFixtureGateway } from "../fixtures/gateway";
import { errorMessage, RefreshCoordinator } from "../runtime/coordinator";
import { liveGateway } from "../runtime/live-gateway";
import { commandDestination, isActiveRun, latestRun } from "../runtime/presentation";
import { AgentPanel } from "../views/AgentPanel";
import {
  AttentionQueue,
  ConnectionBadge,
  ProjectHud,
  SelectionHud,
  WorldActions,
  WorldClock,
} from "../views/WorldHud";
import { tasksInProject } from "../world/layout";
import { artDirection, featuredProjectId } from "../world/asset-policy";
import { cinematicWorker } from "../world/cinematic-catalog";
import type { WorldRenderer } from "../world/renderer";
import { WorldCanvas } from "../world/WorldCanvas";
import { BuildDiagnostics } from "./BuildDiagnostics";
import { ArtPreview } from "./ArtPreview";
import { useNavigation, worldLocation } from "./navigation";
import { type Overlay, OverlayHost } from "./OverlayHost";
import { PanelMemoryProvider } from "./panel-state";
import { readPreferences, savePreferences } from "./preferences";
import { WorldAudio } from "./world-audio";

export function FrontierApp() {
  const runtime = useMemo(
    () =>
      new RefreshCoordinator(
        new URLSearchParams(window.location.search).get("mode") === "fixture"
          ? createFixtureGateway(
              new URLSearchParams(window.location.search).get("qa") === "1"
                ? new URLSearchParams(window.location.search).get("load") === "stress"
                  ? "stress"
                  : new URLSearchParams(window.location.search).get("load") === "normal"
                    ? "normal"
                    : undefined
                : undefined,
              new URLSearchParams(window.location.search).get("scenario") === "workflow",
              new URLSearchParams(window.location.search).get("qa") === "1" &&
                new URLSearchParams(window.location.search).get("scenario") === "stations",
            )
          : liveGateway,
      ),
    [],
  );
  const snapshot = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot);
  const { location, navigate, stack, setStack } = useNavigation();
  const [preferences, setPreferences] = useState(readPreferences);
  const [reduced, setReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [pickedProject, setPickedProject] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [draft, setDraft] = useState<NewTaskDraft>({
    title: "",
    description: "",
    repositoryPath: "",
    workflow: "investigate",
    priority: "medium",
  });
  const renderer = useRef<WorldRenderer | null>(null);
  const worldAudio = useRef<WorldAudio | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  useEffect(() => {
    if (!preferences.ambientAudio && !preferences.effectsAudio) return;
    const resume = () => {
      worldAudio.current ??= new WorldAudio();
      void worldAudio.current
        .configure(preferences)
        .catch((error: unknown) => setAudioError(errorMessage(error)));
    };
    window.addEventListener("pointerdown", resume, { once: true });
    window.addEventListener("keydown", resume, { once: true });
    return () => {
      window.removeEventListener("pointerdown", resume);
      window.removeEventListener("keydown", resume);
    };
  }, [preferences]);
  useEffect(
    () => () => {
      worldAudio.current?.destroy();
    },
    [],
  );
  const commandLock = useRef(false);
  const commandContext = useRef(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Navigation commits invalidate pending command callbacks, including browser Back.
  useLayoutEffect(() => {
    commandContext.current++;
    setCommandError(null);
  }, [location, stack]);
  const initialSelection = useRef(false);
  const selectionTiming = useRef<{ started: number | null; samples: number[] }>({
    started: null,
    samples: [],
  });
  const selected = snapshot.tasks.find((task) => task.id === snapshot.selectedId);
  const task = snapshot.selected?.core;
  const connected = snapshot.connection === "connected";
  const fixture = runtime.gateway.mode === "fixture";
  const project =
    snapshot.projects.find((entry) => entry.id === (location.projectId ?? pickedProject)) ??
    (location.view === "agent" && selected
      ? snapshot.projects.find((entry) => entry.repositoryPath === selected.repositoryPath)
      : undefined);
  const scopedTasks =
    project && location.view !== "world" ? tasksInProject(snapshot.tasks, project) : snapshot.tasks;
  const run = location.runId
    ? snapshot.selected?.runs.items.find((entry) => entry.id === location.runId)
    : latestRun(snapshot.selected?.runs.items ?? [], task?.activeRunIds);
  const sceneInput = useMemo(
    () => ({
      mode: runtime.gateway.mode,
      placementNamespace:
        runtime.gateway.mode === "fixture" && new URLSearchParams(window.location.search).has("load")
          ? "fixture-load"
          : runtime.gateway.mode,
      projects: snapshot.projects.filter((item) => !item.archivedAt),
      tasks: snapshot.tasks,
      location,
      selectedId: snapshot.selectedId,
      connected,
      motion: preferences.motion && !reduced,
      cameraSensitivity: preferences.cameraSensitivity,
      watchedRunActive: Boolean(task && run && isActiveRun(task, run)),
    }),
    [
      runtime.gateway.mode,
      snapshot.projects,
      snapshot.tasks,
      location,
      snapshot.selectedId,
      connected,
      preferences.motion,
      preferences.cameraSensitivity,
      reduced,
      task,
      run,
    ],
  );
  // Measure after scene effects and an intervening paint, including the visible selection frame.
  useEffect(() => {
    const started = selectionTiming.current.started;
    if (started == null || (!snapshot.selectedId && !pickedProject)) return;
    selectionTiming.current.started = null;
    let painted = 0;
    const scheduled = requestAnimationFrame(() => {
      painted = requestAnimationFrame(() => {
        selectionTiming.current.samples.push(performance.now() - started);
        selectionTiming.current.samples = selectionTiming.current.samples.slice(-200);
      });
    });
    return () => {
      cancelAnimationFrame(scheduled);
      cancelAnimationFrame(painted);
    };
  }, [snapshot.selectedId, pickedProject]);

  useEffect(() => {
    if (fixture && !initialSelection.current && snapshot.tasks.length) {
      initialSelection.current = true;
      if (runtime.getSnapshot().selectedId) return;
      runtime.select(
        location.taskId ??
          (snapshot.tasks.some((item) => item.id === "PC-142") ? "PC-142" : (snapshot.tasks[0]?.id ?? null)),
      );
    }
  }, [fixture, snapshot.tasks, runtime, location.taskId]);
  useEffect(() => {
    runtime.start();
    return () => runtime.stop();
  }, [runtime]);
  useEffect(() => {
    if (location.taskId) runtime.select(location.taskId);
  }, [location.taskId, runtime]);
  const overlay = stack.at(-1);
  const overlayTaskId = overlay && "taskId" in overlay ? overlay.taskId : null;
  useEffect(() => {
    if (overlayTaskId) runtime.select(overlayTaskId);
  }, [overlayTaskId, runtime]);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  function open(next: Overlay) {
    commandContext.current++;
    setCommandError(null);
    if ("taskId" in next) runtime.select(next.taskId);
    setStack((current) => [...current, next]);
  }
  function close() {
    commandContext.current++;
    setCommandError(null);
    setStack([]);
  }
  function back() {
    commandContext.current++;
    setCommandError(null);
    setStack((current) => current.slice(0, -1));
  }
  function inspect(id: string, kind: "task" | "grill" | "findings" = "task") {
    open({ kind, taskId: id });
  }
  function actOn(id: string) {
    const item = snapshot.tasks.find((entry) => entry.id === id);
    if (item) inspect(id, commandDestination(item));
  }
  function watch(id: string, runId: string | null = null) {
    close();
    runtime.select(id);
    navigate({ ...worldLocation, view: "agent", taskId: id, runId });
  }
  function locate(id: string) {
    const item = snapshot.tasks.find((entry) => entry.id === id);
    const owner = snapshot.projects.find((entry) => entry.repositoryPath === item?.repositoryPath);
    close();
    runtime.select(id);
    if (owner) navigate({ ...worldLocation, view: "project", projectId: owner.id });
  }
  function choose(kind: "project" | "task", id: string) {
    selectionTiming.current.started =
      kind === "task" && id === snapshot.selectedId ? null : performance.now();
    commandContext.current++;
    if (kind === "task") {
      runtime.select(id);
      setPickedProject(null);
      if (preferences.followSelection) renderer.current?.follow(id);
    } else if (pickedProject === id) navigate({ ...worldLocation, view: "project", projectId: id });
    else {
      setPickedProject(id);
      runtime.select(null);
    }
    worldAudio.current?.select();
  }
  function newTask() {
    setDraft((current) => ({
      ...current,
      repositoryPath:
        current.repositoryPath ||
        (project?.archivedAt ? "" : project?.repositoryPath) ||
        snapshot.projects.find((item) => !item.archivedAt)?.repositoryPath ||
        "",
    }));
    open({ kind: "new-task" });
  }
  async function command<T>(action: () => Promise<T>, then?: (value: T) => void) {
    if (commandLock.current || !connected) return;
    const context = commandContext.current;
    commandLock.current = true;
    setBusy(true);
    setCommandError(null);
    try {
      const result = await action();
      await runtime.synchronize();
      if (context === commandContext.current) then?.(result);
    } catch (error) {
      if (context === commandContext.current) setCommandError(errorMessage(error));
      runtime.retry();
    } finally {
      commandLock.current = false;
      setBusy(false);
    }
  }
  async function create() {
    await command(
      () => runtime.gateway.create(draft),
      (created) => {
        runtime.select(created.id);
        setStack([{ kind: "task", taskId: created.id }]);
        setDraft({ ...draft, title: "", description: "", attachments: [] });
      },
    );
  }
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLElement &&
        (event.target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(event.target.tagName))
      )
        return;
      if (document.querySelector("dialog[open]") || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "j" || event.key === "/") {
        event.preventDefault();
        open({ kind: "tasks" });
      } else if (event.key === "g") navigate(worldLocation);
      else if (["p", "a", "k", "u", ","].includes(event.key)) {
        const destination = { p: "projects", a: "agents", k: "skills", u: "usage", ",": "settings" } as const;
        open({ kind: destination[event.key as keyof typeof destination] });
      } else if (event.key === "Escape") {
        runtime.select(null);
        setPickedProject(null);
      } else if (event.key === " " && snapshot.selectedId) {
        event.preventDefault();
        renderer.current?.follow(snapshot.selectedId);
      } else if (event.key.startsWith("Arrow")) {
        event.preventDefault();
        renderer.current?.pan(
          event.key === "ArrowLeft" ? 70 : event.key === "ArrowRight" ? -70 : 0,
          event.key === "ArrowUp" ? 70 : event.key === "ArrowDown" ? -70 : 0,
        );
      } else if (event.key === "+" || event.key === "=") renderer.current?.zoom(1.2);
      else if (event.key === "-") renderer.current?.zoom(0.8);
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  });
  const selectedForHud = task ?? selected;
  const artworkProject = snapshot.projects.find(
    (entry) => entry.id === featuredProjectId(snapshot.projects.filter((item) => !item.archivedAt)),
  );
  const portrait =
    artDirection(window.location.search) === "cinematic" &&
    artworkProject?.repositoryPath === selectedForHud?.repositoryPath
      ? cinematicWorker.portrait
      : undefined;
  return (
    <main className={`frontier-shell view-${location.view}`}>
      <WorldCanvas
        input={sceneInput}
        preferences={preferences}
        onSelect={choose}
        onEnterProject={(id) => navigate({ ...worldLocation, view: "project", projectId: id })}
        onArtifact={(taskId, artifactId) => open({ kind: "artifact", taskId, artifactId })}
        rendererRef={renderer}
      />
      <header className="top-hud">
        <button type="button" className="brand panel" onClick={() => navigate(worldLocation)}>
          <RocketLaunch size={26} weight="duotone" />
          <strong>Agent Harness</strong>
        </button>
        <label className="project-picker panel">
          <span className="sr-only">Project scope</span>
          <select
            value={location.projectId ?? "all"}
            onChange={(event) =>
              navigate(
                event.target.value === "all"
                  ? worldLocation
                  : { ...worldLocation, view: "project", projectId: event.target.value },
              )
            }
          >
            <option value="all">All projects</option>
            {snapshot.projects
              .filter((entry) => !entry.archivedAt)
              .map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
          </select>
        </label>
        <WorldClock />
        {location.view !== "world" && (
          <button type="button" className="return-world" onClick={() => navigate(worldLocation)}>
            <ArrowLeft size={18} />
            Return to world
          </button>
        )}
      </header>
      <nav className="world-navigation" aria-label="Main navigation">
        <button type="button" className="selected" onClick={() => navigate(worldLocation)}>
          <GlobeHemisphereWest size={18} />
          World
        </button>
        <button type="button" onClick={() => open({ kind: "tasks" })}>
          <ListBullets size={18} />
          Tasks<kbd>J</kbd>
        </button>
        <button type="button" onClick={() => open({ kind: "projects" })}>
          <Buildings size={18} />
          Projects
        </button>
        <button type="button" onClick={() => open({ kind: "agents" })}>
          <Robot size={18} />
          Agents
        </button>
        <button type="button" onClick={() => open({ kind: "skills" })}>
          <Books size={18} />
          Skills
        </button>
        <button type="button" onClick={() => open({ kind: "usage" })}>
          <ChartBar size={18} />
          Usage
        </button>
        <button type="button" onClick={() => open({ kind: "settings" })}>
          <GearSix size={18} />
          Settings
        </button>
        {location.view === "project" && <span className="breadcrumb">/ {project?.name}</span>}
      </nav>
      {location.view !== "agent" && <AttentionQueue tasks={scopedTasks} onSelect={actOn} />}
      {project && location.view === "project" && (
        <ProjectHud project={project} tasks={scopedTasks} onTasks={() => open({ kind: "tasks" })} />
      )}
      {location.view === "agent" && snapshot.selected && (
        <AgentPanel
          portrait={portrait}
          evidence={snapshot.selected}
          run={run}
          connected={connected}
          onAction={() => task && actOn(task.id)}
          onInspect={() => task && inspect(task.id)}
          onArtifact={(id) => task && open({ kind: "artifact", taskId: task.id, artifactId: id })}
          onRun={(id) => task && watch(task.id, id)}
          onMore={(kind) => void runtime.more(kind)}
          onPolicies={() => task && open({ kind: "task-policies", taskId: task.id })}
          requestedRunId={location.runId}
        />
      )}
      {location.view !== "agent" && selectedForHud && (
        <SelectionHud
          portrait={portrait}
          task={selectedForHud}
          run={run}
          loading={snapshot.selectedLoading}
          connected={connected}
          onAction={() => actOn(selectedForHud.id)}
          onInspect={() => inspect(selectedForHud.id)}
          onWatch={() => watch(selectedForHud.id, run?.id)}
          onClose={() => runtime.select(null)}
        />
      )}
      {location.view === "world" && pickedProject && project && !selected && (
        <section className="selection-hud panel project-selection">
          <div>
            <small>Project headquarters</small>
            <h2>{project.name}</h2>
            <p>{project.repositoryPath.split("/").at(-1)}</p>
          </div>
          <button
            type="button"
            className="primary"
            onClick={() => navigate({ ...worldLocation, view: "project", projectId: project.id })}
          >
            Enter base
            <ArrowRight size={20} />
          </button>
        </section>
      )}
      {location.view === "world" && (
        <WorldActions
          onNew={newTask}
          onTasks={() => open({ kind: "tasks" })}
          onSettings={() => open({ kind: "world-settings" })}
        />
      )}
      {location.view === "project" && (
        <button type="button" className="primary hq-new-task" onClick={newTask}>
          <Plus size={20} />
          New task
        </button>
      )}
      <ConnectionBadge snapshot={snapshot} fixture={fixture} onRetry={() => runtime.retry()} />
      {!stack.length && <ArtPreview />}
      {!snapshot.tasks.length && (
        <section className="empty-world panel">
          <h1>
            {snapshot.connection === "connecting"
              ? "Connecting to your world"
              : snapshot.connection === "offline"
                ? "Your world is offline"
                : !snapshot.projects.length
                  ? "Connect your projects"
                  : "Your base is ready"}
          </h1>
          <p>
            {snapshot.error ??
              (snapshot.connection === "connecting"
                ? "Connecting to the local runtime…"
                : "Create a task to brief your first crew.")}
          </p>
          <button
            type="button"
            className="primary"
            disabled={!connected || !snapshot.projects.length}
            onClick={newTask}
          >
            Create a task
            <Plus size={18} />
          </button>
          <button type="button" onClick={() => open({ kind: "world-settings" })}>
            Connection settings
          </button>
          {connected && (
            <button type="button" onClick={() => open({ kind: "project-setup" })}>
              Add a project
            </button>
          )}
        </section>
      )}
      {snapshot.selectedError && !stack.length && (
        <p className="selection-error panel" role="alert">
          {snapshot.selectedError}
          <button type="button" onClick={() => runtime.retry()}>
            Retry task
          </button>
        </p>
      )}
      <BuildDiagnostics renderer={renderer} runtime={runtime} selectionTiming={selectionTiming} />
      {audioError && (
        <p role="alert" className="selection-error panel">
          {audioError}
          <button type="button" onClick={() => setAudioError(null)}>
            Dismiss
          </button>
        </p>
      )}
      <PanelMemoryProvider>
        <OverlayHost
          stack={stack}
          snapshot={snapshot}
          scopedTasks={scopedTasks}
          runtime={runtime}
          draft={draft}
          setDraft={setDraft}
          preferences={preferences}
          onPreferences={(value) => {
            setPreferences(value);
            savePreferences(value);
            if (value.ambientAudio || value.effectsAudio || worldAudio.current) {
              worldAudio.current ??= new WorldAudio();
              void worldAudio.current
                .configure(value)
                .catch(() =>
                  setAudioError("Audio could not start. Try toggling audio again in World settings."),
                );
            }
          }}
          busy={busy}
          error={commandError}
          run={run}
          open={open}
          close={close}
          back={back}
          inspect={inspect}
          locate={locate}
          watch={watch}
          create={() => void create()}
          enterProject={(id) => {
            close();
            navigate({ ...worldLocation, view: "project", projectId: id });
          }}
          command={command}
        />
      </PanelMemoryProvider>
    </main>
  );
}
