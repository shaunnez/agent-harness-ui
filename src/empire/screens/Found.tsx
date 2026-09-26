import { useState } from "react";
import { BuildingPortrait } from "../hud/Portrait";
import { type CivId, civs, deliveryBanners, must, researchBanners } from "../realm";
import { Window } from "./Window";

export function Found({ onClose, notify }: { onClose: () => void; notify: (m: string) => void }) {
  const [research, setResearch] = useState(false);
  const [civId, setCivId] = useState<CivId>("bastion");
  const [banner, setBanner] = useState(must(deliveryBanners[0]).hex);
  const [name, setName] = useState("");
  const [repo, setRepo] = useState("");
  const choices = civs.filter((c) => !!c.researchOnly === research);
  const palette = research ? researchBanners : deliveryBanners;
  const civ = must(civs.find((c) => c.id === civId) ?? civs[0]);
  const switchType = (next: boolean) => {
    setResearch(next);
    setCivId(next ? "relay" : "bastion");
    setBanner(must((next ? researchBanners : deliveryBanners)[0]).hex);
  };
  return (
    <Window
      wide
      onClose={onClose}
      kicker="New project base"
      title="Found a Kingdom"
      footer={
        <>
          <span className="ae-muted">
            {research
              ? "A research realm needs only a name: no repository, no path."
              : "A delivery kingdom is bound to one repository."}
          </span>
          <button
            type="button"
            className="ae-btn is-gold"
            disabled={!name.trim() || (!research && !repo.trim())}
            onClick={() => notify(`${name} would be founded — prototype only: no project was created.`)}
          >
            Found {name.trim() || "kingdom"}
          </button>
        </>
      }
    >
      <div className="ae-found">
        <div className="ae-found-form">
          <div className="ae-segment is-large">
            <button type="button" className={!research ? "is-active" : ""} onClick={() => switchType(false)}>
              Delivery kingdom
            </button>
            <button type="button" className={research ? "is-active" : ""} onClick={() => switchType(true)}>
              Research realm
            </button>
          </div>
          <label className="ae-field">
            <span>Kingdom name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={research ? "QS Rates Research" : "PlanCheck"}
            />
          </label>
          {!research && (
            <label className="ae-field">
              <span>Repository</span>
              <input
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                placeholder="/repos/eversor-plancheck"
              />
            </label>
          )}
          <div className="ae-field-label">Civilisation (base)</div>
          <div className="ae-civs">
            {choices.map((c) => (
              <button
                type="button"
                key={c.id}
                className={c.id === civId ? "is-active" : ""}
                onClick={() => setCivId(c.id)}
              >
                <BuildingPortrait
                  kind={c.researchOnly ? "observatory" : "towncenter"}
                  civ={c}
                  banner={banner}
                  size={96}
                />
                <b>{c.name}</b>
                <small>
                  {c.base} · “{c.motto}”
                </small>
              </button>
            ))}
          </div>
          <div className="ae-field-label">Banner</div>
          <div className="ae-banners">
            {palette.map((b) => (
              <button
                type="button"
                key={b.id}
                className={b.hex === banner ? "is-active" : ""}
                style={{ background: b.hex }}
                onClick={() => setBanner(b.hex)}
                aria-label={b.label}
                title={b.label}
              />
            ))}
          </div>
        </div>
        <div className="ae-found-preview ae-parchment">
          <BuildingPortrait
            kind={research ? "observatory" : "towncenter"}
            civ={civ}
            banner={banner}
            size={340}
          />
          <div className="ae-found-name" style={{ background: banner }}>
            {name.trim() || (research ? "Unnamed realm" : "Unnamed kingdom")}
          </div>
          <p className="ae-muted">
            {civ.name} · {civ.base} base
          </p>
        </div>
      </div>
    </Window>
  );
}
