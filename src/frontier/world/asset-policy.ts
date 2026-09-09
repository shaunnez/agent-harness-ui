export type ArtDirection = "classic" | "cinematic";

/** A review preference changes presentation only; it is never sent to the companion. */
export function artDirection(search: string): ArtDirection {
  return new URLSearchParams(search).get("art") === "cinematic" ? "cinematic" : "classic";
}

export function isDetailAsset(asset: { id: string; loadStage?: "initial" | "detail" | "activity" }) {
  return asset.loadStage === "detail" || asset.id.includes(".detail.") || asset.id === "mf.terrain.region";
}

export function isInitialAsset(
  asset: { id: string; loadStage?: "initial" | "detail" | "activity" },
  direction: ArtDirection,
) {
  return (
    !isDetailAsset(asset) &&
    asset.loadStage !== "activity" &&
    !asset.id.endsWith(".portrait") &&
    !(direction === "cinematic" && asset.id === "mf.terrain.water")
  );
}

export function featuredProjectId(projects: ReadonlyArray<{ id: string; createdAt?: string | null }>) {
  return [...projects].sort(
    (a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? "") || a.id.localeCompare(b.id),
  )[0]?.id;
}
