import { useState } from "react";
import { stageIds, type StageId } from "../../domain";
import { BuildingPortrait } from "../hud/Portrait";
import { type Campaign, ages, buildingFor, civs, makeRoster, must, rankFor, unitFor } from "../realm";
import { Window } from "./Window";

const roster = makeRoster();
const gates: Partial<Record<StageId, string>> = {
  grill: "Your decree",
  specification: "Seal the charter",
  plan: "Approve the plan",
  approval: "Approve & raise PR",
};
// Column / row layout of the tree: each age is a column, stages stack inside it.
const COL_W = 250;
const ROW_H = 118;
const pos = (stage: StageId) => {
  const ageIndex = ages.findIndex((a) => a.stages.includes(stage));
  const row = must(ages[ageIndex]).stages.indexOf(stage);
  return { x: 40 + ageIndex * COL_W, y: 70 + row * ROW_H };
};

export function TechTree({
  campaign,
  onClose,
  onReplay,
}: {
  campaign: Campaign | null;
  onClose: () => void;
  onReplay: () => void;
}) {
  const [focus, setFocus] = useState<StageId>(campaign?.stage ?? "implement");
  const meta = buildingFor(focus);
  const policy =
    focus !== "approval"
      ? roster.settings.stagePolicies[focus as keyof typeof roster.settings.stagePolicies]
      : null;
  const unit = policy ? unitFor(policy.model) : null;
  const width = 40 + ages.length * COL_W;
  const height = 70 + 3 * ROW_H + 40;
  const edge = (a: StageId, b: StageId) => {
    const p = pos(a);
    const q = pos(b);
    const x1 = p.x + 190;
    const y1 = p.y + 34;
    const x2 = q.x;
    const y2 = q.y + 34;
    return `M${x1},${y1} C${x1 + 30},${y1} ${x2 - 30},${y2} ${x2},${y2}`;
  };
  const sameColumn = (a: StageId, b: StageId) => pos(a).x === pos(b).x;
  const reached = (stage: StageId) =>
    campaign && (campaign.completed.includes(stage) || campaign.stage === stage);

  return (
    <Window
      wide
      onClose={onClose}
      kicker="The whole campaign, from arrival to delivery"
      title="Tech Tree of the Realm"
      footer={
        <>
          <span className="ae-muted">
            Every campaign follows this road. The replay marches a sample campaign along it.
          </span>
          <button type="button" className="ae-btn is-gold" onClick={onReplay}>
            Watch a campaign march
          </button>
        </>
      }
    >
      <div className="ae-tree-wrap">
        <div className="ae-tree" style={{ width, height }}>
          <svg width={width} height={height} className="ae-tree-svg" aria-hidden="true">
            <defs>
              <marker
                id="ae-arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M0,0 L10,5 L0,10 z" fill="#8a6a3a" />
              </marker>
              <marker
                id="ae-arrow-red"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M0,0 L10,5 L0,10 z" fill="#b8392b" />
              </marker>
            </defs>
            {stageIds.slice(0, -1).map((stage, i) => {
              const next = must(stageIds[i + 1]);
              const walked = campaign && reached(stage) && reached(next);
              if (sameColumn(stage, next)) {
                const p = pos(stage);
                return (
                  <path
                    key={stage}
                    d={`M${p.x + 95},${p.y + 68} L${p.x + 95},${p.y + ROW_H}`}
                    stroke={walked ? "#d9a21b" : "#8a6a3a"}
                    strokeWidth={walked ? 4 : 2.5}
                    fill="none"
                    markerEnd="url(#ae-arrow)"
                  />
                );
              }
              return (
                <path
                  key={stage}
                  d={edge(stage, next)}
                  stroke={walked ? "#d9a21b" : "#8a6a3a"}
                  strokeWidth={walked ? 4 : 2.5}
                  fill="none"
                  markerEnd="url(#ae-arrow)"
                />
              );
            })}
            {(["dev-review", "test"] as StageId[]).map((from) => {
              const p = pos(from);
              const q = pos("implement");
              return (
                <path
                  key={from}
                  d={`M${p.x},${p.y + 50} C${p.x - 60},${p.y + 60} ${q.x - 50},${q.y + 80} ${q.x},${q.y + 52}`}
                  stroke="#b8392b"
                  strokeWidth={2.5}
                  strokeDasharray="7 5"
                  fill="none"
                  markerEnd="url(#ae-arrow-red)"
                />
              );
            })}
          </svg>
          {ages.map((age, i) => (
            <div key={age.id} className="ae-tree-age" style={{ left: 30 + i * COL_W, width: COL_W - 30 }}>
              <b>{age.numeral}</b> {age.name}
              <small>{age.motto}</small>
            </div>
          ))}
          {stageIds.map((stage) => {
            const p = pos(stage);
            const b = buildingFor(stage);
            const state = campaign
              ? campaign.stage === stage
                ? "current"
                : campaign.completed.includes(stage)
                  ? "done"
                  : "future"
              : "neutral";
            return (
              <button
                type="button"
                key={stage}
                className={`ae-tree-node is-${state}${focus === stage ? " is-focus" : ""}`}
                style={{ left: p.x, top: p.y }}
                onClick={() => setFocus(stage)}
              >
                <span className="ae-tree-num">{stageIds.indexOf(stage) + 1}</span>
                <span>
                  <b>{b.name}</b>
                  <small>{b.stageLabel}</small>
                </span>
                {gates[stage] && (
                  <span className="ae-tree-gate" title={`Gate: ${gates[stage]}`}>
                    ⚜
                  </span>
                )}
              </button>
            );
          })}
          <div className="ae-tree-repair" style={{ left: pos("implement").x + 10, top: pos("test").y + 84 }}>
            Repair road · a failed review or test sends crews back; the new candidate makes later verdicts
            stale
          </div>
        </div>
      </div>
      <div className="ae-tree-detail ae-parchment">
        <BuildingPortrait
          kind={meta.kind}
          civ={civs[0] ?? null}
          banner={campaign ? "#d9a21b" : "#2f63c4"}
          size={150}
        />
        <div>
          <div className="ae-eyebrow">
            Stage {stageIds.indexOf(focus) + 1} · {meta.stageLabel}
            {gates[focus] ? ` · Gate: ${gates[focus]}` : ""}
          </div>
          <h3>{meta.name}</h3>
          <p className="ae-lore">{meta.lore}</p>
          {unit && policy ? (
            <p>
              Default garrison:{" "}
              <b>
                {unit.unit} {rankFor(policy.reasoning).numeral}
              </b>{" "}
              — {unit.modelLabel}, {policy.reasoning} reasoning.
            </p>
          ) : (
            <p>Garrisoned by you: the human seal, then the envoy to GitHub.</p>
          )}
          {campaign && (
            <p className="ae-muted">Gold path: where {campaign.id} has marched, from recorded stages only.</p>
          )}
        </div>
      </div>
    </Window>
  );
}
