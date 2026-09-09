import { artDirection } from "../world/asset-policy";

export function ArtPreview() {
  const params = new URLSearchParams(window.location.search);
  const cinematic = artDirection(window.location.search) === "cinematic";
  if (!cinematic && params.get("qa") !== "1") return null;
  params.set("art", cinematic ? "classic" : "cinematic");
  return (
    <aside className="art-preview" aria-label="Visual preview">
      <span>{cinematic ? "Cinematic island · visual preview" : "Original art · visual preview"}</span>
      <a href={`?${params.toString()}${window.location.hash}`}>
        {cinematic ? "Compare original" : "View cinematic island"}
      </a>
    </aside>
  );
}
