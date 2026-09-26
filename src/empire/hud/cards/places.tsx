// Buildings, kingdoms, the Market, the Capital and the realm overview in the bottom panel.
import {
  Binoculars,
  Books,
  Crown,
  Diamond,
  Door,
  FilmSlate,
  Handshake,
  Scroll,
  Sword,
  TreeStructure,
} from "@phosphor-icons/react";
import { stageIds } from "../../../domain";
import {
  ageOf,
  buildingFor,
  civs,
  makeRoster,
  postureStyle,
  rankFor,
  researchQuestions,
  unitFor,
} from "../../realm";
import { BuildingPortrait } from "../Portrait";
import { type Card, type CardInput, prototypeNotice } from "./types";

const roster = makeRoster();

export function buildingCard({ selection, kingdoms, campaigns, sceneRef, actions }: CardInput): Card | null {
  if (selection?.kind !== "building") return null;
  const placed = sceneRef.current?.world.buildings.find((b) => b.id === selection.id);
  const kingdom = kingdoms.find((k) => k.id === placed?.kingdomId);
  const civ = civs.find((c) => c.id === kingdom?.civ) ?? null;
  if (!placed || !kingdom) return null;
  const stage = placed.stage;
  const meta = stage ? buildingFor(stage) : null;
  const here = campaigns.filter((c) => c.kingdomId === kingdom.id && c.stage === stage);
  const policy =
    stage && stage !== "approval"
      ? roster.settings.stagePolicies[stage as keyof typeof roster.settings.stagePolicies]
      : null;
  const unit = policy ? unitFor(policy.model) : null;
  const body = (
    <div className="ae-sel">
      <div className="ae-sel-portrait is-building" style={{ borderColor: kingdom.banner }}>
        <BuildingPortrait kind={placed.kind} civ={civ} banner={kingdom.banner} size={96} />
      </div>
      <div className="ae-sel-main">
        <div className="ae-sel-kicker">
          <i style={{ background: kingdom.banner }} /> {kingdom.name}
          {meta
            ? ` · ${ageOf(meta.stage).name} · Stage ${stageIds.indexOf(meta.stage) + 1}`
            : " · Research realm"}
        </div>
        <h2>
          {placed.name} <span>{meta?.stageLabel ?? "Research station"}</span>
        </h2>
        <p className="ae-sel-lore">{meta?.lore ?? researchLore[placed.kind] ?? ""}</p>
        {unit && policy && (
          <div className="ae-sel-garrison">
            Garrison:{" "}
            <b>
              {unit.unit} {rankFor(policy.reasoning).numeral}
            </b>{" "}
            · {unit.modelLabel} · {policy.reasoning}
          </div>
        )}
        <div className="ae-sel-chips">
          {here.length ? (
            here.map((c) => (
              <button
                type="button"
                key={c.id}
                onClick={() => actions.select({ kind: "campaign", id: c.id }, true)}
                style={{ borderColor: postureStyle[c.posture].color }}
              >
                {postureStyle[c.posture].glyph} {c.id}
              </button>
            ))
          ) : (
            <span className="ae-muted">
              {meta
                ? "No campaign stationed here."
                : `${researchQuestions.length} sample questions in the realm.`}
            </span>
          )}
        </div>
      </div>
    </div>
  );
  return {
    body,
    commands: [
      {
        icon: <Door />,
        label: "Enter",
        hotkey: "E",
        tone: "gold",
        run: () => actions.enter(placed.id, here[0]?.id ?? null),
      },
      { icon: <Sword />, label: "Muster garrison", hotkey: "M", run: () => actions.open("muster") },
      { icon: <TreeStructure />, label: "Tech tree", hotkey: "T", run: () => actions.open("techtree") },
    ],
  };
}

export function kingdomCard({ selection, kingdoms, campaigns, actions }: CardInput): Card | null {
  if (selection?.kind !== "kingdom") return null;
  const kingdom = kingdoms.find((k) => k.id === selection.id);
  const civ = civs.find((c) => c.id === kingdom?.civ) ?? null;
  if (!kingdom) return null;
  const mine = campaigns.filter((c) => c.kingdomId === kingdom.id);
  const count = (posture: string) => mine.filter((c) => c.posture === posture).length;
  const body = (
    <div className="ae-sel">
      <div className="ae-sel-portrait is-building" style={{ borderColor: kingdom.banner }}>
        <BuildingPortrait
          kind={kingdom.research ? "observatory" : "towncenter"}
          civ={civ}
          banner={kingdom.banner}
          size={96}
        />
      </div>
      <div className="ae-sel-main">
        <div className="ae-sel-kicker">
          <i style={{ background: kingdom.banner }} /> {civ?.name} · {civ?.base} base
        </div>
        <h2>
          {kingdom.name} <span>{kingdom.research ? "Research realm" : "Delivery kingdom"}</span>
        </h2>
        <p className="ae-sel-lore">
          {kingdom.research
            ? "Behind the palisade: research runs on the API loop only, five runs per question, every citation checked by the host. Sample questions shown."
            : `${kingdom.repository}`}
        </p>
        <div className="ae-sel-counts">
          {kingdom.research ? (
            researchQuestions.map((q) => (
              <span key={q.id} title={q.question}>
                {q.id} · {q.grade.replace("_", " ")}
              </span>
            ))
          ) : (
            <>
              <span>⚒ {count("working")} at work</span>
              <span>! {count("needs-you")} await you</span>
              <span>⚔ {count("blocked") + count("failed")} in trouble</span>
              <span>✦ {count("done")} victories</span>
              <span>{mine.length} campaigns</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
  return {
    body,
    commands: kingdom.research
      ? [
          {
            icon: <Scroll />,
            label: "Ask a question",
            tone: "gold",
            run: () => prototypeNotice(actions, "Question drafted for scoping"),
          },
          { icon: <Diamond />, label: "Heraldry", run: () => actions.open("found") },
        ]
      : [
          {
            icon: <Scroll />,
            label: "New campaign",
            hotkey: "N",
            tone: "gold",
            run: () => actions.open("train"),
          },
          { icon: <Books />, label: "Ledger", hotkey: "L", run: () => actions.open("ledger") },
          { icon: <Diamond />, label: "Heraldry", run: () => actions.open("found") },
        ],
  };
}

export function marketCard({ selection, actions }: CardInput): Card | null {
  if (selection?.kind !== "market") return null;
  const body = (
    <div className="ae-sel">
      <div className="ae-sel-main">
        <div className="ae-sel-kicker">Neutral ground · Linear intake</div>
        <h2>
          Grand Market <span>Where caravans arrive</span>
        </h2>
        <p className="ae-sel-lore">
          Tagged Linear issues arrive as caravans and become campaigns in the mapped kingdom, with their
          source kept. A repeated delivery reuses the same campaign. Creating a campaign does not march it.
          The carts on the trade roads are scenery, not recorded deliveries.
        </p>
      </div>
    </div>
  );
  return {
    body,
    commands: [{ icon: <Handshake />, label: "Diplomacy", run: () => actions.open("diplomacy") }],
  };
}

export function capitalCard({ selection, campaigns, actions }: CardInput): Card | null {
  if (selection?.kind !== "capital") return null;
  const envoys = campaigns.filter((c) => c.posture === "external");
  const body = (
    <div className="ae-sel">
      <div className="ae-sel-main">
        <div className="ae-sel-kicker">Across the sea · delivery</div>
        <h2>
          GitHub Capital{" "}
          <span>
            {envoys.length} envoy{envoys.length === 1 ? "" : "s"} at sea
          </span>
        </h2>
        <p className="ae-sel-lore">
          Approve & raise PR sends an envoy carrying the exact approved candidate. The campaign waits at
          “Awaiting PR merge” until the Capital merges it; a closed or changed PR sends it back blocked.
        </p>
        <div className="ae-sel-chips">
          {envoys.map((c) => (
            <button
              type="button"
              key={c.id}
              onClick={() => actions.select({ kind: "campaign", id: c.id }, true)}
            >
              ⛵ {c.id} · {c.title}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
  return {
    body,
    commands: [{ icon: <Handshake />, label: "Diplomacy", run: () => actions.open("diplomacy") }],
  };
}

export function realmCard({ kingdoms, campaigns, actions }: CardInput): Card {
  const body = (
    <div className="ae-sel">
      <div className="ae-sel-main">
        <div className="ae-sel-kicker">The realm</div>
        <h2>
          {kingdoms.length} kingdoms <span>{campaigns.length} campaigns</span>
        </h2>
        <p className="ae-sel-lore">
          Every project is a kingdom; every task is a campaign that marches through ten buildings and four
          ages. Click a squad, a building or a town centre. Drag or WASD to pan, scroll to zoom, <kbd>.</kbd>{" "}
          for the next decree.
        </p>
        <div className="ae-sel-chips">
          {kingdoms.map((k) => (
            <button
              type="button"
              key={k.id}
              onClick={() => actions.select({ kind: "kingdom", id: k.id }, true)}
              style={{ borderColor: k.banner }}
            >
              <i style={{ background: k.banner }} /> {k.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
  return {
    body,
    commands: [
      {
        icon: <Scroll />,
        label: "New campaign",
        hotkey: "N",
        tone: "gold",
        run: () => actions.open("train"),
      },
      { icon: <FilmSlate />, label: "Replay a march", hotkey: "R", run: () => actions.replay() },
      { icon: <Books />, label: "Ledger", hotkey: "L", run: () => actions.open("ledger") },
      { icon: <Crown />, label: "Muster", hotkey: "M", run: () => actions.open("muster") },
      { icon: <Binoculars />, label: "Market", run: () => actions.select({ kind: "market" }, true) },
    ],
  };
}

const researchLore: Record<string, string> = {
  scope:
    "One tools-less DeepSeek call drafts a strict scope for each question; the operator may edit it before the runs march.",
  lodge: "Explorers ride out through Parallel search and fetch sources for the host to retain.",
  mine: "Scholars mine the PlanCheck rate library for QV rows; every cited row is checked against the rows the run was shown.",
  assay:
    "Every quoted figure is weighed by code: Quote verified, Worked from quote, or Quote doesn't give it.",
  archive: "Retained pages and PDFs, word for word, so every citation can be checked again.",
  "review-hall":
    "Five runs, the three closest scored. A reviewer approves a price pinned to its evidence fingerprint.",
};
