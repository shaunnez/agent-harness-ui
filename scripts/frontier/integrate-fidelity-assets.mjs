import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve("design/mission-frontier/assets/staging/design-fidelity-v2");
const output = "public/frontier/assets/fidelity";
await mkdir(output, { recursive: true });
const assets = [];
for (const input of process.argv.slice(2)) {
  const document = JSON.parse(await readFile(input, "utf8"));
  const entries = Array.isArray(document) ? document : (document.assets ?? [document]);
  for (const entry of entries) {
    const source = path.resolve(
      entry.file.startsWith("design/") ? entry.file : path.join(path.dirname(input), entry.file),
    );
    if (!source.startsWith(`${root}${path.sep}`)) throw new Error("Export must belong to fidelity staging.");
    const bytes = await readFile(source);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (entry.sha256 !== sha256) throw new Error(`Export checksum mismatch: ${entry.id}`);
    if (!/^[a-z0-9.-]+$/.test(entry.id)) throw new Error("Invalid asset identity.");
    const filename = `${entry.id}.${sha256.slice(0, 12)}.png`;
    await copyFile(source, path.join(output, filename));
    assets.push({
      ...entry,
      file: `/assets/fidelity/${filename}`,
      bytes: bytes.length,
      sha256,
      ...(entry.id.startsWith("mf.fidelity.room.") ? { loadStage: "detail" } : {}),
    });
  }
}
if (!assets.length) throw new Error("Supply measured export metadata.");
await writeFile(path.join(output, "manifest.json"), `${JSON.stringify({ version: 2, assets }, null, 2)}\n`);
console.log(`Integrated ${assets.length} measured fidelity assets.`);
