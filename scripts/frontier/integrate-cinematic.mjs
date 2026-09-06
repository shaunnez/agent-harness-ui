import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const staging = path.join(root, "design/mission-frontier/assets/staging/cinematic-v1");
const output = path.join(root, "public/frontier/assets/cinematic");
const quality = process.argv.includes("--final") ? "final" : "preview";
const assets = [];
await mkdir(output, { recursive: true });
for (const name of ["island", "water", "bridge", "bridge-se"]) {
  const meta = JSON.parse(await readFile(path.join(staging, "environment", quality, `${name}.json`), "utf8"));
  const source = path.join(root, meta.file);
  const bytes = await readFile(source);
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== meta.sha256) throw new Error(`Unqualified source changed: ${meta.file}`);
  const filename = `${name}-${hash.slice(0, 10)}.png`;
  await copyFile(source, path.join(output, filename));
  assets.push({
    id: meta.id,
    file: `/assets/cinematic/${filename}`,
    sourceSize: meta.sourceSize,
    logicalSize: meta.logicalSize,
    groundAnchor: meta.groundAnchor,
    bytes: bytes.length,
    sha256: hash,
    production: { source: meta.file, blend: meta.sourceBlend, sources: meta.sources, quality },
  });
}
const astra = path.join(staging, "astra");
const ids = {
  "mf.base.standard.roof": "mf.cinematic.roof",
  "mf.prop.purple-tree": "mf.cinematic.tree",
  "mf.prop.purple-tree.shadow": "mf.cinematic.tree.shadow",
  "mf.worker.standard.se.neutral": "mf.cinematic.worker.idle",
  "mf.worker.standard.se.working": "mf.cinematic.worker.work",
  "mf.worker.standard.portrait": "mf.cinematic.worker.portrait",
};
const exterior = path.join(astra, "exterior-production");
const roof = JSON.parse(await readFile(path.join(exterior, "entry.json"), "utf8"));
roof.metadata = "entry.json";
const production = path.join(astra, "production");
const workers = JSON.parse(await readFile(path.join(production, "entries.json"), "utf8"));
const checksums = JSON.parse(await readFile(path.join(production, "checksums.json"), "utf8"));
const checks = JSON.parse(await readFile(path.join(production, "qa/checks.json"), "utf8"));
const vegetation = path.join(astra, quality === "final" ? "vegetation-production" : "vegetation-calibration");
const treeMetadata = quality === "final" ? "entry-r2.json" : "entry.json";
const tree = JSON.parse(await readFile(path.join(vegetation, treeMetadata), "utf8"));
tree.metadata = treeMetadata;
const foliageEntries = [tree];
if (quality === "final") {
  const shadow = JSON.parse(await readFile(path.join(vegetation, "shadow-entry.json"), "utf8"));
  shadow.metadata = "shadow-entry.json";
  foliageEntries.push(shadow);
}
const packages = [
  {
    directory: exterior,
    entries: [roof],
    checksums: {},
    quality: `${roof.samples}-sample-production`,
    blend: "blend/exterior.blend",
  },
  {
    directory: production,
    entries: workers,
    checksums,
    quality: "64-sample-production",
    blend: "blend/worker-production.blend",
  },
  {
    directory: vegetation,
    entries: foliageEntries,
    checksums: {},
    quality: `${tree.samples}-sample-${quality === "final" ? "production" : "calibration"}`,
    blend: quality === "final" ? "blend/spreading-grove-r2.blend" : "blend/spreading-grove.blend",
  },
];
let frameDurationMs = 100;
for (const kit of packages) {
  for (const entry of kit.entries) {
    const frames = entry.frames ?? [{ file: entry.file }];
    if (entry.frames) frameDurationMs = entry.frameDurationMs;
    for (let index = 0; index < frames.length; index++) {
      const frame = frames[index];
      const source = path.join(kit.directory, frame.file);
      const data = await readFile(source);
      const hash = createHash("sha256").update(data).digest("hex");
      const expected = kit.checksums[frame.file] ?? (!index ? entry.sha256 : null);
      if (!expected || hash !== expected)
        throw new Error(`Astra source changed or lacks a checksum: ${frame.file}`);
      const id = `${ids[entry.id]}${entry.frames ? `.${index}` : ""}`;
      const filename = `${id}-${hash.slice(0, 10)}.png`;
      await copyFile(source, path.join(output, filename));
      assets.push({
        id,
        file: `/assets/cinematic/${filename}`,
        sourceSize: entry.sourceSize,
        logicalSize: entry.logicalSize,
        groundAnchor: entry.groundAnchor,
        boundsSourcePixels:
          entry.alphaBoundsSource ??
          (id.includes("worker") && !id.endsWith("portrait") ? checks.visibleBoundsSource : undefined),
        bytes: data.length,
        sha256: hash,
        sockets: frame.probeTipSource ? { probeTip: frame.probeTipSource.map((p) => p / 2) } : {},
        production: {
          source: path.relative(root, source),
          metadata: path.relative(root, path.join(kit.directory, entry.metadata)),
          quality: kit.quality,
          blend: path.relative(
            root,
            path.join(
              kit.directory,
              entry.id === "mf.prop.purple-tree.shadow" ? "blend/spreading-grove.blend" : kit.blend,
            ),
          ),
        },
      });
    }
  }
}
const workerCatalog = {
  portrait: assets.find((asset) => asset.id === "mf.cinematic.worker.portrait").file,
  frames: assets.filter((asset) => asset.id.startsWith("mf.cinematic.worker.work.")).map((asset) => asset.id),
  frameDurationMs,
};
await writeFile(
  path.join(root, "src/frontier/world/cinematic-catalog.ts"),
  `// Generated by scripts/frontier/integrate-cinematic.mjs from verified asset metadata.\nexport const cinematicWorker = {\n  portrait: ${JSON.stringify(workerCatalog.portrait)},\n  frames: [\n${workerCatalog.frames.map((id) => `    ${JSON.stringify(id)},`).join("\n")}\n  ],\n  frameDurationMs: ${workerCatalog.frameDurationMs},\n} as const;\n`,
);
const used = new Set(assets.map((asset) => path.basename(asset.file)));
for (const name of await readdir(output)) {
  const owned =
    name.startsWith("mf.cinematic.") || /^(island|water|bridge|bridge-se)-[a-f0-9]{10}\.png$/.test(name);
  if (owned && name.endsWith(".png") && !used.has(name)) await unlink(path.join(output, name));
}
const manifest = {
  version: 1,
  revision: `cinematic-v1-${quality}`,
  status: quality === "preview" ? "calibration-only" : "qualified-in-app",
  projection: "fixed orthographic 2:1, common measured ground anchors",
  assets,
};
await writeFile(path.join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Integrated ${assets.length} ${quality} environment assets into the explicit cinematic preview.`);
