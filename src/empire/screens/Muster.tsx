import { useMemo, useState } from "react";
import type { RolePolicyId } from "../../domain";
import { UnitPortrait } from "../hud/Portrait";
import {
  type Doctrine,
  buildingFor,
  doctrines,
  makeRoster,
  must,
  rankFor,
  ranks,
  unitFor,
  unitTypes,
  unitKindFor,
} from "../realm";
import { Corps } from "./muster/Corps";
import { Orders } from "./muster/Orders";
import { Window } from "./Window";

const roster = makeRoster();
type Army = Record<RolePolicyId, { model: string; reasoning: string }>;

export function Muster({ onClose, notify }: { onClose: () => void; notify: (m: string) => void }) {
  const [doctrine, setDoctrine] = useState<Doctrine>("standard");
  const [armies, setArmies] = useState<Record<Doctrine, Army>>(
    () => structuredClone(roster.profiles) as unknown as Record<Doctrine, Army>,
  );
  const [tab, setTab] = useState<"armies" | "corps" | "orders">("armies");
  const [selectedRole, setSelectedRole] = useState<RolePolicyId>("implement");
  const army = armies[doctrine];
  const deliveryUnits = unitTypes.filter((u) => u.provider !== "research");
  const catalog = roster.catalog.models;
  const levelsFor = (model: string) =>
    catalog.find((m) => m.id === model)?.reasoningLevels ?? ["low", "medium", "high", "xhigh", "max"];
  const set = (role: RolePolicyId, patch: Partial<{ model: string; reasoning: string }>) =>
    setArmies((all) => {
      const next = structuredClone(all);
      const current = next[doctrine][role];
      next[doctrine][role] = { ...current, ...patch };
      const levels = levelsFor(next[doctrine][role].model);
      if (!levels.includes(next[doctrine][role].reasoning)) next[doctrine][role].reasoning = "high";
      return next;
    });
  const composition = useMemo(() => {
    const counts = new Map<string, number>();
    for (const role of roster.roles) {
      const u = unitFor(army[role.id]?.model).unit;
      counts.set(u, (counts.get(u) ?? 0) + 1);
    }
    return [...counts.entries()];
  }, [army]);
  const role = must(roster.roles.find((r) => r.id === selectedRole) ?? roster.roles[0]);
  const current = army[role.id];
  const currentUnit = unitFor(current?.model);

  return (
    <Window
      wide
      onClose={onClose}
      kicker="Barracks · agents, models and reasoning"
      title="Muster the Armies"
      footer={
        <>
          <span className="ae-muted">
            Units are models; ranks are reasoning effort. Each new campaign snapshots its army when it
            marches.
          </span>
          <div className="ae-foot-actions">
            <button
              type="button"
              className="ae-btn"
              onClick={() => setArmies(structuredClone(roster.profiles) as unknown as Record<Doctrine, Army>)}
            >
              Reset
            </button>
            <button
              type="button"
              className="ae-btn is-gold"
              onClick={() => notify("Armies mustered — prototype only: Settings were not changed.")}
            >
              Muster
            </button>
          </div>
        </>
      }
    >
      <div className="ae-tabs" role="tablist" aria-label="Barracks sections">
        {(
          [
            ["armies", "Armies", "Stage agents by doctrine"],
            ["corps", "Special corps", "Design and research"],
            ["orders", "Standing orders", "Council and repair crews"],
          ] as const
        ).map(([id, label, sub]) => (
          <button
            type="button"
            role="tab"
            aria-selected={tab === id}
            key={id}
            className={tab === id ? "is-active" : ""}
            onClick={() => setTab(id)}
          >
            <b>{label}</b>
            <span>{sub}</span>
          </button>
        ))}
      </div>
      {tab === "corps" && <Corps />}
      {tab === "orders" && <Orders />}
      {tab === "armies" && (
        <>
          <div className="ae-doctrines" role="tablist" aria-label="Doctrine (workflow profile)">
            {doctrines.map((d) => (
              <button
                type="button"
                role="tab"
                aria-selected={d.id === doctrine}
                key={d.id}
                className={d.id === doctrine ? "is-active" : ""}
                onClick={() => setDoctrine(d.id)}
              >
                <b>{d.name}</b>
                <span>
                  {d.profile} profile · {d.blurb}
                </span>
              </button>
            ))}
          </div>

          <div className="ae-muster">
            <div className="ae-muster-grid">
              {roster.roles.map((r) => {
                const policy = army[r.id];
                const unit = unitFor(policy?.model);
                const rank = rankFor(policy?.reasoning);
                const place = r.id === "repair" ? "Repair Crews" : buildingFor(r.id as never).name;
                return (
                  <button
                    type="button"
                    key={r.id}
                    className={`ae-unit-card${r.id === selectedRole ? " is-selected" : ""}`}
                    onClick={() => setSelectedRole(r.id)}
                  >
                    <UnitPortrait
                      kind={unitKindFor(policy?.model ?? "")}
                      team={unit.provider === "claude" ? "#c9793a" : "#2f63c4"}
                      size={58}
                    />
                    <span className="ae-unit-card-text">
                      <small>{place}</small>
                      <b>{r.label}</b>
                      <span>
                        {unit.unit} <em className="ae-rank">{rank.numeral}</em>
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="ae-muster-detail ae-parchment">
              <div className="ae-eyebrow">
                {role.id === "repair" ? "Repair Crews" : buildingFor(role.id as never).name} · skill{" "}
                <code>{role.skill}</code>
              </div>
              <div className="ae-muster-hero">
                <UnitPortrait
                  kind={unitKindFor(current?.model ?? "")}
                  team={currentUnit.provider === "claude" ? "#c9793a" : "#2f63c4"}
                  size={120}
                />
                <div>
                  <h3>
                    {currentUnit.unit} {rankFor(current?.reasoning).numeral}{" "}
                    <small>{rankFor(current?.reasoning).title}</small>
                  </h3>
                  <p className="ae-muted">
                    {currentUnit.army} · {currentUnit.modelLabel} · {current?.reasoning}
                  </p>
                  <p className="ae-lore">{currentUnit.role}</p>
                </div>
              </div>
              <div className="ae-field-label">Unit (model)</div>
              <div className="ae-unit-choices">
                {deliveryUnits.map((u) => (
                  <button
                    type="button"
                    key={u.id}
                    className={u.model === current?.model ? "is-active" : ""}
                    onClick={() => set(role.id, { model: u.model })}
                  >
                    <UnitPortrait
                      kind={unitKindFor(u.model)}
                      team={u.provider === "claude" ? "#c9793a" : "#2f63c4"}
                      size={44}
                    />
                    <span>
                      <b>{u.unit}</b>
                      <small>
                        {u.army} · {u.modelLabel}
                      </small>
                    </span>
                  </button>
                ))}
              </div>
              <div className="ae-field-label">Rank (reasoning effort)</div>
              <div className="ae-ranks">
                {ranks
                  .filter((rk) => levelsFor(current?.model ?? "").includes(rk.id))
                  .map((rk) => (
                    <button
                      type="button"
                      key={rk.id}
                      className={rk.id === current?.reasoning ? "is-active" : ""}
                      onClick={() => set(role.id, { reasoning: rk.id })}
                      title={rk.id}
                    >
                      <span className="ae-chevrons">{rk.numeral}</span>
                      <small>{rk.title}</small>
                      <em>{rk.id}</em>
                    </button>
                  ))}
              </div>
            </div>

            <aside className="ae-muster-side">
              <section className="ae-parchment">
                <div className="ae-eyebrow">
                  Army composition · {doctrines.find((d) => d.id === doctrine)?.name}
                </div>
                {composition.map(([name, count]) => (
                  <div key={name} className="ae-comp-row">
                    <span>{name}</span>
                    <b>× {count}</b>
                  </div>
                ))}
              </section>
            </aside>
          </div>
        </>
      )}
    </Window>
  );
}
