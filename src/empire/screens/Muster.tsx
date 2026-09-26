import { useMemo, useState } from "react";
import type { RolePolicyId } from "../../domain";
import { UnitPortrait } from "../hud/Portrait";
import type { UnitKind } from "../map/paint";
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
} from "../realm";
import { Window } from "./Window";

const roster = makeRoster();
const kindOf = (model: string): UnitKind => {
  const u = unitFor(model).unit;
  return u === "Knight"
    ? "knight"
    : u === "Paladin"
      ? "paladin"
      : u === "Scholar"
        ? "scholar"
        : "man-at-arms";
};
type Army = Record<RolePolicyId, { model: string; reasoning: string }>;

export function Muster({ onClose, notify }: { onClose: () => void; notify: (m: string) => void }) {
  const [doctrine, setDoctrine] = useState<Doctrine>("standard");
  const [armies, setArmies] = useState<Record<Doctrine, Army>>(
    () => structuredClone(roster.profiles) as unknown as Record<Doctrine, Army>,
  );
  const [council, setCouncil] = useState<"manual" | "auto">("manual");
  const [repair, setRepair] = useState<"manual" | "automatic">("manual");
  const [repairAttempts, setRepairAttempts] = useState(2);
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
                  kind={kindOf(policy?.model ?? "")}
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
              kind={kindOf(current?.model ?? "")}
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
                  kind={kindOf(u.model)}
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
          <section className="ae-parchment">
            <div className="ae-eyebrow">The Council (Grill)</div>
            <div className="ae-segment">
              <button
                type="button"
                className={council === "manual" ? "is-active" : ""}
                onClick={() => setCouncil("manual")}
              >
                You decree
              </button>
              <button
                type="button"
                className={council === "auto" ? "is-active" : ""}
                onClick={() => setCouncil("auto")}
              >
                Accept counsel
              </button>
            </div>
            <p className="ae-muted">
              {council === "manual"
                ? "Pause for your answers; you may still accept all remaining counsel at once."
                : "Recommended answers are accepted automatically, with provenance recorded."}
            </p>
          </section>
          <section className="ae-parchment">
            <div className="ae-eyebrow">Repair crews</div>
            <div className="ae-segment">
              <button
                type="button"
                className={repair === "manual" ? "is-active" : ""}
                onClick={() => setRepair("manual")}
              >
                On your order
              </button>
              <button
                type="button"
                className={repair === "automatic" ? "is-active" : ""}
                onClick={() => setRepair("automatic")}
              >
                Automatic
              </button>
            </div>
            <label className="ae-stepper">
              Attempts per candidate
              <input
                type="number"
                min={0}
                max={5}
                value={repairAttempts}
                onChange={(e) => setRepairAttempts(Number(e.target.value))}
              />
            </label>
          </section>
          <section className="ae-parchment">
            <div className="ae-eyebrow">Special corps</div>
            <div className="ae-comp-row">
              <span>Codex design</span>
              <b>Knight III · Sol high</b>
            </div>
            <div className="ae-comp-row">
              <span>Claude design</span>
              <b>Paladin III · Opus 5.5 high</b>
            </div>
            <div
              className="ae-comp-row is-locked"
              title="Research runs only the API loop; no Claude or Codex"
            >
              <span>Starwatch Scholars</span>
              <b>DeepSeek 4.1 Flash · API loop</b>
            </div>
          </section>
        </aside>
      </div>
    </Window>
  );
}
