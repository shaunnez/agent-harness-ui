// Castle and Imperial Age interiors: the Monastery, Proving Grounds, the Keep and the Royal Harbour.
import { useState } from "react";
import { type RuntimeTask, stageIds } from "../../../domain";
import { buildingFor, formatTokens } from "../../realm";
import { Scrolls } from "../parts";

export function Monastery({ task }: { task: RuntimeTask }) {
  const verdicts = (task.artifacts ?? []).filter((a) => a.stage === "dev-review" && a.gateResult);
  const freshness = task.gateFreshness?.["dev-review"];
  return (
    <>
      {freshness && freshness.state !== "fresh" && (
        <section className="ae-parchment ae-callout is-red">
          <b>Verdict {freshness.state}</b>
          <span>{freshness.reasonCopy}</span>
        </section>
      )}
      {verdicts.map((artifact) => (
        <section key={artifact.id} className="ae-parchment">
          <div className="ae-eyebrow">
            Verdict {artifact.gateResult?.verdict} · candidate r{artifact.gateResult?.candidateRevision}
          </div>
          {(artifact.gateResult?.findings ?? []).map((finding) => (
            <article key={`${finding.title}-${finding.line}`} className="ae-finding">
              <span className={`ae-sev is-${finding.severity.toLowerCase()}`}>{finding.severity}</span>
              <div>
                <b>{finding.title}</b>
                {finding.file && (
                  <code>
                    {finding.file}
                    {finding.line ? `:${finding.line}` : ""}
                  </code>
                )}
                <p>{finding.detail}</p>
                {finding.blocking && <em>Blocking · sends a repair crew to the Workshop</em>}
              </div>
            </article>
          ))}
        </section>
      ))}
      <Scrolls task={task} stages={["dev-review"]} />
    </>
  );
}

export function ProvingGrounds({ task }: { task: RuntimeTask }) {
  const run = [...(task.runs ?? [])].reverse().find((item) => item.stage === "test" && item.test);
  const rows = run?.test?.rows ?? [];
  const firstFailed = rows.find((row) => row.status === "failed")?.id ?? null;
  const [open, setOpen] = useState<string | null>(firstFailed);
  const row = rows.find((item) => item.id === open);
  if (!run?.test)
    return (
      <section className="ae-parchment">
        <p className="ae-muted">No test run is recorded for this campaign.</p>
      </section>
    );
  if (row)
    return (
      <section className="ae-parchment">
        <button type="button" className="ae-link" onClick={() => setOpen(null)}>
          ← Back to all targets
        </button>
        <h3 className={`ae-target-title is-${row.status}`}>
          {row.status === "passed" ? "◎ Hit" : "✖ Missed"} · {row.title}
        </h3>
        <p>
          <code>{row.command}</code>
          {row.exitCode !== undefined && row.exitCode !== null ? ` · exit ${row.exitCode}` : ""}
          {row.durationMs ? ` · ${row.durationMs} ms` : ""}
        </p>
        {row.failureDetails && <pre className="ae-reason">{row.failureDetails}</pre>}
        {row.output && <pre className="ae-diff">{row.output}</pre>}
      </section>
    );
  return (
    <section className="ae-parchment">
      <div className="ae-eyebrow">
        Targets · {run.test.status} · <code>{run.test.command}</code>
      </div>
      {rows.map((item) => (
        <button
          type="button"
          key={item.id}
          className={`ae-target is-${item.status}`}
          onClick={() => setOpen(item.id)}
        >
          <span>{item.status === "passed" ? "◎" : "✖"}</span>
          <b>{item.title}</b>
          <em>{item.status}</em>
        </button>
      ))}
    </section>
  );
}

/** The whole campaign, stage by stage, from recorded runs only. */
export function Keep({ task }: { task: RuntimeTask }) {
  return (
    <section className="ae-parchment">
      <div className="ae-eyebrow">The campaign so far</div>
      <table className="ae-journey">
        <thead>
          <tr>
            <th>Building</th>
            <th>State</th>
            <th className="num">Runs</th>
            <th className="num">Tokens</th>
          </tr>
        </thead>
        <tbody>
          {stageIds.map((stage) => {
            const runs = (task.runs ?? []).filter((run) => run.stage === stage);
            const tokens = runs.reduce((sum, run) => sum + (run.usage?.totalTokens ?? 0), 0);
            const state = task.completedStages.includes(stage)
              ? "Completed"
              : stage === task.currentStage
                ? "Current"
                : "Not started";
            return (
              <tr key={stage} className={`is-${state.toLowerCase().replace(" ", "-")}`}>
                <td>{buildingFor(stage).name}</td>
                <td>{state}</td>
                <td className="num">{runs.length || "—"}</td>
                <td className="num">{tokens ? formatTokens(tokens) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="ae-muted">
        Approx. cost is unavailable: the sample settings carry no verified rate card.
      </p>
    </section>
  );
}

export function RoyalHarbour({ task, onSeal }: { task: RuntimeTask; onSeal: () => void }) {
  const intent = task.pullRequestIntent;
  return (
    <>
      {task.status === "awaiting-human-approval" && (
        <section className="ae-parchment ae-callout">
          <b>The exact candidate awaits your seal.</b>
          <button type="button" className="ae-btn is-gold" onClick={onSeal}>
            Approve & raise PR
          </button>
        </section>
      )}
      <section className="ae-parchment">
        <div className="ae-eyebrow">The envoy</div>
        {intent ? (
          <dl className="ae-front-facts is-stacked">
            <div>
              <dt>Carries</dt>
              <dd>
                candidate r{intent.candidateRevision} · <code>{intent.headRevision.slice(0, 10)}</code>
              </dd>
            </div>
            <div>
              <dt>Sails</dt>
              <dd>
                <code>{intent.headBranch}</code> → <code>{intent.targetBranch}</code>
              </dd>
            </div>
            <div>
              <dt>At the Capital</dt>
              <dd>
                {intent.status}
                {intent.number ? ` · PR #${intent.number}` : ""}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="ae-muted">No envoy has sailed for this campaign.</p>
        )}
      </section>
    </>
  );
}
