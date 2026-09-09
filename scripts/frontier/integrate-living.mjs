import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const staging = path.resolve("design/mission-frontier/assets/staging/living-world");
const destination = path.resolve("public/frontier/assets/living");
await mkdir(destination, { recursive: true });
const motion = JSON.parse(await readFile(path.join(staging, "astra/worker-motion-manifest.json"), "utf8"));
const assets = [];
async function exportAsset(id, source, metadata) {
  const bytes = await readFile(source);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const file = `${id}-${sha256.slice(0, 10)}.png`;
  await copyFile(source, path.join(destination, file));
  assets.push({ id, file: `/assets/living/${file}`, bytes: bytes.length, sha256, ...metadata });
}
for (const [pose, animation] of Object.entries(motion.animations)) {
  for (const frame of animation.frames) {
    const source = path.join(staging, "astra", frame.file);
    const actualHash = createHash("sha256")
      .update(await readFile(source))
      .digest("hex");
    if (actualHash !== frame.sha256) throw new Error(`Unqualified animation frame: ${source}`);
    await exportAsset(`mf.living.worker.${pose}.${frame.frame}`, source, {
      sourceSize: motion.sourceSize,
      logicalSize: motion.logicalSize,
      groundAnchor: motion.groundAnchor,
      boundsSourcePixels: frame.alphaBoundsSource,
      sockets: frame.sockets,
      frameDurationMs: animation.frameDurationMs,
      loadStage: pose === "walk" ? "initial" : "activity",
      production: {
        source: path.relative(process.cwd(), source),
        generator: "Blender",
        sourceId: motion.sourceId,
        scriptSha256: motion.buildScriptSha256,
      },
    });
  }
}
const lightMetadata = JSON.parse(await readFile(path.join(staging, "lights/metadata.json"), "utf8"));
await exportAsset("mf.living.observatory.lights", path.join(staging, "lights/observatory-lights.png"), {
  sourceSize: lightMetadata.sourceSize,
  logicalSize: lightMetadata.logicalSize,
  groundAnchor: lightMetadata.groundAnchor,
  loadStage: "initial",
  blendMode: "add",
  production: {
    generator: "Blender",
    sourceSha256: lightMetadata.sourceSha256,
    scriptSha256: lightMetadata.scriptSha256,
  },
});
const manifest = { revision: "living-world-v1", assets };
await writeFile(path.join(destination, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  JSON.stringify({
    assets: assets.length,
    bytes: assets.reduce((sum, entry) => sum + entry.bytes, 0),
    initialBytes: assets
      .filter((entry) => entry.loadStage === "initial")
      .reduce((sum, entry) => sum + entry.bytes, 0),
  }),
);
