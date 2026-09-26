import { ArrowCounterClockwise, Crosshair, Pause, Play, X } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { type StageId, stageIds } from "../../domain";
import { buildingFor, postureStyle } from "../realm";
import type { ReplayController } from "../replay/controller";
import type { ReplayFrame } from "../replay/engine";
import { replayCampaign } from "../replay/script";

const speeds = [1, 2, 4, 8];

/** Playback controls for the labelled sample replay. The map reads the same controller. */
export function ReplayBar({
  controller,
  onClose,
  onFrame,
}: {
  controller: ReplayController;
  onClose: () => void;
  onFrame: (frame: ReplayFrame, playing: boolean) => void;
}) {
  const [frame, setFrame] = useState(() => controller.frame());
  const [, force] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => {
      const next = controller.frame();
      setFrame(next);
      onFrame(next, controller.playing);
    }, 120);
    return () => window.clearInterval(timer);
  }, [controller, onFrame]);
  const refresh = () => force((n) => n + 1);
  const style = postureStyle[frame.posture];
  const currentStage = frame.at === "market" || frame.at === "capital" ? null : frame.at;
  const markFor = (stage: StageId) => controller.marks.find((m) => m.stage === stage);
  return (
    <section className="ae-replay" aria-label="Campaign replay">
      <header>
        <span className="ae-replay-tag">Replay · sample</span>
        <b>
          {replayCampaign.id} · {replayCampaign.title}
        </b>
        <span className="ae-muted">Recorded workflow, replayed. Nothing here is live.</span>
        <button type="button" className="ae-replay-close" onClick={onClose} aria-label="Close replay">
          <X weight="bold" />
        </button>
      </header>
      <div className="ae-replay-caption" style={{ color: style.color }}>
        {style.glyph} {frame.caption}
        {frame.candidate ? <em> · candidate r{frame.candidate}</em> : null}
      </div>
      <div className="ae-replay-row">
        <button
          type="button"
          className="ae-replay-btn is-main"
          onClick={() => {
            controller.toggle();
            refresh();
          }}
          aria-label={controller.playing ? "Pause" : "Play"}
        >
          {controller.playing ? <Pause weight="fill" /> : <Play weight="fill" />}
        </button>
        <button
          type="button"
          className="ae-replay-btn"
          onClick={() => {
            controller.restart();
            refresh();
          }}
          aria-label="Restart"
        >
          <ArrowCounterClockwise weight="bold" />
        </button>
        <div className="ae-replay-track">
          <input
            type="range"
            min={0}
            max={controller.total}
            step={0.1}
            value={frame.t}
            onChange={(event) => controller.seek(Number(event.target.value))}
            aria-label="Replay position"
          />
          <div className="ae-replay-marks">
            {stageIds.map((stage) => {
              const mark = markFor(stage);
              const state = frame.completed.includes(stage)
                ? "done"
                : stage === currentStage
                  ? frame.posture === "blocked"
                    ? "error"
                    : "current"
                  : frame.stale.includes(stage)
                    ? "stale"
                    : "future";
              return (
                <button
                  type="button"
                  key={stage}
                  className={`ae-replay-mark is-${state}`}
                  style={{ left: `${((mark?.t ?? 0) / controller.total) * 100}%` }}
                  onClick={() => mark && controller.seek(mark.t)}
                  title={`${buildingFor(stage).name} · ${buildingFor(stage).stageLabel}`}
                >
                  {state === "done" ? "✓" : stageIds.indexOf(stage) + 1}
                </button>
              );
            })}
          </div>
        </div>
        <button
          type="button"
          className="ae-replay-btn is-speed"
          onClick={() => {
            controller.speed = speeds[(speeds.indexOf(controller.speed) + 1) % speeds.length] ?? 1;
            refresh();
          }}
          aria-label="Playback speed"
        >
          {controller.speed}×
        </button>
        <button
          type="button"
          className={`ae-replay-btn${controller.follow ? " is-on" : ""}`}
          onClick={() => {
            controller.follow = !controller.follow;
            refresh();
          }}
          aria-label="Follow the squad"
          title="Follow the squad"
        >
          <Crosshair weight="bold" />
        </button>
      </div>
    </section>
  );
}
