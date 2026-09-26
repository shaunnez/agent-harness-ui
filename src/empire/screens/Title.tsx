import { Crown, Diamond, Scroll, Sword, TreeStructure } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { WindowId } from "../EmpireApp";

const embers = Array.from({ length: 28 }, (_, i) => ({
  id: `ember-${i}`,
  style: {
    left: `${(i * 37) % 100}%`,
    animationDelay: `${(i * 0.61) % 7}s`,
    animationDuration: `${6 + (i % 5)}s`,
  },
}));

export function Title({ onEnter, onOpen }: { onEnter: () => void; onOpen: (id: WindowId) => void }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setReady(true), 300);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div className={`ae-title${ready ? " is-ready" : ""}`}>
      <div className="ae-embers" aria-hidden="true">
        {embers.map((ember) => (
          <i key={ember.id} style={ember.style} />
        ))}
      </div>
      <div className="ae-title-card">
        <div className="ae-title-crest" aria-hidden="true">
          <Crown weight="fill" />
        </div>
        <h1>
          <span className="ae-title-age">Age of</span>
          <span className="ae-title-main">Agents</span>
        </h1>
        <p className="ae-title-sub">The Harness Chronicles</p>
        <p className="ae-title-lore">
          Four kingdoms. Ten buildings. Every task a campaign that must rise from the Dark Age to the Imperial
          Age before its envoy may sail for the Capital.
        </p>
        <nav className="ae-title-menu">
          <button type="button" className="is-primary" onClick={onEnter}>
            <Crown weight="fill" /> Enter the realm
          </button>
          <button type="button" onClick={() => onOpen("muster")}>
            <Sword /> Muster armies
          </button>
          <button type="button" onClick={() => onOpen("techtree")}>
            <TreeStructure /> Tech tree
          </button>
          <button type="button" onClick={() => onOpen("found")}>
            <Diamond /> Found a kingdom
          </button>
          <button type="button" onClick={() => onOpen("train")}>
            <Scroll /> New campaign
          </button>
        </nav>
        <p className="ae-title-note">
          A look-and-feel prototype over Frontier's recorded sample data. Nothing here reaches a live runtime.
        </p>
      </div>
    </div>
  );
}
