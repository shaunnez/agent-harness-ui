import { BufferAttribute, type BufferGeometry, Color, type MeshStandardMaterial } from "three";
import type { RoomId } from "./rooms";

/**
 * What tells you which room you are looking at.
 *
 * The shell ships six `room_inlay_*` materials that are byte-identical grey -- the producer split
 * them so a renderer could tell the rooms apart and then nothing ever did, so the whole HQ floor
 * reads as one continuous slab. These are the six tones that split it back up.
 *
 * They are function colours, not project colours: the palette a user picks owns the outside of the
 * base, and the inside is the same six rooms whoever owns it. Muted on purpose -- the station is
 * ivory, graphite and titanium, and six saturated floors would turn it into a pie chart. The floor
 * is also the only interior surface you ever see a useful amount of, because the cutaway looks
 * straight down into it.
 *
 * Six hues, evenly spaced, and none of them red. Dispatch was rust first, which suited a cargo bay
 * and then lit a whole room in the one colour this product reserves for blocked and repair-required
 * -- a permanently alarmed loading bay. Magenta is arbitrary where rust was apt, but it cannot be
 * misread as a status, and not being misread is worth more here than being apt.
 */
export const roomTones: Record<RoomId, string> = {
  briefing: "#0a6072",
  planning: "#1b2b6c",
  implementation: "#6b3f11",
  review: "#3d2063",
  testing: "#0f4d2d",
  dispatch: "#7d1a52",
};
/**
 * How far the authored grey travels toward the tone, and how dark those tones are.
 *
 * Both had to go a long way. The sun runs at 2.8 over a rough dielectric floor, so the mid tones
 * this started with came back as pastel paint swatches -- and at that saturation briefing's teal and
 * planning's blue were the same lavender. A floor only reads as coloured material under that much
 * light if its albedo is genuinely dark.
 */
const inlayMix = 0.85;
/**
 * The basalt map multiplies into `color`, and its average texel is a good way short of white, so a
 * tone that was right as flat paint comes back as a dark well once the texture is under it. This is
 * the headroom that puts the lit brightness back where the untextured version had it.
 */
const mapCompensation = 2.1;

/** Metres of floor per texture tile. The court outside is unwrapped at roughly this density. */
const inlayTile = 3.2;
/**
 * Plan-projected UVs for a floor slab the producer exported without any.
 *
 * The inlays ship POSITION and NORMAL only, because grey needs no texture coordinates -- which is
 * also why the floor reads as a diagram once it has a colour: flat paint next to a court with real
 * basalt on it. The slabs are horizontal, so projecting straight down is exact, not an approximation,
 * and the geometry is shared between every base so this only ever runs once per slab.
 */
export function planarFloorUVs(geometry: BufferGeometry) {
  if (geometry.getAttribute("uv")) return;
  const position = geometry.getAttribute("position");
  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    uv[i * 2] = position.getX(i) / inlayTile;
    uv[i * 2 + 1] = position.getZ(i) / inlayTile;
  }
  geometry.setAttribute("uv", new BufferAttribute(uv, 2));
}

/**
 * Lends the court's own basalt to a room floor. Same surface inside and out, so the interior reads
 * as the same building rather than a coloured plan of it; the room tone rides on `color`, which is
 * what the map is multiplied by.
 */
export function lendFloorSurface(material: MeshStandardMaterial, basalt: MeshStandardMaterial) {
  material.map = basalt.map;
  material.normalMap = basalt.normalMap;
  material.normalScale.copy(basalt.normalScale).multiplyScalar(0.7);
  material.needsUpdate = true;
}

const grey = new Color();
export function tintRoomInlay(material: MeshStandardMaterial, room: RoomId) {
  const tone = new Color(roomTones[room]);
  material.userData.albedo ??= material.color.clone();
  material.color
    .copy(grey.copy(material.userData.albedo as Color))
    .lerp(tone, inlayMix)
    .multiplyScalar(mapCompensation);
  material.emissive.copy(tone);
  material.userData.tone = tone;
  material.emissiveIntensity = 0;
  // The dispatch inlay covers the loading bay as well as the marshalling floor, and the bay's slab
  // tops out at 4.30 -- exactly the level of the HQ floor disc it overlaps from z 15.6 to 17.5. Two
  // surfaces at the same depth tear into a sawtooth that moves as you zoom, which is the artifact by
  // the main entrance. A depth bias settles it without moving geometry that lives in the shell GLB.
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -1;
}

/**
 * The floor's own glow after dark.
 *
 * Small on purpose, and it took two goes to believe how small. A floor is lit, it does not light: at
 * 0.42 the six rooms came up as backlit pie slices brighter than the lamps standing on them, and the
 * emissive clipped the tones to pastel on the way. This is the amount that keeps a room's colour
 * legible once the sun is off it and nothing more -- the consoles and the pooled lamps light it.
 */
export function driveRoomInlay(material: MeshStandardMaterial, dark: number) {
  material.emissiveIntensity = 0.02 + dark * 0.12;
}

/**
 * Console glass, which the shell authors at 0.012/0.072/0.105 with no emissive at all -- correct for
 * a sheet of dark glass in daylight and a black hole in every other hour. A small emissive keeps a
 * powered console reading as powered without pretending it is a screen.
 */
export function driveConsoleGlass(material: MeshStandardMaterial, dark: number) {
  material.emissiveIntensity = 0.22 + dark * 0.85;
}

/** Cool white-blue the partition glass picks up off the interior rather than the sky. */
export const glassInterior = "#7fb4c8";

/**
 * The dusk response every interior fixture shares, wherever its geometry came from.
 *
 * The HQ shell and the scanned props kit are two separate GLBs with two separate sets of materials
 * that happen to carry the same names. Naming a prop's screen `ambient_screen_service` was supposed
 * to be enough for `ProofBase` to drive it, but `ProofBase` only ever walks the shell -- so the
 * props' emissives sat at one fixed brightness at noon and at midnight. This is the one driver both
 * call, so a fixture lights the same whichever file it shipped in.
 *
 * `pulse` is the caller's own slow wander. These are ambient station instruments; nothing here is a
 * task-progress signal and no fixture brightens because work arrived.
 */
export function driveFixture(material: MeshStandardMaterial, dark: number, pulse: number) {
  if (material.name === "console_blue_glass") driveConsoleGlass(material, dark);
  else if (material.name.startsWith("ambient_")) material.emissiveIntensity = (0.75 + dark * 1.4) * pulse;
  else if (material.name.startsWith("practical_")) material.emissiveIntensity = 0.38 + dark * 3.0;
}

const screenTint = new Color("#9fe4ff");
/**
 * Live content on the service screens.
 *
 * Every monitor in the HQ is one flat emissive panel at one brightness, so a wall of twenty consoles
 * reads as twenty copies of the same sticker. This gives each panel its own level and its own slow
 * drift, seeded off where the panel is, plus a coarse band pattern that only resolves when you are
 * close enough to see a single screen. Per-panel level is what does the work: it reads at the zoom
 * the cutaway actually sits at, where a monitor is a few pixels across and an animation is noise.
 *
 * Deliberately abstract. Nothing here is task state -- no counts, no progress, and no screen that
 * brightens because work arrived, which would be an activity claim the renderer cannot support.
 */
export function patchScreens(material: MeshStandardMaterial, clock: { value: number }) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uScreenTime = clock;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vScreenPos;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvScreenPos = position;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform float uScreenTime;
varying vec3 vScreenPos;
float mfHash(float n) { return fract(sin(n) * 43758.5453); }`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
{
  // The panels of one room are exported as a single mesh, so the panel has to be identified from
  // where it stands rather than from any per-object value: quantised plan position is its id.
  float panel = mfHash(floor(vScreenPos.x * 4.0) * 7.31 + floor(vScreenPos.z * 4.0) * 3.17);
  float level = 0.55 + 0.45 * panel;
  float drift = 0.88 + 0.12 * sin(uScreenTime * (0.5 + panel) + panel * 20.0);
  // Eight bands up the panel, which is fine enough to look like content close up and averages out
  // to the panel's own level at the distance the cutaway is normally read from.
  float band = 0.8 + 0.2 * step(0.5, mfHash(floor(vScreenPos.y * 8.0) + panel * 30.0));
  totalEmissiveRadiance *= level * drift * band;
}`,
      );
  };
  material.customProgramCacheKey = () => "mf_screen";
  material.emissive.copy(screenTint);
  material.needsUpdate = true;
}
