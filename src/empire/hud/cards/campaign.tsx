// The selected campaign (or the replay's sample campaign) in the bottom panel.
import {
  Anchor,
  ArrowCounterClockwise,
  Door,
  Eye,
  FilmSlate,
  FlagBanner,
  Gavel,
  Pause,
  Play,
  Scroll,
  SealCheck,
  TreeStructure,
  Wrench,
  X,
} from "@phosphor-icons/react";
import { stageIds } from "../../../domain";
import {
  ageOf,
  buildingFor,
  formatTokens,
  makeRoster,
  postureStyle,
  rankFor,
  unitFor,
  unitKindFor,
} from "../../realm";
import { replayCampaign } from "../../replay/script";
import { UnitPortrait } from "../Portrait";
import { type Card, type CardInput, type Command, prototypeNotice } from "./types";

const roster = makeRoster();

export function campaignCard({
  selection,
  kingdoms,
  campaigns,
  sceneRef,
  actions,
  watchId,
}: CardInput): Card | null {
  if (selection?.kind !== "campaign") return null;
  const c = campaigns.find((item) => item.id === selection.id);
  const kingdom = kingdoms.find((k) => k.id === c?.kingdomId);
  if (!c || !kingdom) return null;
  const building = buildingFor(c.stage);
  const run = [...(c.task.runs ?? [])].reverse().find((r) => r.stage === c.stage);
  const policy = roster.settings.stagePolicies[c.stage as keyof typeof roster.settings.stagePolicies];
  const model = run?.model ?? policy?.model ?? "gpt-6-luna";
  const reasoning = run?.reasoning ?? policy?.reasoning ?? "high";
  const unit = unitFor(model);
  const rank = rankFor(reasoning);
  const style = postureStyle[c.posture];
  const progress = stageIds.indexOf(c.stage) + (c.posture === "done" ? 1 : 0);
  const body = (
    <div className="ae-sel">
      <div className="ae-sel-portrait" style={{ borderColor: kingdom.banner }}>
        <UnitPortrait
          kind={unitKindFor(model)}
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
  const buildingId = sceneRef.current?.stageBuilding(c.kingdomId, c.stage)?.id ?? null;
  const commands: Command[] = [
    { icon: <Scroll />, label: "Chronicle", hotkey: "C", run: () => actions.open("chronicle") },
    {
      icon: <Door />,
      label: `Enter ${building.name.replace(/^(The|Great|Royal) /, "")}`,
      run: () => buildingId && actions.enter(buildingId, c.id),
    },
    {
      icon: <Eye />,
      label: watchId === c.id ? "Stop watching" : "Watch crew",
      run: () => actions.watch(watchId === c.id ? "" : c.id),
    },
    { icon: <TreeStructure />, label: "Tech tree", hotkey: "T", run: () => actions.open("techtree") },
  ];
  if (c.status === "awaiting-grill")
    commands.unshift({
      icon: <Gavel />,
      label: "Answer council",
      tone: "gold",
      run: () => buildingId && actions.enter(buildingId, c.id),
    });
  if (c.status.startsWith("awaiting-") && c.status.endsWith("approval"))
    commands.unshift({
      icon: <SealCheck />,
      label: "Seal charter",
      tone: "gold",
      run: () => prototypeNotice(actions, "Charter sealed"),
    });
  if (c.posture === "blocked")
    commands.unshift({
      icon: <Wrench />,
      label: "Send repair crew",
      tone: "red",
      run: () => prototypeNotice(actions, "Repair crew sent to the Workshop"),
    });
  if (c.posture === "failed")
    commands.unshift({
      icon: <ArrowCounterClockwise />,
      label: "Rally & retry",
      tone: "red",
      run: () => prototypeNotice(actions, "Retry ordered"),
    });
  if (c.posture === "external")
    commands.unshift({
      icon: <Anchor />,
      label: "Track envoy",
      tone: "blue",
      run: () => actions.select({ kind: "capital" }, true),
    });
  if (c.status === "queued")
    commands.unshift({
      icon: <FlagBanner />,
      label: "March!",
      tone: "gold",
      run: () => prototypeNotice(actions, "Campaign dispatched"),
    });
  return { body, commands };
}

/** The replay's sample campaign: labelled as a replay, with playback commands. */
export function replayCard({ selection, kingdoms, replay, actions }: CardInput): Card | null {
  if (selection?.kind !== "replay" || !replay) return null;
  const frame = replay.frame();
  const kingdom = kingdoms.find((k) => k.id === replayCampaign.kingdomId);
  const style = postureStyle[frame.posture];
  const unit = unitFor(frame.model);
  const done = frame.completed.length;
  const place =
    frame.at === "market"
      ? "Grand Market"
      : frame.at === "capital"
        ? "GitHub Capital"
        : buildingFor(frame.at).name;
  const body = (
    <div className="ae-sel">
      <div className="ae-sel-portrait" style={{ borderColor: kingdom?.banner }}>
        <UnitPortrait
          kind={unitKindFor(frame.model)}
          team={kingdom?.banner ?? "#999"}
          working={frame.posture === "working"}
          size={84}
        />
      </div>
      <div className="ae-sel-main">
        <div className="ae-sel-kicker">
          <i style={{ background: kingdom?.banner }} /> {kingdom?.name} · Replay · sample
        </div>
        <h2>
          {replayCampaign.id} <span>{replayCampaign.title}</span>
        </h2>
        <div className="ae-sel-posture" style={{ color: style.color }}>
          {style.glyph} {frame.caption}
        </div>
        <div className="ae-hp">
          <span style={{ width: `${(done / 10) * 100}%` }} />
          <em>
            {place} ({done}/10)
          </em>
        </div>
        <dl className="ae-sel-stats">
          <div>
            <dt>Leader</dt>
            <dd>
              {unit.unit} <small>{unit.modelLabel}</small>
            </dd>
          </div>
          <div>
            <dt>Candidate</dt>
            <dd>{frame.candidate ? `r${frame.candidate}` : "—"}</dd>
          </div>
          <div>
            <dt>Packages</dt>
            <dd>
              {frame.packages.length
                ? frame.packages.map((p) => `${p.id} ${p.status.replaceAll("_", " ")}`).join(" · ")
                : "—"}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
  return {
    body,
    commands: [
      {
        icon: replay.playing ? <Pause /> : <Play />,
        label: replay.playing ? "Pause" : "Play",
        hotkey: "Space",
        tone: "gold",
        run: () => replay.toggle(),
      },
      { icon: <FilmSlate />, label: "Restart", run: () => replay.restart() },
      {
        icon: <Eye />,
        label: replay.follow ? "Free camera" : "Follow",
        run: () => (replay.follow = !replay.follow),
      },
      { icon: <X />, label: "End replay", hotkey: "Esc", run: () => actions.endReplay() },
    ],
  };
}
