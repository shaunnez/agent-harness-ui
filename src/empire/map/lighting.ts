// Day and night. Lights are collected in device pixels while the world is drawn, then a
// night pass darkens the scene and adds them back. Lit windows still mean recorded work;
// door lanterns and the town-centre hearth are ambient and only appear after dusk.
export type LightMode = "auto" | "day" | "dusk" | "night";
export const lightModes: { id: LightMode; label: string }[] = [
  { id: "auto", label: "Cycle" },
  { id: "day", label: "Day" },
  { id: "dusk", label: "Dusk" },
  { id: "night", label: "Night" },
];
/** One real hour per world day, as in Frontier. */
export const dayLengthMs = 60 * 60 * 1000;

interface Light {
  x: number;
  y: number;
  r: number;
  color: string;
}
let sink: Light[] | null = null;

export function beginLights() {
  sink = [];
}
export function takeLights() {
  const lights = sink ?? [];
  sink = null;
  return lights;
}
/** Records a light at a world point, converted through the context's current transform. */
export function emitLight(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
) {
  if (!sink) return;
  const m = ctx.getTransform();
  sink.push({
    x: m.a * x + m.c * y + m.e,
    y: m.b * x + m.d * y + m.f,
    r: radius * Math.hypot(m.a, m.b),
    color,
  });
}

/** 0 at noon, 1 at midnight. */
export function nightLevel(mode: LightMode, now: number) {
  if (mode === "day") return 0;
  if (mode === "dusk") return 0.5;
  if (mode === "night") return 1;
  const phase = (now % dayLengthMs) / dayLengthMs; // 0 = midnight
  const sun = Math.cos(phase * Math.PI * 2); // 1 at midnight, -1 at noon
  return Math.max(0, Math.min(1, (sun + 0.35) / 1.1));
}
export function worldClock(mode: LightMode, now: number) {
  const hours =
    mode === "day"
      ? 12
      : mode === "dusk"
        ? 19
        : mode === "night"
          ? 0
          : ((now % dayLengthMs) / dayLengthMs) * 24;
  const h = Math.floor(hours);
  const m = Math.floor((hours - h) * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function drawNight(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  level: number,
  lights: Light[],
) {
  if (level <= 0.01) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // Dusk warms before it darkens.
  const dusk = Math.max(0, 1 - Math.abs(level - 0.45) / 0.3);
  if (dusk > 0) {
    ctx.fillStyle = `rgba(230,110,60,${0.16 * dusk})`;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.fillStyle = `rgba(8,14,40,${0.62 * level})`;
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = "lighter";
  for (const light of lights) {
    const r = light.r * (0.6 + level * 0.6);
    const glow = ctx.createRadialGradient(light.x, light.y, 0, light.x, light.y, r);
    glow.addColorStop(0, light.color.replace("ALPHA", String(0.55 * level)));
    glow.addColorStop(1, light.color.replace("ALPHA", "0"));
    ctx.fillStyle = glow;
    ctx.fillRect(light.x - r, light.y - r, r * 2, r * 2);
  }
  ctx.globalCompositeOperation = "source-over";
}
export const warmLight = "rgba(255,170,80,ALPHA)";
export const violetLight = "rgba(190,140,255,ALPHA)";
