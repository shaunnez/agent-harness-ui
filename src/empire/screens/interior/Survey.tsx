// Dark and Feudal Age interiors: the Watch Tower, Scout Stables, Scriptorium and War Room.
import { scoutRoleIds, type RuntimeTask } from "../../../domain";
import { Scrolls } from "../parts";

export function WatchTower({ task }: { task: RuntimeTask }) {
  return (
    <>
      <section className="ae-parchment">
        <div className="ae-eyebrow">The order as received</div>
        <p className="ae-order">{task.description}</p>
        <dl className="ae-front-facts is-inline">
          <div>
            <dt>Workflow</dt>
            <dd>{task.workflow}</dd>
          </div>
          <div>
            <dt>Priority</dt>
            <dd>{task.priority}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{task.status}</dd>
          </div>
        </dl>
      </section>
      <Scrolls task={task} stages={["triage"]} />
    </>
  );
}

export function ScoutStables({ task }: { task: RuntimeTask }) {
  const dispatch = task.scoutDispatch;
  if (!dispatch) {
    return (
      <>
        <section className="ae-parchment">
          <p className="ae-muted">No scout dispatch is recorded for this campaign yet.</p>
        </section>
        <Scrolls task={task} stages={["scouts"]} />
      </>
    );
  }
  const names = scoutRoleIds.map((id) => id.replace("scout-", ""));
  return (
    <>
      <section className="ae-parchment">
        <div className="ae-eyebrow">
          Riders · {dispatch.selected.length} out, {dispatch.skipped.length} stabled
        </div>
        {dispatch.rationale && <p className="ae-lore">{dispatch.rationale}</p>}
        <div className="ae-scouts">
          {names.map((name) => {
            const rider = dispatch.selected.find((item) => item.name === name);
            return (
              <article key={name} className={`ae-scout is-${rider ? rider.status : "unused"}`}>
                <b>{name.replace("-", " ")}</b>
                {rider ? (
                  <>
                    <span>{rider.focus}</span>
                    <small>{rider.reason}</small>
                    <em>
                      {rider.status === "complete"
                        ? "Returned"
                        : rider.status === "failed"
                          ? "Lost"
                          : "Riding"}
                    </em>
                  </>
                ) : (
                  <em>Not used · stayed in the stable</em>
                )}
              </article>
            );
          })}
        </div>
      </section>
      <Scrolls task={task} stages={["scouts"]} />
    </>
  );
}

export function Scriptorium({ task, onSeal }: { task: RuntimeTask; onSeal: () => void }) {
  return (
    <>
      {task.status === "awaiting-spec-approval" && (
        <section className="ae-parchment ae-callout">
          <b>The charter awaits your seal.</b>
          <button type="button" className="ae-btn is-gold" onClick={onSeal}>
            Seal the charter
          </button>
        </section>
      )}
      <Scrolls task={task} stages={["specification"]} />
    </>
  );
}

/** The plan as dependency batches: columns of packages that may run side by side. */
export function WarRoom({ task, onSeal }: { task: RuntimeTask; onSeal: () => void }) {
  const packages = task.workPackages ?? [];
  const batches = [...new Set(packages.map((p) => p.batch))].sort((a, b) => a - b);
  return (
    <>
      {task.status === "awaiting-plan-approval" && (
        <section className="ae-parchment ae-callout">
          <b>The battle plan awaits your approval.</b>
          <button type="button" className="ae-btn is-gold" onClick={onSeal}>
            Approve the plan
          </button>
        </section>
      )}
      {packages.length > 0 && (
        <section className="ae-parchment">
          <div className="ae-eyebrow">
            Battle plan · {packages.length} packages in {batches.length} batch
            {batches.length === 1 ? "" : "es"}
          </div>
          <div className="ae-batches">
            {batches.map((batch, i) => (
              <div key={batch} className="ae-batch">
                <div className="ae-batch-title">
                  Batch {batch}
                  {i < batches.length - 1 && <span className="ae-batch-arrow">→</span>}
                </div>
                {packages
                  .filter((p) => p.batch === batch)
                  .map((p) => (
                    <div key={p.id} className="ae-batch-pkg">
                      <b>{p.id}</b> {p.title}
                      {p.dependencies.length > 0 && <small> after {p.dependencies.join(", ")}</small>}
                    </div>
                  ))}
              </div>
            ))}
          </div>
        </section>
      )}
      <Scrolls task={task} stages={["plan"]} />
    </>
  );
}
