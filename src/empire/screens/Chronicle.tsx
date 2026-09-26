import { ArrowCounterClockwise, SealCheck, Wrench } from "@phosphor-icons/react";
import { stageIds } from "../../domain";
import { UnitPortrait } from "../hud/Portrait";
import {
  type Campaign,
  type Kingdom,
  ageOf,
  ages,
  buildingFor,
  formatTokens,
  postureStyle,
  rankFor,
  unitFor,
  unitKindFor,
} from "../realm";
import { Council, Scrolls, Yards } from "./parts";
import { Window } from "./Window";

export function Chronicle({
  campaign: c,
  kingdoms,
  onClose,
  notify,
}: {
  campaign: Campaign;
  kingdoms: Kingdom[];
  onClose: () => void;
  notify: (m: string) => void;
}) {
  const kingdom = kingdoms.find((k) => k.id === c.kingdomId);
  const banner = kingdom?.banner ?? "#999";
  const style = postureStyle[c.posture];
  const building = buildingFor(c.stage);
  const grill = c.task.grillSession;
  const prototype = (what: string) => notify(`${what} — prototype only: no task was changed.`);

  return (
    <Window
      wide
      onClose={onClose}
      kicker={
        <>
          <i className="ae-dot" style={{ background: banner }} /> {kingdom?.name} · Campaign chronicle
        </>
      }
      title={
        <>
          {c.id} <span className="ae-window-title-sub">{c.title}</span>
        </>
      }
      footer={
        <>
          <span className="ae-muted">
            Chronicle of recorded sample state. Decrees made here stay in this tab.
          </span>
          <div className="ae-foot-actions">
            {c.posture === "blocked" && (
              <button type="button" className="ae-btn is-red" onClick={() => prototype("Repair crew sent")}>
                <Wrench /> Send repair crew
              </button>
            )}
            {c.posture === "failed" && (
              <button type="button" className="ae-btn is-red" onClick={() => prototype("Retry ordered")}>
                <ArrowCounterClockwise /> Rally & retry
              </button>
            )}
            {c.status.startsWith("awaiting-") && c.status.endsWith("approval") && (
              <button type="button" className="ae-btn is-gold" onClick={() => prototype("Charter sealed")}>
                <SealCheck /> Seal the charter
              </button>
            )}
          </div>
        </>
      }
    >
      <section className="ae-march" aria-label="Progress through the ages">
        {ages.map((age) => (
          <div key={age.id} className={`ae-march-age${ageOf(c.stage).id === age.id ? " is-current" : ""}`}>
            <div className="ae-march-age-name">
              <b>{age.numeral}</b> {age.name}
            </div>
            <div className="ae-march-stages">
              {age.stages.map((stage) => {
                const index = stageIds.indexOf(stage);
                const done = c.completed.includes(stage);
                const current = stage === c.stage;
                const state = current
                  ? c.posture === "done"
                    ? "done"
                    : c.posture === "blocked" || c.posture === "failed"
                      ? "error"
                      : "current"
                  : done
                    ? "done"
                    : "future";
                return (
                  <div
                    key={stage}
                    className={`ae-medal is-${state}`}
                    title={
                      state === "future" ? "Not started — nothing to inspect yet" : buildingFor(stage).name
                    }
                  >
                    <span className="ae-medal-coin">
                      {state === "done" ? "✓" : state === "error" ? "✖" : index + 1}
                    </span>
                    <span className="ae-medal-label">{buildingFor(stage).stageLabel}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </section>

      <div className="ae-chron-grid">
        <div className="ae-chron-main">
          <section className="ae-parchment">
            <div className="ae-front">
              <div>
                <div className="ae-eyebrow">The front · {building.name}</div>
                <h3 style={{ color: style.color }}>
                  {style.glyph} {c.attentionLabel}
                </h3>
                <p className="ae-lore">{building.lore}</p>
              </div>
              <dl className="ae-front-facts">
                <div>
                  <dt>Status</dt>
                  <dd>{c.status}</dd>
                </div>
                <div>
                  <dt>Who must act</dt>
                  <dd>
                    {c.nextActor === "you"
                      ? "You, sovereign"
                      : c.nextActor === "agents"
                        ? "The crew"
                        : c.nextActor === "external"
                          ? "The Capital (GitHub)"
                          : c.nextActor === "dependency"
                            ? "An allied package"
                            : "—"}
                  </dd>
                </div>
                <div>
                  <dt>Age</dt>
                  <dd>{ageOf(c.stage).name}</dd>
                </div>
              </dl>
            </div>
            {c.reason && (
              <pre className={`ae-reason${c.posture === "needs-you" ? " is-question" : ""}`}>{c.reason}</pre>
            )}
          </section>

          {grill && <Council task={c.task} />}
          {c.packages.length > 0 && <Yards task={c.task} />}
          <Scrolls task={c.task} />
        </div>

        <aside className="ae-chron-side">
          <section className="ae-parchment">
            <div className="ae-eyebrow">Battle reports · {c.runs}</div>
            {(c.task.runs ?? []).length === 0 && <p className="ae-muted">No runs recorded yet.</p>}
            {(c.task.runs ?? []).map((run) => {
              const unit = unitFor(run.model);
              const rank = rankFor(run.reasoning);
              return (
                <div key={run.id} className="ae-report">
                  <UnitPortrait
                    kind={unitKindFor(run.model ?? "")}
                    team={banner}
                    size={48}
                    working={run.status === "running"}
                  />
                  <div>
                    <b>
                      {buildingFor(run.stage as never).name}
                      {run.workPackageId ? ` · ${run.workPackageId}` : ""}
                    </b>
                    <span>
                      {unit.unit} {rank.numeral} · {run.model} · {run.reasoning}
                    </span>
                    <span className={`ae-report-status is-${run.status}`}>
                      {run.status}
                      {run.durationMs ? ` · ${Math.round(run.durationMs / 60000)} min` : ""}
                    </span>
                    <span className="ae-muted">
                      {formatTokens(run.usage?.inputTokens ?? 0)} in ·{" "}
                      {formatTokens(run.usage?.outputTokens ?? 0)} out ·{" "}
                      {formatTokens(run.usage?.cachedInputTokens ?? 0)} cached
                    </span>
                  </div>
                </div>
              );
            })}
          </section>
          <section className="ae-parchment">
            <div className="ae-eyebrow">Treasury</div>
            <dl className="ae-front-facts is-stacked">
              <div>
                <dt>Food · input</dt>
                <dd>{formatTokens(c.tokens.input)}</dd>
              </div>
              <div>
                <dt>Wood · output</dt>
                <dd>{formatTokens(c.tokens.output)}</dd>
              </div>
              <div>
                <dt>Stone · cached</dt>
                <dd>
                  {formatTokens(c.tokens.cached)}{" "}
                  {c.tokens.input ? `(${Math.round((c.tokens.cached / c.tokens.input) * 100)}%)` : ""}
                </dd>
              </div>
              <div>
                <dt>Gold · approx. cost</dt>
                <dd title="API-rate estimate; no verified rate card in the sample settings">Unavailable</dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>
    </Window>
  );
}
