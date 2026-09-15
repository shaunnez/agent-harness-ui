import {
  Color,
  DataTexture,
  LinearFilter,
  RGBAFormat,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
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
export function createCoastalWater(loops: [number, number][][]) {
  const points = loops.flat();
  const minX = Math.min(...points.map((p) => p[0])) - 45;
  const minZ = Math.min(...points.map((p) => p[1])) - 45;
  const spanX = Math.max(...points.map((p) => p[0])) + 45 - minX;
  const spanZ = Math.max(...points.map((p) => p[1])) + 45 - minZ;
  const size = 512;
  const bytes = new Uint8Array(size * size * 4);
  for (let row = 0; row < size; row++)
    for (let column = 0; column < size; column++) {
      const { distance, land } = shoreDistance(
        (column / (size - 1)) * spanX + minX,
        (row / (size - 1)) * spanZ + minZ,
        loops,
      );
      const index = (row * size + column) * 4;
      bytes[index] = Math.round(Math.min(1, distance / 40) * 255);
      bytes[index + 1] = land ? 255 : 0;
      bytes[index + 3] = 255;
    }
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
      uniform vec3 uSea;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
          mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
      }
      float wave(vec2 p) {
        float warp = noise(p * .23) * 4.0;
        return sin(p.x * 1.43 + p.y * .63 + uTime * .68 + warp) * .5
          + sin(p.x * .79 - p.y * 1.57 - uTime * .43 + warp * 1.7) * .3
          + sin(p.x * 3.1 + p.y * 2.3 + uTime * .91) * .12;
      }
      void main() {
        vec2 p = vWorld.xz;
        vec2 data = texture2D(uShore, (p - uShoreMin) / uShoreSpan).rg;
        float distance = data.r * 40.0;
        float shallow = exp(-distance * .22);
        vec3 deep = vec3(.013, .075, .115);
        vec3 coast = vec3(.045, .30, .29);
        float w = wave(p);
        vec3 col = mix(deep, coast, shallow) * (1.0 + w * .07);
        float crest = pow(max(0.0, sin(distance * 3.4 + uTime * 1.15 + sin(p.x * .7 + p.y * .9) * 1.2)), 16.0);
        float broken = smoothstep(-.45, .65, wave(p * .8));
        float wash = crest * exp(-distance * 1.2) * smoothstep(.05, .3, distance) * (1.0 - data.g) * broken;
        float glint = pow(max(0.0, wave(p * 1.9) * .8 + .19), 14.0) * .09;
        col = mix(col, vec3(.43, .64, .63), wash * .55);
        col += glint * (1.0 - uLamps * .8);
        col *= mix(vec3(1.0), uSea, .82);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  return { material, texture, uniforms };
}
