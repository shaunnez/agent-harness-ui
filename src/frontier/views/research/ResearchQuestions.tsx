import { ArrowRight, CaretDown, CaretUp, MagnifyingGlass, Plus } from "@phosphor-icons/react";
import type { RuntimeProject } from "../../../domain";
import { usePanelState } from "../../app/panel-state";
import {
  headlineBand,
  type ResearchGateway,
  type ResearchQuestion,
  type ResearchQuestionStatus,
  researchEngineLabel,
  researchEngineName,
  researchStatusCopy,
  reviewState,
  reviewStateCopy,
} from "../../runtime/research";
import { ResearchStatusBadge } from "./ResearchBadges";
import { useProjectQuestions } from "./use-research";

const filters = [
  "All",
  "Awaiting review",
  "Disputed",
  "Not established",
  "Did not finish",
  "Reviewed",
] as const;
type Filter = (typeof filters)[number];
type SortKey = "title" | "status" | "band" | "agreement" | "centre" | "gst" | "asOf" | "engine" | "review";
const statusOrder: ResearchQuestionStatus[] = [
  "running",
  "queued",
  "incomplete",
  "disputed",
  "not_established",
  "single_run",
  "agreed",
];

function matches(question: ResearchQuestion, filter: Filter) {
  const review = reviewState(question);
  if (filter === "All") return true;
  if (filter === "Awaiting review") return review === "awaiting" || review === "out-of-date";
  if (filter === "Disputed") return question.status === "disputed";
  if (filter === "Not established") return question.status === "not_established";
  if (filter === "Did not finish") return question.status === "incomplete";
  return review === "approved" || review === "rejected";
}
function sortValue(question: ResearchQuestion, key: SortKey): string | number {
  if (key === "title") return question.title.toLowerCase();
  if (key === "status") return statusOrder.indexOf(question.status);
  if (key === "band") return question.consensus?.low ?? question.range?.min ?? Number.POSITIVE_INFINITY;
  if (key === "agreement") return question.agreement.lowRatio ?? Number.POSITIVE_INFINITY;
  if (key === "centre") return question.centre ?? "";
  if (key === "gst") return `${question.currency} ${question.gstBasis}`;
  if (key === "asOf") return question.asOf ?? question.askedAt;
  if (key === "engine") return researchEngineLabel(question.engine);
  return reviewState(question);
}

export function ResearchQuestions({
  project,
  research,
  engineLabel,
  onOpen,
  onAsk,
}: {
  project: RuntimeProject;
  research: ResearchGateway | undefined;
  engineLabel: string;
  onOpen(questionId: string): void;
  onAsk(): void;
}) {
  const key = `research-${project.id}`;
  const [query, setQuery] = usePanelState(`${key}-query`, "");
  const [filter, setFilter] = usePanelState<Filter>(`${key}-filter`, "All");
  const [sort, setSort] = usePanelState<{ key: SortKey; ascending: boolean }>(`${key}-sort`, {
    key: "status",
    ascending: true,
  });
  const { value: questions, error, loading } = useProjectQuestions(research, project.id);
  if (!research)
    return (
      <div className="overlay-body">
        <p className="empty-state">This runtime does not serve research questions.</p>
      </div>
    );
  const all = questions ?? [];
  const visible = all
    .filter((question) =>
      `${question.title} ${question.family ?? ""}`.toLowerCase().includes(query.toLowerCase()),
    )
    .filter((question) => matches(question, filter))
    .sort((a, b) => {
      const left = sortValue(a, sort.key);
      const right = sortValue(b, sort.key);
      const order = left < right ? -1 : left > right ? 1 : a.title.localeCompare(b.title);
      return sort.ascending ? order : -order;
    });
  const count = (status: ResearchQuestionStatus) =>
    all.filter((question) => question.status === status).length;
  const awaiting = all.filter((question) => matches(question, "Awaiting review")).length;
  const header = (id: SortKey, label: string) => (
    <th aria-sort={sort.key === id ? (sort.ascending ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        className="research-sort"
        onClick={() => setSort({ key: id, ascending: sort.key === id ? !sort.ascending : true })}
      >
        {label}
        {sort.key === id && (sort.ascending ? <CaretUp size={13} /> : <CaretDown size={13} />)}
      </button>
    </th>
  );
  return (
    <div className="overlay-body journal-body research-body">
      <section className="research-summary" aria-label="Research project summary">
        <dl>
          <div>
            <dt>Questions</dt>
            <dd>{all.length}</dd>
          </div>
          <div className="tone-approval">
            <dt>Awaiting review</dt>
            <dd>{awaiting}</dd>
          </div>
          {(["agreed", "disputed", "not_established", "incomplete", "running"] as const).map((status) => (
            <div key={status} className={`tone-${researchStatusCopy[status].tone}`}>
              <dt>{researchStatusCopy[status].label}</dt>
              <dd>{count(status)}</dd>
            </div>
          ))}
        </dl>
        <div className="research-summary-action">
          <small>New questions run on {engineLabel}</small>
          <button type="button" className="primary" onClick={onAsk}>
            <Plus size={18} />
            Ask a question
          </button>
        </div>
      </section>
      <div className="journal-tools journal-filters">
        <nav className="segmented" aria-label="Question filter">
          {filters.map((entry) => (
            <button
              type="button"
              key={entry}
              aria-pressed={filter === entry}
              onClick={() => setFilter(entry)}
            >
              {entry}
            </button>
          ))}
        </nav>
        <label>
          <MagnifyingGlass size={19} />
          <input
            aria-label="Search questions"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search questions"
          />
        </label>
        <span>{visible.length} questions</span>
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {loading && <p className="quiet">Loading research questions…</p>}
      {!loading && (
        <div className="journal-table-scroll research-table-scroll">
          <table className="task-journal research-table">
            <thead>
              <tr>
                {header("title", "Question")}
                {header("status", "Answer")}
                {header("band", "Band")}
                {header("agreement", "Agreement")}
                {header("gst", "Currency")}
                {header("centre", "Centre")}
                {header("asOf", "As of")}
                {header("engine", "Engine")}
                {header("review", "Review")}
                <th>
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((question) => {
                const band = headlineBand(question);
                const review = reviewStateCopy[reviewState(question)];
                return (
                  <tr key={question.id} onClick={() => onOpen(question.id)}>
                    <td>
                      <button
                        type="button"
                        className="table-task"
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpen(question.id);
                        }}
                      >
                        <strong>{question.title}</strong>
                        <span>
                          {[question.family, question.unit].filter(Boolean).join(" · ") ||
                            provenanceLabel(question)}
                        </span>
                      </button>
                    </td>
                    <td>
                      <ResearchStatusBadge question={question} />
                      <small className="research-cell-note">
                        {question.runs.filter((run) => run.resolvedFrom).at(0)?.resolvedFrom ?? ""}
                      </small>
                    </td>
                    <td>
                      <strong className="research-band">{band.text}</strong>
                      {band.label && <small className="research-cell-note">{band.label}</small>}
                    </td>
                    <td>
                      {question.agreement.runsWithBand}/{question.agreement.runsTotal} banded
                      {question.agreement.lowRatio != null && question.agreement.highRatio != null && (
                        <small className="research-cell-note">
                          ×{question.agreement.lowRatio.toFixed(2)} low · ×
                          {question.agreement.highRatio.toFixed(2)} high
                        </small>
                      )}
                    </td>
                    <td className="research-nowrap">
                      {question.currency}
                      <small className="research-cell-note">GST {question.gstBasis}</small>
                    </td>
                    <td>{question.centre ?? "Not stated"}</td>
                    <td className="research-nowrap">{question.asOf ?? "—"}</td>
                    <td>
                      <span className="research-engine" title={researchEngineLabel(question.engine)}>
                        {researchEngineLabel(question.engine).split(" · ")[0]}
                      </span>
                      <small className="research-cell-note">{researchEngineName(question.engine)}</small>
                    </td>
                    <td>
                      <span className={`state-badge tone-${review.tone}`}>{review.label}</span>
                    </td>
                    <td>
                      <ArrowRight size={20} aria-hidden="true" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {!loading && !visible.length && (
        <p className="empty-state">
          {all.length
            ? "No questions match these filters."
            : "No questions yet. Ask one to start three runs."}
        </p>
      )}
    </div>
  );
}

function provenanceLabel(question: ResearchQuestion) {
  if (question.provenance === "live")
    return question.source?.kind === "external" ? `From ${question.source.provider}` : "Asked here";
  return {
    recorded: "Recorded question",
    "sample-activity": "Sample activity",
    "prototype-ask": "Asked in this tab",
  }[question.provenance];
}
