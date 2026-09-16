import { integrateColonyAssets } from "./integrate-colony-assets.mjs";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { legacyBaseVariants } from "../../src/frontier/world-3d/appearance.ts";
import { parseProofManifest } from "../../src/frontier/world-3d/model.ts";

const root = process.cwd();
const original = path.join(root, "design/mission-frontier/assets/staging/3d-visual-proof/astra-scene");
const source = path.join(root, "design/mission-frontier/assets/staging/exterior-bases/astra-kit");
const destination = path.join(root, "public/frontier/assets/3d-proof");
await mkdir(destination, { recursive: true });
const metadata = JSON.parse(await readFile(path.join(source, "kit-metadata.json"), "utf8"));
const inventory = [];
async function asset(file, name, groups = [], identity = false) {
  const bytes = await readFile(file);
  const extension = path.extname(file);
  let details = {};
  if (extension === ".glb") {
    if (
      bytes.readUInt32LE(0) !== 0x46546c67 ||
      bytes.readUInt32LE(4) !== 2 ||
      bytes.readUInt32LE(8) !== bytes.length
    )
      throw new Error(`${name}: invalid GLB container`);
    const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
    const nodes = new Set(json.nodes.map((node) => node.name));
    for (const group of groups) if (!nodes.has(group)) throw new Error(`${name}: missing ${group}`);
    if (groups.length && (!json.images?.length || !json.materials.some((material) => material.normalTexture)))
      throw new Error(`${name}: exported PBR color and normal textures are required`);
    if (identity)
      for (const material of ["identity_roof_inset", "identity_roof_ring", "identity_trim"])
        if (!json.materials.some((entry) => entry.name === material))
          throw new Error(`${name}: missing ${material}`);
    if (json.images?.some((image) => image.uri && !image.uri.startsWith("data:")))
      throw new Error(`${name}: external texture URI is not self contained`);
    details = {
      meshes: json.meshes?.length ?? 0,
      materials: json.materials?.length ?? 0,
      textures: json.images?.length ?? 0,
      animations: json.animations?.map((animation) => animation.name) ?? [],
    };
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const filename = `${name}.${sha256.slice(0, 12)}${extension}`;
  await writeFile(path.join(destination, filename), bytes);
  inventory.push({ source: path.relative(root, file), filename, sha256, bytes: bytes.length, ...details });
  return `/assets/3d-proof/${filename}`;
}
const scene = await asset(path.join(source, "environment.glb"), "environment", [
  "MF_Terrain",
  "MF_Bridge",
  "MF_Planting",
]);
const worker = await asset(path.join(original, "worker.glb"), "worker");
const bases = {};
for (const variant of legacyBaseVariants) {
  const src = await asset(
    path.join(source, `base-${variant}.glb`),
    `base-${variant}`,
    ["MF_BaseFixed", "MF_Roof", "MF_ShellCutaway", "MF_Interior", "MF_Court", "MF_Props", "MF_Practicals"],
    true,
  );
  const preview = await asset(path.join(source, `previews/${variant}.png`), `preview-${variant}`);
  bases[variant] = { src, preview, lightPositions: metadata.baseLightPositions[variant] };
}
const { colony, shoreline } = await integrateColonyAssets(root, asset);
const manifest = parseProofManifest({
  version: 3,
  colony,
  scene,
  worker,
  bases,
  cameras: metadata.cameras,
  sockets: metadata.sockets,
  walkableRoutes: metadata.walkableRoutes,
  shorelineXZ: shoreline,
  practicalLightPositions: [],
  environmentLightPositions: metadata.environmentLightPositions,
});
await writeFile(path.join(destination, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await mkdir(path.join(root, "design/mission-frontier/build-evidence/COLONY-SLICE-1"), { recursive: true });
await writeFile(
  path.join(root, "design/mission-frontier/build-evidence/COLONY-SLICE-1/asset-inventory.json"),
  `${JSON.stringify({ capturedAt: new Date().toISOString(), assets: inventory }, null, 2)}\n`,
);
console.log(
  JSON.stringify(
    inventory.map(({ filename, bytes }) => ({ filename, bytes })),
    null,
    2,
  ),
);
