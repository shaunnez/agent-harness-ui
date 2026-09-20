import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  Mesh,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
} from "three";
import type { SceneLight } from "./ProofBase";
import {
  heightAt,
  type ParcelProfile,
  seaLevel,
  type TerrainField,
  type WaterFeature,
  type WaterPath,
} from "./terrain-field";
import { waterNoiseGlsl } from "./water";

/**
 * Fresh water on the parcels that have a stream: the spring and mid pools, the channel ribbon, the
 * fall curtain hugging the cliff face and a little mist at its foot. Geometry follows the same
 * analytic field the terrain was built from, so the water sits in its cut. Nothing here reads task
 * or run state; the only animation is the shader clock.
 */
interface Ribbon {
  positions: number[];
  flow: number[];
  indices: number[];
}
function ribbonGeometry(ribbon: Ribbon) {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(ribbon.positions), 3));
  geometry.setAttribute("aFlow", new BufferAttribute(new Float32Array(ribbon.flow), 2));
  geometry.setIndex(ribbon.indices);
  geometry.computeVertexNormals();
  return geometry;
}
/**
 * Strip along `points` (x, y, z) with a half-width per point; flow = (across -1..1, along 0..1).
 * `bulge` pushes the middle of the strip forward along the path direction (a convex curtain that
 * still reads from the side); `across` vertices per row.
 */
function strip(points: [number, number, number][], halfWidths: number[], bulge = 0, across = 2): Ribbon {
  const positions: number[] = [];
  const flow: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const [x, y, z] = points[i] as [number, number, number];
    const previous = points[Math.max(0, i - 1)] as [number, number, number];
    const next = points[Math.min(points.length - 1, i + 1)] as [number, number, number];
    let tx = next[0] - previous[0],
      tz = next[2] - previous[2];
    const length = Math.hypot(tx, tz) || 1;
    tx /= length;
    tz /= length;
    const half = halfWidths[i] ?? 1;
    const along = i / (points.length - 1);
    for (let k = 0; k < across; k++) {
      const u = across === 1 ? 0 : (k / (across - 1)) * 2 - 1;
      const forward = bulge * half * (1 - u * u);
      // Normal in the ground plane; the strip is flat across, following the path in height.
      positions.push(x - tz * half * u + tx * forward, y, z + tx * half * u + tz * forward);
      flow.push(u, along);
    }
    if (i > 0)
      for (let k = 0; k < across - 1; k++) {
        const a = (i - 1) * across + k;
        const b = i * across + k;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
  }
  return { positions, flow, indices };
}
/** Disc with a ring of vertices at the bank so the shader can foam the edge; flow = (edge 0..1, angle). */
function disc(x: number, y: number, z: number, radius: number, segments = 28): Ribbon {
  const positions = [x, y, z];
  const flow = [0, 0];
  const indices: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    positions.push(x + Math.cos(angle) * radius, y, z + Math.sin(angle) * radius);
    flow.push(1, i / segments);
    if (i > 0) indices.push(0, i + 1, i);
  }
  return { positions, flow, indices };
}

const freshVertex = `
  attribute vec2 aFlow;
  varying vec2 vFlow;
  varying vec3 vWorld;
  void main() {
    vFlow = aFlow;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;
type FreshUniforms = {
  uTime: { value: number };
  uSea: { value: Color };
  uLamps: { value: number };
} & Record<string, { value: unknown }>;
const freshUniforms = (): FreshUniforms => ({
  uTime: { value: 0 },
  uSea: { value: new Color(0xffffff) },
  uLamps: { value: 0 },
});
function createStreamMaterial() {
  const uniforms = freshUniforms();
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms,
    vertexShader: freshVertex,
    fragmentShader: `
      varying vec2 vFlow;
      varying vec3 vWorld;
      uniform float uTime;
      uniform float uLamps;
      uniform vec3 uSea;
      ${waterNoiseGlsl}
      void main() {
        vec2 p = vWorld.xz;
        float edge = clamp(abs(vFlow.x), 0.0, 1.0);
        // Ripples drift along the stream; pools ripple in place.
        float ripple = noise(p * 3.5 + vec2(0.0, -uTime * 1.5)) * .5 + noise(p * 7.0 + vec2(uTime * .4, -uTime * 2.2)) * .5;
        // Dark, clear water over a limestone bed: the centre reads deeper than the bank.
        vec3 col = mix(vec3(.05, .19, .21), vec3(.13, .36, .36), ripple * .55);
        col *= mix(.8, 1.05, edge);
        float foam = smoothstep(.78, 1.0, edge) * (.35 + .65 * noise(p * 4.0 + vec2(-uTime * .8, 0.0)));
        foam += smoothstep(.66, .86, ripple) * .1 * (1.0 - edge);
        col = mix(col, vec3(.80, .88, .87), clamp(foam, 0.0, 1.0) * .55);
        col *= mix(vec3(1.0), uSea, .7);
        float glint = pow(max(0.0, ripple * 1.3 - .55), 6.0) * (1.0 - uLamps * .8) * .35;
        col += glint;
        gl_FragColor = vec4(col, mix(.72, .5, edge));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  return { material, uniforms };
}
function createFallMaterial() {
  const uniforms = freshUniforms();
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    uniforms,
    vertexShader: freshVertex,
    fragmentShader: `
      varying vec2 vFlow;
      varying vec3 vWorld;
      uniform float uTime;
      uniform vec3 uSea;
      ${waterNoiseGlsl}
      void main() {
        float across = vFlow.x;
        float along = vFlow.y;
        // Streaks race down the curtain; the sides thin out, the foot thickens into spray.
        float streak = noise(vec2(across * 5.0 + vWorld.x * .3 + vWorld.z * .2, along * 7.0 - uTime * 2.6));
        float fine = noise(vec2(across * 11.0 + 3.0, along * 13.0 - uTime * 3.6));
        float body = smoothstep(.32, .72, streak * .65 + fine * .35);
        float sides = 1.0 - smoothstep(.55, 1.0, abs(across));
        float alpha = (.16 + .5 * body) * sides * (.7 + .3 * along);
        alpha = max(alpha, smoothstep(.75, 1.0, along) * sides * .45);
        vec3 col = mix(vec3(.62, .80, .82), vec3(.93, .97, .97), body);
        col *= mix(vec3(1.0), uSea, .6);
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  return { material, uniforms };
}
let mistTexture: CanvasTexture | null = null;
function getMistTexture() {
  if (mistTexture) return mistTexture;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(32, 32, 2, 32, 32, 32);
    gradient.addColorStop(0, "rgba(255,255,255,0.85)");
    gradient.addColorStop(0.45, "rgba(255,255,255,0.35)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
  }
  mistTexture = new CanvasTexture(canvas);
  return mistTexture;
}

/** World-space ribbons for one parcel's stream: pools, channel and fall. */
export function waterRibbons(field: TerrainField, profile: ParcelProfile, feature: WaterFeature) {
  const [cx, cz] = profile.centre;
  const lift = 0.03;
  const pools = feature.pools.map((pool) =>
    disc(cx + pool.x, pool.water + lift, cz + pool.z, pool.radius - 0.1),
  );
  const lipIndex = feature.path.length - 4;
  const channel = feature.path.slice(0, lipIndex + 1);
  const stream = strip(
    channel.map((p: WaterPath) => [cx + p.x, p.water + lift, cz + p.z] as [number, number, number]),
    channel.map(() => feature.halfWidth - 0.25),
  );
  // The curtain leaves the lip and hugs the face: sampled down the radial until the sea.
  const a = (feature.fall.angleDeg * Math.PI) / 180;
  const lip = feature.path[lipIndex] as WaterPath;
  const lipRadius = Math.hypot(lip.x, lip.z);
  const curtain: [number, number, number][] = [[cx + lip.x, lip.water + lift, cz + lip.z]];
  const widths = [feature.halfWidth - 0.25];
  let last = lip.water + lift;
  // Every sample must drop. Clamping only to `last` let a face that juts outward hold the curtain at
  // one height, which folded the strip into a horizontal sheet part way down: with DoubleSide and no
  // depth write that sheet blended against itself and read as a hard-edged opacity seam.
  const minimumDrop = 0.22;
  for (let k = 1; k <= 14; k++) {
    const radial = lipRadius + k * 0.55;
    const x = cx + Math.cos(a) * radial,
      z = cz + Math.sin(a) * radial;
    const face = heightAt(field, x, z);
    const floor = seaLevel + 0.03;
    let y = Math.max(face + 0.28, floor);
    y = Math.min(y, last - minimumDrop);
    if (y < floor) y = floor;
    last = y;
    curtain.push([x, y, z]);
    widths.push(feature.halfWidth - 0.25 + k * 0.08);
    if (y <= seaLevel + 0.04) break;
  }
  const fall = strip(curtain, widths, 0.7, 5);
  const base = curtain[curtain.length - 1] as [number, number, number];
  return { pools, stream, fall, base, height: lip.water - seaLevel };
}

export function ColonyWater({ field, light }: { field: TerrainField; light: React.RefObject<SceneLight> }) {
  const key = field.profiles.map((profile) => `${profile.id}:${profile.water ? 1 : 0}`).join("|");
  // biome-ignore lint/correctness/useExhaustiveDependencies: Water follows the parcel set, not identity.
  const built = useMemo(() => {
    const root = new Group();
    root.name = "MF_Water";
    const stream = createStreamMaterial();
    const fall = createFallMaterial();
    const mist = new SpriteMaterial({
      map: getMistTexture(),
      transparent: true,
      depthWrite: false,
      opacity: 0.2,
      color: "#e4f1f1",
    });
    const geometries: BufferGeometry[] = [];
    const sprites: { sprite: Sprite; scale: number; phase: number }[] = [];
    for (const profile of field.profiles) {
      if (!profile.water) continue;
      const ribbons = waterRibbons(field, profile, profile.water);
      for (const ribbon of [...ribbons.pools, ribbons.stream]) {
        const geometry = ribbonGeometry(ribbon);
        geometries.push(geometry);
        const mesh = new Mesh(geometry, stream.material);
        mesh.name = `MF_Stream_${profile.id}`;
        mesh.frustumCulled = false;
        root.add(mesh);
      }
      const curtain = ribbonGeometry(ribbons.fall);
      geometries.push(curtain);
      const curtainMesh = new Mesh(curtain, fall.material);
      curtainMesh.name = `MF_Fall_${profile.id}`;
      curtainMesh.frustumCulled = false;
      root.add(curtainMesh);
      // Three soft sprites at the foot; cheaper than particles and enough at these distances.
      const [bx, by, bz] = ribbons.base;
      const spread = Math.min(1.2, 0.5 + ribbons.height * 0.12);
      for (let i = 0; i < 2; i++) {
        const sprite = new Sprite(mist);
        const scale = 1.4 + i * 0.5 + ribbons.height * 0.15;
        sprite.position.set(bx + (i - 0.5) * spread, by + 0.35 + i * 0.3, bz + (i % 2 ? 0.5 : -0.5) * spread);
        sprite.scale.setScalar(scale);
        root.add(sprite);
        sprites.push({ sprite, scale, phase: i * 2.1 + profile.salt * 0.001 });
      }
    }
    return {
      root,
      stream,
      fall,
      mist,
      sprites,
      dispose() {
        for (const geometry of geometries) geometry.dispose();
        stream.material.dispose();
        fall.material.dispose();
        mist.dispose();
      },
    };
  }, [field, key]);
  useEffect(() => () => built.dispose(), [built]);
  useFrame(() => {
    const { time, lamps, sea } = light.current;
    built.stream.uniforms.uTime.value = time;
    built.stream.uniforms.uLamps.value = lamps;
    built.fall.uniforms.uTime.value = time;
    if (sea !== undefined) {
      built.stream.uniforms.uSea.value.setHex(sea);
      built.fall.uniforms.uSea.value.setHex(sea);
    }
    built.mist.opacity = 0.18 - lamps * 0.08;
    for (const { sprite, scale, phase } of built.sprites) {
      sprite.scale.setScalar(scale * (1 + 0.08 * Math.sin(time * 1.3 + phase)));
      sprite.position.y += Math.sin(time * 0.9 + phase) * 0.0015;
    }
  });
  return <primitive object={built.root} />;
}
