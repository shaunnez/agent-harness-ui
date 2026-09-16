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
const loopList = (value) => (!value ? undefined : typeof value[0]?.[0] === "number" ? [value] : value);
/** Validate producer bytes against their own receipts before publishing any manifest references. */
export async function integrateColonyAssets(root, asset) {
  const source = path.join(root, "design/mission-frontier/assets/staging/colony-hq-v1");
  const contract = JSON.parse(await readFile(path.join(source, "contract.json"), "utf8"));
  const producer = await optionalJson(path.join(source, "producer/hq-metadata.json"));
  const terrain = await optionalJson(path.join(source, "terrain/parcel-metadata.json"));
  const contractBytes = await readFile(path.join(source, "contract.json"));
  const contractHash = createHash("sha256").update(contractBytes).digest("hex");
  for (const metadata of [producer, terrain]) {
    if (metadata?.contractVersion && metadata.contractVersion !== contract.version)
      throw new Error("Colony producer contract version is stale.");
    if (metadata?.contractSha256 && metadata.contractSha256 !== contractHash)
      throw new Error("Colony producer contract hash is stale.");
  }
  const colony = { contract: await asset(path.join(source, "contract.json"), "colony-contract"), crowns: {} };
  for (const [dir, file, key, kind] of [
    ["producer", "hq-shell.glb", "shell", "shell"],
    ["producer", "crown-bastion.glb", "bastion", "crown"],
    ["producer", "crown-command.glb", "command", "crown"],
    ["producer", "crown-relay.glb", "relay", "crown"],
    ["producer", "crown-foundry.glb", "foundry", "crown"],
    ["producer", "bridge-span-27.glb", "bridgeSpan", "span"],
    ["producer", "bridge-end.glb", "bridgeEnd", "end"],
    ["terrain", "parcel-hub.glb", "parcelHub", "parcel"],
    ["terrain", "parcel-a.glb", "parcelA", "parcel"],
  ]) {
    const filePath = path.join(source, dir, file);
    let bytes;
    try {
      bytes = await readFile(filePath);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    const metadata = dir === "producer" ? producer : terrain;
    const entry = metadata?.assets?.[file.replace(/\.glb$/, "")] ?? metadata?.files?.[file];
    const expectedSha256 = entry?.glb?.sha256 ?? entry?.sha256;
    if (!expectedSha256) throw new Error(`${file}: missing producer hash receipt`);
    validateColonyGlb(bytes, { kind, contract, expectedSha256 });
    const url = await asset(filePath, file.replace(/\.glb$/, ""));
    if (kind === "crown") colony.crowns[key] = url;
    else colony[key] = url;
  }
  // Picker thumbnails: each crown rendered on the shared shell by the producer.
  for (const variant of Object.keys(colony.crowns)) {
    const preview = path.join(source, "producer/previews", `crown-${variant}.png`);
    try {
      await readFile(preview);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    colony.crownPreviews ??= {};
    colony.crownPreviews[variant] = await asset(preview, `crown-preview-${variant}`);
  }
  const a = terrain?.files?.["parcel-a.glb"];
  const hub = terrain?.files?.["parcel-hub.glb"];
  colony.hqLightPositions =
    producer?.lightPositions ?? producer?.lights?.map((light) => light.position ?? light) ?? [];
  colony.obstacles = producer?.obstacles ?? [];
  colony.parcelLightPositions = a?.lightPositions ?? [];
  colony.hubShorelineXZ = loopList(hub?.shorelineXZ);
  const shoreline = loopList(a?.shorelineXZ) ?? [
    Array.from({ length: 73 }, (_, i) => [
      43 * Math.cos((i * Math.PI) / 36),
      43 * Math.sin((i * Math.PI) / 36),
    ]),
  ];
  colony.hubShorelineXZ ??= shoreline;
  return { colony, shoreline };
}
