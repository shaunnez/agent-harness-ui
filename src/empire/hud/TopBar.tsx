import {
  Bread,
  Coins,
  Diamond,
  FilmSlate,
  Gear,
  Handshake,
  ListBullets,
  Moon,
  Mountains,
  Scroll,
  Sun,
  SunHorizon,
  Sword,
  Tree,
  TreeStructure,
  UsersThree,
} from "@phosphor-icons/react";
import type { WindowId } from "../EmpireApp";
import { type LightMode, lightModes, worldClock } from "../map/lighting";
import { type Campaign, ageOf, ages, formatTokens, must } from "../realm";
import { useEffect, useState } from "react";

export function TopBar({
  campaigns,
  selected,
  onOpen,
  onReplay,
  light,
  onLight,
}: {
  campaigns: Campaign[];
  selected: Campaign | null;
  onOpen: (id: WindowId) => void;
  onReplay: () => void;
  light: LightMode;
  onLight: (mode: LightMode) => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 20000);
    return () => window.clearInterval(timer);
  }, []);
  const nextLight = () => {
    const index = lightModes.findIndex((m) => m.id === light);
    onLight(lightModes[(index + 1) % lightModes.length]?.id ?? "auto");
  };
  const LightIcon = light === "night" ? Moon : light === "dusk" ? SunHorizon : Sun;
  const totals = campaigns.reduce(
    (sum, c) => ({
      input: sum.input + c.tokens.input,
      output: sum.output + c.tokens.output,
      cached: sum.cached + c.tokens.cached,
      running: sum.running + c.running,
    }),
    { input: 0, output: 0, cached: 0, running: 0 },
  );
  const cacheRate = totals.input ? Math.round((totals.cached / totals.input) * 100) : 0;
  const open = campaigns.filter((c) => c.posture !== "done");
  const furthest = open.reduce((best, c) => Math.max(best, ages.indexOf(ageOf(c.stage))), 0);
  const age = selected ? ageOf(selected.stage) : must(ages[furthest]);
  const resources = [
    {
      icon: <Bread weight="fill" />,
      label: "Food",
      value: formatTokens(totals.input),
      hint: "Input tokens, all recorded runs",
      tone: "food",
    },
    {
      icon: <Tree weight="fill" />,
      label: "Wood",
      value: formatTokens(totals.output),
      hint: "Output tokens, all recorded runs",
      tone: "wood",
    },
    {
      icon: <Mountains weight="fill" />,
      label: "Stone",
      value: `${formatTokens(totals.cached)} · ${cacheRate}%`,
      hint: "Cached input tokens and cache rate",
      tone: "stone",
    },
    {
      icon: <Coins weight="fill" />,
      label: "Gold",
      value: "—",
      hint: "Approx. cost · API-rate estimate. Unavailable: the sample settings carry no verified rate card.",
      tone: "gold",
    },
    {
      icon: <UsersThree weight="fill" />,
      label: "Pop",
      value: `${totals.running} in the field`,
      hint: "Agent runs recorded as running right now",
      tone: "pop",
    },
  ];
  return (
    <header className="ae-topbar">
      <div className="ae-resources">
        {resources.map((item) => (
          <div key={item.label} className={`ae-res ae-res--${item.tone}`} title={item.hint}>
            <span className="ae-res-icon">{item.icon}</span>
            <span className="ae-res-value">{item.value}</span>
            <span className="ae-res-label">
              {item.label === "Food"
                ? "in"
                : item.label === "Wood"
                  ? "out"
                  : item.label === "Stone"
                    ? "cached"
                    : item.label === "Gold"
                      ? "approx. cost"
                      : "agents"}
            </span>
          </div>
        ))}
      </div>
      <div className="ae-age" title={`${age.name}: ${age.stages.join(", ")}`}>
        <span className="ae-age-numeral">{age.numeral}</span>
        <span className="ae-age-name">{age.name}</span>
        <span className="ae-age-sub">{selected ? `${selected.id} · ${age.motto}` : "Furthest campaign"}</span>
      </div>
      <nav className="ae-topnav" aria-label="Realm menus">
        <button
          type="button"
          className="ae-clock"
          onClick={nextLight}
          title="Time of day, this browser only: Cycle (one real hour per day), Day, Dusk, Night"
        >
          <LightIcon weight="fill" /> <span>{worldClock(light, now)}</span>
          <small>{lightModes.find((m) => m.id === light)?.label}</small>
        </button>
        <button type="button" onClick={onReplay} title="Replay a sample campaign's march (R)">
          <FilmSlate /> <span>Replay</span>
        </button>
        <button type="button" onClick={() => onOpen("ledger")} title="Campaign ledger (L)">
          <ListBullets /> <span>Ledger</span>
        </button>
        <button type="button" onClick={() => onOpen("techtree")} title="Tech tree: the whole pipeline (T)">
          <TreeStructure /> <span>Tech tree</span>
        </button>
        <button
          type="button"
          onClick={() => onOpen("muster")}
          title="Muster armies: agents, models and reasoning (M)"
        >
          <Sword /> <span>Muster</span>
        </button>
        <button
          type="button"
          onClick={() => onOpen("diplomacy")}
          title="Diplomacy: Linear, GitHub and the research boundary"
        >
          <Handshake /> <span>Diplomacy</span>
        </button>
        <button type="button" onClick={() => onOpen("found")} title="Found a kingdom: new project base">
          <Diamond /> <span>Found</span>
        </button>
        <button
          type="button"
          className="ae-topnav-menu"
          onClick={() => onOpen("train")}
          title="Train a campaign: new task (N)"
        >
          <Scroll /> <span>New campaign</span>
        </button>
        <button type="button" className="ae-icon-only" onClick={() => onOpen("muster")} aria-label="Settings">
          <Gear />
        </button>
      </nav>
    </header>
  );
}
