import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useState } from "react";

/** Explicit, local fixture diagnostics. Never included in ordinary world controls. */
export const profiling =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("mode") === "fixture" &&
  new URLSearchParams(window.location.search).get("profile") === "1";

interface Frame {
  interval: number;
  cpu: number;
  labels: number;
  calls: number;
  triangles: number;
}
let labelTime = 0;
let requested = false;
let report = "Ready to measure 10 seconds after scene warm-up.";
const listeners = new Set<(value: string) => void>();
function publish(value: string) {
  report = value;
  for (const listener of listeners) listener(value);
}
export function recordLabelTime(start: number) {
  if (profiling) labelTime += performance.now() - start;
}
function summary(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const rounded = (value: number) => Math.round(value * 100) / 100;
  return {
    mean: rounded(values.reduce((sum, value) => sum + value, 0) / values.length),
    p50: rounded(sorted[Math.floor(sorted.length * 0.5)] ?? 0),
    p95: rounded(sorted[Math.floor(sorted.length * 0.95)] ?? 0),
    max: rounded(sorted.at(-1) ?? 0),
  };
}
export function PerformanceProbe() {
  const { gl, size } = useThree();
  const [sample] = useState(() => ({
    frames: [] as Frame[],
    start: 0,
    previous: 0,
    frameStart: 0,
    firstFrame: 0,
  }));
  useEffect(() => {
    const previous = gl.info.autoReset;
    gl.info.autoReset = false;
    return () => {
      gl.info.autoReset = previous;
    };
  }, [gl]);
  useFrame(() => {
    if (!sample.firstFrame) sample.firstFrame = performance.now();
    sample.frameStart = performance.now();
    labelTime = 0;
    gl.info.reset();
    if (!requested) return;
    if (document.hidden) {
      requested = false;
      publish("Measurement cancelled: tab was hidden. Keep this preview visible while measuring.");
      return;
    }
    if (!sample.start) sample.start = sample.previous = sample.frameStart;
  }, -100);
  useFrame(() => {
    if (!requested) {
      sample.start = 0;
      sample.frames = [];
      return;
    }
    const now = performance.now();
    if (sample.previous !== sample.frameStart)
      sample.frames.push({
        interval: sample.frameStart - sample.previous,
        cpu: now - sample.frameStart,
        labels: labelTime,
        calls: gl.info.render.calls,
        triangles: gl.info.render.triangles,
      });
    sample.previous = sample.frameStart;
    if (now - sample.start < 10_000) return;
    requested = false;
    const intervals = summary(sample.frames.map((frame) => frame.interval));
    publish(
      JSON.stringify(
        {
          url: `${window.location.pathname}${window.location.search}${window.location.hash}`,
          capturedAt: new Date().toISOString(),
          viewport: { width: size.width, height: size.height, pixelRatio: gl.getPixelRatio() },
          frames: sample.frames.length,
          fps: Math.round((1000 / intervals.mean) * 10) / 10,
          frameMs: intervals,
          cpuSubmitMs: summary(sample.frames.map((frame) => frame.cpu)),
          labelMs: summary(sample.frames.map((frame) => frame.labels)),
          renderCalls: summary(sample.frames.map((frame) => frame.calls)),
          submittedTriangles: summary(sample.frames.map((frame) => frame.triangles)),
          geometries: gl.info.memory.geometries,
          textures: gl.info.memory.textures,
          graphicsRenderer: (() => {
            const context = gl.getContext();
            const info = context.getExtension("WEBGL_debug_renderer_info");
            return info
              ? context.getParameter(info.UNMASKED_RENDERER_WEBGL)
              : context.getParameter(context.RENDERER);
          })(),
          firstFrameMs: Math.round(sample.firstFrame),
          assetRequests: performance
            .getEntriesByType("resource")
            .filter((entry) => entry.name.includes(".glb"))
            .map((entry) => ({
              name: entry.name.split("/").at(-1),
              durationMs: Math.round(entry.duration),
              bytes: (entry as PerformanceResourceTiming).decodedBodySize,
            })),
          note: "Frame intervals and CPU submission measured locally; not GPU timings or a device guarantee.",
        },
        null,
        2,
      ),
    );
  }, 2);
  return null;
}
export function PerformancePanel({ ready }: { ready: boolean }) {
  const [value, setValue] = useState(report);
  useEffect(() => {
    listeners.add(setValue);
    return () => {
      listeners.delete(setValue);
    };
  }, []);
  return (
    <details
      className="panel"
      style={{ position: "absolute", left: 12, top: 220, zIndex: 30, padding: 12, width: 350 }}
    >
      <summary>Local 3D performance diagnostics</summary>
      <button
        type="button"
        disabled={!ready || requested}
        onClick={() => {
          requested = true;
          publish("Measuring 10 seconds… Keep this tab visible.");
        }}
      >
        Measure 10 seconds
      </button>
      <textarea
        aria-label="Performance result"
        readOnly
        value={value}
        style={{ width: "100%", height: 240, fontSize: 12 }}
      />
    </details>
  );
}
