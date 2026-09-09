import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const base = "design/mission-frontier/assets";
const output = "public/frontier/assets";
const manifestPath = path.join(base, "runtime-asset-manifest.json");
const manifest = await readFile(manifestPath, "utf8")
  .then(JSON.parse)
  .catch((error) => {
    if (error.code === "ENOENT") return { version: 1, status: "M1-calibration", assets: [] };
    throw error;
  });
await mkdir(output, { recursive: true });
for (const input of process.argv.slice(2)) {
  const directory = input.endsWith(".json") ? path.dirname(input) : input;
  if (!directory.startsWith(`${base}/staging/`))
    throw new Error("Only assigned staging entries can be integrated.");
  const entry = JSON.parse(
    await readFile(input.endsWith(".json") ? input : path.join(directory, "entry.json"), "utf8"),
  );
  const source = path.resolve(directory, entry.file);
  if (!source.startsWith(path.resolve(directory) + path.sep)) throw new Error("Invalid export path.");
  const bytes = await readFile(source);
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== entry.sha256) throw new Error(`Asset checksum mismatch: ${entry.id}`);
  const filename = `${entry.id}.r${entry.revision}.png`;
  await copyFile(source, path.join(output, filename));
  const parts = [];
  for (const part of entry.parts ?? []) {
    if (!/^[a-z0-9-]+$/.test(part.name)) throw new Error("Invalid part name.");
    if (!part.file) {
      parts.push(part);
      continue;
    }
    const partSource = path.resolve(directory, part.file);
    if (!partSource.startsWith(path.resolve(directory) + path.sep)) throw new Error("Invalid part export.");
    const partBytes = await readFile(partSource);
    const sha256 = createHash("sha256").update(partBytes).digest("hex");
    if (part.sha256 && sha256 !== part.sha256) throw new Error(`Part checksum mismatch: ${part.name}`);
    const partFilename = `${entry.id}.${part.name}.r${entry.revision}.png`;
    await copyFile(partSource, path.join(output, partFilename));
    parts.push({ ...part, file: `/assets/${partFilename}`, bytes: partBytes.length, sha256 });
  }
  manifest.assets = manifest.assets.filter((asset) => asset.id !== entry.id);
  manifest.assets.push({
    ...entry,
    file: `/assets/${filename}`,
    bytes: bytes.length,
    parts,
    sourceDirectory: directory,
    status: directory.includes("/A2/")
      ? "integrated-pending-A2-visual-gate"
      : directory.includes("/A1/")
        ? "integrated-pending-A1-visual-gate"
        : "integrated-pending-M1-visual-gate",
  });
}
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(
  path.join(output, "manifest.json"),
  `${JSON.stringify({ version: manifest.version, assets: manifest.assets }, null, 2)}\n`,
);
console.log("Integrated", manifest.assets.length, "runtime assets");
