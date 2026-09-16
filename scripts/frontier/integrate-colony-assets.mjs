import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { validateColonyGlb } from "./validate-colony-assets.mjs";

const optionalJson = async (file) => {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
};
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
/** Contract 2.0 texture stems -> manifest keys. */
const TEXTURES = {
  "gravel-albedo.jpg": "gravel",
  "limestone-albedo.jpg": "limestone",
  "cliff-albedo.jpg": "cliff",
  "cliff-normal.jpg": "cliffNormal",
  "basalt-albedo.jpg": "basalt",
};
/**
 * Publish the colony set: Contract 2.0 plus its terrain textures from `colony-v2`, and the shell,
 * crowns, bridge parts and scatter kit from the producer directories. Land is a runtime height field,
 * so no parcel GLBs are published. Every GLB is validated against its producer receipt first.
 */
export async function integrateColonyAssets(root, asset) {
  const staging = path.join(root, "design/mission-frontier/assets/staging");
  const v2 = path.join(staging, "colony-v2");
  const v1 = path.join(staging, "colony-hq-v1");
  const contract = JSON.parse(await readFile(path.join(v2, "contract.json"), "utf8"));
  // The Contract 2.0 producer set (lobed shell, re-fitted crowns) replaces the 1.0.1 set once it exists.
  const producer2 = await optionalJson(path.join(v2, "producer/hq-metadata.json"));
  const producerDir = producer2 ? path.join(v2, "producer") : path.join(v1, "producer");
  const producer = producer2 ?? (await optionalJson(path.join(v1, "producer/hq-metadata.json")));
  // Producer receipts may still be bound to 1.0.1 while the v2 shell is authored; either hash is accepted.
  const accepted = new Set([
    sha256(await readFile(path.join(v2, "contract.json"))),
    sha256(await readFile(path.join(v1, "contract.json"))),
  ]);
  if (producer?.contractSha256 && !accepted.has(producer.contractSha256))
    throw new Error("Colony producer contract hash is stale.");
  const colony = { contract: await asset(path.join(v2, "contract.json"), "colony-contract"), crowns: {} };
  const bridgeReceipts = producer2
    ? await optionalJson(path.join(v1, "producer/hq-metadata.json"))
    : producer;
  for (let [dir, file, key, kind] of [
    ["producer", "hq-shell.glb", "shell", "shell"],
    ["producer", "crown-bastion.glb", "bastion", "crown"],
    ["producer", "crown-command.glb", "command", "crown"],
    ["producer", "crown-relay.glb", "relay", "crown"],
    ["producer", "crown-foundry.glb", "foundry", "crown"],
    ["producer", "bridge-span-27.glb", "bridgeSpan", "span"],
    ["producer", "bridge-end.glb", "bridgeEnd", "end"],
    ["terrain", "scatter-kit.glb", "scatterKit", "scatter"],
  ]) {
    // The environment-pass kit in colony-v2/producer replaces the 2A kit once it exists.
    const kit2 =
      kind === "scatter" ? await optionalJson(path.join(v2, "producer/scatter-metadata.json")) : null;
    if (kit2) kind = "scatter2";
    const filePath = kit2
      ? path.join(v2, "producer", file)
      : dir === "producer" && !file.startsWith("bridge-")
        ? path.join(producerDir, file)
        : path.join(v1, dir, file);
    let bytes;
    try {
      bytes = await readFile(filePath);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    const stem = file.replace(/\.glb$/, "");
    const fromV1 = file.startsWith("bridge-") && producer2;
    const entry =
      file === "scatter-kit.glb"
        ? (kit2 ?? (await optionalJson(path.join(v1, "terrain/scatter-metadata.json"))))
        : (fromV1 ? bridgeReceipts : producer)?.assets?.[stem];
    const expectedSha256 = entry?.glb?.sha256 ?? entry?.sha256;
    if (!expectedSha256) throw new Error(`${file}: missing producer hash receipt`);
    // Crown envelopes: 2.0 crowns sit inside the drum, well within the retained hex eaves numbers.
    const envelopeContract = producer2
      ? contract
      : JSON.parse(await readFile(path.join(v1, "contract.json"), "utf8"));
    validateColonyGlb(bytes, { kind, contract: envelopeContract, expectedSha256 });
    const url = await asset(filePath, file.replace(/\.glb$/, ""));
    if (kind === "crown") colony.crowns[key] = url;
    else colony[key] = url;
  }
  // Picker thumbnails: each crown rendered on the shared shell by the producer.
  for (const variant of Object.keys(colony.crowns)) {
    const preview = path.join(producerDir, "previews", `crown-${variant}.png`);
    try {
      await readFile(preview);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    colony.crownPreviews ??= {};
    colony.crownPreviews[variant] = await asset(preview, `crown-preview-${variant}`);
  }
  // Terrain textures: extracted Poly Haven sets with their own receipt.
  const textures = await optionalJson(path.join(v2, "terrain-textures/textures.json"));
  if (textures) {
    colony.terrainTextures = {};
    for (const [file, key] of Object.entries(TEXTURES)) {
      const receipt = textures.files?.[file];
      if (!receipt) continue;
      const filePath = path.join(v2, "terrain-textures", file);
      const bytes = await readFile(filePath);
      if (sha256(bytes) !== receipt.sha256)
        throw new Error(`${file}: texture bytes do not match the receipt`);
      colony.terrainTextures[key] = await asset(filePath, `terrain-${file.replace(/\.jpg$/, "")}`);
    }
  }
  colony.hqLightPositions =
    producer?.lightPositions ?? producer?.lights?.map((light) => light.position ?? light) ?? [];
  colony.obstacles = producer?.obstacles ?? [];
  return { colony, shoreline: undefined };
}
