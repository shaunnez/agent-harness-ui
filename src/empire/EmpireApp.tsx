import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BottomPanel } from "./hud/BottomPanel";
import { Decrees } from "./hud/Decrees";
import { Herald } from "./hud/Herald";
import { ReplayBar } from "./hud/ReplayBar";
import { TopBar } from "./hud/TopBar";
import { WatchPanel } from "./hud/WatchPanel";
import type { LightMode } from "./map/lighting";
import { MapView } from "./map/MapView";
import type { RealmScene, Selection } from "./map/scene";
import { makeCampaigns, makeKingdoms, must } from "./realm";
import { ReplayController } from "./replay/controller";
import type { ReplayFrame } from "./replay/engine";
import { Chronicle } from "./screens/Chronicle";
import { Diplomacy } from "./screens/Diplomacy";
import { Found } from "./screens/Found";
import { Interior } from "./screens/Interior";
import { Ledger } from "./screens/Ledger";
import { Muster } from "./screens/Muster";
import { TechTree } from "./screens/TechTree";
import { Title } from "./screens/Title";
import { Train } from "./screens/Train";

export type WindowId = "chronicle" | "muster" | "techtree" | "diplomacy" | "found" | "ledger" | "train";

/** What the HUD can ask the realm to do. Nothing here reaches a runtime. */
export interface RealmActions {
  select: (selection: Selection, focus?: boolean) => void;
  open: (id: WindowId) => void;
  notify: (message: string) => void;
  watch: (campaignId: string) => void;
  enter: (buildingId: string, campaignId?: string | null) => void;
  replay: () => void;
  endReplay: () => void;
}

const lightKey = "age-of-agents.light";
function savedLight(): LightMode {
  try {
    const value = localStorage.getItem(lightKey);
    return value === "day" || value === "dusk" || value === "night" ? value : "auto";
  } catch {
    return "auto";
  }
}

export function EmpireApp() {
  const kingdoms = useMemo(() => makeKingdoms(), []);
  const home = must(kingdoms[0]);
  const campaigns = useMemo(() => makeCampaigns(kingdoms), [kingdoms]);
  const sceneRef = useRef<RealmScene | null>(null);
  const [entered, setEntered] = useState(() => new URLSearchParams(location.search).has("skip"));
  const [selection, setSelection] = useState<Selection>(null);
  const [window_, setWindow] = useState<WindowId | null>(null);
  const [interior, setInterior] = useState<{ buildingId: string; campaignId: string | null } | null>(null);
  const [watchId, setWatchId] = useState<string | null>(null);
  const [replay, setReplay] = useState<ReplayController | null>(null);
  const [replayHeralds, setReplayHeralds] = useState<string[]>([]);
  const [, setReplayStep] = useState("");
  const [light, setLight] = useState<LightMode>(savedLight);
  const [toast, setToast] = useState<string | null>(null);
  const [decreeIndex, setDecreeIndex] = useState(-1);
  const toastTimer = useRef(0);

  const select = useCallback((next: Selection, focus = false) => {
    setSelection(next);
    const scene = sceneRef.current;
    if (scene) {
      scene.selection = next;
      if (focus) scene.focusSelection(next);
    }
  }, []);
  const notify = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3800);
  }, []);
  const watch = useCallback(
    (id: string | null) => {
      setWatchId(id);
      const scene = sceneRef.current;
      if (!scene) return;
      scene.follow = id ? { kind: "campaign", id } : null;
      if (id) select({ kind: "campaign", id });
    },
    [select],
  );
  const startReplay = useCallback(() => {
    const controller = new ReplayController();
    setReplay(controller);
    setReplayHeralds([]);
    setWindow(null);
    watch(null);
    if (sceneRef.current) sceneRef.current.replay = controller;
    select({ kind: "replay" });
  }, [select, watch]);
  const stopReplay = useCallback(() => {
    setReplay(null);
    setReplayHeralds([]);
    if (sceneRef.current) sceneRef.current.replay = null;
    select(null);
  }, [select]);
  const onReplayFrame = useCallback((frame: ReplayFrame, playing: boolean) => {
    setReplayStep(`${frame.index}:${playing}`);
    setReplayHeralds((prev) => (prev.length === frame.heralds.length ? prev : frame.heralds));
  }, []);
  useEffect(() => {
    if (sceneRef.current) sceneRef.current.lightMode = light;
    try {
      localStorage.setItem(lightKey, light);
    } catch {
      // Browser storage is a per-viewer convenience only.
    }
  }, [light]);
  useEffect(() => {
    if (new URLSearchParams(location.search).has("replay")) startReplay();
  }, [startReplay]);

  const actions: RealmActions = useMemo(
    () => ({
      select,
      open: setWindow,
      notify,
      watch,
      enter: (buildingId, campaignId = null) => setInterior({ buildingId, campaignId }),
      replay: startReplay,
      endReplay: stopReplay,
    }),
    [select, notify, watch, startReplay, stopReplay],
  );

  const needsYou = useMemo(
    () => campaigns.filter((c) => ["needs-you", "blocked", "failed"].includes(c.posture)),
    [campaigns],
  );
  const nextDecree = useCallback(
    (step = 1) => {
      if (!needsYou.length) return;
      const index = (decreeIndex + step + needsYou.length) % needsYou.length;
      setDecreeIndex(index);
      const target = needsYou[index];
      if (target) select({ kind: "campaign", id: target.id }, true);
    },
    [decreeIndex, needsYou, select],
  );

  useEffect(() => {
    if (!entered) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (event.key === "Escape") {
        if (interior) setInterior(null);
        else if (window_) setWindow(null);
        else if (watchId) watch(null);
        else if (replay) stopReplay();
        else select(null);
      } else if (event.key === ".") nextDecree(1);
      else if (event.key === ",") nextDecree(-1);
      else if (event.key === "h" || event.key === "H") select({ kind: "kingdom", id: home.id }, true);
      else if (event.key === "t" || event.key === "T") setWindow("techtree");
      else if (event.key === "m" || event.key === "M") setWindow("muster");
      else if (event.key === "l" || event.key === "L") setWindow("ledger");
      else if (event.key === "n" || event.key === "N") setWindow("train");
      else if (event.key === "r" || event.key === "R") startReplay();
      else if ((event.key === "c" || event.key === "C") && selection?.kind === "campaign")
        setWindow("chronicle");
      else if ((event.key === "f" || event.key === "F") && selection?.kind === "campaign")
        watch(selection.id);
      else if (event.key === "e" || event.key === "E") {
        const scene = sceneRef.current;
        if (selection?.kind === "building") setInterior({ buildingId: selection.id, campaignId: null });
        else if (selection?.kind === "campaign" && scene) {
          const c = campaigns.find((item) => item.id === selection.id);
          const b = c ? scene.stageBuilding(c.kingdomId, c.stage) : null;
          if (b) setInterior({ buildingId: b.id, campaignId: selection.id });
        }
      } else if (event.key === " " && replay) {
        event.preventDefault();
        replay.toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    entered,
    window_,
    interior,
    watchId,
    replay,
    selection,
    campaigns,
    nextDecree,
    select,
    home,
    watch,
    stopReplay,
    startReplay,
  ]);

  const selectedCampaign =
    selection?.kind === "campaign" ? (campaigns.find((c) => c.id === selection.id) ?? null) : null;
  const watched = watchId ? campaigns.find((c) => c.id === watchId) : null;
  const watchedKingdom = watched ? kingdoms.find((k) => k.id === watched.kingdomId) : null;
  const interiorBuilding = interior
    ? sceneRef.current?.world.buildings.find((b) => b.id === interior.buildingId)
    : null;
  const interiorKingdom = interiorBuilding ? kingdoms.find((k) => k.id === interiorBuilding.kingdomId) : null;

  return (
    <div className={`ae-root${entered ? " is-entered" : ""}`}>
      <MapView
        kingdoms={kingdoms}
        campaigns={campaigns}
        sceneRef={sceneRef}
        onSelect={(next) => setSelection(next)}
        attract={!entered}
        light={light}
      />
      {!entered && (
        <Title
          onEnter={() => {
            setEntered(true);
            sceneRef.current?.focusTile(home.origin.x + 4, home.origin.y + 6);
          }}
          onOpen={(id) => {
            setEntered(true);
            setWindow(id);
          }}
          onReplay={() => {
            setEntered(true);
            startReplay();
          }}
        />
      )}
      {entered && (
        <>
          <TopBar
            campaigns={campaigns}
            selected={selectedCampaign}
            onOpen={setWindow}
            onReplay={startReplay}
            light={light}
            onLight={setLight}
          />
          {watched && watchedKingdom ? (
            <WatchPanel campaign={watched} kingdom={watchedKingdom} onClose={() => watch(null)} />
          ) : (
            <Decrees
              campaigns={needsYou}
              kingdoms={kingdoms}
              selectedId={selectedCampaign?.id ?? null}
              onPick={(id) => select({ kind: "campaign", id }, true)}
              onNext={() => nextDecree(1)}
            />
          )}
          <Herald
            campaigns={campaigns}
            kingdoms={kingdoms}
            replayLines={replay ? replayHeralds : null}
            onPick={(id) => select({ kind: "campaign", id }, true)}
          />
          {replay && <ReplayBar controller={replay} onClose={stopReplay} onFrame={onReplayFrame} />}
          <BottomPanel
            selection={selection}
            kingdoms={kingdoms}
            campaigns={campaigns}
            sceneRef={sceneRef}
            actions={actions}
            replay={replay}
            watchId={watchId}
          />
          <div
            className="ae-sample-ribbon"
            title="Every task, run and token here is the Frontier fixture data. Commands stay in this tab."
          >
            Sample realm · recorded fixture data · actions stay in this tab
          </div>
        </>
      )}
      {interiorBuilding && interiorKingdom && (
        <Interior
          building={interiorBuilding}
          kingdom={interiorKingdom}
          campaigns={campaigns}
          initialId={interior?.campaignId ?? null}
          onClose={() => setInterior(null)}
          notify={notify}
        />
      )}
      {window_ === "chronicle" && selectedCampaign && (
        <Chronicle
          campaign={selectedCampaign}
          kingdoms={kingdoms}
          onClose={() => setWindow(null)}
          notify={notify}
        />
      )}
      {window_ === "muster" && <Muster onClose={() => setWindow(null)} notify={notify} />}
      {window_ === "techtree" && (
        <TechTree campaign={selectedCampaign} onClose={() => setWindow(null)} onReplay={startReplay} />
      )}
      {window_ === "diplomacy" && (
        <Diplomacy campaigns={campaigns} onClose={() => setWindow(null)} notify={notify} />
      )}
      {window_ === "found" && <Found onClose={() => setWindow(null)} notify={notify} />}
      {window_ === "train" && (
        <Train
          kingdoms={kingdoms}
          onClose={() => setWindow(null)}
          notify={notify}
          onMuster={() => setWindow("muster")}
        />
      )}
      {window_ === "ledger" && (
        <Ledger
          campaigns={campaigns}
          kingdoms={kingdoms}
          onClose={() => setWindow(null)}
          onPick={(id) => {
            select({ kind: "campaign", id }, true);
            setWindow("chronicle");
          }}
        />
      )}
      {toast && (
        <div className="ae-toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
