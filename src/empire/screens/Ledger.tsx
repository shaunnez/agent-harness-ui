import { useMemo, useState } from "react";
import {
  type Campaign,
  type Kingdom,
  type Posture,
  ageOf,
  buildingFor,
  formatTokens,
  postureStyle,
} from "../realm";
import { Window } from "./Window";

export function Ledger({
  campaigns,
  kingdoms,
  onClose,
  onPick,
}: {
  campaigns: Campaign[];
  kingdoms: Kingdom[];
  onClose: () => void;
  onPick: (id: string) => void;
}) {
  const [kingdom, setKingdom] = useState<string>("all");
  const [posture, setPosture] = useState<Posture | "all">("all");
  const [query, setQuery] = useState("");
  const rows = useMemo(
    () =>
      campaigns.filter(
        (c) =>
          (kingdom === "all" || c.kingdomId === kingdom) &&
          (posture === "all" || c.posture === posture) &&
          (!query || `${c.id} ${c.title}`.toLowerCase().includes(query.toLowerCase())),
      ),
    [campaigns, kingdom, posture, query],
  );
  return (
    <Window wide onClose={onClose} kicker="Every campaign across every kingdom" title="The Ledger">
      <div className="ae-ledger-filters">
        <input
          className="ae-search"
          placeholder="Search campaigns…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select value={kingdom} onChange={(e) => setKingdom(e.target.value)}>
          <option value="all">All kingdoms</option>
          {kingdoms
            .filter((k) => !k.research)
            .map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
        </select>
        <select value={posture} onChange={(e) => setPosture(e.target.value as Posture | "all")}>
          <option value="all">Every posture</option>
          {Object.entries(postureStyle).map(([id, s]) => (
            <option key={id} value={id}>
              {s.label}
            </option>
          ))}
        </select>
        <span className="ae-muted">{rows.length} shown</span>
      </div>
      <table className="ae-ledger">
        <thead>
          <tr>
            <th>Campaign</th>
            <th>Kingdom</th>
            <th>Age</th>
            <th>Front</th>
            <th>Posture</th>
            <th className="num">Tokens</th>
            <th className="num">Runs</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const k = kingdoms.find((item) => item.id === c.kingdomId);
            const style = postureStyle[c.posture];
            return (
              <tr
                key={c.id}
                onClick={() => onPick(c.id)}
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && onPick(c.id)}
              >
                <td>
                  <b>{c.id}</b> {c.title}
                </td>
                <td>
                  <i className="ae-dot" style={{ background: k?.banner }} /> {k?.name}
                </td>
                <td>{ageOf(c.stage).name}</td>
                <td>{buildingFor(c.stage).name}</td>
                <td style={{ color: style.color }}>
                  {style.glyph} {c.attentionLabel}
                </td>
                <td className="num">{formatTokens(c.tokens.total)}</td>
                <td className="num">{c.runs}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Window>
  );
}
