import {
  ChatCircleText,
  Flask,
  GearSix,
  GlobeHemisphereWest,
  ListMagnifyingGlass,
} from "@phosphor-icons/react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { RuntimeProject } from "../../domain";
import { useBottomHudLayout } from "../app/bottom-hud-layout";
import { PanelMemoryProvider } from "../app/panel-state";
import { readPreferences, savePreferences, type WorldPreferences } from "../app/preferences";
import { researchEngineLabel, researchEnginePlan } from "../runtime/research";
import type { SceneInput } from "../scene/input";
import { Modal } from "../ui/Modal";
import { ResearchAsk } from "../views/research/ResearchAsk";
import { ResearchBaseSelection } from "../views/research/ResearchBaseSelection";
import { ResearchQuestions } from "../views/research/ResearchQuestions";
import { ResearchQuestionView } from "../views/research/ResearchQuestionView";
import type { ProofControls } from "../world-3d/model";
import { ConsoleSettings } from "./ConsoleSettings";
import { type ConsoleEngine, consoleGateway, FIXTURES_AVAILABLE } from "./gateway";

// The research console: the research service's own build of Frontier. One world with the research
// bases only, and the research windows (questions, a question, Ask, settings). No task workspace,
// New task, agent roster, Linear or Companion: those belong to the harness, which stays dev only
// (`research-agent-deepagents-spike-pack/32-RESEARCH-SPLIT-PLAN.md`, Phase 4). The build fails if
// one of their modules is bundled (`vite.research-console.config.mjs`).

const ProofWorld = lazy(() =>
  import("../world-3d/ProofWorld").then((module) => ({ default: module.ProofWorld })),
);

type Overlay =
  | { kind: "research"; projectId: string; questionId?: string }
  | { kind: "research-ask"; projectId: string }
  | { kind: "settings" };

const WORLD = { view: "world", projectId: null, taskId: null, runId: null } as const;
const REFRESH_MS = 30_000;

export function ResearchConsoleApp() {
  const mode =
    FIXTURES_AVAILABLE && new URLSearchParams(window.location.search).get("mode") === "fixture"
      ? "fixture"
      : "live";
  const gateway = useMemo(() => consoleGateway(mode), [mode]);
  const [projects, setProjects] = useState<RuntimeProject[]>([]);
  const [engine, setEngine] = useState<ConsoleEngine | null>(null);
  const [connection, setConnection] = useState<"connecting" | "connected" | "offline">("connecting");
  const [problem, setProblem] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [stack, setStack] = useState<Overlay[]>([]);
  const [preferences, setPreferences] = useState<WorldPreferences>(readPreferences);
  const [reduced, setReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const renderer = useRef<ProofControls | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is how Reconnect asks again.
  useEffect(() => {
    let disposed = false;
    const load = async () => {
      try {
        const [nextProjects, nextEngine] = await Promise.all([gateway.projects(), gateway.engine()]);
        if (disposed) return;
        setProjects(nextProjects);
        setEngine(nextEngine);
        setConnection("connected");
        setProblem(null);
      } catch (error) {
        if (disposed) return;
        setConnection("offline");
        setProblem(error instanceof Error ? error.message : String(error));
      }
    };
    void load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [gateway, attempt]);

  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const live = useMemo(() => projects.filter((entry) => !entry.archivedAt), [projects]);
  const project = live.find((entry) => entry.id === picked) ?? null;
  const connected = connection === "connected";
  const overlay = stack.at(-1);
  const sceneInput = useMemo<SceneInput>(
    () => ({
      mode,
      placementNamespace: `research-console-${mode}`,
      projects: live,
      // Research runs are not tasks; the world shows bases and no crews until runs are drawn.
      tasks: [],
      location: WORLD,
      selectedId: null,
      connected,
      motion: preferences.motion && !reduced,
      cameraSensitivity: preferences.cameraSensitivity,
      idleRoaming: preferences.idleRoaming,
      environment: preferences.environment,
      watchedRunActive: false,
    }),
    [mode, live, connected, preferences, reduced],
  );

  const open = (next: Overlay) => setStack((current) => [...current, next]);
  const close = () => setStack([]);
  const back = () => setStack((current) => current.slice(0, -1));
  const firstProject = project ?? live[0] ?? null;
  const openResearch = (id: string) => {
    setPicked(id);
    setStack([{ kind: "research", projectId: id }]);
  };
  function choose(kind: "project" | "task", id: string) {
    if (kind !== "project") return;
    if (picked === id) openResearch(id);
    else setPicked(id);
  }

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLElement &&
        (event.target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(event.target.tagName))
      )
        return;
      if (document.querySelector("dialog[open]") || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Escape") setPicked(null);
      else if (event.key === "q" && firstProject) openResearch(firstProject.id);
      else if (event.key === ",") open({ kind: "settings" });
      else if (event.key.startsWith("Arrow")) {
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

  const shell = useBottomHudLayout(false, Boolean(project), "world");
  const overlayProject =
    overlay && "projectId" in overlay ? live.find((entry) => entry.id === overlay.projectId) : null;

  return (
    <main ref={shell} className="frontier-shell view-world research-console">
      {live.length ? (
        <Suspense
          fallback={
            <p className="world-error panel" role="status">
              Loading the world…
            </p>
          }
        >
          <ProofWorld
            input={sceneInput}
            selectedProjectId={picked}
            preferences={preferences}
            controlsRef={renderer}
            onSelect={choose}
            onExterior={() => setPicked(null)}
            onEnterProject={openResearch}
            onWorldSettings={() => open({ kind: "settings" })}
          />
        </Suspense>
      ) : (
        <section className="empty-world panel">
          <h1>
            {connection === "connecting"
              ? "Connecting to the research service"
              : connection === "offline"
                ? "The research service is offline"
                : "No research project yet"}
          </h1>
          <p>
            {problem ??
              (connection === "connecting"
                ? "Reading the research projects…"
                : "The service makes its standing project when it starts; restart it to create one.")}
          </p>
          {connection === "offline" && (
            <button type="button" className="primary" onClick={() => setAttempt((value) => value + 1)}>
              Reconnect
            </button>
          )}
        </section>
      )}

      <header className="top-hud">
        <button type="button" className="brand panel" onClick={() => setPicked(null)}>
          <Flask size={26} weight="duotone" />
          <strong>Eversor Research</strong>
        </button>
        {live.length > 1 && (
          <label className="project-picker panel">
            <span className="sr-only">Research project</span>
            <select value={picked ?? ""} onChange={(event) => setPicked(event.target.value || null)}>
              <option value="">All research projects</option>
              {live.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <ConsoleClock />
      </header>

      {project && !stack.length && (
        <ResearchBaseSelection
          project={project}
          research={gateway.research}
          rendererRef={renderer}
          onOpen={() => openResearch(project.id)}
          onAsk={() => open({ kind: "research-ask", projectId: project.id })}
        />
      )}

      <aside className="world-actions panel">
        <div className="secondary-actions">
          <button
            type="button"
            disabled={!firstProject}
            onClick={() => firstProject && openResearch(firstProject.id)}
          >
            <ListMagnifyingGlass size={23} />
            Questions
          </button>
          <button
            type="button"
            disabled={!firstProject || !connected}
            onClick={() => firstProject && open({ kind: "research-ask", projectId: firstProject.id })}
          >
            <ChatCircleText size={23} />
            Ask a question
          </button>
          <button type="button" onClick={() => open({ kind: "settings" })}>
            <GearSix size={23} />
            Settings
          </button>
        </div>
        <small>Drag to pan · Scroll to zoom · Q for questions</small>
      </aside>

      <div className={`connection-badge ${connection === "offline" ? "offline" : ""}`}>
        <GlobeHemisphereWest size={15} />
        <span>
          {mode === "fixture"
            ? "Sample research · recorded questions, actions stay in this tab"
            : connection === "connected"
              ? engine
                ? `Research service · ${researchEngineLabel(engine.engine)} · ${researchEnginePlan(engine.engine).split(" · ")[1] ?? ""}`
                : "Research service connected"
              : connection === "connecting"
                ? "Connecting…"
                : "Research service offline · last known state"}
        </span>
        {connection === "offline" && (
          <button type="button" className="link-button" onClick={() => setAttempt((value) => value + 1)}>
            Reconnect
          </button>
        )}
      </div>

      <PanelMemoryProvider key={mode}>
        {overlay && (
          <Modal
            family={
              overlay.kind === "research"
                ? "evidence"
                : overlay.kind === "research-ask"
                  ? "form"
                  : "management"
            }
            focusKey={`${overlay.kind}:${"projectId" in overlay ? overlay.projectId : ""}:${
              overlay.kind === "research" ? (overlay.questionId ?? "") : ""
            }`}
            title={
              overlay.kind === "settings"
                ? "Research settings"
                : overlay.kind === "research-ask"
                  ? "Ask a research question"
                  : `${overlayProject?.name ?? "Research"} · ${overlay.questionId ? "Question" : "Research questions"}`
            }
            onClose={close}
            onBack={stack.length > 1 ? back : undefined}
            className={`overlay-${overlay.kind}`}
          >
            {!connected && mode === "live" && (
              <p className="connection-notice" role="alert">
                The research service is not answering. What you see is the last state it sent.
              </p>
            )}
            {mode === "fixture" && (
              <p className="sample-mode-banner">
                Sample research · Recorded questions; actions stay in this tab.
              </p>
            )}
            {overlay.kind === "settings" ? (
              <ConsoleSettings
                mode={mode}
                engine={engine}
                preferences={preferences}
                onPreferences={(value) => {
                  setPreferences(value);
                  savePreferences(value);
                }}
              />
            ) : !overlayProject ? (
              <div className="overlay-body">
                <p>This research project is not on the research service.</p>
              </div>
            ) : overlay.kind === "research-ask" ? (
              <ResearchAsk
                project={overlayProject}
                research={gateway.research}
                status={null}
                engine={engine?.engine}
                connected={connected}
                onAsked={(questionId) => {
                  back();
                  open({ kind: "research", projectId: overlayProject.id, questionId });
                }}
                onSettings={() => open({ kind: "settings" })}
                onClose={back}
              />
            ) : overlay.questionId ? (
              <ResearchQuestionView
                key={overlay.questionId}
                research={gateway.research}
                questionId={overlay.questionId}
                connected={connected}
              />
            ) : (
              <ResearchQuestions
                project={overlayProject}
                research={gateway.research}
                engineLabel={engine ? researchEngineLabel(engine.engine) : "DeepSeek 4.1 Flash"}
                onOpen={(questionId) => open({ kind: "research", projectId: overlayProject.id, questionId })}
                onAsk={() => open({ kind: "research-ask", projectId: overlayProject.id })}
              />
            )}
          </Modal>
        )}
      </PanelMemoryProvider>
    </main>
  );
}

function ConsoleClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="world-clock">
      <span>
        {now.toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" })} ·{" "}
        {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      </span>
      <small>{Intl.DateTimeFormat().resolvedOptions().timeZone}</small>
    </div>
  );
}
