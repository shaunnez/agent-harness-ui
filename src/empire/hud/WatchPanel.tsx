import { Eye, X } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { RuntimeRun } from "../../domain";
import {
  type Campaign,
  type Kingdom,
  buildingFor,
  formatTokens,
  postureStyle,
  rankFor,
  unitFor,
  unitKindFor,
} from "../realm";
import { UnitPortrait } from "./Portrait";

const elapsed = (from: string | null | undefined, to: number) => {
  if (!from) return "—";
  const minutes = Math.max(0, Math.round((to - Date.parse(from)) / 60000));
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
};

/** Pick the run to watch: a recorded running run first, otherwise the latest run at this stage. */
export function watchedRun(c: Campaign): RuntimeRun | null {
  const runs = c.task.runs ?? [];
  return (
    runs.find((run) => run.status === "running") ??
    [...runs].reverse().find((run) => run.stage === c.stage) ??
    null
  );
}

/** Follow one campaign's crew: the camera tracks the squad and its recorded activity is listed. */
export function WatchPanel({
  campaign: c,
  kingdom,
  onClose,
}: {
  campaign: Campaign;
  kingdom: Kingdom;
  onClose: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, []);
  const run = watchedRun(c);
  const unit = unitFor(run?.model);
  const rank = rankFor(run?.reasoning);
  const running = run?.status === "running";
  const events = [...(c.task.events ?? [])]
    .filter((event) => !run || !event.runId || event.runId === run.id)
    .sort((a, b) => b.at.localeCompare(a.at));
  const tools = run?.toolCalls ?? [];
  const style = postureStyle[c.posture];
  return (
    <aside className="ae-watch" aria-label={`Watching ${c.id}`}>
      <header>
        <Eye weight="fill" />
        <span>
          Watching {c.id} · {buildingFor(c.stage).name}
        </span>
        <button type="button" onClick={onClose} aria-label="Stop watching">
          <X weight="bold" />
        </button>
      </header>
      <div className="ae-watch-hero">
        <span className="ae-watch-portrait" style={{ borderColor: kingdom.banner }}>
          <UnitPortrait kind={unitKindFor(run?.model)} team={kingdom.banner} working={running} size={76} />
        </span>
        <div>
          <b>
            {unit.unit} {rank.numeral}
          </b>
          <span>
            {run ? `${run.model} · ${run.reasoning}` : "No run recorded yet"}
            {run?.workPackageId ? ` · ${run.workPackageId}` : ""}
          </span>
          {run && (
            <span className={`ae-report-status is-${run.status}`}>
              {running ? `Running · ${elapsed(run.startedAt, now)}` : `Run ${run.status}`}
            </span>
          )}
        </div>
      </div>
      {!running && c.posture !== "working" && (
        <p className="ae-watch-note" style={{ borderColor: style.color }}>
          {run ? "This run has finished. " : ""}The campaign is {style.label.toLowerCase()}:{" "}
          {c.attentionLabel}.
        </p>
      )}
      {run && (
        <dl className="ae-watch-usage">
          <div>
            <dt>in</dt>
            <dd>{formatTokens(run.usage?.inputTokens ?? 0)}</dd>
          </div>
          <div>
            <dt>out</dt>
            <dd>{formatTokens(run.usage?.outputTokens ?? 0)}</dd>
          </div>
          <div>
            <dt>cached</dt>
            <dd>{formatTokens(run.usage?.cachedInputTokens ?? 0)}</dd>
          </div>
        </dl>
      )}
      <div className="ae-watch-feed">
        <div className="ae-watch-feed-title">Recorded activity</div>
        {events.length === 0 && tools.length === 0 && (
          <p className="ae-muted-light">No activity recorded for this run.</p>
        )}
        {events.map((event) => (
          <article key={event.id} className={`ae-watch-event is-${event.tone}`}>
            <time>{new Date(event.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
            <b>{event.title}</b>
            <span>{event.detail}</span>
          </article>
        ))}
        {tools.map((tool, i) => (
          <article
            key={tool.id ?? `${tool.name}-${i}`}
            className={`ae-watch-event${tool.commandFailed ? " is-danger" : ""}`}
          >
            <b>{tool.name}</b>
            <span>
              {tool.category} · {tool.phase}
            </span>
          </article>
        ))}
      </div>
    </aside>
  );
}
