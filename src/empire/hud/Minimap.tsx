import { type MutableRefObject, useEffect, useRef } from "react";
import { TH, TW, iso } from "../map/draw";
import type { RealmScene } from "../map/scene";
import { N } from "../map/world";
import { type Campaign, type Kingdom, postureStyle } from "../realm";

const W = 232;
const H = 116;

export function Minimap({
  sceneRef,
  kingdoms,
  campaigns,
}: {
  sceneRef: MutableRefObject<RealmScene | null>;
  kingdoms: Kingdom[];
  campaigns: Campaign[];
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const dragging = useRef(false);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const scale = W / (N * TW);
    let frame = 0;
    const toMini = (x: number, y: number) => {
      const p = iso(x, y);
      return { x: (p.x + (N * TW) / 2) * scale, y: p.y * scale };
    };
    const draw = (now: number) => {
      const scene = sceneRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      if (scene?.minimap) ctx.drawImage(scene.minimap, 0, 0, W, H);
      for (const k of kingdoms) {
        const p = toMini(k.origin.x + 0.5, k.origin.y + 0.5);
        ctx.fillStyle = k.banner;
        ctx.strokeStyle = "#f3e7c7";
        ctx.lineWidth = 1;
        ctx.fillRect(p.x - 4, p.y - 3, 8, 6);
        ctx.strokeRect(p.x - 4, p.y - 3, 8, 6);
      }
      if (scene) {
        const pulse = (Math.sin(now / 220) + 1) / 2;
        for (const c of campaigns) {
          const a = scene.squadAnchor(c);
          const p = toMini(a.x, a.y);
          const color = postureStyle[c.posture].color;
          ctx.fillStyle = color;
          ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
          if (c.posture === "needs-you" || c.posture === "blocked" || c.posture === "failed") {
            ctx.strokeStyle = color;
            ctx.globalAlpha = 1 - pulse;
            ctx.beginPath();
            ctx.arc(p.x, p.y, 3 + pulse * 7, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 1;
          }
        }
        const { camera, view } = scene;
        const vw = (view.w / camera.zoom) * scale;
        const vh = (view.h / camera.zoom) * scale;
        const cx = (camera.x + (N * TW) / 2) * scale;
        const cy = camera.y * scale;
        ctx.strokeStyle = "#fff6dc";
        ctx.lineWidth = 1;
        ctx.strokeRect(cx - vw / 2, cy - vh / 2, vw, vh);
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [sceneRef, kingdoms, campaigns]);
  const jump = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const scene = sceneRef.current;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!scene) return;
    const scale = W / (N * TW);
    scene.camera.x = (event.clientX - rect.left) / scale - (N * TW) / 2;
    scene.camera.y = Math.max(0, Math.min(N * TH, (event.clientY - rect.top) / scale));
  };
  return (
    <div className="ae-minimap">
      <canvas
        ref={ref}
        style={{ width: W, height: H }}
        onPointerDown={(event) => {
          dragging.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          jump(event);
        }}
        onPointerMove={(event) => dragging.current && jump(event)}
        onPointerUp={() => {
          dragging.current = false;
        }}
        aria-label="Minimap: click to move the view"
      />
    </div>
  );
}
