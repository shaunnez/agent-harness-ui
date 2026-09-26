import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BottomPanel } from "./hud/BottomPanel";
import { Decrees } from "./hud/Decrees";
import { Herald } from "./hud/Herald";
import { TopBar } from "./hud/TopBar";
import { MapView } from "./map/MapView";
import type { RealmScene, Selection } from "./map/scene";
import { makeCampaigns, makeKingdoms, must } from "./realm";
import { Chronicle } from "./screens/Chronicle";
import { Diplomacy } from "./screens/Diplomacy";
import { Found } from "./screens/Found";
import { Ledger } from "./screens/Ledger";
import { Muster } from "./screens/Muster";
import { TechTree } from "./screens/TechTree";
import { Title } from "./screens/Title";
import { Train } from "./screens/Train";

export type WindowId = "chronicle" | "muster" | "techtree" | "diplomacy" | "found" | "ledger" | "train";

export function EmpireApp() {
  const kingdoms = useMemo(() => makeKingdoms(), []);
  const home = must(kingdoms[0]);
  const campaigns = useMemo(() => makeCampaigns(kingdoms), [kingdoms]);
  const sceneRef = useRef<RealmScene | null>(null);
  const [entered, setEntered] = useState(() => new URLSearchParams(location.search).has("skip"));
  const [selection, setSelection] = useState<Selection>(null);
  const [window_, setWindow] = useState<WindowId | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [decreeIndex, setDecreeIndex] = useState(-1);

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
    window.clearTimeout((notify as unknown as { timer?: number }).timer);
    (notify as unknown as { timer?: number }).timer = window.setTimeout(() => setToast(null), 3800);
  }, []);

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
        if (window_) setWindow(null);
        else select(null);
      } else if (event.key === ".") nextDecree(1);
      else if (event.key === ",") nextDecree(-1);
      else if (event.key === "h" || event.key === "H") select({ kind: "kingdom", id: home.id }, true);
      else if (event.key === "t" || event.key === "T") setWindow("techtree");
      else if (event.key === "m" || event.key === "M") setWindow("muster");
      else if (event.key === "l" || event.key === "L") setWindow("ledger");
      else if (event.key === "n" || event.key === "N") setWindow("train");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [entered, window_, nextDecree, select, home]);

  const selectedCampaign =
    selection?.kind === "campaign" ? (campaigns.find((c) => c.id === selection.id) ?? null) : null;

  return (
    <div className={`ae-root${entered ? " is-entered" : ""}`}>
      <MapView
        kingdoms={kingdoms}
        campaigns={campaigns}
        sceneRef={sceneRef}
        onSelect={(next) => setSelection(next)}
        attract={!entered}
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
        />
      )}
      {entered && (
        <>
          <TopBar campaigns={campaigns} selected={selectedCampaign} onOpen={setWindow} />
          <Decrees
            campaigns={needsYou}
            kingdoms={kingdoms}
            selectedId={selectedCampaign?.id ?? null}
            onPick={(id) => select({ kind: "campaign", id }, true)}
            onNext={() => nextDecree(1)}
          />
          <Herald
            campaigns={campaigns}
            kingdoms={kingdoms}
            onPick={(id) => select({ kind: "campaign", id }, true)}
          />
          <BottomPanel
            selection={selection}
            kingdoms={kingdoms}
            campaigns={campaigns}
            sceneRef={sceneRef}
            onSelect={select}
            onOpen={setWindow}
            notify={notify}
          />
          <div
            className="ae-sample-ribbon"
            title="Every task, run and token here is the Frontier fixture data. Commands stay in this tab."
          >
            Sample realm · recorded fixture data · actions stay in this tab
          </div>
        </>
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
      {window_ === "techtree" && <TechTree campaign={selectedCampaign} onClose={() => setWindow(null)} />}
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
