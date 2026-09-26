// Special corps: design generation per provider, and the research realm's fixed scholars.
import { useState } from "react";
import { UnitPortrait } from "../../hud/Portrait";
import { makeRoster, rankFor, ranks, unitFor, unitKindFor } from "../../realm";

const roster = makeRoster();
type DesignId = "codex-design" | "claude-design";
const corps: { id: DesignId; name: string; provider: "codex" | "claude"; blurb: string }[] = [
  {
    id: "codex-design",
    name: "Codex design corps",
    provider: "codex",
    blurb: "Draws design variants through the Codex CLI.",
  },
  {
    id: "claude-design",
    name: "Claude design corps",
    provider: "claude",
    blurb: "Draws design variants through the Claude CLI.",
  },
];

export function Corps() {
  const [design, setDesign] = useState(() => structuredClone(roster.settings.designPolicies));
  return (
    <div className="ae-corps">
      {corps.map((corp) => {
        const policy = design[corp.id];
        const models = roster.catalog.models.filter((m) => m.provider === corp.provider);
        const levels = models.find((m) => m.id === policy?.model)?.reasoningLevels ?? [];
        const team = corp.provider === "claude" ? "#c9793a" : "#2f63c4";
        return (
          <section key={corp.id} className="ae-parchment ae-corp">
            <UnitPortrait kind={unitKindFor(policy?.model)} team={team} size={96} />
            <div>
              <div className="ae-eyebrow">{corp.name}</div>
              <h3>
                {unitFor(policy?.model).unit} {rankFor(policy?.reasoning).numeral}{" "}
                <small>
                  {unitFor(policy?.model).modelLabel} · {policy?.reasoning}
                </small>
              </h3>
              <p className="ae-lore">
                {corp.blurb} One pick per provider, snapshotted on each campaign and every variant.
              </p>
              <div className="ae-field-label">Unit</div>
              <div className="ae-segment">
                {models.map((m) => (
                  <button
                    type="button"
                    key={m.id}
                    className={m.id === policy?.model ? "is-active" : ""}
                    onClick={() => setDesign((d) => ({ ...d, [corp.id]: { ...d[corp.id], model: m.id } }))}
                  >
                    {unitFor(m.id).unit} · {m.label}
                  </button>
                ))}
              </div>
              <div className="ae-field-label">Rank</div>
              <div className="ae-segment">
                {ranks
                  .filter((rank) => levels.includes(rank.id))
                  .map((rank) => (
                    <button
                      type="button"
                      key={rank.id}
                      className={rank.id === policy?.reasoning ? "is-active" : ""}
                      onClick={() =>
                        setDesign((d) => ({ ...d, [corp.id]: { ...d[corp.id], reasoning: rank.id } }))
                      }
                    >
                      {rank.numeral} {rank.id}
                    </button>
                  ))}
              </div>
            </div>
          </section>
        );
      })}
      <section className="ae-parchment ae-corp is-locked">
        <UnitPortrait kind="scholar" team="#3b2350" size={96} />
        <div>
          <div className="ae-eyebrow">Starwatch Scholars · research only</div>
          <h3>
            Scholar <small>DeepSeek 4.1 Flash · API loop</small>
          </h3>
          <p className="ae-lore">
            The research realm fields one kind of unit and it cannot be changed here: the API loop with the
            host's answer check. No Claude or Codex rides for research.
          </p>
          <dl className="ae-front-facts is-stacked">
            <div>
              <dt>Engine</dt>
              <dd>API loop (eval arm A10)</dd>
            </div>
            <div>
              <dt>Provider</dt>
              <dd>OpenCode Go for testing · Baseten (US-hosted) planned for production</dd>
            </div>
            <div>
              <dt>Scouting</dt>
              <dd>Parallel search</dd>
            </div>
            <div>
              <dt>Scoping</dt>
              <dd>One tools-less DeepSeek call on the same key</dd>
            </div>
            <div>
              <dt>Runs per question</dt>
              <dd>Five by default, the three closest scored · Three · Quick (one run, not cross-checked)</dd>
            </div>
          </dl>
        </div>
      </section>
    </div>
  );
}
