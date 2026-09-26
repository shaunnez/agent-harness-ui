import type { CSSProperties, MutableRefObject } from "react";
import type { RealmActions } from "../EmpireApp";
import type { RealmScene, Selection } from "../map/scene";
import { type Campaign, type Kingdom, postureStyle } from "../realm";
import type { ReplayController } from "../replay/controller";
import { campaignCard, replayCard } from "./cards/campaign";
import { buildingCard, capitalCard, kingdomCard, marketCard, realmCard } from "./cards/places";
import type { CardInput, Command } from "./cards/types";
import { Minimap } from "./Minimap";

/** The bottom HUD: the selected thing's card, its command grid and the minimap. */
export function BottomPanel(input: {
  selection: Selection;
  kingdoms: Kingdom[];
  campaigns: Campaign[];
  sceneRef: MutableRefObject<RealmScene | null>;
  actions: RealmActions;
  replay: ReplayController | null;
  watchId: string | null;
}) {
  const card: CardInput = input;
  const { body, commands } =
    campaignCard(card) ??
    replayCard(card) ??
    buildingCard(card) ??
    kingdomCard(card) ??
    marketCard(card) ??
    capitalCard(card) ??
    realmCard(card);
  // Only real commands, sized to fill the panel: no empty slots.
  const grid = commands.slice(0, 9);
  const cols = grid.length <= 2 ? grid.length : grid.length <= 4 ? 2 : 3;
  return (
    <footer className="ae-bottom">
      <div className="ae-bottom-frame ae-bottom-sel">{body}</div>
      <div
        className="ae-bottom-frame ae-commands"
        role="toolbar"
        aria-label="Commands"
        style={{ "--cols": Math.max(1, cols) } as CSSProperties}
      >
        {grid.map((cmd: Command) => (
          <button
            type="button"
            key={cmd.label}
            className={`ae-cmd ${cmd.tone ? `ae-cmd--${cmd.tone}` : ""}`}
            onClick={cmd.run}
            title={cmd.hotkey ? `${cmd.label} (${cmd.hotkey})` : cmd.label}
          >
            {cmd.icon}
            <span>
              {cmd.label}
              {cmd.hotkey && <kbd>{cmd.hotkey}</kbd>}
            </span>
          </button>
        ))}
      </div>
      <div className="ae-bottom-frame ae-bottom-map">
        <Minimap sceneRef={input.sceneRef} kingdoms={input.kingdoms} campaigns={input.campaigns} />
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
