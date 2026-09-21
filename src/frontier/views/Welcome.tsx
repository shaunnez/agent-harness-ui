import {
  ArrowRight,
  ArrowsClockwise,
  Buildings,
  CheckCircle,
  Eye,
  Link,
  ListChecks,
  LockKey,
  Question,
  RocketLaunch,
  SpeakerHigh,
  SpeakerSlash,
  WifiSlash,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type { FrontierSnapshot } from "../runtime/contracts";
import { WorldClock } from "./WorldHud";

const media = "/assets/welcome/";

export function shouldShowWelcome(search: string, hash: string) {
  return new URLSearchParams(search).get("mode") !== "fixture" && (!hash || hash === "#");
}

export function WelcomePanel({
  snapshot,
  onRetry,
  onHelp,
  onAdd,
  onNew,
  onProjects,
  onEnter,
}: {
  snapshot: FrontierSnapshot;
  onRetry(): void;
  onHelp(): void;
  onAdd(): void;
  onNew(): void;
  onProjects(): void;
  onEnter(id: string): void;
}) {
  const projects = snapshot.projects.filter((project) => !project.archivedAt);
  const connected = snapshot.connection === "connected";
  const connecting = snapshot.connection === "connecting";
  const [help, setHelp] = useState(false);
  return (
    <section className="welcome-panel" aria-labelledby="welcome-heading">
      <header>
        <h1 id="welcome-heading">Welcome to your workspace</h1>
        <p>Build, run and review work with your local backend.</p>
      </header>
      {projects.length ? (
        <div className="welcome-projects">
          <div className="welcome-section-heading">
            <h2>Your projects</h2>
            <button type="button" onClick={onProjects}>
              View all <ArrowRight size={15} />
            </button>
          </div>
          {projects.slice(0, 3).map((project) => (
            <button
              type="button"
              className="welcome-project"
              key={project.id}
              onClick={() => onEnter(project.id)}
            >
              <span className="welcome-icon">
                <Buildings size={29} />
              </span>
              <span>
                <strong>{project.name}</strong>
                <small>{project.repositoryPath}</small>
              </span>
              <ArrowRight size={19} />
            </button>
          ))}
          {!connected && (
            <p className="welcome-muted">Last known projects · reconnect to refresh activity.</p>
          )}
        </div>
      ) : (
        <ol className="welcome-steps">
          {[
            {
              title: "Connect companion",
              detail: "Connect the local companion to load your projects and tasks.",
              Icon: Link,
              action: onRetry,
              disabled: connecting,
            },
            {
              title: "Add your first project",
              detail: "Register a local repository.",
              Icon: Buildings,
              action: onAdd,
              disabled: !connected,
            },
            {
              title: "Create a task",
              detail: "Define the work, assign agents and start execution.",
              Icon: ListChecks,
              action: onNew,
              disabled: true,
            },
          ].map(({ title, detail, Icon, action, disabled }, index) => (
            <li key={title}>
              <button type="button" onClick={action} disabled={disabled}>
                <span className="welcome-icon">
                  <Icon size={31} />
                </span>
                <span className="welcome-step-number">{index + 1}</span>
                <span>
                  <strong>{title}</strong>
                  <small>{detail}</small>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
      <div className={`welcome-connection ${connected ? "connected" : ""}`} role="status">
        <span className="welcome-status-icon">
          {connected ? <CheckCircle size={35} /> : <WifiSlash size={35} />}
        </span>
        <div>
          <strong>
            {connected
              ? "Companion connected"
              : connecting
                ? "Connecting to companion…"
                : "Companion not connected"}
          </strong>
          {snapshot.updatedAt && (
            <small>Last synced {new Date(snapshot.updatedAt).toLocaleTimeString()}</small>
          )}
          <p>
            {connected
              ? projects.length
                ? "Your projects and retained task history are ready."
                : "Add a project to create your first base."
              : "Connect the local companion to load your projects and tasks."}
          </p>
        </div>
      </div>
      <button
        type="button"
        className="primary welcome-primary"
        disabled={connecting}
        onClick={connected ? (projects.length ? onProjects : onAdd) : onRetry}
      >
        {connected ? <Buildings size={22} /> : <ArrowsClockwise size={22} />}
        {connected
          ? projects.length
            ? "Open your projects"
            : "Add your first project"
          : connecting
            ? "Connecting…"
            : "Retry connection"}
      </button>
      <div className="welcome-secondary">
        <button type="button" aria-expanded={help} onClick={() => setHelp(!help)}>
          <Question size={21} />
          Connection help
        </button>
        <a href="?mode=fixture#world">
          <Eye size={22} />
          <span>
            View demo world<small>Sample mode</small>
          </span>
        </a>
      </div>
      {help && (
        <div className="welcome-help">
          <p>
            This page uses your local Agent Harness companion for projects and tasks. If it is unavailable,
            check that the companion is running on this computer, then retry.
          </p>
          {snapshot.error && <p>{snapshot.error}</p>}
          <button type="button" onClick={onHelp}>
            Open world &amp; connection settings <ArrowRight size={16} />
          </button>
        </div>
      )}
      <footer>
        <LockKey size={27} />
        <div>
          One backend, one task history
          <small>Connect to your existing projects, tasks and retained evidence.</small>
        </div>
      </footer>
    </section>
  );
}

export function Welcome({
  reduced,
  onWorld,
  ...panelProps
}: Parameters<typeof WelcomePanel>[0] & { reduced: boolean; onWorld(): void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<"poster" | "playing" | "ready">(reduced ? "ready" : "poster");
  const [ended, setEnded] = useState(false);
  const [muted, setMuted] = useState(true);
  const ready = phase === "ready";
  useEffect(() => {
    if (reduced || ready) {
      video.current?.pause();
      setPhase("ready");
      return;
    }
    // Hold the supplied opening image briefly before starting the arrival.
    const start = window.setTimeout(() => {
      void video.current?.play().catch(() => setPhase("ready"));
    }, 700);
    const fallback = window.setTimeout(() => setPhase("ready"), 18_000);
    return () => {
      clearTimeout(start);
      clearTimeout(fallback);
      video.current?.pause();
    };
  }, [reduced, ready]);
  return (
    <div className={`welcome-screen ${ready ? "welcome-ready" : "welcome-intro"}`}>
      <img
        className="welcome-backdrop"
        src={`${media}${ended ? "arrival-end.jpg" : "arrival-poster.jpg"}`}
        alt="Futuristic island headquarters linked by bridges at sunset"
      />
      {!reduced && !ready && (
        <video
          ref={video}
          className={`welcome-film ${phase === "playing" ? "visible" : ""}`}
          src={`${media}arrival.mp4`}
          poster={`${media}arrival-poster.jpg`}
          muted={muted}
          playsInline
          preload="auto"
          tabIndex={-1}
          aria-label="Island arrival introduction"
          onPlaying={() => setPhase((current) => (current === "ready" ? current : "playing"))}
          onEnded={() => {
            setEnded(true);
            setPhase("ready");
          }}
          onError={() => setPhase("ready")}
        />
      )}
      {ready ? (
        <>
          <header className="welcome-topbar">
            <div className="welcome-brand">
              <RocketLaunch size={27} />
              <strong>Agent Harness</strong>
            </div>
            <WorldClock />
            <button type="button" onClick={onWorld}>
              Enter world <ArrowRight size={19} />
            </button>
          </header>
          <div className="welcome-panel-scroll">
            <WelcomePanel {...panelProps} />
          </div>
        </>
      ) : (
        <div className="welcome-intro-controls">
          <button
            type="button"
            className="welcome-skip"
            onClick={() => {
              const nextMuted = !muted;
              setMuted(nextMuted);
              if (video.current) {
                video.current.muted = nextMuted;
                void video.current.play().catch(() => setPhase("ready"));
              }
            }}
          >
            {muted ? <SpeakerSlash size={19} /> : <SpeakerHigh size={19} />}
            {muted ? "Enable sound" : "Mute sound"}
          </button>
          <button type="button" className="welcome-skip" onClick={() => setPhase("ready")}>
            Skip intro <ArrowRight size={17} />
          </button>
        </div>
      )}
    </div>
  );
}
