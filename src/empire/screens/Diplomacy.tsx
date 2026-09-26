import { Anchor, Barricade, Handshake } from "@phosphor-icons/react";
import { useState } from "react";
import type { Campaign } from "../realm";
import { Window } from "./Window";

export function Diplomacy({
  campaigns,
  onClose,
  notify,
}: {
  campaigns: Campaign[];
  onClose: () => void;
  notify: (m: string) => void;
}) {
  const [linear, setLinear] = useState(true);
  const envoys = campaigns.filter((c) => c.posture === "external");
  return (
    <Window onClose={onClose} kicker="Integrations as treaties" title="Diplomacy">
      <div className="ae-treaties">
        <article className="ae-treaty ae-parchment">
          <div className="ae-seal" style={{ background: "#5e6ad2" }}>
            <Handshake weight="fill" />
          </div>
          <div>
            <div className="ae-eyebrow">Trade pact · Linear</div>
            <h3>The Merchant League</h3>
            <p className="ae-lore">
              Tagged issues arrive at the Grand Market as caravans and become campaigns in the mapped kingdom.
              Plans, blockers, reviews and deliveries are sent back; a human reply that names Harness can
              answer the Council.
            </p>
            <div className="ae-segment">
              <button type="button" className={linear ? "is-active" : ""} onClick={() => setLinear(true)}>
                Allied
              </button>
              <button
                type="button"
                className={!linear ? "is-active" : ""}
                onClick={() => {
                  setLinear(false);
                  notify(
                    "Pact paused in this tab only. Intake would pause after the current receipt settles.",
                  );
                }}
              >
                Paused
              </button>
            </div>
          </div>
        </article>
        <article className="ae-treaty ae-parchment">
          <div className="ae-seal" style={{ background: "#24292f" }}>
            <Anchor weight="fill" />
          </div>
          <div>
            <div className="ae-eyebrow">Tribute · GitHub</div>
            <h3>The GitHub Capital</h3>
            <p className="ae-lore">
              Only the exact approved candidate sails, to a campaign-specific branch. The campaign waits at
              “Awaiting PR merge” until the Capital merges it.
            </p>
            <p>
              <b>{envoys.length}</b> envoy{envoys.length === 1 ? "" : "s"} at sea:{" "}
              {envoys.map((c) => c.id).join(", ") || "none"}
            </p>
          </div>
        </article>
        <article className="ae-treaty ae-parchment">
          <div className="ae-seal" style={{ background: "#3b2350" }}>
            <Barricade weight="fill" />
          </div>
          <div>
            <div className="ae-eyebrow">Border · Research</div>
            <h3>The Starwatch Palisade</h3>
            <p className="ae-lore">
              Research lives in its own walled realm across the river, running only the API loop. The gate is
              narrow: Linear issues carrying IDs and failure codes, and scrubbed cases merged by PR. Nothing
              else crosses.
            </p>
          </div>
        </article>
      </div>
    </Window>
  );
}
