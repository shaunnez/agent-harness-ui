import { type MutableRefObject, useEffect, useRef } from "react";
import type { Campaign, Kingdom } from "../realm";
import { RealmScene, type Selection } from "./scene";

export function MapView({
  kingdoms,
  campaigns,
  sceneRef,
  onSelect,
  attract,
}: {
  kingdoms: Kingdom[];
  campaigns: Campaign[];
  sceneRef: MutableRefObject<RealmScene | null>;
  onSelect: (selection: Selection) => void;
  attract: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scene = new RealmScene(kingdoms);
    scene.campaigns = campaigns;
    sceneRef.current = scene;
    scene.attach(canvas);
    return () => {
      scene.detach();
      sceneRef.current = null;
    };
  }, [kingdoms, campaigns, sceneRef]);
  useEffect(() => {
    const scene = sceneRef.current;
    if (scene) scene.onSelect = onSelect;
  }, [onSelect, sceneRef]);
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.edgeScroll = !attract;
    if (!attract) return;
    // Title screen: a slow flyover of the realm.
    scene.camera.zoom = 0.62;
    let frame = 0;
    let angle = 0;
    const tick = () => {
      angle += 0.0012;
      scene.camera.x = Math.cos(angle) * 700;
      scene.camera.y = 1280 + Math.sin(angle * 1.3) * 380;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      scene.camera.zoom = 1;
    };
  }, [attract, sceneRef]);
  return (
    <canvas
      ref={canvasRef}
      className="ae-map"
      aria-label="Realm map. Drag or use WASD to pan, scroll to zoom, click a building or squad to select it."
    />
  );
}
