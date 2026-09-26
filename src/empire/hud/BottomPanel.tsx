import {
  Anchor,
  ArrowCounterClockwise,
  Binoculars,
  Books,
  Crown,
  Diamond,
  Eye,
  FlagBanner,
  Gavel,
  Handshake,
  Scroll,
  SealCheck,
  Sword,
  TreeStructure,
  Wrench,
} from "@phosphor-icons/react";
import type { MutableRefObject, ReactNode } from "react";
import type { WindowId } from "../EmpireApp";
import type { UnitKind } from "../map/paint";
import type { RealmScene, Selection } from "../map/scene";
import {
  type Campaign,
  type Kingdom,
  ageOf,
  buildingFor,
  civs,
  formatTokens,
  makeRoster,
  postureStyle,
  rankFor,
  researchQuestions,
  unitFor,
} from "../realm";
import { stageIds } from "../../domain";
import { Minimap } from "./Minimap";
import { BuildingPortrait, UnitPortrait } from "./Portrait";

const roster = makeRoster();
interface Command {
  icon: ReactNode;
  label: string;
  hotkey?: string;
  tone?: "gold" | "red" | "blue";
  run: () => void;
}
const unitKindOf = (model: string): UnitKind => {
  const unit = unitFor(model).unit;
  return unit === "Knight"
    ? "knight"
    : unit === "Paladin"
      ? "paladin"
      : unit === "Scholar"
        ? "scholar"
        : "man-at-arms";
};

export function BottomPanel({
  selection,
  kingdoms,
  campaigns,
  sceneRef,
  onSelect,
  onOpen,
  notify,
}: {
  selection: Selection;
  kingdoms: Kingdom[];
  campaigns: Campaign[];
  sceneRef: MutableRefObject<RealmScene | null>;
  onSelect: (selection: Selection, focus?: boolean) => void;
  onOpen: (id: WindowId) => void;
  notify: (message: string) => void;
}) {
  const prototype = (what: string) => notify(`${what} — prototype only: no task was changed.`);
  let body: ReactNode = null;
  let commands: Command[] = [];

  if (selection?.kind === "campaign") {
    const c = campaigns.find((item) => item.id === selection.id);
    const kingdom = kingdoms.find((k) => k.id === c?.kingdomId);
    if (c && kingdom) {
      const building = buildingFor(c.stage);
      const run = [...(c.task.runs ?? [])].reverse().find((r) => r.stage === c.stage);
      const policy = roster.settings.stagePolicies[c.stage as keyof typeof roster.settings.stagePolicies];
      const model = run?.model ?? policy?.model ?? "gpt-6-luna";
      const reasoning = run?.reasoning ?? policy?.reasoning ?? "high";
      const unit = unitFor(model);
      const rank = rankFor(reasoning);
      const style = postureStyle[c.posture];
      const progress = stageIds.indexOf(c.stage) + (c.posture === "done" ? 1 : 0);
      body = (
        <div className="ae-sel">
          <div className="ae-sel-portrait" style={{ borderColor: kingdom.banner }}>
            <UnitPortrait
              kind={unitKindOf(model)}
              team={kingdom.banner}
              working={c.posture === "working"}
              size={84}
            />
          </div>
          <div className="ae-sel-main">
            <div className="ae-sel-kicker">
              <i style={{ background: kingdom.banner }} /> {kingdom.name} · {ageOf(c.stage).name}
            </div>
            <h2>
              {c.id} <span>{c.title}</span>
            </h2>
            <div className="ae-sel-posture" style={{ color: style.color }}>
              {style.glyph} {style.label} — {c.attentionLabel}
            </div>
            <div className="ae-hp" title={`${progress} of 10 stages behind it`}>
              <span style={{ width: `${(progress / 10) * 100}%` }} />
              <em>
                {building.name} · {building.stageLabel} ({progress}/10)
              </em>
            </div>
            <dl className="ae-sel-stats">
              <div>
                <dt>Leader</dt>
                <dd>
                  {unit.unit} {rank.numeral}{" "}
                  <small>
                    {unit.modelLabel} · {reasoning}
                  </small>
                </dd>
              </div>
              <div>
                <dt>Tokens</dt>
                <dd>
                  {formatTokens(c.tokens.input)} in · {formatTokens(c.tokens.output)} out
                </dd>
              </div>
              <div>
                <dt>Runs</dt>
                <dd>
                  {c.runs} recorded{c.running ? ` · ${c.running} running` : ""}
                </dd>
              </div>
            </dl>
            {c.reason && <p className="ae-sel-reason">{c.reason.split("\n")[0]}</p>}
          </div>
        </div>
      );
      commands = [
        { icon: <Scroll />, label: "Chronicle", hotkey: "C", run: () => onOpen("chronicle") },
        { icon: <Eye />, label: "Watch crew", hotkey: "F", run: () => onSelect(selection, true) },
        { icon: <TreeStructure />, label: "Tech tree", hotkey: "T", run: () => onOpen("techtree") },
      ];
      if (c.status === "awaiting-grill")
        commands.unshift({
          icon: <Gavel />,
          label: "Answer council",
          tone: "gold",
          run: () => onOpen("chronicle"),
        });
      if (c.status.startsWith("awaiting-") && c.status.endsWith("approval"))
        commands.unshift({
          icon: <SealCheck />,
          label: "Seal charter",
          tone: "gold",
          run: () => prototype("Charter sealed"),
        });
      if (c.posture === "blocked")
        commands.unshift({
          icon: <Wrench />,
          label: "Send repair crew",
          tone: "red",
          run: () => prototype("Repair crew sent to the Workshop"),
        });
      if (c.posture === "failed")
        commands.unshift({
          icon: <ArrowCounterClockwise />,
          label: "Rally & retry",
          tone: "red",
          run: () => prototype("Retry ordered"),
        });
      if (c.posture === "external")
        commands.unshift({
          icon: <Anchor />,
          label: "Track envoy",
          tone: "blue",
          run: () => onSelect({ kind: "capital" }, true),
        });
      if (c.status === "queued")
        commands.unshift({
          icon: <FlagBanner />,
          label: "March!",
          tone: "gold",
          run: () => prototype("Campaign dispatched"),
        });
    }
  } else if (selection?.kind === "building") {
    const scene = sceneRef.current;
    const placed = scene?.world.buildings.find((b) => b.id === selection.id);
    const kingdom = kingdoms.find((k) => k.id === placed?.kingdomId);
    const civ = civs.find((c) => c.id === kingdom?.civ) ?? null;
    if (placed && kingdom) {
      const stage = placed.stage;
      const meta = stage ? buildingFor(stage) : null;
      const here = campaigns.filter((c) => c.kingdomId === kingdom.id && c.stage === stage);
      const policy =
        stage && stage !== "approval"
          ? roster.settings.stagePolicies[stage as keyof typeof roster.settings.stagePolicies]
          : null;
      const unit = policy ? unitFor(policy.model) : null;
      body = (
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
                    onClick={() => onSelect({ kind: "campaign", id: c.id }, true)}
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
      commands = [
        { icon: <Sword />, label: "Muster garrison", hotkey: "M", run: () => onOpen("muster") },
        { icon: <TreeStructure />, label: "Tech tree", hotkey: "T", run: () => onOpen("techtree") },
      ];
    }
  } else if (selection?.kind === "kingdom") {
    const kingdom = kingdoms.find((k) => k.id === selection.id);
    const civ = civs.find((c) => c.id === kingdom?.civ) ?? null;
    if (kingdom) {
      const mine = campaigns.filter((c) => c.kingdomId === kingdom.id);
      const count = (posture: string) => mine.filter((c) => c.posture === posture).length;
      body = (
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
      commands = kingdom.research
        ? [
            {
              icon: <Scroll />,
              label: "Ask a question",
              tone: "gold",
              run: () => prototype("Question drafted for scoping"),
            },
            { icon: <Diamond />, label: "Heraldry", run: () => onOpen("found") },
          ]
        : [
            {
              icon: <Scroll />,
              label: "New campaign",
              hotkey: "N",
              tone: "gold",
              run: () => onOpen("train"),
            },
            { icon: <Books />, label: "Ledger", hotkey: "L", run: () => onOpen("ledger") },
            { icon: <Diamond />, label: "Heraldry", run: () => onOpen("found") },
          ];
    }
  } else if (selection?.kind === "market") {
    body = (
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
    commands = [{ icon: <Handshake />, label: "Diplomacy", run: () => onOpen("diplomacy") }];
  } else if (selection?.kind === "capital") {
    const envoys = campaigns.filter((c) => c.posture === "external");
    body = (
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
              <button type="button" key={c.id} onClick={() => onSelect({ kind: "campaign", id: c.id }, true)}>
                ⛵ {c.id} · {c.title}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
    commands = [{ icon: <Handshake />, label: "Diplomacy", run: () => onOpen("diplomacy") }];
  } else {
    body = (
      <div className="ae-sel">
        <div className="ae-sel-main">
          <div className="ae-sel-kicker">The realm</div>
          <h2>
            {kingdoms.length} kingdoms <span>{campaigns.length} campaigns</span>
          </h2>
          <p className="ae-sel-lore">
            Every project is a kingdom; every task is a campaign that marches through ten buildings and four
            ages. Click a squad, a building or a town centre. Drag or WASD to pan, scroll to zoom,{" "}
            <kbd>.</kbd> for the next decree.
          </p>
          <div className="ae-sel-chips">
            {kingdoms.map((k) => (
              <button
                type="button"
                key={k.id}
                onClick={() => onSelect({ kind: "kingdom", id: k.id }, true)}
                style={{ borderColor: k.banner }}
              >
                <i style={{ background: k.banner }} /> {k.name}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
    commands = [
      { icon: <Scroll />, label: "New campaign", hotkey: "N", tone: "gold", run: () => onOpen("train") },
      { icon: <Books />, label: "Ledger", hotkey: "L", run: () => onOpen("ledger") },
      { icon: <Crown />, label: "Muster", hotkey: "M", run: () => onOpen("muster") },
      { icon: <Binoculars />, label: "Market", run: () => onSelect({ kind: "market" }, true) },
    ];
  }

  const grid: (Command | null)[] = [...commands.slice(0, 10)];
  while (grid.length < 10) grid.push(null);
  return (
    <footer className="ae-bottom">
      <div className="ae-bottom-frame ae-bottom-sel">{body}</div>
      <div className="ae-bottom-frame ae-commands" role="toolbar" aria-label="Commands">
        {grid.map((cmd, i) =>
          cmd ? (
            <button
              type="button"
              key={cmd.label}
              className={`ae-cmd ${cmd.tone ? `ae-cmd--${cmd.tone}` : ""}`}
              onClick={cmd.run}
              title={cmd.hotkey ? `${cmd.label} (${cmd.hotkey})` : cmd.label}
            >
              {cmd.icon}
              <span>{cmd.label}</span>
            </button>
          ) : (
            // biome-ignore lint/suspicious/noArrayIndexKey: empty command slots have no identity
            <span key={`empty-${i}`} className="ae-cmd is-empty" aria-hidden="true" />
          ),
        )}
      </div>
      <div className="ae-bottom-frame ae-bottom-map">
        <Minimap sceneRef={sceneRef} kingdoms={kingdoms} campaigns={campaigns} />
        <div className="ae-legend">
          {(["working", "needs-you", "blocked", "external", "done"] as const).map((p) => (
            <span key={p}>
              <i style={{ background: postureStyle[p].color }} />
              {postureStyle[p].label}
            </span>
          ))}
        </div>
      </div>
    </footer>
  );
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
