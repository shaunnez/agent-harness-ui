import type { MutableRefObject, ReactNode } from "react";
import type { RealmActions } from "../../EmpireApp";
import type { RealmScene, Selection } from "../../map/scene";
import type { Campaign, Kingdom } from "../../realm";
import type { ReplayController } from "../../replay/controller";

export interface Command {
  icon: ReactNode;
  label: string;
  hotkey?: string;
  tone?: "gold" | "red" | "blue";
  run: () => void;
}
export interface Card {
  body: ReactNode;
  commands: Command[];
}
export interface CardInput {
  selection: Selection;
  kingdoms: Kingdom[];
  campaigns: Campaign[];
  sceneRef: MutableRefObject<RealmScene | null>;
  actions: RealmActions;
  replay: ReplayController | null;
  watchId: string | null;
}
export const prototypeNotice = (actions: RealmActions, what: string) =>
  actions.notify(`${what} — prototype only: no task was changed.`);
