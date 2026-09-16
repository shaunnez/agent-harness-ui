import { useLoader } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
} from "three";
import { surfaceAt, type TerrainField } from "./terrain-field";

export interface TerrainTextureUrls {
  gravel: string;
  limestone: string;
  cliff: string;
  cliffNormal?: string;
  basalt: string;
}

/** Grid mesh over the field bounds; `aSurface` = (road, flat, shelf, land) and `aWet` drive the shader blend. */
export function buildTerrainGeometry(field: TerrainField, resolution = 1.0) {
  const { minX, maxX, minZ, maxZ } = field.bounds;
  const columns = Math.ceil((maxX - minX) / resolution) + 1;
  const rows = Math.ceil((maxZ - minZ) / resolution) + 1;
  const count = columns * rows;
  const positions = new Float32Array(count * 3);
  const surface = new Float32Array(count * 4);
  const wet = new Float32Array(count);
  const uvs = new Float32Array(count * 2);
  for (let row = 0; row < rows; row++)
    for (let column = 0; column < columns; column++) {
      const index = row * columns + column;
      const x = minX + column * resolution;
      const z = minZ + row * resolution;
      const sample = surfaceAt(field, x, z);
      positions[index * 3] = x;
      positions[index * 3 + 1] = sample.height;
      positions[index * 3 + 2] = z;
      surface[index * 4] = sample.road;
      surface[index * 4 + 1] = sample.flat;
      surface[index * 4 + 2] = sample.shelf;
      surface[index * 4 + 3] = sample.land;
      wet[index] = sample.wet;
      uvs[index * 2] = x / 8;
      uvs[index * 2 + 1] = z / 8;
    }
  const indices = new Uint32Array((columns - 1) * (rows - 1) * 6);
  let cursor = 0;
  for (let row = 0; row < rows - 1; row++)
    for (let column = 0; column < columns - 1; column++) {
      const a = row * columns + column;
      const b = a + 1;
      const c = a + columns;
      const d = c + 1;
      // Alternate the diagonal so long ridges do not show a stitching direction.
      if ((row + column) % 2 === 0) {
        indices[cursor++] = a;
        indices[cursor++] = c;
        indices[cursor++] = b;
        indices[cursor++] = b;
        indices[cursor++] = c;
        indices[cursor++] = d;
      } else {
        indices[cursor++] = a;
        indices[cursor++] = c;
        indices[cursor++] = d;
        indices[cursor++] = a;
        indices[cursor++] = d;
        indices[cursor++] = b;
      }
    }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("aSurface", new BufferAttribute(surface, 4));
  geometry.setAttribute("aWet", new BufferAttribute(wet, 1));
  geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

const prepare = (texture: Texture, colour = true) => {
  texture.wrapS = texture.wrapT = RepeatWrapping;
  if (colour) texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
};

/**
 * One standard material for the whole archipelago. Ground, shelf, cliff and paving textures are
 * blended per fragment from slope, height and the vertex surface weights, tri-planar on the faces,
 * so the same lights, shadows and tone mapping as the buildings apply.
 */
export function createTerrainMaterial(textures: {
  gravel: Texture;
  limestone: Texture;
  cliff: Texture;
  cliffNormal?: Texture;
  basalt: Texture;
}) {
  const material = new MeshStandardMaterial({
    map: prepare(textures.gravel),
    roughness: 0.94,
    metalness: 0,
  });
  material.name = "colony_terrain";
  prepare(textures.limestone);
  prepare(textures.cliff);
  prepare(textures.basalt);
  if (textures.cliffNormal) prepare(textures.cliffNormal, false);
  material.customProgramCacheKey = () => "colony_terrain_v2_wet";
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uLimestone = { value: textures.limestone };
    shader.uniforms.uCliff = { value: textures.cliff };
    shader.uniforms.uBasalt = { value: textures.basalt };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        attribute vec4 aSurface;
        attribute float aWet;
        varying vec4 vSurface;
        varying float vWet;
        varying vec3 vWorldPos;
        varying vec3 vNormalW;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vSurface = aSurface;
        vWet = aWet;
        vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vNormalW = normalize(mat3(modelMatrix) * normal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec4 vSurface;
        varying float vWet;
        varying vec3 vWorldPos;
        varying vec3 vNormalW;
        uniform sampler2D uLimestone;
        uniform sampler2D uCliff;
        uniform sampler2D uBasalt;
        float tHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float tNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(tHash(i), tHash(i + vec2(1, 0)), f.x), mix(tHash(i + vec2(0, 1)), tHash(i + vec2(1, 1)), f.x), f.y);
        }`,
      )
      .replace(
        "#include <map_fragment>",
        `vec3 wp = vWorldPos;
        vec3 nw = normalize(vNormalW);
        float slope = 1.0 - abs(nw.y);
        float cliff = smoothstep(0.40, 0.70, slope);
        float macro = tNoise(wp.xz * 0.045);
        // Ground: gravel-sand with drifts of dry grass on the flatter shoulder, never on paving.
        vec3 gravel = texture2D(map, wp.xz / 7.5).rgb * (0.9 + 0.2 * macro) * vec3(0.88, 0.82, 0.72);
        vec3 grass = gravel * vec3(0.72, 0.86, 0.50);
        float grassMask = smoothstep(0.50, 0.78, tNoise(wp.xz * 0.11 + 3.0)) * (1.0 - cliff) * smoothstep(3.2, 3.9, wp.y) * (1.0 - vSurface.y * 0.7);
        vec3 ground = mix(gravel, grass, grassMask * 0.6);
        vec3 lime = texture2D(uLimestone, wp.xz / 5.5).rgb;
        // Bare rock breaks through the shoulder in patches and on every ledge.
        float rockPatch = smoothstep(0.52, 0.72, tNoise(wp.xz * 0.075 + 9.0)) * (1.0 - vSurface.y);
        rockPatch = max(rockPatch, smoothstep(0.18, 0.40, slope) * (1.0 - vSurface.y));
        ground = mix(ground, lime * vec3(0.95, 0.9, 0.82), rockPatch * 0.85);
        ground = mix(ground, lime * vec3(0.92, 0.9, 0.86), clamp(vSurface.z, 0.0, 1.0));
        // Cliff faces: tri-planar limestone with strata bands and a darker undercut near the water.
        vec3 blend = abs(nw); blend = pow(blend, vec3(4.0)); blend /= (blend.x + blend.y + blend.z);
        vec3 cx = texture2D(uCliff, wp.zy / 6.5).rgb;
        vec3 cz = texture2D(uCliff, wp.xy / 6.5).rgb;
        vec3 face = cx * blend.x + cz * blend.z + lime * blend.y;
        float strata = 0.84 + 0.16 * smoothstep(0.30, 0.62, fract(wp.y / 1.4 + tNoise(wp.xz * 0.35) * 0.35));
        face *= strata * vec3(1.0, 0.96, 0.9);
        vec3 col = mix(ground, face, cliff);
        // Paving on spurs, pads and the court apron.
        vec3 basalt = texture2D(uBasalt, wp.xz / 4.0).rgb;
        col = mix(col, basalt, clamp(vSurface.x, 0.0, 1.0));
        // Splash zone and stream banks: wet, dark rock; the stream bed is bare limestone under the water.
        float wet = max(1.0 - smoothstep(0.1, 1.5, wp.y), clamp(vWet, 0.0, 1.0) * (1.0 - vSurface.x));
        col = mix(col, lime * vec3(0.9, 0.88, 0.82), clamp(vWet, 0.0, 1.0) * 0.6);
        col *= mix(1.0, 0.42, wet);
        // Seabed under shallow water reads as sand so the shallows glow.
        float sea = 1.0 - smoothstep(-2.6, -0.4, wp.y);
        col = mix(col, vec3(0.42, 0.40, 0.30), sea * 0.8);
        diffuseColor.rgb *= col;`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.38, max(1.0 - smoothstep(0.1, 1.5, vWorldPos.y), clamp(vWet, 0.0, 1.0)));`,
      );
  };
  return material;
}

function TexturedTerrain({ field, textures }: { field: TerrainField; textures: TerrainTextureUrls }) {
  const urls = useMemo(
    () => [
      textures.gravel,
      textures.limestone,
      textures.cliff,
      textures.basalt,
      ...(textures.cliffNormal ? [textures.cliffNormal] : []),
    ],
    [textures],
  );
  const loaded = useLoader(TextureLoader, urls);
  const material = useMemo(
    () =>
      createTerrainMaterial({
        gravel: loaded[0] as Texture,
        limestone: loaded[1] as Texture,
        cliff: loaded[2] as Texture,
        basalt: loaded[3] as Texture,
        cliffNormal: loaded[4],
      }),
    [loaded],
  );
  useEffect(() => () => material.dispose(), [material]);
  return <TerrainMesh field={field} material={material} />;
}
function TerrainMesh({ field, material }: { field: TerrainField; material: MeshStandardMaterial }) {
  const geometry = useMemo(() => buildTerrainGeometry(field), [field]);
  const mesh = useMemo(() => {
    const result = new Mesh(geometry, material);
    result.name = "MF_Terrain";
    result.castShadow = result.receiveShadow = true;
    result.frustumCulled = false;
    return result;
  }, [geometry, material]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <primitive object={mesh} />;
}
const plainMaterial = new MeshStandardMaterial({ color: "#8d907c", roughness: 0.95 });
/** The archipelago surface; without a complete texture set it renders in one neutral stone colour. */
export function ColonyTerrain({
  field,
  textures,
}: {
  field: TerrainField;
  textures?: Partial<TerrainTextureUrls>;
}) {
  const complete =
    textures?.gravel && textures.limestone && textures.cliff && textures.basalt
      ? (textures as TerrainTextureUrls)
      : null;
  return complete ? (
    <TexturedTerrain field={field} textures={complete} />
  ) : (
    <TerrainMesh field={field} material={plainMaterial} />
  );
}
