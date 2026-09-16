import {
  Color,
  DataTexture,
  LinearFilter,
  RGBAFormat,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  Vector3,
  Vector4,
} from "three";

export function shoreDistance(x: number, z: number, loops: [number, number][][]) {
  let distanceSquared = 40 * 40;
  let land = false;
  for (const loop of loops) {
    let inside = false;
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      if (!a || !b) continue;
      const dx = b[0] - a[0],
        dz = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
      const px = x - a[0] - t * dx,
        pz = z - a[1] - t * dz;
      distanceSquared = Math.min(distanceSquared, px * px + pz * pz);
      if (a[1] > z !== b[1] > z && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    land ||= inside;
  }
  return { distance: Math.sqrt(distanceSquared), land };
}
/** Legacy archipelago sea: polygon shorelines, no depth channel, the 2A look (style 0). */
export function createCoastalWater(loops: [number, number][][]) {
  const points = loops.flat();
  const minX = Math.min(...points.map((p) => p[0])) - 45;
  const minZ = Math.min(...points.map((p) => p[1])) - 45;
  const spanX = Math.max(...points.map((p) => p[0])) + 45 - minX;
  const spanZ = Math.max(...points.map((p) => p[1])) + 45 - minZ;
  // Pixels farther than the shader's 40m shore reach do not need polygon edge tests.
  // With many parcels this avoids scanning every island for every water texel.
  const bounded = loops.map((loop) => ({
    loop,
    minX: Math.min(...loop.map((p) => p[0])) - 40,
    maxX: Math.max(...loop.map((p) => p[0])) + 40,
    minZ: Math.min(...loop.map((p) => p[1])) - 40,
    maxZ: Math.max(...loop.map((p) => p[1])) + 40,
  }));
  const size = 512;
  const bytes = new Uint8Array(size * size * 4);
  for (let row = 0; row < size; row++)
    for (let column = 0; column < size; column++) {
      const x = (column / (size - 1)) * spanX + minX;
      const z = (row / (size - 1)) * spanZ + minZ;
      const nearby = bounded
        .filter((bounds) => x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ)
        .map((bounds) => bounds.loop);
      const { distance, land } = shoreDistance(x, z, nearby);
      const index = (row * size + column) * 4;
      bytes[index] = Math.round(Math.min(1, distance / 40) * 255);
      bytes[index + 1] = land ? 255 : 0;
      bytes[index + 2] = 255;
      bytes[index + 3] = 255;
    }
  return buildWater(bytes, size, minX, minZ, spanX, spanZ, 0.22, 0);
}
/**
 * Water for a height field: land is wherever the field is above sea level, the shore distance is a
 * chamfer distance transform over a 512-cell grid (about half a metre per cell for a small colony),
 * and the blue channel carries how deep the seabed lies so the shallows read as sand under water.
 */
export function createWaterFromField(
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  heightAt: (x: number, z: number) => number,
  seaLevel = 0,
) {
  const margin = 45;
  const minX = bounds.minX - margin,
    minZ = bounds.minZ - margin;
  const spanX = bounds.maxX + margin - minX,
    spanZ = bounds.maxZ + margin - minZ;
  const size = 512;
  const cellX = spanX / (size - 1),
    cellZ = spanZ / (size - 1);
  const land = new Uint8Array(size * size);
  const depth = new Uint8Array(size * size);
  const distance = new Float32Array(size * size).fill(1e9);
  for (let row = 0; row < size; row++)
    for (let column = 0; column < size; column++) {
      const x = column * cellX + minX,
        z = row * cellZ + minZ;
      const index = row * size + column;
      const height = heightAt(x, z);
      if (height > seaLevel) {
        land[index] = 1;
        distance[index] = 0;
      }
      // Full depth is the channel seabed (3 m); the cliff toe and pad faces are shallower.
      depth[index] = Math.round(Math.min(1, Math.max(0, (seaLevel - height) / 3)) * 255);
    }
  // Two-pass chamfer (3-4 weights) in cell units; anisotropic cells are close enough for wash.
  const cell = (cellX + cellZ) / 2;
  const relax = (index: number, other: number, cost: number) => {
    const candidate = (distance[other] ?? 1e9) + cost;
    if (candidate < (distance[index] ?? 1e9)) distance[index] = candidate;
  };
  for (let row = 0; row < size; row++)
    for (let column = 0; column < size; column++) {
      const index = row * size + column;
      if (column > 0) relax(index, index - 1, 3);
      if (row > 0) {
        relax(index, index - size, 3);
        if (column > 0) relax(index, index - size - 1, 4);
        if (column < size - 1) relax(index, index - size + 1, 4);
      }
    }
  for (let row = size - 1; row >= 0; row--)
    for (let column = size - 1; column >= 0; column--) {
      const index = row * size + column;
      if (column < size - 1) relax(index, index + 1, 3);
      if (row < size - 1) {
        relax(index, index + size, 3);
        if (column < size - 1) relax(index, index + size + 1, 4);
        if (column > 0) relax(index, index + size - 1, 4);
      }
    }
  const bytes = new Uint8Array(size * size * 4);
  for (let index = 0; index < size * size; index++) {
    const metres = ((distance[index] ?? 0) / 3) * cell;
    bytes[index * 4] = Math.round(Math.min(1, metres / 40) * 255);
    bytes[index * 4 + 1] = land[index] ? 255 : 0;
    bytes[index * 4 + 2] = depth[index] ?? 255;
    bytes[index * 4 + 3] = 255;
  }
  // A tighter shallow band than the archipelago: the reference sea is deep teal right up to the rocks.
  return buildWater(bytes, size, minX, minZ, spanX, spanZ, 0.55, 1);
}
/** Waterfall splash points (world x, z, radius, strength) the sea foams around; at most this many. */
export const maxSplashes = 8;
export type WaterSplash = [number, number, number, number];
export function setWaterSplashes(water: ReturnType<typeof buildWater>, splashes: WaterSplash[]) {
  const list = water.uniforms.uSplash.value;
  for (let i = 0; i < maxSplashes; i++) {
    const splash = splashes[i];
    list[i]?.set(splash?.[0] ?? 0, splash?.[1] ?? 0, splash?.[2] ?? 0, splash?.[3] ?? 0);
  }
  water.uniforms.uSplashCount.value = Math.min(maxSplashes, splashes.length);
}

/** Noise shared by the sea, stream and fall shaders. */
export const waterNoiseGlsl = `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
      mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 3; i++) { v += a * noise(p); p = p * 2.07 + vec2(1.3, 7.1); a *= 0.5; }
    return v;
  }`;

/**
 * Shared sea material: shore-distance texture (r = distance / 40, g = land, b = depth) over the sea
 * plane. Style 1 (the colony) adds shoreline foam, a sand-to-deep colour ramp from the depth
 * channel, a sun glint from the wave normal and churn around waterfall bases; style 0 keeps the
 * archipelago look on main unchanged.
 */
function buildWater(
  bytes: Uint8Array,
  size: number,
  minX: number,
  minZ: number,
  spanX: number,
  spanZ: number,
  shallowDecay: number,
  style: 0 | 1,
) {
  const texture = new DataTexture(bytes, size, size, RGBAFormat, UnsignedByteType);
  texture.minFilter = texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  const uniforms = {
    uShore: { value: texture },
    uShoreMin: { value: new Vector2(minX, minZ) },
    uShoreSpan: { value: new Vector2(spanX, spanZ) },
    uTime: { value: 0 },
    uSea: { value: new Color(0xffffff) },
    uLamps: { value: 0 },
    uShallow: { value: shallowDecay },
    uStyle: { value: style },
    uSun: { value: new Vector3(-105, 165, 90).normalize() },
    uSplash: { value: Array.from({ length: maxSplashes }, () => new Vector4()) },
    uSplashCount: { value: 0 },
  };
  const material = new ShaderMaterial({
    uniforms,
    vertexShader: `
      varying vec3 vWorld;
      uniform float uTime;
      void main() {
        vec3 p = position;
        p.z += sin(p.x * 0.61 + uTime * 0.62) * 0.045 + sin(p.y * 0.7 - uTime * 0.45) * 0.03;
        vec4 world = modelMatrix * vec4(p, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: `
      varying vec3 vWorld;
      uniform sampler2D uShore;
      uniform vec2 uShoreMin;
      uniform vec2 uShoreSpan;
      uniform float uTime;
      uniform float uLamps;
      uniform float uShallow;
      uniform float uStyle;
      uniform vec3 uSea;
      uniform vec3 uSun;
      uniform vec4 uSplash[${maxSplashes}];
      uniform float uSplashCount;
      ${waterNoiseGlsl}
      float wave(vec2 p) {
        float warp = noise(p * .23) * 4.0;
        return sin(p.x * 1.43 + p.y * .63 + uTime * .68 + warp) * .5
          + sin(p.x * .79 - p.y * 1.57 - uTime * .43 + warp * 1.7) * .3
          + sin(p.x * 3.1 + p.y * 2.3 + uTime * .91) * .12;
      }
      void main() {
        vec2 p = vWorld.xz;
        vec3 data = texture2D(uShore, (p - uShoreMin) / uShoreSpan).rgb;
        float distance = data.r * 40.0;
        float depth = mix(1.0, data.b, uStyle);
        float shallow = exp(-distance * uShallow);
        // Colour: deep water, teal along the coast, and sand showing through where the seabed is close.
        float shoal = max(shallow, (1.0 - depth) * (1.0 - depth));
        vec3 deep = vec3(.013, .075, .115);
        vec3 coast = vec3(.045, .30, .29);
        vec3 sand = vec3(.21, .50, .45);
        float w = wave(p);
        vec3 col = mix(deep, coast, shoal);
        col = mix(col, sand, smoothstep(.55, 1.0, shoal) * uStyle * .8);
        col *= 1.0 + w * .07;
        // Surface movement: a normal from the wave gradient gives a sun glint and a sky-tinted grazing angle.
        float e = .35;
        float wx = wave(p + vec2(e, 0.0)) - wave(p - vec2(e, 0.0));
        float wz = wave(p + vec2(0.0, e)) - wave(p - vec2(0.0, e));
        vec3 n = normalize(vec3(-wx * .28, 1.0, -wz * .28));
        vec3 view = normalize(cameraPosition - vWorld);
        vec3 h = normalize(view + uSun);
        float spec = pow(max(dot(n, h), 0.0), 160.0) * .5 * (1.0 - uLamps * .85) * uStyle;
        float grazing = pow(1.0 - max(dot(n, view), 0.0), 3.0);
        col = mix(col, vec3(.34, .48, .58), grazing * .16 * (1.0 - uLamps * .6) * uStyle);
        // Wash lines rolling in (both styles), then the colony's broken foam band along every shore.
        float crest = pow(max(0.0, sin(distance * 3.4 + uTime * 1.15 + sin(p.x * .7 + p.y * .9) * 1.2)), 16.0);
        float broken = smoothstep(-.45, .65, wave(p * .8));
        float wash = crest * exp(-distance * 1.2) * smoothstep(.05, .3, distance) * (1.0 - data.g) * broken;
        col = mix(col, vec3(.43, .64, .63), wash * .55);
        float foamNoise = fbm(p * .9 + vec2(uTime * .13, -uTime * .09));
        float breathe = .5 + .5 * sin(uTime * .9 + distance * 1.6 + foamNoise * 3.0);
        float band = 1.0 - smoothstep(.1, 1.9 + breathe * 1.3, distance);
        float foam = smoothstep(.40, .62, foamNoise + band * .38) * band;
        // Churn and rings where a waterfall lands.
        for (int i = 0; i < ${maxSplashes}; i++) {
          if (float(i) >= uSplashCount) break;
          vec4 s = uSplash[i];
          float d = length(p - s.xy);
          float churn = (1.0 - smoothstep(0.0, s.z, d)) * (.5 + .5 * noise(p * 2.4 + vec2(uTime * .9, -uTime * 1.3)));
          float ring = pow(max(0.0, sin(d * 2.6 - uTime * 2.4)), 8.0) * (1.0 - smoothstep(s.z * .5, s.z * 2.4, d)) * .4;
          foam = max(foam, (churn + ring) * s.w);
        }
        foam *= (1.0 - data.g) * uStyle;
        col = mix(col, vec3(.86, .92, .9), clamp(foam, 0.0, 1.0) * .78);
        col += spec;
        float glint = pow(max(0.0, wave(p * 1.9) * .8 + .19), 14.0) * .09;
        col += glint * (1.0 - uLamps * .8);
        col *= mix(vec3(1.0), uSea, .82);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  return { material, texture, uniforms };
}
