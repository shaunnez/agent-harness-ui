import { Assets, Rectangle, Sprite, type Texture, TilingSprite } from "pixi.js";
import { artDirection, isDetailAsset, isInitialAsset } from "./asset-policy";

interface AssetPart {
  name: string;
  file: string;
  sourceSize: [number, number];
  logicalSize: [number, number];
  anchor: [number, number];
  pivot?: [number, number];
  bytes: number;
}
export interface GameAsset {
  id: string;
  file: string;
  sourceSize: [number, number];
  logicalSize: [number, number];
  groundAnchor: [number, number];
  bytes: number;
  boundsSourcePixels?: [number, number, number, number];
  sockets?: Record<string, [number, number]>;
  parts?: AssetPart[];
  motionContract?: string;
  loadStage?: "initial" | "detail";
}
export class WorldAssets {
  private entries = new Map<string, GameAsset>();
  private textures = new Map<string, Texture>();
  detailReady = false;
  readonly direction = artDirection(window.location.search);
  async load() {
    const response = await fetch("/assets/manifest.json");
    if (!response.ok) throw new Error("The game artwork could not be loaded. Retry the world.");
    const manifest = (await response.json()) as { assets: GameAsset[] };
    if (this.direction === "cinematic") {
      const cinematic = await fetch("/assets/cinematic/manifest.json");
      if (!cinematic.ok) throw new Error("The cinematic artwork could not be loaded. Retry the world.");
      const additions = (await cinematic.json()) as { assets: GameAsset[] };
      manifest.assets.push(...additions.assets);
    }
    for (const entry of manifest.assets) {
      // Occlusion frames share the parent texture; only exported parts load another image.
      entry.parts = entry.parts?.filter((part) => typeof part.file === "string");
      this.entries.set(entry.id, entry);
    }
    await this.loadEntries(manifest.assets.filter((entry) => isInitialAsset(entry, this.direction)));
  }
  private async loadEntries(entries: GameAsset[]) {
    await Promise.all(
      entries.map(async (entry) => {
        if (!this.textures.has(entry.id)) this.textures.set(entry.id, await Assets.load<Texture>(entry.file));
        await Promise.all(
          (entry.motionContract ? (entry.parts ?? []) : []).map(async (part) => {
            const key = `${entry.id}:${part.name}`;
            if (!this.textures.has(key)) this.textures.set(key, await Assets.load<Texture>(part.file));
          }),
        );
      }),
    );
  }
  async loadDetail() {
    await this.loadEntries([...this.entries.values()].filter(isDetailAsset));
    this.detailReady = true;
  }
  has(id: string) {
    return this.textures.has(id);
  }
  setFrame(sprite: Sprite, id: string) {
    const texture = this.textures.get(id);
    if (texture) sprite.texture = texture;
  }
  bounds(id: string, x: number, y: number, scale: number) {
    const entry = this.entries.get(id);
    return entry
      ? {
          x: x - entry.groundAnchor[0] * scale,
          y: y - entry.groundAnchor[1] * scale,
          width: entry.logicalSize[0] * scale,
          height: entry.logicalSize[1] * scale,
        }
      : null;
  }
  tiledWater(x: number, y: number, width: number, height: number) {
    const cinematic = this.direction === "cinematic" && this.has("mf.cinematic.water");
    const texture = this.textures.get(cinematic ? "mf.cinematic.water" : "mf.terrain.water");
    if (!texture) return null;
    const tileScale = cinematic ? 1.4 : 0.75;
    const sprite = new TilingSprite({ texture, width, height, tileScale: { x: tileScale, y: tileScale } });
    sprite.position.set(x, y);
    sprite.eventMode = "none";
    return sprite;
  }
  socket(id: string, socket: string, scale = 1) {
    const entry = this.entries.get(id),
      point = entry?.sockets?.[socket];
    return entry && point
      ? { x: (point[0] - entry.groundAnchor[0]) * scale, y: (point[1] - entry.groundAnchor[1]) * scale }
      : { x: 0, y: 0 };
  }
  part(id: string, name: string, x: number, y: number, scale: number) {
    const entry = this.entries.get(id),
      part = entry?.parts?.find((item) => item.name === name);
    const texture = this.textures.get(`${id}:${name}`);
    if (!entry || !part || !texture) return null;
    const sprite = new Sprite(texture),
      pivot = part.pivot ?? part.anchor;
    sprite.width = part.logicalSize[0] * scale;
    sprite.height = part.logicalSize[1] * scale;
    sprite.anchor.set(pivot[0] / part.logicalSize[0], pivot[1] / part.logicalSize[1]);
    sprite.position.set(
      x + (pivot[0] - entry.groundAnchor[0]) * scale,
      y + (pivot[1] - entry.groundAnchor[1]) * scale,
    );
    return sprite;
  }
  sprite(id: string, x = 0, y = 0, scale = 1): Sprite | null {
    const entry = this.entries.get(id),
      texture = this.textures.get(id);
    if (!entry || !texture) return null;
    const sprite = new Sprite(texture);
    sprite.width = entry.logicalSize[0] * scale;
    sprite.height = entry.logicalSize[1] * scale;
    sprite.anchor.set(
      entry.groundAnchor[0] / entry.logicalSize[0],
      entry.groundAnchor[1] / entry.logicalSize[1],
    );
    sprite.position.set(x, y);
    if (entry.boundsSourcePixels) {
      const [left, top, right, bottom] = entry.boundsSourcePixels;
      sprite.hitArea = new Rectangle(
        left - sprite.anchor.x * entry.sourceSize[0],
        top - sprite.anchor.y * entry.sourceSize[1],
        right - left,
        bottom - top,
      );
    }
    return sprite;
  }
  get metrics() {
    return {
      artDirection: this.direction,
      textures: this.textures.size,
      decodedBytes: [...this.entries.values()]
        .filter((entry) => this.textures.has(entry.id))
        .reduce(
          (sum, entry) =>
            sum +
            entry.sourceSize[0] * entry.sourceSize[1] * 4 +
            (entry.parts ?? [])
              .filter((part) => this.textures.has(`${entry.id}:${part.name}`))
              .reduce((partSum, part) => partSum + part.sourceSize[0] * part.sourceSize[1] * 4, 0),
          0,
        ),
      compressedBytes: [...this.entries.values()]
        .filter((entry) => this.textures.has(entry.id))
        .reduce(
          (sum, entry) =>
            sum +
            entry.bytes +
            (entry.parts ?? [])
              .filter((part) => this.textures.has(`${entry.id}:${part.name}`))
              .reduce((partSum, part) => partSum + part.bytes, 0),
          0,
        ),
    };
  }
}
