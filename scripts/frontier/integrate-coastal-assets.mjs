import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve("design/mission-frontier/assets/staging/coastal-checkpoint-1");
const input = path.join(root, "astra-scene/entries.json");
const output = "public/frontier/assets/coastal";
const document = JSON.parse(await readFile(input, "utf8"));
const entries = Array.isArray(document) ? document : document.assets;
const required = ["terrain", "base", "bridge", "front", "lights", "shallows", "shore"];
if (
  !Array.isArray(entries) ||
  required.some((name) => !entries.some(({ id }) => id === `mf.coastal.${name}`))
)
  throw new Error("The complete registered coastal kit is required.");
if (new Set(entries.map(({ id }) => id)).size !== entries.length)
  throw new Error("Duplicate coastal identity.");
const assets = [];
for (const entry of entries) {
  const source = path.resolve(path.dirname(input), entry.file);
  if (!source.startsWith(`${root}${path.sep}`)) throw new Error("Coastal source escapes staging.");
  const bytes = await readFile(source);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (entry.sha256 !== sha256 || entry.bytes !== bytes.length)
    throw new Error(`Incorrect hash/size: ${entry.id}`);
  if (!/^mf\.coastal\.[a-z0-9.-]+$/.test(entry.id)) throw new Error("Invalid coastal identity.");
  if (bytes.toString("hex", 0, 8) !== "89504e470d0a1a0a" || bytes[25] !== 6)
    throw new Error(`Expected RGBA PNG: ${entry.id}`);
  if (JSON.stringify([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]) !== JSON.stringify(entry.sourceSize))
    throw new Error(`Incorrect PNG dimensions: ${entry.id}`);
  if (
    JSON.stringify(entry.sourceSize) !== JSON.stringify([2560, 1920]) ||
    JSON.stringify(entry.logicalSize) !== JSON.stringify([1280, 960]) ||
    JSON.stringify(entry.groundAnchor) !== JSON.stringify([640, 600])
  )
    throw new Error(`Unregistered coastal layer: ${entry.id}`);
  assets.push({ ...entry, source, sha256, loadStage: "initial" });
}
// Validate every source before changing the public manifest.
await mkdir(output, { recursive: true });
const exported = [];
for (const { source, ...entry } of assets) {
  const filename = `${entry.id}.${entry.sha256.slice(0, 12)}.png`;
  await copyFile(source, path.join(output, filename));
  exported.push({ ...entry, file: `/assets/coastal/${filename}` });
}
await writeFile(
  path.join(output, "manifest.json"),
  `${JSON.stringify({ version: 1, assets: exported }, null, 2)}\n`,
);
console.log(`Integrated ${exported.length} measured coastal layers.`);
