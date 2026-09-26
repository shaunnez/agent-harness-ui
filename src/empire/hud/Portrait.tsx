import { useEffect, useRef } from "react";
import type { Civ } from "../realm.ts";
import { drawBuilding } from "../map/buildings.ts";
import { type UnitKind, drawUnit } from "../map/units.ts";
import { iso } from "../map/draw.ts";
import type { Placed } from "../map/world.ts";

/** A small animated canvas portrait of a unit, drawn with the map's own renderer. */
export function UnitPortrait({
  kind,
  team,
  size = 72,
  working = false,
}: {
  kind: UnitKind;
  team: string;
  size?: number;
  working?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let frame = 0;
    const start = performance.now();
    const draw = (now: number) => {
      const t = (now - start) / 1000;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      const scale = size / 36;
      drawUnit(ctx, size / 2 - (kind === "knight" || kind === "paladin" ? 2 : 0), size * 0.86, {
        kind,
        team,
        t,
        working,
        scale,
      });
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [kind, team, size, working]);
  return (
    <span aria-hidden="true" className="ae-portrait-frame">
      <canvas ref={ref} style={{ width: size, height: size }} />
    </span>
  );
}

/** A building preview drawn with the map renderer at its real civ palette and banner colour. */
export function BuildingPortrait({
  kind,
  civ,
  banner,
  size = 160,
}: {
  kind: Placed["kind"];
  civ: Civ | null;
  banner: string;
  size?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let frame = 0;
    const start = performance.now();
    const placed: Placed = {
      id: "preview",
      kind,
      x: 0,
      y: 0,
      size: kind === "towncenter" || kind === "observatory" ? 3.4 : 2.6,
      kingdomId: null,
      name: "",
    };
    const draw = (now: number) => {
      const t = (now - start) / 1000;
      const scale = size / 230;
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, (dpr * size) / 2, dpr * size * 0.74);
      ctx.clearRect(-400, -400, 800, 800);
      const c = iso(0, 0);
      const glow = ctx.createRadialGradient(c.x, c.y - 40, 10, c.x, c.y - 40, 140);
      glow.addColorStop(0, `${banner}55`);
      glow.addColorStop(1, `${banner}00`);
      ctx.fillStyle = glow;
      ctx.fillRect(-200, -220, 400, 320);
      ctx.fillStyle = "#6c9a3c";
      ctx.beginPath();
      ctx.ellipse(0, 0, 118, 56, 0, 0, Math.PI * 2);
      ctx.fill();
      drawBuilding(ctx, placed, civ, banner, t, { active: 1, alert: null, selected: false, hovered: false });
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [kind, civ, banner, size]);
  return (
    <span aria-hidden="true" className="ae-portrait-frame">
      <canvas ref={ref} style={{ width: size, height: size }} />
    </span>
  );
}
