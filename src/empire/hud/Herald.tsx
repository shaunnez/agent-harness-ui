import { useEffect, useMemo, useState } from "react";
import { type Campaign, type Kingdom, buildingFor } from "../realm";

interface Line {
  id: string;
  campaignId: string;
  text: string;
  tone: string;
}

/** The herald: AoE-style chat lines, built only from recorded events and attention. */
export function Herald({
  campaigns,
  kingdoms,
  onPick,
}: {
  campaigns: Campaign[];
  kingdoms: Kingdom[];
  onPick: (id: string) => void;
}) {
  const lines = useMemo<Line[]>(() => {
    const out: Line[] = [];
    for (const c of campaigns) {
      const kingdom = kingdoms.find((k) => k.id === c.kingdomId)?.name ?? "";
      const place = buildingFor(c.stage).name;
      for (const event of c.task.events ?? [])
        out.push({
          id: `${c.id}-${event.id}`,
          campaignId: c.id,
          text: `${kingdom} · ${c.id}: ${event.title}`,
          tone: "info",
        });
      if (c.posture === "needs-you")
        out.push({
          id: `${c.id}-n`,
          campaignId: c.id,
          text: `The ${place} of ${kingdom} awaits your decree (${c.id}).`,
          tone: "gold",
        });
      if (c.posture === "blocked")
        out.push({
          id: `${c.id}-b`,
          campaignId: c.id,
          text: `${c.id} is under siege at the ${place}: ${c.reason ?? "repair required"}`,
          tone: "red",
        });
      if (c.posture === "failed")
        out.push({
          id: `${c.id}-f`,
          campaignId: c.id,
          text: `${c.id} fell at the ${place}. ${(c.reason ?? "").split("\n")[0]}`,
          tone: "red",
        });
      if (c.posture === "external")
        out.push({
          id: `${c.id}-e`,
          campaignId: c.id,
          text: `An envoy of ${kingdom} sails to the GitHub Capital with ${c.id}.`,
          tone: "blue",
        });
    }
    return out;
  }, [campaigns, kingdoms]);
  const [shown, setShown] = useState(3);
  useEffect(() => {
    if (shown >= lines.length) return;
    const timer = window.setTimeout(() => setShown((n) => n + 1), 2600);
    return () => window.clearTimeout(timer);
  }, [shown, lines.length]);
  const visible = lines.slice(Math.max(0, shown - 5), shown);
  return (
    <div className="ae-herald" aria-live="polite">
      {visible.map((line) => (
        <button
          type="button"
          key={line.id}
          className={`ae-herald-line ae-herald--${line.tone}`}
          onClick={() => onPick(line.campaignId)}
        >
          {line.text}
        </button>
      ))}
    </div>
  );
}
