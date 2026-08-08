import { MapTrifold, Table } from "@phosphor-icons/react";

export type AtlasView = "map" | "table";

export function AtlasViewSwitch({
  view,
  onChange,
}: {
  view: AtlasView;
  onChange: (view: AtlasView) => void;
}) {
  return (
    <fieldset className="atlas-view-switch">
      <legend className="sr-only">Task view</legend>
      <button type="button" aria-pressed={view === "table"} onClick={() => onChange("table")}>
        <Table size={16} /> Table
      </button>
      <button type="button" aria-pressed={view === "map"} onClick={() => onChange("map")}>
        <MapTrifold size={16} /> Map
      </button>
    </fieldset>
  );
}
