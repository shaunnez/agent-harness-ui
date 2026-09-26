import { useState } from "react";
import { stageIds } from "../../domain";
import { BuildingPortrait } from "../hud/Portrait";
import type { Placed } from "../map/world";
import {
  type Campaign,
  type Kingdom,
  ageOf,
  buildingFor,
  civs,
  makeRoster,
  postureStyle,
  rankFor,
  researchQuestions,
  unitFor,
} from "../realm";
import { GreatWorkshop } from "./interior/Workshop";
import { Keep, Monastery, ProvingGrounds, RoyalHarbour } from "./interior/Judgement";
import { ScoutStables, Scriptorium, WarRoom, WatchTower } from "./interior/Survey";
import { Council } from "./parts";
import { Window } from "./Window";

const roster = makeRoster();

function StageView({ campaign, notify }: { campaign: Campaign; notify: (m: string) => void }) {
  const task = campaign.task;
  const seal = (what: string) => () => notify(`${what} — prototype only: no task was changed.`);
  switch (campaign.stage) {
    case "triage":
      return <WatchTower task={task} />;
    case "scouts":
      return <ScoutStables task={task} />;
    case "grill":
      return <Council task={task} />;
    case "specification":
      return <Scriptorium task={task} onSeal={seal("Charter sealed")} />;
    case "plan":
      return <WarRoom task={task} onSeal={seal("Plan approved")} />;
    case "implement":
      return <GreatWorkshop task={task} />;
    case "dev-review":
      return <Monastery task={task} />;
    case "test":
      return <ProvingGrounds task={task} />;
    case "final-review":
      return <Keep task={task} />;
    case "approval":
      return <RoyalHarbour task={task} onSeal={seal("Approved & PR raised")} />;
  }
}

/** Inside a building: every campaign stationed here, with the stage's own evidence. */
export function Interior({
  building,
  kingdom,
  campaigns,
  initialId,
  onClose,
  notify,
}: {
  building: Placed;
  kingdom: Kingdom;
  campaigns: Campaign[];
  initialId: string | null;
  onClose: () => void;
  notify: (m: string) => void;
}) {
  const here = campaigns.filter((c) => c.kingdomId === kingdom.id && c.stage === building.stage);
  const [id, setId] = useState(initialId ?? here[0]?.id ?? null);
  const selected = here.find((c) => c.id === id) ?? here[0] ?? null;
  const meta = building.stage ? buildingFor(building.stage) : null;
  const civ = civs.find((c) => c.id === kingdom.civ) ?? null;
  const policy =
    building.stage && building.stage !== "approval"
      ? roster.settings.stagePolicies[building.stage as keyof typeof roster.settings.stagePolicies]
      : null;
  const unit = policy ? unitFor(policy.model) : null;
  return (
    <Window
      wide
      onClose={onClose}
      kicker={
        <>
          <i className="ae-dot" style={{ background: kingdom.banner }} /> {kingdom.name}
          {meta
            ? ` · ${ageOf(meta.stage).name} · Stage ${stageIds.indexOf(meta.stage) + 1}`
            : " · Research realm"}
        </>
      }
      title={
        <>
          {building.name}{" "}
          <span className="ae-window-title-sub">{meta?.stageLabel ?? "Research station"}</span>
        </>
      }
    >
      <div className="ae-interior">
        <aside className="ae-interior-side ae-parchment">
          <BuildingPortrait kind={building.kind} civ={civ} banner={kingdom.banner} size={220} />
          {meta && <p className="ae-lore">{meta.lore}</p>}
          {unit && policy && (
            <p>
              Garrison:{" "}
              <b>
                {unit.unit} {rankFor(policy.reasoning).numeral}
              </b>{" "}
              · {unit.modelLabel} · {policy.reasoning}
            </p>
          )}
          {here.length > 0 && (
            <>
              <div className="ae-field-label">Stationed here</div>
              <div className="ae-interior-tabs">
                {here.map((c) => (
                  <button
                    type="button"
                    key={c.id}
                    className={c.id === selected?.id ? "is-active" : ""}
                    onClick={() => setId(c.id)}
                  >
                    <span style={{ color: postureStyle[c.posture].color }}>
                      {postureStyle[c.posture].glyph}
                    </span>
                    <b>{c.id}</b> {c.title}
                  </button>
                ))}
              </div>
            </>
          )}
        </aside>
        <div className="ae-interior-main">
          {selected ? (
            <>
              <section className="ae-parchment ae-interior-head">
                <b>
                  {selected.id} · {selected.title}
                </b>
                <span style={{ color: postureStyle[selected.posture].color }}>
                  {postureStyle[selected.posture].glyph} {selected.attentionLabel}
                </span>
                {selected.reason && (
                  <pre className={`ae-reason${selected.posture === "needs-you" ? " is-question" : ""}`}>
                    {selected.reason}
                  </pre>
                )}
              </section>
              <StageView key={selected.id} campaign={selected} notify={notify} />
            </>
          ) : meta ? (
            <section className="ae-parchment">
              <p className="ae-muted">
                No campaign is stationed here. The building waits for the next campaign to reach it.
              </p>
            </section>
          ) : (
            <section className="ae-parchment">
              <div className="ae-eyebrow">Sample questions in the realm</div>
              {researchQuestions.map((q) => (
                <div key={q.id} className="ae-comp-row">
                  <span>
                    <b>{q.id}</b> {q.question}
                  </span>
                  <b>{q.band ?? q.grade.replace("_", " ")}</b>
                </div>
              ))}
            </section>
          )}
        </div>
      </div>
    </Window>
  );
}
