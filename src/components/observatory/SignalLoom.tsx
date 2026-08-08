import { ArrowRight, FileCode, GitBranch, Robot } from "@phosphor-icons/react";
import { type CSSProperties, useEffect, useMemo, useRef } from "react";
import type { ObservatoryModel, ObservatoryPackage, ObservatorySelection, ObservatoryState } from "./model";

const THREAD_COLORS: Record<ObservatoryState, string> = {
  complete: "#69cf99",
  active: "#5aa2ff",
  waiting: "#d6a13a",
  blocked: "#ef6a62",
  stale: "#77766f",
};

export function SignalLoom({
  model,
  selection,
  reducedMotion,
  paused,
  onSelect,
}: {
  model: ObservatoryModel;
  selection: ObservatorySelection;
  reducedMotion: boolean;
  paused: boolean;
  onSelect: (selection: ObservatorySelection) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const selectedPackage =
    selection.kind === "package"
      ? (model.packages.find((item) => item.id === selection.id) ?? null)
      : (model.packages.find((item) => item.state === "active") ?? model.packages[0] ?? null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = canvas?.parentElement;
    if (!canvas || !container) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    let width = 1;
    let height = 1;
    let frame = 0;
    let start = performance.now();
    let previousFrame = start;

    const resize = () => {
      const bounds = container.getBoundingClientRect();
      width = Math.max(1, bounds.width);
      height = Math.max(1, bounds.height);
      const scale = Math.min(window.devicePixelRatio, 2.5);
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(scale, 0, 0, scale, 0, 0);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    const draw = (now: number) => {
      frame = window.requestAnimationFrame(draw);
      if (paused) start += now - previousFrame;
      previousFrame = now;
      const time = reducedMotion || paused ? 0.35 : (now - start) / 1_000;
      context.clearRect(0, 0, width, height);
      drawField(context, width, height);
      drawInvestigation(context, width, height, model, time);
      drawPackageWeave(context, width, height, model, time);
      drawCandidateAndGates(context, width, height, model, time);
    };
    frame = window.requestAnimationFrame(draw);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [model, paused, reducedMotion]);

  return (
    <section className="signal-loom" data-testid="signal-loom">
      <div className="signal-loom__canvas">
        <canvas ref={canvasRef} aria-label="Animated workflow handoff loom" />
        <nav className="signal-loom__labels" aria-label="Signal Loom topology">
          {model.stages.slice(0, 5).map((stage, index) => (
            <button
              type="button"
              key={stage.id}
              className={`loom-stage observatory-state--${stage.state}${selection.kind === "stage" && selection.id === stage.id ? " is-selected" : ""}`}
              style={{ left: `${6.8 + index * 9.35}%` } satisfies CSSProperties}
              onClick={() => onSelect({ kind: "stage", id: stage.id })}
              aria-pressed={selection.kind === "stage" && selection.id === stage.id}
            >
              <span>{index + 1}</span>
              <strong>{stage.label}</strong>
              <small>{stage.artifact?.name ?? stateLabel(stage.state)}</small>
              <time>{stage.duration}</time>
            </button>
          ))}
          <span className="signal-loom__weave-label">Implementation weave</span>
          <div className="signal-loom__packages">
            {model.packages.length ? (
              model.packages.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={`loom-package observatory-state--${item.state}${selection.kind === "package" && selection.id === item.id ? " is-selected" : ""}`}
                  onClick={() => onSelect({ kind: "package", id: item.id })}
                  aria-pressed={selection.kind === "package" && selection.id === item.id}
                >
                  <i aria-hidden />
                  <span>
                    <strong>{item.id}</strong>
                    <small>{item.title}</small>
                  </span>
                  <em>{stateLabel(item.state)}</em>
                </button>
              ))
            ) : (
              <small className="loom-empty">Package threads appear after planning.</small>
            )}
          </div>
          {model.candidate ? (
            <button
              type="button"
              className={`loom-candidate observatory-state--${model.candidate.state}${selection.kind === "candidate" ? " is-selected" : ""}`}
              onClick={() => onSelect({ kind: "candidate", id: model.candidate?.id ?? "candidate" })}
              aria-pressed={selection.kind === "candidate"}
            >
              <small>Candidate</small>
              <strong>
                {model.candidate.id} r{model.candidate.revision}
              </strong>
              <code>{model.candidate.headRevision?.slice(0, 8) ?? "assembling"}</code>
            </button>
          ) : null}
          <div className="signal-loom__gates">
            {model.stages.slice(6).map((stage, index) => (
              <button
                type="button"
                key={stage.id}
                className={`loom-gate observatory-state--${stage.state}${selection.kind === "stage" && selection.id === stage.id ? " is-selected" : ""}`}
                onClick={() => onSelect({ kind: "stage", id: stage.id })}
                aria-pressed={selection.kind === "stage" && selection.id === stage.id}
              >
                <span>{index + 7}</span>
                <strong>{stage.label}</strong>
                <small>{stateLabel(stage.state)}</small>
              </button>
            ))}
          </div>
        </nav>
      </div>
      <HandoffPanel item={selectedPackage} />
    </section>
  );
}

function HandoffPanel({ item }: { item: ObservatoryPackage | null }) {
  const handoff = useMemo(() => {
    if (!item) return null;
    return {
      input: item.inputArtifact?.name ?? "Implementation plan",
      output: item.outputArtifact?.name ?? (item.state === "blocked" ? "Missing output" : "In progress"),
    };
  }, [item]);
  if (!item || !handoff) {
    return (
      <section className="loom-handoff loom-handoff--empty">
        Select a package thread to inspect its handoff.
      </section>
    );
  }
  return (
    <section className="loom-handoff" aria-label={`Selected handoff ${item.id}`}>
      <header>
        <small>Selected handoff</small>
        <strong>
          {item.id} · {item.title}
        </strong>
        <em className={`observatory-state-text--${item.state}`}>{stateLabel(item.state)}</em>
      </header>
      <span>
        <FileCode size={16} />
        <small>Input</small>
        <strong>{handoff.input}</strong>
      </span>
      <ArrowRight size={17} />
      <span>
        <Robot size={16} />
        <small>Agent</small>
        <strong>{item.agent}</strong>
      </span>
      <ArrowRight size={17} />
      <span>
        <GitBranch size={16} />
        <small>Output</small>
        <strong>{handoff.output}</strong>
      </span>
    </section>
  );
}

function drawField(context: CanvasRenderingContext2D, width: number, height: number) {
  context.save();
  context.fillStyle = "#080b09";
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "rgba(135, 119, 81, 0.075)";
  context.lineWidth = 1;
  for (let y = 32; y < height; y += 48) {
    context.beginPath();
    context.moveTo(0, y + 0.5);
    context.lineTo(width, y + 0.5);
    context.stroke();
  }
  for (let index = 0; index < 120; index += 1) {
    const x = ((index * 97) % Math.max(width, 1)) + 0.5;
    const y = ((index * 53) % Math.max(height, 1)) + 0.5;
    context.fillStyle = index % 9 === 0 ? "rgba(228, 177, 75, 0.28)" : "rgba(213, 220, 214, 0.08)";
    context.fillRect(x, y, index % 9 === 0 ? 1.5 : 1, index % 9 === 0 ? 1.5 : 1);
  }
  context.restore();
}

function drawInvestigation(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  model: ObservatoryModel,
  time: number,
) {
  const baseline = height * 0.52;
  context.save();
  context.lineCap = "round";
  model.stages.slice(0, 5).forEach((stage, index) => {
    const x = width * (0.068 + index * 0.0935);
    for (let rail = -3; rail <= 3; rail += 1) {
      context.strokeStyle = rail === 0 ? "rgba(202, 154, 69, 0.72)" : "rgba(110, 88, 50, 0.48)";
      context.lineWidth = rail === 0 ? 1.6 : 0.8;
      context.beginPath();
      context.moveTo(x + rail * 3.3, height * 0.17);
      context.lineTo(x + rail * 3.3, height * 0.84);
      context.stroke();
    }
    drawRailCap(context, x, height * 0.17, THREAD_COLORS[stage.state]);
    const color = THREAD_COLORS[stage.state];
    const pulse = stage.state === "active" ? 1 + Math.sin(time * 2.2) * 0.12 : 1;
    context.fillStyle = color;
    context.shadowColor = color;
    context.shadowBlur = stage.state === "active" ? 18 : 9;
    context.beginPath();
    context.arc(x, baseline, (stage.state === "active" ? 8 : 6.5) * pulse, 0, Math.PI * 2);
    context.fill();
    context.lineWidth = 1.5;
    context.strokeStyle = "rgba(255,255,255,0.58)";
    context.stroke();
    context.shadowBlur = 0;
  });
  context.strokeStyle = "#e3ab43";
  context.shadowColor = "#e3ab43";
  context.shadowBlur = 11;
  context.lineWidth = 2.3;
  context.beginPath();
  context.moveTo(width * 0.038, baseline);
  context.lineTo(width * 0.443, baseline);
  context.stroke();
  context.restore();
}

function drawPackageWeave(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  model: ObservatoryModel,
  time: number,
) {
  const packages = model.packages;
  const startX = width * 0.443;
  const endX = width * 0.735;
  const top = height * 0.3;
  const gap = Math.min(76, (height * 0.46) / Math.max(packages.length, 1));
  context.save();
  context.lineCap = "round";
  packages.forEach((item, index) => {
    const y = top + index * gap;
    const color = THREAD_COLORS[item.state];
    for (let strand = -2; strand <= 2; strand += 1) {
      context.strokeStyle = strand === 0 ? color : withAlpha(color, 0.36);
      context.lineWidth = strand === 0 ? (item.state === "active" ? 3.2 : 2.4) : 1;
      context.shadowColor = color;
      context.shadowBlur = strand === 0 ? (item.state === "active" ? 13 : 6) : 0;
      if (item.state === "stale") context.setLineDash([6, 7]);
      context.beginPath();
      context.moveTo(startX, height * 0.52 + strand * 1.4);
      context.bezierCurveTo(
        startX + width * 0.04,
        height * 0.52 + strand * 1.4,
        startX + width * 0.055,
        y + strand * 1.4,
        startX + width * 0.09,
        y + strand * 1.4,
      );
      context.lineTo(endX - width * 0.06, y + strand * 1.4);
      context.bezierCurveTo(
        endX - width * 0.03,
        y + strand * 1.4,
        endX - width * 0.03,
        height * 0.52 + strand * 1.4,
        endX,
        height * 0.52 + strand * 1.4,
      );
      context.stroke();
      context.setLineDash([]);
    }
    const progress = (time * 0.09 + index * 0.21) % 1;
    const shuttleX = startX + width * (0.095 + progress * 0.13);
    drawShuttle(context, shuttleX, y, color, item.state);
  });
  context.restore();
}

function drawCandidateAndGates(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  model: ObservatoryModel,
  time: number,
) {
  const y = height * 0.52;
  const candidateX = width * 0.76;
  const candidateColor = model.candidate ? THREAD_COLORS[model.candidate.state] : "#5a5952";
  context.save();
  context.strokeStyle = candidateColor;
  context.lineWidth = 5;
  context.shadowColor = candidateColor;
  context.shadowBlur = 12;
  context.beginPath();
  context.moveTo(width * 0.72, y);
  context.lineTo(width * 0.982, y);
  context.stroke();
  context.shadowBlur = 0;
  drawCandidateSeal(context, candidateX, y, candidateColor, time);
  model.stages.slice(6).forEach((stage, index) => {
    const x = width * (0.825 + index * 0.052);
    const color = THREAD_COLORS[stage.state];
    context.strokeStyle = withAlpha(color, 0.72);
    context.lineWidth = 2.3;
    context.beginPath();
    context.moveTo(x, height * 0.16);
    context.lineTo(x, height * 0.86);
    context.stroke();
    drawRailCap(context, x, height * 0.18, color);
    context.fillStyle = "#111410";
    context.lineWidth = 2;
    context.strokeStyle = color;
    context.beginPath();
    context.arc(x, y, 10.5, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  });
  context.restore();
}

function drawRailCap(context: CanvasRenderingContext2D, x: number, y: number, color: string) {
  context.save();
  context.fillStyle = "#2a2419";
  context.strokeStyle = color;
  context.lineWidth = 1;
  context.shadowColor = color;
  context.shadowBlur = 5;
  context.beginPath();
  context.roundRect(x - 12, y - 4, 24, 8, 3);
  context.fill();
  context.stroke();
  context.restore();
}

function drawShuttle(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  state: ObservatoryState,
) {
  context.save();
  context.fillStyle = state === "blocked" ? "#301818" : "#111713";
  context.strokeStyle = color;
  context.lineWidth = 1.8;
  context.shadowColor = color;
  context.shadowBlur = 8;
  context.beginPath();
  context.roundRect(x - 25, y - 10, 50, 20, 10);
  context.fill();
  context.stroke();
  context.fillStyle = withAlpha(color, 0.32);
  context.beginPath();
  context.roundRect(x - 12, y - 5, 24, 10, 5);
  context.fill();
  context.restore();
}

function drawCandidateSeal(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  time: number,
) {
  context.save();
  context.translate(x, y);
  context.rotate(Math.sin(time * 0.35) * 0.035);
  [29, 24, 18].forEach((radius, index) => {
    context.strokeStyle = index === 1 ? color : withAlpha("#d6a13a", index ? 0.55 : 0.8);
    context.lineWidth = index === 1 ? 2.2 : 1;
    context.beginPath();
    context.arc(0, 0, radius, 0, Math.PI * 2);
    context.stroke();
  });
  context.fillStyle = "#171713";
  context.beginPath();
  context.arc(0, 0, 15, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function withAlpha(color: string, alpha: number) {
  const value = color.replace("#", "");
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function stateLabel(state: ObservatoryState) {
  return state === "complete"
    ? "Done"
    : state === "active"
      ? "Running"
      : state === "blocked"
        ? "Blocked"
        : state === "stale"
          ? "Stale"
          : "Waiting";
}
