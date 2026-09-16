import { Group, type Object3D } from "three";
import { baseVariants } from "./appearance.ts";
import {
  greyboxBridge,
  greyboxBridgeEnd,
  greyboxCrown,
  greyboxParcel,
  greyboxShell,
} from "./colony-greybox.ts";
import type { ProofManifest } from "./model.ts";

/** Only assets used by this renderer are requested; all projects share the same GLTF source. */
export function proofAssetUrls(manifest: ProofManifest) {
  if (manifest.version !== 3)
    return [
      manifest.scene,
      manifest.worker,
      ...baseVariants.map((id) => manifest.bases?.[id].src ?? manifest.scene),
    ];
  const colony = manifest.colony;
  return [
    ...new Set(
      [
        manifest.worker,
        colony?.shell,
        colony?.parcelA,
        colony?.parcelHub,
        colony?.bridgeSpan,
        colony?.bridgeEnd,
        ...Object.values(colony?.crowns ?? {}),
      ].filter((value): value is string => Boolean(value)),
    ),
  ];
}
export function colonyModels(manifest: ProofManifest, loaded: Map<string, Object3D>) {
  const owned: Group[] = [];
  const get = (url: string | undefined, fallback: () => Group) => {
    const model = url ? loaded.get(url) : undefined;
    if (model) return model;
    const greybox = fallback();
    owned.push(greybox);
    return greybox;
  };
  const colony = manifest.colony;
  const shell = get(colony?.shell, greyboxShell);
  const bases = Object.fromEntries(
    baseVariants.map((variant) => {
      const crown = get(colony?.crowns?.[variant] ?? colony?.crowns?.command, () => greyboxCrown(variant));
      const group = new Group();
      group.add(shell.clone(true));
      group.add(crown.clone(true));
      return [variant, group];
    }),
  );
  return {
    bases,
    owned,
    parcel: get(colony?.parcelA, () => greyboxParcel()),
    hub: get(colony?.parcelHub, () => greyboxParcel(true)),
    span: get(colony?.bridgeSpan, greyboxBridge),
    end: get(colony?.bridgeEnd, greyboxBridgeEnd),
  };
}
