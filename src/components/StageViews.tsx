import {
  ArrowLeft,
  ArrowRight,
  Browser,
  CaretDown,
  Check,
  CheckCircle,
  CircleNotch,
  Code,
  FileCode,
  GitBranch,
  GitDiff,
  GitPullRequest,
  Play,
  Prohibit,
  ShieldCheck,
  Wrench,
  X,
  XCircle,
} from "@phosphor-icons/react";
import { createContext, useContext, useEffect, useState } from "react";
import { getCandidateDiff, type CandidateDiffResponse } from "../api";
import { acceptanceCriteria, type HarnessEvent, type TaskRunState, workflowStages } from "../domain";
import { Button, EvidenceState, ProviderTag, SectionHeader } from "./Primitives";

export interface StageViewProps {
  stageIndex: number;
  activeStageIndex: number;
  runState: TaskRunState;
  attempts: number;
  testResult: "running" | "passed" | "failed";
  taskId: string;
  taskTitle: string;
  taskDescription: string;
  candidateId: string;
  candidateSha: string;
  selectedEvent?: HarnessEvent;
  onAdvance: () => void;
  onAnswerComplete: () => void;
  onSendRepair: () => void;
  onRetryTest: () => void;
  onFailTest: () => void;
  onPassTest: () => void;
  onMarkBlocked: () => void;
  onResume: () => void;
  onApprove: () => void;
}

const TaskBriefContext = createContext({
  title: "",
  description: "",
  activeStageIndex: 0,
  viewedStageIndex: 0,
  candidateId: "C1",
  candidateSha: "a16f29d",
  taskId: "",
});

export function StageView(props: StageViewProps) {
  let view: React.ReactNode;
  switch (props.stageIndex) {
    case 0:
      view = <TriageView onAdvance={props.onAdvance} selectedEvent={props.selectedEvent} />;
      break;
    case 1:
      view = <ScoutsView onAdvance={props.onAdvance} selectedEvent={props.selectedEvent} />;
      break;
    case 2:
      view = <GrillView onComplete={props.onAnswerComplete} selectedEvent={props.selectedEvent} />;
      break;
    case 3:
      view = <SpecificationView onAdvance={props.onAdvance} selectedEvent={props.selectedEvent} />;
      break;
    case 4:
      view = <PlanView onAdvance={props.onAdvance} selectedEvent={props.selectedEvent} />;
      break;
    case 5:
      view = (
        <ImplementView
          onAdvance={props.onAdvance}
          repairing={props.runState === "repairing"}
          attempts={props.attempts}
          selectedEvent={props.selectedEvent}
          taskId={props.taskId}
          candidateId={props.candidateId}
          candidateSha={props.candidateSha}
        />
      );
      break;
    case 6:
      view = (
        <DevReviewView
          onAdvance={props.onAdvance}
          attempts={props.attempts}
          selectedEvent={props.selectedEvent}
          taskId={props.taskId}
          candidateId={props.candidateId}
          candidateSha={props.candidateSha}
        />
      );
      break;
    case 7:
      view = <TestView {...props} />;
      break;
    case 8:
      view = (
        <FinalReviewView
          onAdvance={props.onAdvance}
          attempts={props.attempts}
          selectedEvent={props.selectedEvent}
          taskId={props.taskId}
          candidateId={props.candidateId}
          candidateSha={props.candidateSha}
        />
      );
      break;
    default:
      view = (
        <ApprovalView
          state={props.runState}
          onApprove={props.onApprove}
          selectedEvent={props.selectedEvent}
          taskId={props.taskId}
          candidateId={props.candidateId}
          candidateSha={props.candidateSha}
        />
      );
  }
  return (
    <TaskBriefContext.Provider
      value={{
        title: props.taskTitle,
        description: props.taskDescription,
        activeStageIndex: props.activeStageIndex,
        viewedStageIndex: props.stageIndex,
        candidateId: props.candidateId,
        candidateSha: props.candidateSha,
        taskId: props.taskId,
      }}
    >
      {view}
    </TaskBriefContext.Provider>
  );
}

function StageCommandBar({
  label = "Next step",
  title,
  detail,
  tone = "ready",
  children,
}: {
  label?: string;
  title: string;
  detail: string;
  tone?: "ready" | "active" | "blocked" | "waiting";
  children: React.ReactNode;
}) {
  const StatusIcon = tone === "blocked" ? XCircle : tone === "active" ? CircleNotch : CheckCircle;
  return (
    <section className={`stage-command-bar stage-command-bar--${tone}`} aria-label="Stage actions">
      <StatusIcon size={18} weight="fill" className={tone === "active" ? "spin" : ""} />
      <span className="stage-command-bar__copy">
        <small>{label}</small>
        <strong>{title}</strong>
        <span>{detail}</span>
      </span>
      <div className="stage-command-bar__actions">{children}</div>
    </section>
  );
}

function CandidateBadge({ candidateId, candidateSha }: { candidateId: string; candidateSha: string }) {
  return (
    <span
      className="candidate-badge"
      role="img"
      aria-label={`Integration candidate ${candidateId}, ${candidateSha}`}
    >
      <GitBranch size={14} weight="bold" />
      <span>
        <small>Candidate</small>
        <strong>{candidateId}</strong>
      </span>
      <code>{candidateSha}</code>
    </span>
  );
}

function TriageView({ onAdvance, selectedEvent }: Pick<StageViewProps, "onAdvance" | "selectedEvent">) {
  return (
    <>
      <div className="stage-main">
        <SectionHeader
          eyebrow="Triage · Deterministic classification"
          title="Feature work with API surface change"
          description="The harness classifies scope and risk before any agent and model are selected."
        />
        <StageCommandBar
          title="Accept classification and start repository scouts"
          detail="This locks the workflow, risk gates, and required evidence before model routing begins."
        >
          <Button tone="primary" icon={ArrowRight} onClick={onAdvance}>
            Accept triage & start scouts
          </Button>
        </StageCommandBar>
        <div className="structured-list">
          <StructuredRow label="Task type" value="Feature" />
          <StructuredRow label="Severity" value="S2 · Moderate" tone="amber" />
          <StructuredRow label="Workflow" value="Investigate + Implement" />
          <StructuredRow label="Affected surfaces" value="Schema · API · UI · Tests" />
          <StructuredRow label="Risk gates" value="API contract · migration · browser behaviour" />
        </div>
        <div className="rationale-block">
          <strong>Routing rationale</strong>
          <p>
            Request changes persisted data and an external API contract, so repository evidence, explicit
            acceptance criteria, independent review, and deterministic tests are required.
          </p>
        </div>
      </div>
      <ContextInspector stage="triage" selectedEvent={selectedEvent} />
    </>
  );
}

function ScoutsView({ onAdvance, selectedEvent }: Pick<StageViewProps, "onAdvance" | "selectedEvent">) {
  const [openFinding, setOpenFinding] = useState(0);
  const findings = [
    {
      file: "src/db/schema.ts:42",
      title: "Task records have no priority field",
      detail: "pgTable tasks defines status, title, and timestamps.",
      snippet:
        'status: text("status").notNull(),\ntitle: text("title").notNull(),\ncreatedAt: timestamp("created_at")',
    },
    {
      file: "src/api/tasks.ts:88",
      title: "Create route uses parsed body directly",
      detail: "Defaulting belongs in the schema boundary.",
      snippet: "const parsed = createTaskSchema.parse(req.body);\nreturn db.insert(tasks).values(parsed);",
    },
    {
      file: "src/ui/TaskListItem.tsx:112",
      title: "Status badges establish the visual pattern",
      detail: "Existing badge tokens can carry priority semantics.",
      snippet: '<StatusBadge tone={task.status} />\n<span className="task-title">{task.title}</span>',
    },
    {
      file: "tests/api/tasks.test.ts:31",
      title: "API contract tests use request fixtures",
      detail: "Add valid, omitted, and invalid priority cases.",
      snippet: 'await request(app).post("/tasks").send(validTask);\nexpect(response.status).toBe(201);',
    },
  ];
  return (
    <>
      <div className="stage-main">
        <SectionHeader
          eyebrow="Repository scouts · 3 parallel scouts"
          title="Evidence before assumptions"
          description="142 files inspected · 4 relevant findings · no write access"
          action={<ProviderTag provider="codex" model="Codex 1.2 Mini" />}
        />
        <StageCommandBar
          title="Record the retained findings and begin clarification"
          detail="The four cited findings become read-only inputs to Grill and the eventual task specification."
        >
          <Button tone="primary" icon={ArrowRight} onClick={onAdvance}>
            Record evidence & start Grill
          </Button>
        </StageCommandBar>
        <div className="finding-list">
          {findings.map((finding, index) => (
            <div
              className={`finding-item ${openFinding === index ? "finding-item--open" : ""}`}
              key={finding.file}
            >
              <button
                type="button"
                className="finding-row"
                aria-expanded={openFinding === index}
                onClick={() => setOpenFinding(openFinding === index ? -1 : index)}
              >
                <span className="finding-row__index">{String(index + 1).padStart(2, "0")}</span>
                <span>
                  <code>{finding.file}</code>
                  <strong>{finding.title}</strong>
                  <small>{finding.detail}</small>
                </span>
                <ArrowRight size={15} />
              </button>
              {openFinding === index ? (
                <div className="finding-evidence">
                  <span>Scout evidence · read-only</span>
                  <pre>
                    <code>{finding.snippet}</code>
                  </pre>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
      <ContextInspector stage="scouts" selectedEvent={selectedEvent} />
    </>
  );
}

function SpecificationView({
  onAdvance,
  selectedEvent,
}: Pick<StageViewProps, "onAdvance" | "selectedEvent">) {
  const [tab, setTab] = useState<"spec" | "stories" | "decisions" | "scope">("spec");
  return (
    <>
      <div className="stage-main">
        <SectionHeader
          eyebrow="Task specification · to-spec · v1"
          title="Settled context synthesized into a complete specification"
          description="No second interview: the spec carries Grill decisions, domain language, and repository evidence forward."
        />
        <StageCommandBar
          title="Approve the specification and generate dependency-aware work"
          detail="Approval freezes the five acceptance criteria and their verification seams for planning."
        >
          <Button tone="primary" icon={ArrowRight} onClick={onAdvance}>
            Approve spec & create tickets
          </Button>
        </StageCommandBar>
        <div className="spec-tabs" role="tablist" aria-label="Specification sections">
          {[
            ["spec", "Specification"],
            ["stories", "User stories"],
            ["decisions", "Decisions & seams"],
            ["scope", "Scope"],
          ].map(([id, label]) => (
            <button
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? "selected" : ""}
              onClick={() => setTab(id as typeof tab)}
              key={id}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === "spec" ? (
          <>
            <div className="spec-summary-grid">
              <section>
                <span>Problem statement</span>
                <p>
                  Tasks have no explicit priority, so API consumers and operators cannot communicate urgency
                  consistently.
                </p>
              </section>
              <section>
                <span>Solution</span>
                <p>
                  Add a constrained priority value with a medium default, expose it through the API, and
                  render a quiet badge.
                </p>
              </section>
            </div>
            <div className="criteria-table criteria-table--compact">
              <div className="criteria-table__header">
                <span>ID</span>
                <span>Acceptance criterion</span>
                <span>Verification</span>
                <span>State</span>
              </div>
              {acceptanceCriteria.map((criterion, index) => (
                <div className="criteria-table__row" key={criterion}>
                  <code>AC-{index + 1}</code>
                  <strong>{criterion}</strong>
                  <span>{index === 3 ? "Browser + unit" : index === 2 ? "API contract" : "Unit test"}</span>
                  <span>
                    <EvidenceState tone="passed" /> Settled
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : null}
        {tab === "stories" ? (
          <div className="spec-document-list">
            {acceptanceCriteria.map((criterion, index) => (
              <div key={criterion}>
                <code>US-{index + 1}</code>
                <p>
                  As a repository operator, I want to {criterion.toLowerCase()}, so task urgency stays
                  explicit and verifiable.
                </p>
              </div>
            ))}
          </div>
        ) : null}
        {tab === "decisions" ? (
          <div className="spec-document-list">
            <div>
              <code>D-01</code>
              <p>Priority is optional on create and defaults to medium at the schema seam.</p>
            </div>
            <div>
              <code>D-02</code>
              <p>
                The task API is the highest stable test seam; UI behavior is verified through the task row.
              </p>
            </div>
            <div>
              <code>D-03</code>
              <p>The badge is quiet, text-labelled, and never replaces deterministic workflow status.</p>
            </div>
            <div>
              <code>TEST</code>
              <p>Use independent literals for low, medium, high, omitted, and invalid values.</p>
            </div>
          </div>
        ) : null}
        {tab === "scope" ? (
          <div className="spec-summary-grid">
            <section>
              <span>Out of scope</span>
              <p>
                Priority scheduling, automatic escalation, project policy inheritance, and bulk migration
                controls.
              </p>
            </section>
            <section>
              <span>Further notes</span>
              <p>
                No model routing is introduced. Existing API clients remain compatible because omitted
                priority defaults safely.
              </p>
            </section>
          </div>
        ) : null}
      </div>
      <ContextInspector stage="specification" selectedEvent={selectedEvent} />
    </>
  );
}

function GrillView({ onComplete, selectedEvent }: { onComplete: () => void; selectedEvent?: HarnessEvent }) {
  const questions = [
    {
      question: "Should priority be required in API create requests?",
      recommended: "No — default to medium",
      rationale: "Preserves existing creation behaviour and keeps client integrations simple.",
      choices: [
        "No — default to medium",
        "Yes — require explicit value",
        "Inherit from project policy",
        "Custom answer",
      ],
    },
    {
      question: "How should priority be shown in compact task rows?",
      recommended: "A quiet coloured label",
      rationale: "Keeps priority scannable without competing with deterministic workflow status.",
      choices: ["A quiet coloured label", "Coloured text only", "Icon and tooltip", "Custom answer"],
    },
  ];
  const [questionIndex, setQuestionIndex] = useState(0);
  const [choice, setChoice] = useState(questions[0]?.recommended ?? "");
  const [decisions, setDecisions] = useState(["Values · low / medium / high"]);
  const question = questions[questionIndex] ?? questions[0];
  if (!question) return null;
  const advanceQuestion = () => {
    const nextDecisions = [
      ...decisions,
      questionIndex === 0 ? "API create · optional, defaults medium" : "Badge · quiet coloured label",
    ];
    setDecisions(nextDecisions);
    if (questionIndex < questions.length - 1) {
      const nextIndex = questionIndex + 1;
      setQuestionIndex(nextIndex);
      setChoice(questions[nextIndex]?.recommended ?? "");
    } else {
      onComplete();
    }
  };
  return (
    <>
      <div className="stage-main grill-main">
        <SectionHeader
          eyebrow="Grill with docs · One question at a time"
          title={question.question}
          description="The interview keeps going until the decision frontier is clear; it does not promise a fixed question count."
        />
        <StageCommandBar
          label="Decision required"
          title={
            questionIndex === questions.length - 1
              ? "Finish the decision frontier"
              : "Record this answer and ask the next question"
          }
          detail="Answers are written into CONTEXT.md as you go; the selected choice below is ready to record."
          tone="waiting"
        >
          <Button tone="primary" icon={Check} onClick={advanceQuestion}>
            {questionIndex === questions.length - 1 ? "Use answer & build specification" : "Use answer"}
          </Button>
        </StageCommandBar>
        <div className="recommendation">
          <span>Recommended answer</span>
          <strong>{question.recommended}</strong>
          <p>{question.rationale}</p>
        </div>
        <div className="evidence-strip">
          <div className="evidence-strip__title">
            <ShieldCheck size={16} weight="fill" />
            Repository evidence <span>Deterministic scout output</span>
          </div>
          <div className="evidence-code">
            <div>
              <a href="#src-api">src/api/tasks.ts:88</a>
              <code>
                const priority = body.priority ?? <em>"medium"</em>
                {";"}
              </code>
            </div>
            <div>
              <a href="#src-db">src/db/schema.ts:42</a>
              <code>
                .default(<em>"medium"</em>).notNull()
              </code>
            </div>
          </div>
        </div>
        <fieldset className="answer-list">
          <legend className="sr-only">Choose an answer</legend>
          {question.choices.map((item, index) => (
            <label className={choice === item ? "selected" : ""} key={item}>
              <input
                type="radio"
                name="grill-answer"
                checked={choice === item}
                onChange={() => setChoice(item)}
              />
              <span>
                <strong>
                  {item}
                  {index === 0 ? " (recommended)" : ""}
                </strong>
                <small>
                  {index === 0
                    ? "Use medium when no value is provided."
                    : index === 1
                      ? "Reject requests that omit priority."
                      : index === 2
                        ? "Read a repository-level default."
                        : "Provide different guidance."}
                </small>
              </span>
            </label>
          ))}
        </fieldset>
      </div>
      <ContextInspector stage="grill" selectedEvent={selectedEvent}>
        <InspectorSection title="Decision frontier">
          <div className="decision-list decision-list--nested">
            {decisions.map((decision, index) => (
              <div className="decision-item decision-item--complete" key={decision}>
                <EvidenceState tone="passed" />
                <span>
                  <small>Settled · Q{index + 1}</small>
                  <strong>{decision}</strong>
                </span>
              </div>
            ))}
            <div className="decision-item decision-item--active">
              <EvidenceState tone="pending" />
              <span>
                <small>Open now</small>
                <strong>{question.question}</strong>
              </span>
            </div>
            <div className="decision-item">
              <EvidenceState tone="pending" />
              <span>
                <small>Adaptive frontier</small>
                <strong>
                  {questionIndex === 0
                    ? "Badge treatment may still need a decision"
                    : "No known ambiguity after this answer"}
                </strong>
              </span>
            </div>
          </div>
        </InspectorSection>
        <InspectorSection
          title="Specification readiness"
          meta={questionIndex === 0 ? "1 open decision" : "Ready after answer"}
        >
          <div className="progress-line">
            <span style={{ width: questionIndex === 0 ? "66%" : "88%" }} />
          </div>
          <small className="muted-note">
            The skill decides whether another question is useful after each answer.
          </small>
        </InspectorSection>
      </ContextInspector>
    </>
  );
}

function PlanView({ onAdvance, selectedEvent }: Pick<StageViewProps, "onAdvance" | "selectedEvent">) {
  const [openSlice, setOpenSlice] = useState("S1");
  const slices = [
    {
      id: "S1",
      batch: 1,
      title: "Persist priority",
      status: "Ready",
      files: "src/db/schema.ts · migrations/0042_priority.sql",
      owner: "Schema agent",
      model: "Codex 1.2 · High",
      dependency: "None",
      purpose: "Create the constrained persistence seam without changing existing task creation behavior.",
      change: "Add TaskPriority enum, a non-null priority field, and a medium database default.",
      produces: "TaskPriority type · priority column",
      consumes: "Existing tasks table",
      verify: "pnpm vitest run tests/db/task-schema.test.ts",
      cost: "$0.12",
    },
    {
      id: "S2",
      batch: 2,
      title: "Expose API contract",
      status: "Blocked",
      files: "src/api/routes/tasks.ts · src/api/types.ts",
      owner: "API agent",
      model: "Codex 1.2 · High",
      dependency: "S1",
      purpose: "Carry the approved priority contract through create and read APIs.",
      change: "Accept low, medium, or high; default omission; reject invalid values before persistence.",
      produces: "CreateTaskInput · TaskResponse.priority",
      consumes: "S1 · TaskPriority type",
      verify: "pnpm vitest run tests/api/priority.test.ts",
      cost: "$0.16",
    },
    {
      id: "S3",
      batch: 2,
      title: "Render priority badge",
      status: "Blocked",
      files: "src/ui/PriorityBadge.tsx · src/ui/TaskListItem.tsx",
      owner: "UI agent",
      model: "Codex 1.2 Mini · Medium",
      dependency: "S1",
      purpose: "Make urgency scannable without competing with deterministic workflow status.",
      change: "Add the quiet text-labelled badge and render it in compact task rows.",
      produces: "PriorityBadge component",
      consumes: "S1 · TaskPriority type",
      verify: "pnpm playwright test task-priority.spec.ts",
      cost: "$0.14",
    },
    {
      id: "INT",
      batch: 3,
      title: "Assemble integration candidate",
      status: "Gate",
      files: ".worktrees/gh-241/integration · merge-queue.json",
      owner: "Integration orchestrator",
      model: "Deterministic harness",
      dependency: "S1 + S2 + S3",
      purpose:
        "Create the only candidate that can enter authoritative Dev Review and the complete Test gate.",
      change:
        "Apply ready slice commits in dependency order, detect overlap, and record a versioned merged diff.",
      produces: "Candidate C1 · merged diff · provenance manifest",
      consumes: "S1 81ac09f · S2 4f7e2bd · S3 962e11a",
      verify: "pnpm verify:candidate --scope integration",
      cost: "$0.02",
    },
  ];
  const batches = [1, 2, 3];
  return (
    <>
      <div className="stage-main">
        <SectionHeader
          eyebrow="Implementation plan · 3 worktree slices + 1 integration gate"
          title="Slices qualify in isolation; the merged candidate earns the final verdict"
          description="Dependencies, file ownership, worktree outputs, and the authoritative integration boundary are explicit before implementation."
        />
        <StageCommandBar
          title="Approve the plan and create three isolated worktrees"
          detail="The orchestrator will qualify each slice, then assemble Candidate C1 in a dedicated integration worktree."
        >
          <Button tone="primary" icon={Play} onClick={onAdvance}>
            Approve plan & start worktrees
          </Button>
        </StageCommandBar>
        <section className="plan-flow" aria-label="Implementation dependency flow">
          {batches.map((batch, batchIndex) => (
            <div className="plan-batch-wrap" key={batch}>
              <section className="plan-batch">
                <header className="plan-batch__header">
                  <span>Batch {batch}</span>
                  <strong>
                    {batch === 1 ? "Foundation" : batch === 2 ? "Parallel feature work" : "Integration gate"}
                  </strong>
                  <small>
                    {batch === 1
                      ? "Starts immediately"
                      : batch === 2
                        ? "S2 and S3 can run together"
                        : "Runs after prior dependencies pass"}
                  </small>
                </header>
                <div
                  className={`plan-batch__packages ${batch === 2 ? "plan-batch__packages--parallel" : ""}`}
                >
                  {slices
                    .filter((slice) => slice.batch === batch)
                    .map((slice) => {
                      const open = openSlice === slice.id;
                      return (
                        <article
                          className={`plan-package ${open ? "plan-package--open" : ""}`}
                          key={slice.id}
                        >
                          <button
                            type="button"
                            className="plan-package__summary"
                            aria-expanded={open}
                            aria-controls={`plan-${slice.id}`}
                            onClick={() => setOpenSlice(open ? "" : slice.id)}
                          >
                            <span className="plan-package__identity">
                              <code>{slice.id}</code>
                              <span>
                                <strong>{slice.title}</strong>
                                <small>{slice.files}</small>
                              </span>
                            </span>
                            <span className={`plan-status plan-status--${slice.status.toLowerCase()}`}>
                              {slice.status}
                            </span>
                            <span className="plan-package__meta">
                              <small>{slice.model}</small>
                              <small>
                                Depends on {slice.dependency} · {slice.cost}
                              </small>
                            </span>
                            <CaretDown size={15} weight="bold" />
                          </button>
                          {open ? (
                            <div className="plan-package__details" id={`plan-${slice.id}`}>
                              <div>
                                <span>Purpose</span>
                                <p>{slice.purpose}</p>
                              </div>
                              <div>
                                <span>Exact change</span>
                                <p>{slice.change}</p>
                              </div>
                              <dl>
                                <div>
                                  <dt>Agent</dt>
                                  <dd>{slice.owner}</dd>
                                </div>
                                <div>
                                  <dt>Produces</dt>
                                  <dd>{slice.produces}</dd>
                                </div>
                                <div>
                                  <dt>Consumes</dt>
                                  <dd>{slice.consumes}</dd>
                                </div>
                                <div>
                                  <dt>Verify</dt>
                                  <dd>
                                    <code>{slice.verify}</code>
                                  </dd>
                                </div>
                              </dl>
                            </div>
                          ) : null}
                        </article>
                      );
                    })}
                </div>
              </section>
              {batchIndex < batches.length - 1 ? (
                <div
                  className="plan-connector"
                  role="note"
                  aria-label={batch === 1 ? "S1 unblocks S2 and S3" : "Ready slices unblock integration"}
                >
                  <ArrowRight size={16} weight="bold" />
                  <span>{batch === 1 ? "S1 unblocks S2 + S3" : "S1 + S2 + S3 converge on Candidate C1"}</span>
                </div>
              ) : null}
            </div>
          ))}
        </section>
        <div className="plan-frontier">
          <span>Ready frontier</span>
          <strong>S1 · Persist priority</strong>
          <small>Execution order: S1 → S2 + S3 in parallel → assemble Candidate C1.</small>
        </div>
      </div>
      <ContextInspector stage="plan" selectedEvent={selectedEvent} />
    </>
  );
}

function ImplementView({
  onAdvance,
  repairing,
  attempts,
  selectedEvent,
  candidateId,
  candidateSha,
}: {
  onAdvance: () => void;
  repairing: boolean;
  attempts: number;
  selectedEvent?: HarnessEvent;
  candidateId: string;
  candidateSha: string;
}) {
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(repairing ? "integration" : null);
  const [showDiff, setShowDiff] = useState(false);
  const [diffScope, setDiffScope] = useState<"package" | "candidate">("candidate");
  const [activeDiffFile, setActiveDiffFile] = useState("src/api/routes/tasks.ts");
  const slices = [
    {
      kind: "slice" as const,
      id: "S1",
      batch: 1,
      title: "Persist priority",
      status: "ready",
      agent: "Schema agent",
      provider: "codex" as const,
      model: "Codex 1.2 · High",
      dependency: "None",
      files: "2 files",
      tokens: "4.8k",
      cost: "$0.12",
      worktree: "wt-schema",
      commit: "81ac09f",
    },
    {
      kind: "slice" as const,
      id: "S2",
      batch: 2,
      title: "Expose API contract",
      status: "ready",
      agent: "API agent",
      provider: "codex" as const,
      model: "Codex 1.2 · High",
      dependency: "S1",
      files: "2 files",
      tokens: "6.2k",
      cost: "$0.16",
      worktree: "wt-api",
      commit: "4f7e2bd",
    },
    {
      kind: "slice" as const,
      id: "S3",
      batch: 2,
      title: "Render priority badge",
      status: "ready",
      agent: "UI agent",
      provider: "codex" as const,
      model: "Codex 1.2 Mini · Medium",
      dependency: "S1",
      files: "2 files",
      tokens: "5.9k",
      cost: "$0.14",
      worktree: "wt-ui",
      commit: "962e11a",
    },
  ];
  const candidate = {
    kind: "integration" as const,
    id: candidateId,
    batch: 3,
    title: repairing ? `${candidateId} · Repair candidate` : `${candidateId} · Integration candidate`,
    status: repairing ? "repairing" : "assembling",
    agent: repairing ? "Integration repair agent" : "Integration orchestrator",
    provider: "harness" as const,
    model: "Deterministic merge harness",
    dependency: "S1 + S2 + S3",
    files: repairing ? "2 repaired · 6 candidate files" : "6 candidate files",
    tokens: repairing ? "2.7k" : "No model tokens",
    cost: repairing ? "$0.08" : "$0.02",
    worktree: ".worktrees/gh-241/integration",
    commit: candidateSha,
  };
  const selectedPackage =
    selectedPackageId === "integration"
      ? candidate
      : (slices.find((item) => item.id === selectedPackageId) ?? null);
  const qualityRows = [
    ["Correctness", "12 / 15"],
    ["Security", "10 / 10"],
    ["Error handling", "9 / 10"],
    ["Maintainability", "11 / 15"],
    ["Repository fit", "13 / 15"],
    ["Test quality", "11 / 15"],
    ["Performance", "8 / 10"],
    ["Scope discipline", "8 / 10"],
  ];
  const diffFiles = [
    { name: "src/api/routes/tasks.ts", change: "+18 −4" },
    { name: "src/db/schema.ts", change: "+9 −1" },
    { name: "tests/api/priority.test.ts", change: "+24 −3" },
  ];
  const diffLines = [
    { tone: "context", line: "88", value: " const parsed = createTaskSchema.parse(req.body);" },
    { tone: "remove", line: "89", value: "-return db.insert(tasks).values(parsed);" },
    { tone: "add", line: "89", value: '+const priority = parsed.priority ?? "medium";' },
    { tone: "add", line: "90", value: "+assertTaskPriority(priority);" },
    { tone: "add", line: "91", value: "+return db.insert(tasks).values({ ...parsed, priority });" },
    { tone: "context", line: "92", value: " " },
    { tone: "add", line: "93", value: "+// Invalid values are rejected before persistence." },
  ];
  return (
    <>
      <div className="stage-main">
        {showDiff && selectedPackage ? (
          <div className="diff-view">
            <button type="button" className="stage-back-link" onClick={() => setShowDiff(false)}>
              <ArrowLeft size={14} /> Implement / {selectedPackage.id} / Diff
            </button>
            <SectionHeader
              eyebrow={`Live patch · ${selectedPackage.id} · ${diffScope === "package" ? "selected slice" : "merged candidate"}`}
              title="Inline code diff"
              description="This diff is tied to a versioned candidate; later review and test verdicts must reference the same revision."
              action={<CandidateBadge candidateId={candidateId} candidateSha={candidateSha} />}
            />
            <StageCommandBar
              title={`Send ${candidateId} to fresh-context Dev Review`}
              detail="The reviewer receives the merged diff, specification, and provenance manifest without implementation reasoning."
            >
              <Button tone="primary" icon={ArrowRight} onClick={onAdvance}>
                Send {candidateId} to Dev Review
              </Button>
              <Button tone="secondary" icon={ArrowLeft} onClick={() => setShowDiff(false)}>
                Back to candidate
              </Button>
            </StageCommandBar>
            <fieldset className="diff-scope">
              <legend className="sr-only">Diff scope</legend>
              <button
                type="button"
                className={diffScope === "package" ? "selected" : ""}
                onClick={() => setDiffScope("package")}
              >
                This package
              </button>
              <button
                type="button"
                className={diffScope === "candidate" ? "selected" : ""}
                onClick={() => setDiffScope("candidate")}
              >
                Merged candidate {candidateId}
              </button>
            </fieldset>
            <div className="diff-workspace">
              <nav className="diff-files" aria-label="Changed files">
                <header>Changed files</header>
                {diffFiles.map((file) => (
                  <button
                    type="button"
                    className={activeDiffFile === file.name ? "selected" : ""}
                    onClick={() => setActiveDiffFile(file.name)}
                    key={file.name}
                  >
                    <FileCode size={14} />
                    <span>{file.name}</span>
                    <small>{file.change}</small>
                  </button>
                ))}
              </nav>
              <section className="diff-code">
                <header>
                  <code>{activeDiffFile}</code>
                  <span>Unified diff</span>
                </header>
                <pre>
                  <code>
                    {diffLines.map((line) => (
                      <span
                        className={`diff-line diff-line--${line.tone}`}
                        key={`${line.line}-${line.value}`}
                      >
                        <i>{line.line}</i>
                        {line.value}
                      </span>
                    ))}
                  </code>
                </pre>
              </section>
            </div>
          </div>
        ) : selectedPackage ? (
          <div className="implementation-detail">
            <button type="button" className="stage-back-link" onClick={() => setSelectedPackageId(null)}>
              <ArrowLeft size={14} /> All work packages / {selectedPackage.id}
            </button>
            <SectionHeader
              eyebrow={
                selectedPackage.kind === "integration"
                  ? `Implement · Integration boundary · ${candidateId}`
                  : `Implement · Batch ${selectedPackage.batch} · ${selectedPackage.id}`
              }
              title={selectedPackage.title}
              description={
                selectedPackage.kind === "integration"
                  ? "The orchestrator applies qualified slice commits into a dedicated worktree. This merged revision is the only result that can pass review and tests."
                  : `${selectedPackage.agent} owns this isolated worktree. Its result is ready for integration, not yet task-level passed.`
              }
              action={
                selectedPackage.kind === "integration" ? (
                  <CandidateBadge candidateId={candidateId} candidateSha={candidateSha} />
                ) : (
                  <ProviderTag provider={selectedPackage.provider} model={selectedPackage.model} />
                )
              }
            />
            <StageCommandBar
              title={
                selectedPackage.kind === "integration"
                  ? `Send ${candidateId} to fresh-context Dev Review`
                  : "Return to the integration overview"
              }
              detail={
                selectedPackage.kind === "integration"
                  ? "The complete merged candidate, not an individual slice, receives the authoritative review and Test gate."
                  : `${selectedPackage.id} passed its owned qualification checks and is ready to be included in ${candidateId}.`
              }
              tone={selectedPackage.kind === "integration" && !repairing ? "active" : "ready"}
            >
              {selectedPackage.kind === "integration" ? (
                <Button tone="primary" icon={ArrowRight} onClick={onAdvance}>
                  Send {candidateId} to Dev Review
                </Button>
              ) : (
                <Button tone="primary" icon={ArrowLeft} onClick={() => setSelectedPackageId(null)}>
                  Back to integration overview
                </Button>
              )}
              <Button tone="secondary" icon={GitDiff} onClick={() => setShowDiff(true)}>
                Inspect {selectedPackage.kind === "integration" ? "merged" : "slice"} diff
              </Button>
            </StageCommandBar>
            {repairing && selectedPackage.kind === "integration" ? (
              <div className="repair-banner">
                <Wrench size={18} weight="fill" />
                <span>
                  <strong>
                    {candidateId} created from repair run {attempts} of 3
                  </strong>
                  <small>
                    PKT-0094 changed the candidate; all affected C1 review and test verdicts are now stale.
                  </small>
                </span>
              </div>
            ) : null}
            {selectedPackage.kind === "integration" ? (
              <>
                <div className="candidate-detail-grid">
                  <div>
                    <span>Integration worktree</span>
                    <strong>.worktrees/gh-241/integration</strong>
                  </div>
                  <div>
                    <span>Base</span>
                    <strong>main@9b6c0fa</strong>
                  </div>
                  <div>
                    <span>Candidate revision</span>
                    <strong>{candidateSha}</strong>
                  </div>
                  <div>
                    <span>Conflicts / overlap</span>
                    <strong>0 / 0 files</strong>
                  </div>
                </div>
                <section className="merge-queue" aria-label="Integration merge queue">
                  <header>
                    <span>Merge queue</span>
                    <strong>S1 → S2 → S3</strong>
                    <small>Topological order · candidate manifest retained</small>
                  </header>
                  {slices.map((slice, index) => (
                    <button type="button" onClick={() => setSelectedPackageId(slice.id)} key={slice.id}>
                      <span>{index + 1}</span>
                      <strong>
                        {slice.id} · {slice.title}
                      </strong>
                      <code>{slice.commit}</code>
                      <small>{slice.worktree}</small>
                      <span className="badge badge--success">Applied</span>
                    </button>
                  ))}
                </section>
                <div className="run-steps">
                  <RunStep
                    status="done"
                    title="Slice manifests validated"
                    detail="Owned files, base commits, and qualification evidence"
                    meta="3s"
                  />
                  <RunStep
                    status="done"
                    title="Commits applied in dependency order"
                    detail="81ac09f → 4f7e2bd → 962e11a"
                    meta="9s"
                  />
                  <RunStep
                    status="done"
                    title="Overlap and conflict scan passed"
                    detail="No two slices modified the same owned path"
                    meta="4s"
                  />
                  <RunStep
                    status="active"
                    title={
                      repairing ? "Rebuilding repaired candidate evidence" : "Packaging candidate evidence"
                    }
                    detail="Merged diff · provenance · affected gate map"
                    meta="running"
                  />
                </div>
              </>
            ) : (
              <>
                <div className="package-detail-meta">
                  <StructuredRow label="Depends on" value={selectedPackage.dependency} />
                  <StructuredRow label="Isolated worktree" value={selectedPackage.worktree} />
                  <StructuredRow label="Ready commit" value={selectedPackage.commit} />
                  <StructuredRow label="Owned scope" value={selectedPackage.files} />
                  <StructuredRow
                    label="Usage"
                    value={`${selectedPackage.tokens} tokens · ${selectedPackage.cost}`}
                  />
                </div>
                <div className="run-steps">
                  <RunStep
                    status="done"
                    title="Package context loaded"
                    detail="Approved ticket, dependency outputs, and owned files"
                    meta="3s"
                  />
                  <RunStep
                    status="done"
                    title="RED · acceptance seam reproduced"
                    detail="Targeted contract failed before the owned patch"
                    meta="6s"
                  />
                  <RunStep
                    status="done"
                    title="GREEN · minimal owned patch"
                    detail={`${selectedPackage.files} changed · commit ${selectedPackage.commit}`}
                    meta="1m 52s"
                  />
                  <RunStep
                    status="done"
                    title="Slice qualification passed"
                    detail="Owned tests · lint · typecheck · contract checks"
                    meta="11s"
                  />
                </div>
                <section className="quality-self-score">
                  <header>
                    <span>Developer self-score · 8-part rubric</span>
                    <strong>82 / 100</strong>
                  </header>
                  <div>
                    {qualityRows.map(([label, score]) => (
                      <span key={label}>
                        <small>{label}</small>
                        <strong>{score}</strong>
                      </span>
                    ))}
                  </div>
                  <p>
                    Advisory only. A ready slice is not task-level passed until the merged candidate clears
                    independent review and tests.
                  </p>
                </section>
              </>
            )}
          </div>
        ) : (
          <div className="implementation-overview">
            <SectionHeader
              eyebrow={
                repairing
                  ? `Implement · Repair run ${attempts} of 3`
                  : "Implement · Isolated slices + integration"
              }
              title={
                repairing
                  ? `${candidateId} rebuilding from a targeted repair`
                  : `3 of 3 slices ready · ${candidateId} assembling`
              }
              description="Each slice qualifies inside its own worktree. The integration candidate below is the only revision that advances to authoritative review and tests."
              action={<CandidateBadge candidateId={candidateId} candidateSha={candidateSha} />}
            />
            <StageCommandBar
              label={repairing ? "Repair in progress" : "Integration in progress"}
              title={`Open ${candidateId} merge queue and candidate evidence`}
              detail="Inspect included commits, merge order, conflicts, provenance, and the complete merged diff before advancing."
              tone="active"
            >
              <Button tone="primary" icon={GitBranch} onClick={() => setSelectedPackageId("integration")}>
                Open {candidateId} merge queue
              </Button>
              <Button
                tone="secondary"
                icon={GitDiff}
                onClick={() => {
                  setSelectedPackageId("integration");
                  setShowDiff(true);
                }}
              >
                Inspect merged diff
              </Button>
            </StageCommandBar>
            <div className="package-flow-summary">
              <span>Batch 1 · S1</span>
              <ArrowRight size={15} />
              <span>Batch 2 · S2 + S3 parallel</span>
              <ArrowRight size={15} />
              <span className="active">Integration · {candidateId} assembling</span>
            </div>
            <div className="work-package-list">
              {slices.map((item) => {
                return (
                  <button
                    type="button"
                    className={`work-package work-package--${item.status}`}
                    onClick={() => setSelectedPackageId(item.id)}
                    key={item.id}
                  >
                    <span className="work-package__state">
                      <CheckCircle size={18} weight="fill" />
                    </span>
                    <span className="work-package__title">
                      <code>{item.id}</code>
                      <span>
                        <strong>{item.title}</strong>
                        <small>
                          {item.worktree} · commit {item.commit} · ready for integration
                        </small>
                      </span>
                    </span>
                    <ProviderTag provider={item.provider} model={item.model} />
                    <span className="work-package__usage">
                      <strong>{item.tokens}</strong>
                      <small>
                        {item.cost} · {item.files}
                      </small>
                    </span>
                    <ArrowRight size={15} />
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              className={`integration-candidate integration-candidate--${candidate.status}`}
              onClick={() => setSelectedPackageId("integration")}
            >
              <span className="integration-candidate__state">
                <CircleNotch size={19} className="spin" />
              </span>
              <span>
                <small>Authoritative integration boundary</small>
                <strong>{candidate.title}</strong>
                <span>S1 81ac09f → S2 4f7e2bd → S3 962e11a</span>
              </span>
              <span className="integration-candidate__meta">
                <strong>{candidateSha}</strong>
                <small>0 conflicts · 6 files</small>
              </span>
              <ArrowRight size={16} />
            </button>
          </div>
        )}
      </div>
      <ContextInspector stage="implement" attempts={attempts} selectedEvent={selectedEvent} />
    </>
  );
}

function DevReviewView({
  onAdvance,
  attempts,
  selectedEvent,
  candidateId,
  candidateSha,
}: Pick<StageViewProps, "onAdvance" | "attempts" | "selectedEvent" | "candidateId" | "candidateSha">) {
  return (
    <>
      <div className="stage-main">
        <SectionHeader
          eyebrow="Dev review · Fresh-context code advisor"
          title={`${candidateId} has no blocking findings`}
          description="A separate reviewer inspected the merged candidate for correctness, security, edge cases, design, and performance without implementation reasoning."
          action={
            <span className="header-identity-stack">
              <CandidateBadge candidateId={candidateId} candidateSha={candidateSha} />
              <ProviderTag provider="codex" model="Codex 1.2 · Medium" />
            </span>
          }
        />
        <StageCommandBar
          title={`Send reviewed candidate ${candidateId} to deterministic tests`}
          detail="The complete Test gate will run against the exact same candidate revision; any later repair invalidates affected verdicts."
        >
          <Button tone="primary" icon={ArrowRight} onClick={onAdvance}>
            Send {candidateId} to tests
          </Button>
          <Button tone="secondary" icon={GitDiff}>
            Inspect merged diff
          </Button>
        </StageCommandBar>
        {attempts > 1 ? (
          <div className="repair-lineage">
            <Wrench size={18} weight="fill" />
            <span>
              <strong>Reviewed after repair run {attempts}</strong>
              <small>C1 superseded → {candidateId} · PKT-0094 resolved before the fresh review started</small>
            </span>
            <span className="badge badge--success">Repaired</span>
          </div>
        ) : null}
        <div className="review-verdict review-verdict--detailed">
          <CheckCircle size={28} weight="fill" />
          <span>
            <strong>Verdict · no blockers</strong>
            <small>One non-blocking P2 suggestion is recorded with a file, line, and proposed change.</small>
          </span>
          <section className="severity-counts" aria-label="Finding counts">
            <span>
              <small>P0</small>
              <strong>0</strong>
            </span>
            <span>
              <small>P1</small>
              <strong>0</strong>
            </span>
            <span>
              <small>P2</small>
              <strong>1</strong>
            </span>
            <span>
              <small>P3</small>
              <strong>0</strong>
            </span>
          </section>
        </div>
        <div className="review-findings">
          <div>
            <span className="badge badge--neutral">P2</span>
            <span>
              <strong>Maintainability · extract priority colours into semantic tokens</strong>
              <small>
                src/ui/PriorityBadge.tsx:18 · suggestion: map low, medium, and high through the existing badge
                token table
              </small>
            </span>
          </div>
          <div>
            <span className="badge badge--success">Passed</span>
            <span>
              <strong>Correctness · API default matches the approved decision</strong>
              <small>
                src/api/routes/tasks.ts:94 · omission defaults to medium and invalid values fail before writes
              </small>
            </span>
          </div>
          <div>
            <span className="badge badge--success">Passed</span>
            <span>
              <strong>Security and scope · no untrusted value reaches persistence</strong>
              <small>6 of 6 changed paths are owned by the approved work packages</small>
            </span>
          </div>
        </div>
        <div className="revision-policy">
          <span>
            <strong>Revision allowance</strong>
            <small>One focused revision turn may be requested for blocking findings.</small>
          </span>
          <strong>1 available · unused</strong>
        </div>
      </div>
      <ContextInspector stage="dev-review" attempts={attempts} selectedEvent={selectedEvent}>
        {attempts > 1 ? (
          <InspectorSection title="Repair lineage">
            <StructuredRow label="Failure packet" value="PKT-0094" />
            <StructuredRow label="Repair run" value={`${attempts} of 3`} />
            <StructuredRow label="Superseded candidate" value="C1 · review and test stale" />
            <StructuredRow label="Current candidate" value={`${candidateId} · ${candidateSha}`} />
            <StructuredRow label="Resolution" value="Validation before persistence" />
          </InspectorSection>
        ) : null}
      </ContextInspector>
    </>
  );
}

function TestView(props: StageViewProps) {
  const hasFailure = props.testResult === "failed" || props.runState === "failed";
  const [openTest, setOpenTest] = useState<string | null>(hasFailure ? "api" : null);
  if (props.runState === "blocked")
    return (
      <BlockedTestView
        attempts={props.attempts}
        onResume={props.onResume}
        selectedEvent={props.selectedEvent}
        candidateId={props.candidateId}
        candidateSha={props.candidateSha}
      />
    );
  const tests = [
    {
      id: "unit",
      label: "Unit tests",
      command: "pnpm vitest run src/**/*.test.ts",
      status: "passed" as const,
      duration: "4.1s",
      count: "28 passed",
      artifact: "unit-results.json",
      detail: "Priority parsing, defaulting, badge labels, and schema helpers all passed in isolation.",
    },
    {
      id: "api",
      label: "API contract",
      command: "pnpm vitest run tests/api/priority.test.ts",
      status: hasFailure
        ? ("failed" as const)
        : props.testResult === "passed"
          ? ("passed" as const)
          : ("running" as const),
      duration: "8.2s",
      count: hasFailure ? "8 passed · 1 failed" : props.testResult === "passed" ? "9 passed" : "9 tests",
      artifact: "junit.xml",
      detail: hasFailure
        ? "The invalid-value contract failed: urgent was persisted instead of returning a validation error."
        : "Create, read, omitted, valid, and invalid priority contracts are verified at the HTTP boundary.",
    },
    {
      id: "types",
      label: "Typecheck",
      command: "pnpm tsc --noEmit",
      status: "passed" as const,
      duration: "3.7s",
      count: "0 errors",
      artifact: "typecheck.log",
      detail: "TaskPriority stays consistent across schema, API response, and UI component props.",
    },
    {
      id: "browser",
      label: "Browser",
      command: "pnpm playwright test task-priority.spec.ts",
      status: props.testResult === "passed" ? ("passed" as const) : ("pending" as const),
      duration: props.testResult === "passed" ? "12.4s" : "—",
      count: props.testResult === "passed" ? "5 passed" : "Waiting on API gate",
      artifact: "playwright-report/index.html",
      detail: "The task list badge and create-task default are checked in the rendered application.",
    },
  ];
  return (
    <>
      <div className="stage-main">
        <SectionHeader
          eyebrow="Test · Deterministic gate"
          title={
            hasFailure
              ? `${props.candidateId} · 37 checks passed · 1 failed`
              : props.testResult === "passed"
                ? `${props.candidateId} · all 46 acceptance checks passed`
                : `${props.candidateId} · 37 checks passed · API contract running`
          }
          description="Open any result for its command, cases, evidence, and artifact. Gate-level actions stay outside individual test details."
          action={<CandidateBadge candidateId={props.candidateId} candidateSha={props.candidateSha} />}
        />
        <StageCommandBar
          label={
            hasFailure
              ? "Candidate gate failed"
              : props.testResult === "passed"
                ? "Candidate gate passed"
                : "Test gate active"
          }
          title={
            hasFailure
              ? `Repair ${props.candidateId} or stop automatic routing`
              : props.testResult === "passed"
                ? `Send ${props.candidateId} to holdout Final Review`
                : `Complete the remaining gates against ${props.candidateId}`
          }
          detail={
            hasFailure
              ? "The failure packet preserves candidate provenance and routes to the owning slice or the integration worktree."
              : props.testResult === "passed"
                ? "All results reference the same merged revision reviewed by Dev Review."
                : "Unit, API, type, and browser evidence must all reference this candidate revision."
          }
          tone={hasFailure ? "blocked" : props.testResult === "passed" ? "ready" : "active"}
        >
          {hasFailure ? (
            <>
              <Button tone="primary" icon={Wrench} onClick={props.onSendRepair}>
                Send {props.candidateId} failure packet to repair
              </Button>
              <Button
                tone="secondary"
                icon={Play}
                onClick={() => {
                  setOpenTest("api");
                  props.onRetryTest();
                }}
              >
                Retry failed test
              </Button>
              <Button tone="ghost" icon={Prohibit} onClick={props.onMarkBlocked}>
                Mark blocked
              </Button>
            </>
          ) : props.testResult === "passed" ? (
            <Button tone="primary" icon={ArrowRight} onClick={props.onAdvance}>
              Send {props.candidateId} to Final Review
            </Button>
          ) : (
            <>
              <Button tone="primary" icon={Play} onClick={props.onPassTest}>
                Run successful test
              </Button>
              <Button
                tone="secondary"
                icon={XCircle}
                onClick={() => {
                  setOpenTest("api");
                  props.onFailTest();
                }}
              >
                Simulate failing test
              </Button>
            </>
          )}
        </StageCommandBar>
        {props.attempts > 1 && !hasFailure ? (
          <div className="stale-gate-history">
            <Wrench size={17} weight="fill" />
            <span>
              <strong>Prior candidate evidence retained</strong>
              <small>
                C1 · API contract failed · superseded by {props.candidateId}; affected review and test results
                were rerun.
              </small>
            </span>
            <span className="badge badge--neutral">Stale</span>
          </div>
        ) : null}
        <div className="test-list-breadcrumb" aria-live="polite">
          <span>Tests</span>
          {openTest ? (
            <>
              <ArrowRight size={12} />
              <strong>{tests.find((test) => test.id === openTest)?.label}</strong>
            </>
          ) : (
            <strong>All results</strong>
          )}
        </div>
        <div className="test-suite test-suite--accordion">
          {tests.map((test) => (
            <TestAccordionRow
              key={test.id}
              test={test}
              open={openTest === test.id}
              onToggle={() => setOpenTest(openTest === test.id ? null : test.id)}
              onBack={() => setOpenTest(null)}
            />
          ))}
        </div>
        {hasFailure ? (
          <div className="test-gate-summary">
            <div className="resume-route">
              <div>
                <strong>Global repair route</strong>
                <span>
                  Failure PKT-0094 returns to the owning slice or integration worktree, creates a new
                  candidate, then re-enters affected gates.
                </span>
              </div>
              <div className="route-flow">
                <span className="active">
                  <Wrench size={16} /> {props.candidateId} failed
                </span>
                <ArrowRight size={18} />
                <span>
                  <Code size={16} /> Repair → next candidate
                </span>
              </div>
            </div>
            <div className="attempt-meter">
              <span>
                Repair run <strong>{props.attempts} of 3</strong>
              </span>
              <div className="progress-line progress-line--amber">
                <span style={{ width: `${(props.attempts / 3) * 100}%` }} />
              </div>
              <span>{Math.max(0, 3 - props.attempts)} remaining</span>
            </div>
          </div>
        ) : null}
      </div>
      <ContextInspector stage="test" attempts={props.attempts} selectedEvent={props.selectedEvent}>
        <InspectorSection title="Candidate gate">
          <StructuredRow label="Tested revision" value={`${props.candidateId} · ${props.candidateSha}`} />
          <StructuredRow label="Verdict freshness" value="Current" />
          <StructuredRow label="Prior candidate" value={props.attempts > 1 ? "C1 · superseded" : "None"} />
        </InspectorSection>
      </ContextInspector>
    </>
  );
}

function BlockedTestView({
  attempts,
  onResume,
  selectedEvent,
  candidateId,
  candidateSha,
}: {
  attempts: number;
  onResume: () => void;
  selectedEvent?: HarnessEvent;
  candidateId: string;
  candidateSha: string;
}) {
  return (
    <>
      <div className="stage-main blocked-view">
        <div className="blocked-symbol">
          <Prohibit size={30} weight="fill" />
        </div>
        <SectionHeader
          eyebrow={`Test · ${attempts} of 3 repair runs used`}
          title={`${candidateId} is blocked by deterministic validation`}
          description="The same API contract criterion failed after every permitted repair. The harness has stopped automatic routing."
          action={<CandidateBadge candidateId={candidateId} candidateSha={candidateSha} />}
        />
        <StageCommandBar
          label="Human decision required"
          title="Grant another candidate repair, change the plan, or stop"
          detail="Automatic routing is paused. Any approved repair creates a new candidate and invalidates affected downstream verdicts."
          tone="blocked"
        >
          <Button tone="primary" icon={Play} onClick={onResume}>
            Resume with one candidate repair
          </Button>
          <Button tone="secondary" icon={ShieldCheck}>
            Override criterion
          </Button>
          <Button tone="secondary">Return to plan</Button>
          <Button tone="ghost" icon={Prohibit}>
            Cancel task
          </Button>
        </StageCommandBar>
        <div className="blocked-reason">
          <strong>Human action required</strong>
          <p>
            Choose whether to grant one more repair attempt, override AC-5 with a recorded rationale, return
            to planning, or stop the task.
          </p>
        </div>
        <div className="failure-command">
          <span>Last failing command</span>
          <code>pnpm vitest run tests/api/priority.test.ts</code>
        </div>
      </div>
      <ContextInspector stage="test" attempts={attempts} selectedEvent={selectedEvent}>
        <InspectorSection title="Blocked state record">
          <StructuredRow label="Blocker" value="AC-5 failed 3 times" tone="red" />
          <StructuredRow label="Resume from" value="Implement → Test" />
          <StructuredRow label="Automatic retries" value="Exhausted" />
          <StructuredRow label="Human decision" value="Required" tone="amber" />
        </InspectorSection>
        <InspectorSection title="Failure history">
          <div className="attempt-history">
            <span>
              <strong>Attempt 1</strong>
              <small>Missing API enum validation</small>
            </span>
            <span>
              <strong>Attempt 2</strong>
              <small>Validation after persistence</small>
            </span>
            <span>
              <strong>Attempt 3</strong>
              <small>Error contract mismatch</small>
            </span>
          </div>
        </InspectorSection>
      </ContextInspector>
    </>
  );
}

function FinalReviewView({
  onAdvance,
  attempts,
  selectedEvent,
  candidateId,
  candidateSha,
}: Pick<StageViewProps, "onAdvance" | "attempts" | "selectedEvent" | "candidateId" | "candidateSha">) {
  const stageSummary = [
    {
      stage: "Triage",
      state: "Passed",
      tokens: "1.2k",
      cost: "$0.03",
      finding: "Feature · moderate API and migration risk",
    },
    {
      stage: "Repo scouts",
      state: "Passed",
      tokens: "3.9k",
      cost: "$0.07",
      finding: "142 files inspected · 4 findings retained",
    },
    {
      stage: "Grill",
      state: "Passed",
      tokens: "6.1k",
      cost: "$0.18",
      finding: "3 decisions settled · no open ambiguity",
    },
    {
      stage: "Task spec",
      state: "Passed",
      tokens: "7.4k",
      cost: "$0.21",
      finding: "5 acceptance criteria · scope fixed",
    },
    {
      stage: "Impl plan",
      state: "Passed",
      tokens: "4.2k",
      cost: "$0.11",
      finding: "4 work packages · 3 dependency batches",
    },
    {
      stage: "Implement",
      state: attempts > 1 ? "Repaired" : "Passed",
      tokens: "20.5k",
      cost: "$0.56",
      finding:
        attempts > 1
          ? `3 slices → ${candidateId} · repair run ${attempts} resolved PKT-0094`
          : `3 slices → ${candidateId} · 6 merged files`,
    },
    {
      stage: "Dev review",
      state: "Passed",
      tokens: "6.4k",
      cost: "$0.19",
      finding: "0 blockers · 1 non-blocking P2",
    },
    {
      stage: "Test",
      state: "Passed",
      tokens: "—",
      cost: "$0.04",
      finding: attempts > 1 ? "46 passed after targeted repair" : "46 passed · unit, API, type, browser",
    },
  ];
  return (
    <>
      <div className="stage-main">
        <SectionHeader
          eyebrow="Final review · Holdout"
          title={`${candidateId} passed independent holdout review`}
          description="Claude reviewed the merged candidate, specification, and test evidence without access to implementation reasoning."
          action={
            <span className="header-identity-stack">
              <CandidateBadge candidateId={candidateId} candidateSha={candidateSha} />
              <ProviderTag provider="claude" model="Claude 3.7 Sonnet · High" />
            </span>
          }
        />
        <StageCommandBar
          title={`Send ${candidateId} to human approval`}
          detail="The approval packet includes the target branch, merge method, candidate revision, every required verdict, and the merged diff."
        >
          <Button tone="primary" icon={ArrowRight} onClick={onAdvance}>
            Send {candidateId} to human approval
          </Button>
          <Button tone="secondary" icon={GitDiff}>
            Inspect candidate diff
          </Button>
        </StageCommandBar>
        <div className="review-verdict">
          <CheckCircle size={28} weight="fill" />
          <span>
            <strong>Ready for human approval</strong>
            <small>All acceptance criteria trace to changed files and passing deterministic evidence.</small>
          </span>
        </div>
        <div className="final-review-grid">
          <div>
            <span>Stages completed</span>
            <strong>8 / 8</strong>
            <small>All required gates</small>
          </div>
          <div>
            <span>Work packages</span>
            <strong>4 / 4</strong>
            <small>3 slices + integration</small>
          </div>
          <div>
            <span>Deterministic checks</span>
            <strong>46 passed</strong>
            <small>0 remaining failures</small>
          </div>
          <div>
            <span>Approx total</span>
            <strong>$1.39</strong>
            <small>49.7k model tokens</small>
          </div>
        </div>
        <section className="workflow-summary">
          <header>
            <span>Workflow record</span>
            <strong>What was done</strong>
            <small>State, model usage, and the most useful output from every prior step.</small>
          </header>
          <div className="workflow-summary__columns" aria-hidden="true">
            <span>Stage</span>
            <span>State</span>
            <span>Tokens</span>
            <span>Cost</span>
            <span>Key outcome</span>
          </div>
          {stageSummary.map((item) => (
            <div className="workflow-summary__row" key={item.stage}>
              <strong>{item.stage}</strong>
              <span
                className={`workflow-state ${item.state === "Repaired" ? "workflow-state--repaired" : ""}`}
              >
                <CheckCircle size={14} weight="fill" /> {item.state}
              </span>
              <code>{item.tokens}</code>
              <code>{item.cost}</code>
              <span>{item.finding}</span>
            </div>
          ))}
        </section>
        <div className="final-review-note">
          <ShieldCheck size={18} weight="fill" />
          <span>
            <strong>Holdout conclusion</strong>
            <small>
              The delivered patch matches the approved task, stays inside owned files, and is supported by
              independent review and deterministic evidence.
            </small>
          </span>
        </div>
      </div>
      <ContextInspector stage="final-review" attempts={attempts} selectedEvent={selectedEvent}>
        <InspectorSection title="Final verdicts">
          <div className="verdict-row">
            <ProviderTag provider="codex" model="Dev review" />
            <span>
              <EvidenceState tone="passed" /> Passed
            </span>
          </div>
          <div className="verdict-row">
            <ProviderTag provider="claude" model="Holdout review" />
            <span>
              <EvidenceState tone="passed" /> Passed
            </span>
          </div>
        </InspectorSection>
        <InspectorSection title="Approval handoff">
          <StructuredRow label="Candidate" value={`${candidateId} · ${candidateSha}`} />
          <StructuredRow label="Target" value="main · squash merge" />
          <StructuredRow label="Verdicts" value="Dev Review · Test · Holdout current" />
        </InspectorSection>
      </ContextInspector>
    </>
  );
}

function ApprovalView({
  state,
  onApprove,
  selectedEvent,
  candidateId,
  candidateSha,
}: {
  state: TaskRunState;
  onApprove: () => void;
  selectedEvent?: HarnessEvent;
  candidateId: string;
  candidateSha: string;
}) {
  const approved = state === "completed";
  return (
    <>
      <div className="stage-main approval-view">
        <SectionHeader
          eyebrow={approved ? "Completed · Merged by s.k.dev" : "Human approval · Final gate"}
          title={approved ? `${candidateId} merged to main` : `Approve and merge ${candidateId}`}
          description={
            approved
              ? "The deterministic workflow is complete and the signed merge record is retained with the task."
              : "Review the candidate, target branch, merge method, and complete evidence packet before changing the repository."
          }
          action={<CandidateBadge candidateId={candidateId} candidateSha={candidateSha} />}
        />
        <StageCommandBar
          label={approved ? "Merge complete" : "Human decision required"}
          title={
            approved
              ? `${candidateId} is now main@c842e1b`
              : `Approve the exact ${candidateId} revision and squash merge it into main`
          }
          detail={
            approved
              ? "The candidate hash, approver identity, prior verdicts, and resulting target commit are recorded."
              : "This is the repository-changing action. Requesting changes creates a repair packet and a new candidate instead."
          }
          tone={approved ? "ready" : "waiting"}
        >
          {!approved ? (
            <Button tone="primary" icon={GitPullRequest} onClick={onApprove}>
              Approve & merge {candidateId}
            </Button>
          ) : (
            <Button tone="primary" icon={GitBranch}>
              View merge record
            </Button>
          )}
          {!approved ? (
            <Button tone="secondary" icon={Wrench}>
              Request changes
            </Button>
          ) : null}
          <Button tone="secondary" icon={GitDiff}>
            Inspect candidate diff
          </Button>
        </StageCommandBar>
        <div className="merge-target-grid">
          <div>
            <span>Candidate</span>
            <strong>
              {candidateId} · {candidateSha}
            </strong>
          </div>
          <div>
            <span>Target branch</span>
            <strong>main@9b6c0fa</strong>
          </div>
          <div>
            <span>Merge method</span>
            <strong>Squash merge</strong>
          </div>
          <div>
            <span>Required gates</span>
            <strong>3 / 3 current</strong>
          </div>
        </div>
        <div className="completion-summary">
          <div>
            <span>Files changed</span>
            <strong>6</strong>
            <small>+148 −22</small>
          </div>
          <div>
            <span>Acceptance criteria</span>
            <strong>5 / 5</strong>
            <small>Fully traced</small>
          </div>
          <div>
            <span>Tests</span>
            <strong>46 passed</strong>
            <small>0 failed</small>
          </div>
          <div>
            <span>Total duration</span>
            <strong>24m 18s</strong>
            <small>2 repair runs</small>
          </div>
        </div>
        <section className="traceability-matrix">
          <h3>Acceptance traceability</h3>
          {acceptanceCriteria.map((criterion, index) => (
            <div key={criterion}>
              <EvidenceState tone="passed" />
              <span>
                <code>AC-{index + 1}</code>
                <strong>{criterion}</strong>
              </span>
              <span>
                {index === 2 ? "API · 9 passed" : index === 3 ? "Browser · 5 passed" : "Unit · passed"}
              </span>
            </div>
          ))}
        </section>
        <div className="evidence-columns">
          <section>
            <h3>Files changed</h3>
            <ul>
              <li>
                src/db/schema.ts <span>+18 −2</span>
              </li>
              <li>
                src/api/tasks.ts <span>+42 −8</span>
              </li>
              <li>
                src/ui/PriorityBadge.tsx <span>+38</span>
              </li>
              <li>
                tests/api/priority.test.ts <span>+50 −12</span>
              </li>
            </ul>
          </section>
          <section>
            <h3>Verification</h3>
            <ul>
              <li>
                <CheckCircle />
                Unit tests <span>28 passed</span>
              </li>
              <li>
                <CheckCircle />
                API tests <span>9 passed</span>
              </li>
              <li>
                <CheckCircle />
                Typecheck <span>0 errors</span>
              </li>
              <li>
                <CheckCircle />
                Browser tests <span>5 passed</span>
              </li>
            </ul>
          </section>
        </div>
        <div className="screenshot-strip">
          <div>
            <Browser size={24} />
            <span>Task list · medium priority</span>
          </div>
          <div>
            <Browser size={24} />
            <span>Create task · default priority</span>
          </div>
        </div>
      </div>
      <ContextInspector stage="approval" selectedEvent={selectedEvent}>
        <InspectorSection title="Final verdicts">
          <div className="verdict-row">
            <ProviderTag provider="codex" model="Dev review" />
            <span>
              <EvidenceState tone="passed" />
              Passed
            </span>
          </div>
          <div className="verdict-row">
            <ProviderTag provider="claude" model="Final review" />
            <span>
              <EvidenceState tone="passed" />
              Passed
            </span>
          </div>
        </InspectorSection>
        <InspectorSection title="Model usage">
          <StructuredRow label="Codex" value="32.1k tokens · 78% cache" />
          <StructuredRow label="Claude" value="12.1k tokens · 64% cache" />
          <StructuredRow label="Harness" value="7 deterministic gates" />
          <StructuredRow label="Elapsed" value="24m 18s" />
        </InspectorSection>
        <InspectorSection title="Merge contract">
          <StructuredRow label="Candidate" value={`${candidateId} · ${candidateSha}`} />
          <StructuredRow label="Target" value={approved ? "main@c842e1b" : "main@9b6c0fa"} />
          <StructuredRow label="Method" value="Squash merge" />
          <StructuredRow label="Decision" value={approved ? "Approved and merged" : "Awaiting s.k.dev"} />
        </InspectorSection>
      </ContextInspector>
    </>
  );
}

function TaskBrief() {
  const task = useContext(TaskBriefContext);
  return (
    <section className="task-brief">
      <span>Task brief</span>
      <strong>{task.title}</strong>
      <p>{task.description}</p>
    </section>
  );
}

function ContextInspector({
  stage,
  attempts = 1,
  selectedEvent,
  children,
}: {
  stage: string;
  attempts?: number;
  selectedEvent?: HarnessEvent;
  children?: React.ReactNode;
}) {
  const task = useContext(TaskBriefContext);
  const [openArtifact, setOpenArtifact] = useState<ArtifactRecord | null>(null);
  const [candidateDiff, setCandidateDiff] = useState<CandidateDiffResponse | null>(null);
  const [candidateDiffError, setCandidateDiffError] = useState<string | null>(null);
  const [candidateDiffLoading, setCandidateDiffLoading] = useState(false);
  const index = workflowStages.findIndex((item) => item.id === stage);
  const current = workflowStages[index >= 0 ? index : 0] ?? workflowStages[0];
  if (!current) return null;
  const active = workflowStages[task.activeStageIndex] ?? workflowStages[0];
  const relation =
    index < task.activeStageIndex
      ? "Recorded history"
      : index > task.activeStageIndex
        ? "Upcoming preview"
        : "Current execution";
  const artifacts = stageArtifacts[stage] ?? [];
  const metrics = stageMetrics[stage] ?? {
    duration: "—",
    tokens: "No model tokens",
    cost: "$0.00",
    cache: "Not applicable",
  };
  const model = stageModels[stage] ?? "Deterministic harness";
  const agent = stageAgents[stage] ?? "Orchestration agent";
  const candidateIdentity = `${task.candidateId} · ${task.candidateSha}`;
  useEffect(() => {
    setCandidateDiff(null);
    setCandidateDiffError(null);
    setCandidateDiffLoading(false);
  }, [candidateIdentity]);
  const openCandidateDiff = async () => {
    setCandidateDiffLoading(true);
    setCandidateDiffError(null);
    try {
      const response = await getCandidateDiff(task.taskId, task.candidateId, task.candidateSha);
      setCandidateDiff(response);
    } catch (error) {
      setCandidateDiff(null);
      setCandidateDiffError(error instanceof Error ? error.message : "Failed to load candidate diff.");
    } finally {
      setCandidateDiffLoading(false);
    }
  };
  return (
    <>
      <aside className="stage-inspector">
        <TaskBrief />
        <InspectorHeader title="Stage context" />
        <StructuredRow label="Viewed stage" value={`${current.shortLabel} · ${relation}`} />
        <StructuredRow label="Active stage" value={active?.shortLabel ?? "Triage"} />
        <StructuredRow label="Skill" value={current.skill} />
        <StructuredRow label="Agent" value={agent} />
        <StructuredRow label="Model" value={model} />
        <StructuredRow
          label="Reasoning"
          value={
            current.provider === "harness" ? "Not applicable" : stage === "dev-review" ? "Medium" : "High"
          }
        />
        <StructuredRow label="Stage run" value={`${attempts} of 3`} />
        <InspectorSection title="Execution metadata">
          <StructuredRow label="Run ID" value={`run-gh241-${current.id}-${attempts}`} />
          <StructuredRow label="Duration" value={metrics.duration} />
          <StructuredRow label="Tokens" value={metrics.tokens} />
          <StructuredRow label="Approx cost" value={metrics.cost} />
          <StructuredRow label="Cache" value={metrics.cache} />
          <StructuredRow
            label="Worktree"
            value={index >= 5 ? ".worktrees/gh-241/integration" : ".worktrees/gh-241/context"}
          />
        </InspectorSection>
        {index >= 5 ? (
          <InspectorSection title="Integration candidate">
            <StructuredRow label="Candidate" value={candidateIdentity} />
            <StructuredRow label="Includes" value="S1 81ac09f · S2 4f7e2bd · S3 962e11a" />
            <StructuredRow label="Target" value="main@9b6c0fa · squash merge" />
            <StructuredRow
              label="Verdict freshness"
              value={index === task.activeStageIndex ? "Current for this revision" : relation}
            />
            <Button tone="secondary" icon={GitDiff} onClick={openCandidateDiff} disabled={candidateDiffLoading}>
              {candidateDiffLoading ? "Loading candidate diff" : "Inspect candidate diff"}
            </Button>
          </InspectorSection>
        ) : null}
        <details className="safeguard-details">
          <summary>
            <span>
              <ShieldCheck size={15} weight="fill" />
              Run safeguards
            </span>
            <strong>
              {relation === "Recorded history"
                ? "3 passed"
                : relation === "Current execution"
                  ? "2 passed · 1 active"
                  : "Not started"}
            </strong>
            <CaretDown size={14} />
          </summary>
          <div>
            <div className="trace-row">
              <EvidenceState tone="passed" />
              <span>Input contract validated</span>
            </div>
            <div className="trace-row">
              <EvidenceState tone="passed" />
              <span>Permissions and owned scope enforced</span>
            </div>
            <div className="trace-row">
              <EvidenceState tone={relation === "Recorded history" ? "passed" : "pending"} />
              <span>
                {relation === "Recorded history"
                  ? "Output gate recorded"
                  : relation === "Current execution"
                    ? "Output gate active"
                    : "Output gate not started"}
              </span>
            </div>
          </div>
        </details>
        {children}
        <InspectorSection title="Living artifacts" meta={`${artifacts.length} retained`}>
          <div className="artifact-list">
            {artifacts.map((artifact) => (
              <button type="button" onClick={() => setOpenArtifact(artifact)} key={artifact.name}>
                <FileCode size={15} />
                <span>
                  <strong>{artifact.name}</strong>
                  <small>{artifact.status}</small>
                </span>
                <ArrowRight size={13} />
              </button>
            ))}
          </div>
        </InspectorSection>
        {selectedEvent ? <SelectedEvent event={selectedEvent} /> : null}
      </aside>
      {openArtifact ? <ArtifactViewer artifact={openArtifact} onClose={() => setOpenArtifact(null)} /> : null}
      {candidateDiff ? (
        <CandidateDiffViewer
          candidateIdentity={candidateIdentity}
          diff={candidateDiff}
          taskId={task.taskId}
          onClose={() => setCandidateDiff(null)}
        />
      ) : null}
      {candidateDiffError ? (
        <CandidateDiffErrorViewer
          candidateIdentity={candidateIdentity}
          error={candidateDiffError}
          taskId={task.taskId}
          onClose={() => setCandidateDiffError(null)}
          onRetry={openCandidateDiff}
        />
      ) : null}
    </>
  );
}

function CandidateDiffViewer({
  candidateIdentity,
  diff,
  onClose,
  taskId,
}: {
  candidateIdentity: string;
  diff: CandidateDiffResponse;
  onClose: () => void;
  taskId: string;
}) {
  const lines = diff.diff.split("\n");
  return (
    <div className="artifact-overlay candidate-diff-overlay" role="dialog" aria-modal="true" aria-label="Candidate diff">
      <button type="button" className="artifact-overlay__backdrop" onClick={onClose} aria-label="Close candidate diff" />
      <section className="artifact-viewer candidate-diff-viewer">
        <header>
          <span>
            <FileCode size={18} />
            <span>
              <small>Candidate diff</small>
              <strong>{candidateIdentity}</strong>
            </span>
          </span>
          <code>Task {taskId}</code>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Return to inspector">
            <X size={17} />
          </button>
        </header>
        <div className="artifact-viewer__summary">
          <span>
            Revision {diff.revisionNumber} · {diff.worktreePath}
          </span>
          <p>
            Head revision <code>{diff.headRevision}</code>
            {diff.truncated ? " · diff capped at 300000 characters" : ""}
          </p>
        </div>
        <pre className="candidate-diff-viewer__diff">
          <code>
            {lines.map((line, index) => (
              <span className="diff-line diff-line--context" key={`${index}-${line}`}>
                {line}
              </span>
            ))}
          </code>
        </pre>
        <footer>
          <Button tone="secondary" icon={ArrowLeft} onClick={onClose}>
            Back to inspector
          </Button>
          <small>Read-only candidate-bound diff</small>
        </footer>
      </section>
    </div>
  );
}

function CandidateDiffErrorViewer({
  candidateIdentity,
  error,
  onClose,
  onRetry,
  taskId,
}: {
  candidateIdentity: string;
  error: string;
  onClose: () => void;
  onRetry: () => void;
  taskId: string;
}) {
  return (
    <div className="artifact-overlay candidate-diff-overlay" role="dialog" aria-modal="true" aria-label="Candidate diff error">
      <button type="button" className="artifact-overlay__backdrop" onClick={onClose} aria-label="Dismiss candidate diff error" />
      <section className="artifact-viewer candidate-diff-viewer">
        <header>
          <span>
            <FileCode size={18} />
            <span>
              <small>Candidate diff unavailable</small>
              <strong>{candidateIdentity}</strong>
            </span>
          </span>
          <code>Task {taskId}</code>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close error viewer">
            <X size={17} />
          </button>
        </header>
        <div className="artifact-viewer__summary">
          <span>Fresh candidate verification failed</span>
          <p>{error}</p>
        </div>
        <footer>
          <Button tone="primary" icon={GitDiff} onClick={onRetry}>
            Retry fresh fetch
          </Button>
          <Button tone="secondary" icon={ArrowLeft} onClick={onClose}>
            Back to inspector
          </Button>
        </footer>
      </section>
    </div>
  );
}

interface ArtifactRecord {
  name: string;
  status: string;
  type: string;
  summary: string;
  content: string;
}

const stageAgents: Record<string, string> = {
  triage: "Routing harness",
  scouts: "Repository scouts ×3",
  grill: "Clarification agent",
  specification: "Specification agent",
  plan: "Planning agent",
  implement: "Implementation agent",
  "dev-review": "Fresh-context review agent",
  test: "Verification harness",
  "final-review": "Holdout review agent",
  approval: "Approval orchestrator",
};

const stageModels: Record<string, string> = {
  triage: "Deterministic harness",
  scouts: "Codex 1.2 Mini",
  grill: "Claude 3.7 Sonnet",
  specification: "Claude 3.7 Sonnet",
  plan: "Claude 3.7 Sonnet",
  implement: "Codex 1.2",
  "dev-review": "Codex 1.2",
  test: "Deterministic harness",
  "final-review": "Claude 3.7 Sonnet",
  approval: "Deterministic harness",
};

const stageMetrics: Record<string, { duration: string; tokens: string; cost: string; cache: string }> = {
  triage: { duration: "2s", tokens: "No model tokens", cost: "$0.00", cache: "Not applicable" },
  scouts: { duration: "41s", tokens: "3.9k", cost: "$0.07", cache: "82% · 11.2k" },
  grill: { duration: "2m 18s", tokens: "6.1k", cost: "$0.18", cache: "91% · 18.4k" },
  specification: { duration: "1m 06s", tokens: "7.4k", cost: "$0.21", cache: "88% · 22.1k" },
  plan: { duration: "52s", tokens: "4.2k", cost: "$0.11", cache: "86% · 13.6k" },
  implement: { duration: "8m 44s", tokens: "20.5k", cost: "$0.56", cache: "76% · 31.8k" },
  "dev-review": { duration: "1m 42s", tokens: "6.4k", cost: "$0.19", cache: "64% · 9.8k" },
  test: { duration: "28.4s", tokens: "No model tokens", cost: "$0.04", cache: "Not applicable" },
  "final-review": { duration: "1m 34s", tokens: "6.2k", cost: "$0.18", cache: "71% · 12.4k" },
  approval: { duration: "Waiting", tokens: "No model tokens", cost: "$0.00", cache: "Not applicable" },
};

const stageArtifacts: Record<string, ArtifactRecord[]> = {
  triage: [
    {
      name: "triage-result.json",
      status: "Validated · retained",
      type: "Structured output",
      summary: "Classification, risk, and routing decision.",
      content:
        '{\n  "taskType": "feature",\n  "severity": "S2",\n  "workflow": "investigate-and-implement",\n  "riskGates": ["api-contract", "migration", "browser"]\n}',
    },
  ],
  scouts: [
    {
      name: "scout-synthesis.md",
      status: "4 findings · retained",
      type: "Repository evidence",
      summary: "Merged findings from three read-only scouts.",
      content:
        "# Scout synthesis\n\n1. Schema has no priority field.\n2. API create route persists parsed input directly.\n3. StatusBadge is the closest UI pattern.\n4. Request fixtures are the stable test seam.",
    },
    {
      name: "scout-citations.json",
      status: "4 code citations",
      type: "Evidence index",
      summary: "File and line references behind the synthesis.",
      content:
        '{\n  "citations": [\n    "src/db/schema.ts:42",\n    "src/api/tasks.ts:88",\n    "src/ui/TaskListItem.tsx:112",\n    "tests/api/tasks.test.ts:31"\n  ]\n}',
    },
  ],
  grill: [
    {
      name: "CONTEXT.md",
      status: "Updated after each answer",
      type: "Living decision record",
      summary: "Settled answers and remaining ambiguity.",
      content:
        "# Shared context\n\n- Values: low / medium / high\n- API create: optional, defaults to medium\n- UI: quiet coloured label\n\nOpen frontier: none after the current answer.",
    },
    {
      name: "glossary.json",
      status: "3 terms · current",
      type: "Domain glossary",
      summary: "Stable meanings carried into the specification.",
      content:
        '{\n  "priority": "User-supplied urgency label",\n  "status": "Deterministic workflow state",\n  "task": "Persisted unit of work"\n}',
    },
  ],
  specification: [
    {
      name: "task-spec.md",
      status: "v1 · validated",
      type: "Specification",
      summary: "Problem, solution, stories, scope, and decisions.",
      content:
        "# Add task priority\n\n## Problem\nTasks cannot communicate urgency consistently.\n\n## Solution\nPersist a constrained priority, expose it through the API, and render a quiet badge.",
    },
    {
      name: "acceptance-criteria.json",
      status: "5 settled criteria",
      type: "Verification contract",
      summary: "Stable criteria and their verification seams.",
      content:
        '{\n  "criteria": ["persist enum", "default medium", "API response", "priority badge", "validation tests"]\n}',
    },
  ],
  plan: [
    {
      name: "execution-plan.json",
      status: "4 packages · approved",
      type: "Dependency plan",
      summary: "Batches, ownership, interfaces, and commands.",
      content:
        '{\n  "batches": [\n    ["S1"],\n    ["S2", "S3"],\n    ["S4"]\n  ],\n  "edges": ["S1->S2", "S1->S3", "S2+S3->S4"]\n}',
    },
    {
      name: "interface-contracts.md",
      status: "3 interfaces · retained",
      type: "Package handoff",
      summary: "Outputs produced and consumed across packages.",
      content:
        "# Interfaces\n\nS1 produces TaskPriority.\nS2 produces the API response contract.\nS3 consumes TaskPriority.\nS4 consumes S2 and S3 outputs.",
    },
  ],
  implement: [
    {
      name: "candidate-manifest.json",
      status: "C1 · 3 slice commits",
      type: "Integration provenance",
      summary: "Base, merge order, worktrees, included commits, and candidate revision.",
      content:
        '{\n  "candidate": "C1",\n  "base": "main@9b6c0fa",\n  "revision": "a16f29d",\n  "commits": ["81ac09f", "4f7e2bd", "962e11a"],\n  "conflicts": 0\n}',
    },
    {
      name: "candidate-C1.diff",
      status: "Merged · +51 −8",
      type: "Candidate diff",
      summary: "Complete merged candidate reviewed and tested downstream.",
      content:
        'diff --git a/src/api/routes/tasks.ts b/src/api/routes/tasks.ts\n+ const priority = parsed.priority ?? "medium";\n+ assertTaskPriority(priority);\n+ return db.insert(tasks).values({ ...parsed, priority });',
    },
    {
      name: "developer-self-score.json",
      status: "82 / 100 · advisory",
      type: "Quality self-score",
      summary: "Eight-category implementation assessment.",
      content:
        '{\n  "correctness": 12,\n  "security": 10,\n  "errorHandling": 9,\n  "maintainability": 11,\n  "repositoryFit": 13,\n  "testQuality": 11,\n  "performance": 8,\n  "scopeDiscipline": 8\n}',
    },
  ],
  "dev-review": [
    {
      name: "dev-review.json",
      status: "C1 · no blockers · 1 P2",
      type: "Review verdict",
      summary: "Categorized, line-specific fresh-context findings.",
      content:
        '{\n  "verdict": "no-blockers",\n  "counts": { "P0": 0, "P1": 0, "P2": 1, "P3": 0 },\n  "finding": "Extract priority colours into semantic tokens"\n}',
    },
    {
      name: "repair-lineage.json",
      status: "PKT-0094 · resolved",
      type: "Repair history",
      summary: "Failure, affected package, repair, and re-review record.",
      content:
        '{\n  "packet": "PKT-0094",\n  "package": "S4",\n  "resolution": "validation-before-persistence",\n  "status": "resolved"\n}',
    },
  ],
  test: [
    {
      name: "junit.xml",
      status: "Candidate-bound · 42 passed · 1 historical failure",
      type: "Test results",
      summary: "Case-level unit and API results.",
      content:
        '<testsuites tests="43" failures="1">\n  <testcase name="defaults priority to medium" />\n  <testcase name="rejects invalid priority">\n    <failure>Expected 400, received 201</failure>\n  </testcase>\n</testsuites>',
    },
    {
      name: "playwright-report/index.html",
      status: "5 checks · passed",
      type: "Browser report",
      summary: "Rendered UI checks and screenshots.",
      content:
        "Browser verification\n\n✓ Medium priority renders by default\n✓ Low, medium, and high labels remain readable\n✓ Create task request omits priority safely\n✓ API response is reflected in the task row\n✓ Workflow status remains visually dominant",
    },
  ],
  "final-review": [
    {
      name: "workflow-summary.json",
      status: "8 stages · complete",
      type: "End-to-end record",
      summary: "State, usage, cost, and key output from every stage.",
      content:
        '{\n  "candidate": "C2",\n  "revision": "f3b90c8",\n  "stages": 8,\n  "slices": 3,\n  "checksPassed": 46,\n  "approxCost": 1.39,\n  "verdict": "ready-for-human-approval"\n}',
    },
    {
      name: "holdout-review.md",
      status: "Passed · retained",
      type: "Independent conclusion",
      summary: "Patch-to-spec and evidence conclusion.",
      content:
        "# Holdout review\n\nThe patch matches all five acceptance criteria, changes only six owned files, and is supported by deterministic unit, API, type, and browser evidence.",
    },
  ],
  approval: [
    {
      name: "approval-record.json",
      status: "Awaiting signature",
      type: "Human gate",
      summary: "Final human decision and audit identity.",
      content:
        '{\n  "task": "GH-241",\n  "candidate": "C2",\n  "revision": "f3b90c8",\n  "target": "main@9b6c0fa",\n  "mergeMethod": "squash",\n  "status": "awaiting-approval",\n  "reviewers": ["dev-review", "holdout-review"]\n}',
    },
    {
      name: "publication-plan.json",
      status: "External actions pending",
      type: "Publication plan",
      summary: "Pull request and tracker actions after approval.",
      content: '{\n  "pullRequest": "not-opened",\n  "linearUpdate": "not-sent"\n}',
    },
  ],
};

function ArtifactViewer({ artifact, onClose }: { artifact: ArtifactRecord; onClose: () => void }) {
  return (
    <div
      className="artifact-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`${artifact.name} artifact`}
    >
      <button
        type="button"
        className="artifact-overlay__backdrop"
        onClick={onClose}
        aria-label="Close artifact"
      />
      <section className="artifact-viewer">
        <header>
          <span>
            <FileCode size={18} />
            <span>
              <small>{artifact.type}</small>
              <strong>{artifact.name}</strong>
            </span>
          </span>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close artifact viewer">
            <X size={17} />
          </button>
        </header>
        <div className="artifact-viewer__summary">
          <span>{artifact.status}</span>
          <p>{artifact.summary}</p>
        </div>
        <pre>
          <code>{artifact.content}</code>
        </pre>
        <footer>
          <Button tone="secondary" icon={ArrowLeft} onClick={onClose}>
            Back to stage
          </Button>
          <small>Read-only prototype artifact</small>
        </footer>
      </section>
    </div>
  );
}

function SelectedEvent({ event }: { event: HarnessEvent }) {
  return (
    <InspectorSection title="Selected event" meta={event.time}>
      <div className="selected-event">
        <strong>{event.title}</strong>
        <p>{event.detail}</p>
        <StructuredRow label="Component" value={event.component} />
        <StructuredRow label="Scope" value={event.scope} />
        <StructuredRow label="Model" value={event.model} />
        <StructuredRow label="Approx cost" value={event.cost} />
        <StructuredRow label="Duration" value={event.duration} />
        <a href={`#${event.artifact}`}>
          <FileCode size={14} />
          {event.artifact}
        </a>
      </div>
    </InspectorSection>
  );
}

function InspectorHeader({ title }: { title: string }) {
  return (
    <header className="inspector-header">
      <h3>{title}</h3>
    </header>
  );
}
function InspectorSection({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="inspector-section">
      <header>
        <h4>{title}</h4>
        {meta ? <span>{meta}</span> : null}
      </header>
      {children}
    </section>
  );
}
function StructuredRow({ label, value, tone }: { label: string; value: string; tone?: "red" | "amber" }) {
  return (
    <div className="structured-row">
      <span>{label}</span>
      <strong className={tone ? `text-${tone}` : ""}>{value}</strong>
    </div>
  );
}
function RunStep({
  status,
  title,
  detail,
  meta,
}: {
  status: "done" | "active";
  title: string;
  detail: string;
  meta: string;
}) {
  return (
    <div className={`run-step run-step--${status}`}>
      <span className="run-step__icon">
        {status === "done" ? (
          <CheckCircle size={18} weight="fill" />
        ) : (
          <CircleNotch size={18} className="spin" />
        )}
      </span>
      <span>
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
      <code>{meta}</code>
    </div>
  );
}
function TestAccordionRow({
  test,
  open,
  onToggle,
  onBack,
}: {
  test: {
    id: string;
    label: string;
    command: string;
    status: "running" | "passed" | "failed" | "pending";
    duration: string;
    count: string;
    artifact: string;
    detail: string;
  };
  open: boolean;
  onToggle: () => void;
  onBack: () => void;
}) {
  const Icon =
    test.status === "passed"
      ? CheckCircle
      : test.status === "failed"
        ? XCircle
        : test.status === "running"
          ? CircleNotch
          : Code;
  const statusLabel =
    test.status === "running" ? "Running" : test.status === "pending" ? "Waiting" : test.status;
  return (
    <div className={`test-result test-result--${test.status} ${open ? "test-result--open" : ""}`}>
      <button
        type="button"
        className="test-row"
        aria-expanded={open}
        aria-controls={`test-${test.id}`}
        onClick={onToggle}
      >
        <Icon
          size={18}
          weight={test.status === "running" || test.status === "pending" ? "regular" : "fill"}
          className={test.status === "running" ? "spin" : ""}
        />
        <span>
          <strong>{test.label}</strong>
          <code>{test.command}</code>
        </span>
        <span>
          <strong>{statusLabel}</strong>
          <small>
            {test.duration} · {test.count}
          </small>
        </span>
        <CaretDown size={15} weight="bold" />
      </button>
      {open ? (
        <section className="test-detail" id={`test-${test.id}`}>
          <header className="test-detail__header">
            <span>
              <small>Tests / {test.label}</small>
              <strong>{statusLabel} result details</strong>
            </span>
            <button type="button" className="test-back-button" onClick={onBack}>
              <ArrowLeft size={14} /> Back to test list
            </button>
          </header>
          <p>{test.detail}</p>
          {test.status === "failed" ? (
            <>
              <div className="failure-evidence">
                <StructuredRow label="Expected" value="HTTP 400 · Bad Request" />
                <StructuredRow label="Received" value="HTTP 201 · Created" tone="red" />
                <StructuredRow label="Failing assertion" value="tests/api/priority.test.ts:94" />
                <StructuredRow label="Duration / artifact" value={`${test.duration} · ${test.artifact}`} />
              </div>
              <pre className="code-excerpt">
                <code>
                  <span>92</span>
                  {' .send({ title: "Test", priority: "urgent" })\n'}
                  <span>93</span>
                  {" expect(res.status).toBe(400)\n"}
                  <mark>
                    <span>94</span> expect(res.body.error).toMatch(/invalid priority/i)
                  </mark>
                </code>
              </pre>
            </>
          ) : (
            <div className="test-detail__facts">
              <StructuredRow label="Command" value={test.command} />
              <StructuredRow
                label="Exit"
                value={test.status === "passed" ? "0 · success" : "Waiting for upstream gate"}
              />
              <StructuredRow label="Cases" value={test.count} />
              <StructuredRow label="Artifact" value={test.artifact} />
            </div>
          )}
          <button type="button" className="test-back-button test-back-button--footer" onClick={onBack}>
            <ArrowLeft size={14} /> Back to all tests
          </button>
        </section>
      ) : null}
    </div>
  );
}
