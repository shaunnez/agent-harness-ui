import { type Container, Sprite, Texture, type TilingSprite } from "pixi.js";
import {
  defaultEnvironment,
  type EnvironmentPreferences,
  LightingClock,
  lightingAt,
} from "./environment-model";

/** One reusable radial light texture, not a substitute for authored world objects. */
function lightTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) return Texture.WHITE;
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, "rgba(255,255,255,0.8)");
  gradient.addColorStop(0.18, "rgba(255,255,255,0.35)");
  gradient.addColorStop(0.55, "rgba(255,255,255,0.10)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  return Texture.from(canvas);
}

export class WorldEnvironment {
  private texture = lightTexture();
  private clock = new LightingClock();
  private preferences = defaultEnvironment;
  private animate = false;
  private lastUpdate = -Infinity;
  private surfaces = new Map<Sprite | TilingSprite, "land" | "sea">();
  private lights: { sprite: Sprite; threshold: number; strength: number }[] = [];
  private glints: { sprite: Sprite; offset: number }[] = [];
  lighting = lightingAt(9);

  configure(preferences: EnvironmentPreferences, animate: boolean) {
    this.preferences = preferences;
    this.setAnimating(animate);
  }
  setAnimating(animate: boolean) {
    this.clock.configure(this.preferences, animate, Date.now());
    this.animate = animate;
    this.update(0, true);
  }
  surface(sprite: Sprite | TilingSprite | null, kind: "land" | "sea" = "land") {
    if (sprite) {
      this.surfaces.set(sprite, kind);
      sprite.tint = this.lighting[kind];
    }
    return sprite;
  }
  surfacesIn(container: Container) {
    for (const child of container.children) {
      if (child instanceof Sprite) this.surface(child);
      else if (child.children.length) this.surfacesIn(child);
    }
  }
  glow(container: Container, x: number, y: number, width: number, height: number, color: number) {
    const glow = new Sprite(this.texture);
    glow.anchor.set(0.5);
    glow.position.set(x, y);
    glow.width = width;
    glow.height = height;
    glow.tint = color;
    glow.blendMode = "add";
    glow.eventMode = "none";
    container.addChild(glow);
    return glow;
  }
  lamp(container: Container, x: number, y: number, scale: number, index: number) {
    const pool = this.glow(container, x, y, 170 * scale, 92 * scale, 0xffc17f);
    const core = this.glow(container, x, y - 7 * scale, 14 * scale, 15 * scale, 0xffe5bc);
    this.emission(pool, 0.08 + (index % 4) * 0.13, 1.3);
    this.emission(core, 0.08 + (index % 4) * 0.13, 1);
  }
  emission(sprite: Sprite | null, threshold = 0.12, strength = 1) {
    if (!sprite) return;
    this.lights.push({ sprite, threshold, strength });
    sprite.alpha = Math.max(0, (this.lighting.lamps - threshold) / (1 - threshold)) * strength;
  }
  waterGlints(container: Container, x: number, y: number, seed: number) {
    for (let index = 0; index < 6; index++) {
      const sprite = this.glow(
        container,
        x + (index - 2) * 78,
        y + Math.sin(index * 2 + seed) * 50,
        22,
        3,
        0xaccde5,
      );
      sprite.alpha = 0;
      this.glints.push({ sprite, offset: seed + index * 13 });
    }
  }
  update(time: number, force = false) {
    // Sun/sea exposure needs 8 updates per second, not a new scene or React render every frame.
    if (!force && time - this.lastUpdate < 125) return;
    this.lastUpdate = time;
    this.lighting = lightingAt(this.clock.hour(Date.now()));
    for (const [sprite, kind] of this.surfaces) {
      if (sprite.destroyed) this.surfaces.delete(sprite);
      else sprite.tint = this.lighting[kind];
    }
    this.lights = this.lights.filter(({ sprite, threshold, strength }) => {
      if (sprite.destroyed) return false;
      sprite.alpha = Math.max(0, (this.lighting.lamps - threshold) / (1 - threshold)) * strength;
      return true;
    });
    this.glints = this.glints.filter(({ sprite, offset }) => {
      if (sprite.destroyed) return false;
      sprite.alpha = this.animate
        ? Math.max(0, Math.sin(time / 2600 + offset)) ** 8 * (0.14 + this.lighting.lamps * 0.12)
        : 0.08;
      return true;
    });
  }
  get metrics() {
    return {
      phase: this.lighting.phase,
      worldHour: this.lighting.hour,
      lamps: this.lights.filter(({ sprite }) => !sprite.destroyed && sprite.alpha > 0.05).length,
      lightingSurfaces: this.surfaces.size,
    };
  }
  destroy() {
    this.surfaces.clear();
    this.lights = [];
    this.glints = [];
    if (this.texture !== Texture.WHITE) this.texture.destroy(true);
  }
}
