import { useState } from "react";
import { UnitPortrait } from "../hud/Portrait";
import {
  type Doctrine,
  type Kingdom,
  buildingFor,
  doctrines,
  makeRoster,
  rankFor,
  unitFor,
  unitKindFor,
} from "../realm";
import { Window } from "./Window";

const roster = makeRoster();

export function Train({
  kingdoms,
  onClose,
  notify,
  onMuster,
}: {
  kingdoms: Kingdom[];
  onClose: () => void;
  notify: (m: string) => void;
  onMuster: () => void;
}) {
  const delivery = kingdoms.filter((k) => !k.research);
  const [kingdomId, setKingdomId] = useState(delivery[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [orders, setOrders] = useState("");
  const [doctrine, setDoctrine] = useState<Doctrine | "auto">("auto");
  const [priority, setPriority] = useState("medium");
  const kingdom = kingdoms.find((k) => k.id === kingdomId);
  const army = roster.profiles[doctrine === "auto" ? "standard" : doctrine];
  return (
    <Window
      wide
      onClose={onClose}
      kicker="New task"
      title="Raise a Campaign"
      footer={
        <>
          <span className="ae-muted">
            Raising a campaign records it; it does not march until you order it.
          </span>
          <button
            type="button"
            className="ae-btn is-gold"
            disabled={!title.trim()}
            onClick={() =>
              notify(`“${title}” would be raised in ${kingdom?.name} — prototype only: no task was created.`)
            }
          >
            Raise campaign
          </button>
        </>
      }
    >
      <div className="ae-train">
        <div className="ae-train-form">
          <div className="ae-field-label">Kingdom</div>
          <div className="ae-kingdom-pick">
            {delivery.map((k) => (
              <button
                type="button"
                key={k.id}
                className={k.id === kingdomId ? "is-active" : ""}
                onClick={() => setKingdomId(k.id)}
                style={{ borderColor: k.id === kingdomId ? k.banner : undefined }}
              >
                <i style={{ background: k.banner }} /> {k.name}
              </button>
            ))}
          </div>
          <label className="ae-field">
            <span>Campaign name</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Normalise revision labels"
            />
          </label>
          <label className="ae-field">
            <span>Orders</span>
            <textarea
              rows={5}
              value={orders}
              onChange={(e) => setOrders(e.target.value)}
              placeholder="What must be true when the campaign is won?"
            />
          </label>
          <div className="ae-field-label">Doctrine</div>
          <div className="ae-segment">
            <button
              type="button"
              className={doctrine === "auto" ? "is-active" : ""}
              onClick={() => setDoctrine("auto")}
            >
              Let the Watch Tower judge
            </button>
            {doctrines.map((d) => (
              <button
                type="button"
                key={d.id}
                className={doctrine === d.id ? "is-active" : ""}
                onClick={() => setDoctrine(d.id)}
              >
                {d.name}
              </button>
            ))}
          </div>
          <div className="ae-field-label">Priority</div>
          <div className="ae-segment">
            {["low", "medium", "high"].map((p) => (
              <button
                type="button"
                key={p}
                className={priority === p ? "is-active" : ""}
                onClick={() => setPriority(p)}
              >
                {p[0]?.toUpperCase()}
                {p.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <aside className="ae-parchment ae-train-army">
          <div className="ae-eyebrow">
            The army that will march ·{" "}
            {doctrine === "auto"
              ? "Campaign (until triage decides)"
              : doctrines.find((d) => d.id === doctrine)?.name}
          </div>
          <div className="ae-army-strip">
            {roster.roles.map((r) => {
              const p = army[r.id];
              const u = unitFor(p?.model);
              return (
                <div
                  key={r.id}
                  className="ae-army-slot"
                  title={`${r.label}: ${u.modelLabel} · ${p?.reasoning}`}
                >
                  <UnitPortrait
                    kind={unitKindFor(p?.model ?? "")}
                    team={kingdom?.banner ?? "#999"}
                    size={46}
                  />
                  <small>{r.id === "repair" ? "Repair" : buildingFor(r.id as never).stageLabel}</small>
                  <b>
                    {u.unit} {rankFor(p?.reasoning).numeral}
                  </b>
                </div>
              );
            })}
          </div>
          <button type="button" className="ae-btn" onClick={onMuster}>
            Change the army in the Barracks
          </button>
        </aside>
      </div>
    </Window>
  );
}
