import {
  ArrowRight,
  CheckCircle,
  Circle,
  CircleNotch,
  Code,
  Database,
  GitBranch,
  MagnifyingGlass,
  Package,
  ShieldCheck,
  TestTube,
  WarningCircle,
} from "@phosphor-icons/react";
import { useState } from "react";
import type { StageId } from "../../domain";

type StageViewProps = {
  stageId: StageId;
  onAction: (message: string) => void;
};

export function OperatorStageView({ stageId, onAction }: StageViewProps) {
  switch (stageId) {
    case "triage":
      return <TriageView />;
    case "scouts":
      return <ScoutsView />;
    case "grill":
      return <GrillView onAction={onAction} />;
    case "specification":
      return <SpecificationView />;
    case "plan":
      return <PlanView />;
    case "implement":
      return <ImplementView onAction={onAction} />;
    case "dev-review":
      return <DevReviewView />;
    case "test":
      return <TestView />;
    case "final-review":
      return <FinalReviewView />;
    case "approval":
      return <ApprovalView />;
  }
}

function SectionTitle({ children }: { children: string }) {
  return (
    <div className="operator-stage-section-title">
      <span>{children}</span>
      <i aria-hidden />
    </div>
  );
}

function TriageView() {
  return (
    <div className="operator-stage-view operator-stage-view--triage">
      <SectionTitle>Routing decision</SectionTitle>
      <div className="operator-route-summary">
        <article>
          <Code size={22} weight="duotone" />
          <span>
            <small>Workflow</small>
            <strong>Implement</strong>
            <p>A repository change with candidate-bound gates.</p>
          </span>
        </article>
        <ArrowRight size={22} className="operator-flow-arrow" />
        <article>
          <WarningCircle size={22} weight="duotone" />
          <span>
            <small>Risk profile</small>
            <strong>High-risk</strong>
            <p>Schema and orchestration boundaries are material.</p>
          </span>
        </article>
        <ArrowRight size={22} className="operator-flow-arrow" />
        <article>
          <MagnifyingGlass size={22} weight="duotone" />
          <span>
            <small>Investigation</small>
            <strong>3 targeted scouts</strong>
            <p>Code path, schema, and test inventory.</p>
          </span>
        </article>
      </div>
      <div className="operator-check-list">
        {[
          "Repository selected and revision captured",
          "Workflow profile fixed before execution",
          "Required evidence gates retained",
        ].map((item) => (
          <span key={item}>
            <CheckCircle size={18} weight="fill" />
            <strong>{item}</strong>
            <small>Ready</small>
          </span>
        ))}
      </div>
    </div>
  );
}

const scouts = [
  ["Code path", "Completed", "12 paths · 4 material"],
  ["Schema", "Completed", "3 migrations · 1 ownership gap"],
  ["Test inventory", "Completed", "4 manifest commands"],
  ["Dependency", "Skipped", "No dependency change requested"],
  ["Pattern", "Skipped", "Existing implementation is canonical"],
  ["User journey", "Skipped", "No interaction-flow change"],
] as const;

function ScoutsView() {
  return (
    <div className="operator-stage-view">
      <SectionTitle>Scout coverage</SectionTitle>
      <div className="operator-scout-grid">
        {scouts.map(([name, status, detail]) => (
          <article key={name} className={status === "Completed" ? "is-complete" : "is-skipped"}>
            {status === "Completed" ? <CheckCircle size={21} weight="fill" /> : <Circle size={21} />}
            <span>
              <strong>{name}</strong>
              <small>{detail}</small>
            </span>
            <em>{status}</em>
          </article>
        ))}
      </div>
      <div className="operator-exception-line">
        <WarningCircle size={18} weight="fill" />
        <span>
          <strong>One evidence gap</strong>
          <small>Migration ownership needs an explicit operator decision in Grill.</small>
        </span>
      </div>
    </div>
  );
}

function GrillView({ onAction }: { onAction: (message: string) => void }) {
  const [answer, setAnswer] = useState("existing");
  return (
    <div className="operator-stage-view operator-grill-view">
      <SectionTitle>Current decision · 3 of 3</SectionTitle>
      <div className="operator-evidence-note">
        <Database size={20} weight="duotone" />
        <span>
          <small>Repository evidence</small>
          <strong>The existing repository service already owns migration execution.</strong>
        </span>
        <span className="badge badge--blue">4 direct claims</span>
      </div>
      <div className="operator-question">
        <small>Material question</small>
        <h3>Where should the new migration lifecycle be owned?</h3>
        <p>Choose the boundary downstream agents must treat as authoritative.</p>
        <div className="operator-answer-list">
          <button
            type="button"
            className={answer === "existing" ? "is-selected" : ""}
            onClick={() => setAnswer("existing")}
          >
            <CheckCircle size={20} weight={answer === "existing" ? "fill" : "regular"} />
            <span>
              <strong>Use the existing repository service</strong>
              <small>Recommended · lowest change risk and one owner.</small>
            </span>
          </button>
          <button
            type="button"
            className={answer === "new" ? "is-selected" : ""}
            onClick={() => setAnswer("new")}
          >
            <Circle size={20} weight={answer === "new" ? "fill" : "regular"} />
            <span>
              <strong>Create a new orchestration boundary</strong>
              <small>More isolation, but duplicates lifecycle ownership.</small>
            </span>
          </button>
        </div>
        <button
          type="button"
          className="button button--primary"
          onClick={() => onAction("Decision recorded for the prototype. Task data was not changed.")}
        >
          Record answer
        </button>
      </div>
    </div>
  );
}

const criteria = [
  ["AC1", "Operator view answers state, health, change, decision, and next action."],
  ["AC2", "All ten task stages remain clickable in the preview."],
  ["AC3", "Evidence view preserves provenance and detailed artifacts."],
  ["AC4", "Preview controls never mutate persisted task state."],
  ["AC5", "Desktop workflow fits the reference viewport without page scrolling."],
] as const;

function SpecificationView() {
  return (
    <div className="operator-stage-view">
      <SectionTitle>Acceptance coverage</SectionTitle>
      <div className="operator-criteria-list">
        {criteria.map(([id, text]) => (
          <article key={id}>
            <span>{id}</span>
            <CheckCircle size={18} weight="fill" />
            <strong>{text}</strong>
            <em>Testable</em>
          </article>
        ))}
      </div>
      <div className="operator-scope-grid">
        <section>
          <small>In scope</small>
          <strong>Operator summaries · stage widgets · evidence switch</strong>
        </section>
        <section>
          <small>Explicitly excluded</small>
          <strong>Runtime mutations · new backend contracts · invented metrics</strong>
        </section>
      </div>
    </div>
  );
}

function PackageNode({ id, title, meta, tone }: { id: string; title: string; meta: string; tone: string }) {
  return (
    <article className={`operator-package operator-package--${tone}`}>
      <Package size={22} weight="duotone" />
      <span>
        <small>{id}</small>
        <strong>{title}</strong>
        <p>{meta}</p>
      </span>
    </article>
  );
}

function PlanView() {
  return (
    <div className="operator-stage-view">
      <SectionTitle>Dependency workbench</SectionTitle>
      <div className="operator-package-flow">
        <div>
          <small>Batch 1</small>
          <PackageNode id="S1" title="Shared contracts" meta="2 owned paths · 4 checks" tone="ready" />
        </div>
        <ArrowRight size={23} className="operator-flow-arrow" />
        <div className="operator-package-stack">
          <small>Batch 2 · parallel</small>
          <PackageNode id="S2" title="Runtime adapter" meta="Depends on S1" tone="ready" />
          <PackageNode id="S3" title="Operator interface" meta="Depends on S1" tone="ready" />
        </div>
        <ArrowRight size={23} className="operator-flow-arrow" />
        <div>
          <small>Batch 3</small>
          <PackageNode id="S4" title="Candidate assembly" meta="Depends on S2 + S3" tone="waiting" />
        </div>
      </div>
      <div className="operator-legend">
        <span>
          <CheckCircle size={16} weight="fill" />
          Ready
        </span>
        <span>
          <Circle size={16} />
          Waiting
        </span>
        <span>
          <GitBranch size={16} />
          No path overlap
        </span>
      </div>
    </div>
  );
}

function ImplementView({ onAction }: { onAction: (message: string) => void }) {
  const [selected, setSelected] = useState("S2");
  return (
    <div className="operator-stage-view">
      <SectionTitle>Implement workbench</SectionTitle>
      <div className="operator-package-flow operator-package-flow--implement">
        <PackageButton item={implementPackages[0]} selected={selected} onSelect={setSelected} />
        <ArrowRight size={23} className="operator-flow-arrow" />
        <div className="operator-package-stack">
          <PackageButton item={implementPackages[1]} selected={selected} onSelect={setSelected} />
          <PackageButton item={implementPackages[2]} selected={selected} onSelect={setSelected} />
        </div>
        <ArrowRight size={23} className="operator-flow-arrow" />
        <PackageButton item={implementPackages[3]} selected={selected} onSelect={setSelected} />
      </div>
      <div className="operator-implement-detail">
        <span>
          <small>Selected package</small>
          <strong>
            {selected} · {implementPackages.find((item) => item.id === selected)?.title}
          </strong>
        </span>
        <button
          type="button"
          className="button button--primary"
          onClick={() => onAction(`${selected} opened in the prototype inspector.`)}
        >
          Inspect package
        </button>
      </div>
    </div>
  );
}

const implementPackages = [
  { id: "S1", title: "Foundation setup", status: "Qualified", detail: "Artifacts ready", tone: "qualified" },
  {
    id: "S2",
    title: "Detector & migration",
    status: "Running",
    detail: "52% · 6 of 11 checks",
    tone: "running",
  },
  { id: "S3", title: "Worker & backend", status: "Qualified", detail: "Artifacts ready", tone: "qualified" },
  { id: "S4", title: "Tender detection run", status: "Waiting", detail: "Waiting on S2", tone: "waiting" },
] as const;

function PackageButton({
  item,
  selected,
  onSelect,
}: {
  item: { id: string; title: string; status: string; detail: string; tone: string };
  selected: string;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      className={`operator-package operator-package--${item.tone} ${selected === item.id ? "is-selected" : ""}`}
      onClick={() => onSelect(item.id)}
    >
      {item.tone === "running" ? (
        <CircleNotch size={22} className="spin" />
      ) : item.tone === "qualified" ? (
        <CheckCircle size={22} weight="fill" />
      ) : (
        <Circle size={22} />
      )}
      <span>
        <small>
          {item.id} · {item.status}
        </small>
        <strong>{item.title}</strong>
        <p>{item.detail}</p>
      </span>
    </button>
  );
}

function DevReviewView() {
  const severities = [
    ["P0", "Critical", "0"],
    ["P1", "High", "0"],
    ["P2", "Medium", "0"],
    ["P3", "Low", "0"],
  ] as const;
  return (
    <div className="operator-stage-view">
      <SectionTitle>Fresh-context verdict</SectionTitle>
      <div className="operator-verdict">
        <CheckCircle size={48} weight="fill" />
        <span>
          <strong>PASS</strong>
          <small>Candidate C1 r2 · no findings</small>
        </span>
      </div>
      <div className="operator-severity-grid">
        {severities.map(([id, label, count]) => (
          <article key={id}>
            <small>
              {id} · {label}
            </small>
            <strong>{count}</strong>
            <span>No findings</span>
          </article>
        ))}
      </div>
      <div className="operator-check-list operator-check-list--inline">
        {[
          "Scope matches specification",
          "Architecture remains cohesive",
          "Verification contract preserved",
        ].map((item) => (
          <span key={item}>
            <CheckCircle size={17} weight="fill" />
            <strong>{item}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

const testResults = [
  ["Lint", "biome lint", "Passed", "4.1s"],
  ["Format", "biome format", "Passed", "2.6s"],
  ["Typecheck", "tsc --noEmit", "Passed", "6.8s"],
  ["Test", "node --test", "Passed", "27.5s"],
] as const;

function TestView() {
  const [selected, setSelected] = useState("Test");
  return (
    <div className="operator-stage-view">
      <SectionTitle>Verification results</SectionTitle>
      <div className="operator-result-summary">
        <span>
          <CheckCircle size={31} weight="fill" />
          <strong>11 passed</strong>
          <small>0 failed</small>
          <small>0 skipped</small>
        </span>
        <div>
          <i style={{ width: "100%" }} />
        </div>
      </div>
      <div className="operator-test-list">
        {testResults.map(([name, command, status, duration]) => (
          <button
            type="button"
            key={name}
            className={selected === name ? "is-selected" : ""}
            onClick={() => setSelected(name)}
          >
            <CheckCircle size={18} weight="fill" />
            <strong>{name}</strong>
            <code>{command}</code>
            <em>{status}</em>
            <small>{duration}</small>
          </button>
        ))}
      </div>
      <div className="operator-test-detail">
        <TestTube size={20} />
        <span>
          <small>Selected result</small>
          <strong>{selected} completed successfully against C1 r2.</strong>
        </span>
      </div>
    </div>
  );
}

const finalStages = [
  ["Triage", "High-risk route fixed"],
  ["Repo scouts", "3 targeted scouts"],
  ["Grill", "3 decisions settled"],
  ["Task spec", "5 criteria approved"],
  ["Impl plan", "4 packages · 3 batches"],
  ["Implement", "C1 r2 assembled"],
  ["Dev review", "PASS · 0 findings"],
  ["Test", "11 checks passed"],
  ["Final review", "READY · 0 blockers"],
] as const;

function FinalReviewView() {
  return (
    <div className="operator-stage-view">
      <SectionTitle>Workflow outcome</SectionTitle>
      <div className="operator-final-grid">
        {finalStages.map(([stage, outcome], index) => (
          <article key={stage}>
            <span>{index + 1}</span>
            <CheckCircle size={18} weight="fill" />
            <strong>{stage}</strong>
            <small>{outcome}</small>
          </article>
        ))}
      </div>
      <div className="operator-readiness">
        <ShieldCheck size={31} weight="duotone" />
        <span>
          <small>Holdout verdict</small>
          <strong>Ready for human approval</strong>
          <p>All required evidence is fresh for candidate C1 r2.</p>
        </span>
      </div>
    </div>
  );
}

function ApprovalView() {
  return (
    <div className="operator-stage-view">
      <SectionTitle>Delivery readiness</SectionTitle>
      <div className="operator-approval-layout">
        <div className="operator-check-list">
          {[
            "Candidate head is exact and immutable",
            "Dev Review evidence is fresh",
            "Test evidence is fresh",
            "Final Review evidence is fresh",
            "Target branch identity is recorded",
          ].map((item) => (
            <span key={item}>
              <CheckCircle size={18} weight="fill" />
              <strong>{item}</strong>
              <small>Ready</small>
            </span>
          ))}
        </div>
        <section className="operator-candidate-card">
          <GitBranch size={26} weight="duotone" />
          <small>Exact candidate</small>
          <strong>C1 revision 2</strong>
          <code>2afbdfb0</code>
          <div>
            <span>
              <small>Target</small>
              <strong>main</strong>
            </span>
            <span>
              <small>Delivery</small>
              <strong>GitHub PR</strong>
            </span>
          </div>
        </section>
      </div>
      <div className="operator-exception-line operator-exception-line--success">
        <ShieldCheck size={18} weight="fill" />
        <span>
          <strong>No blocking residual risk</strong>
          <small>Rollback remains a two-file revert.</small>
        </span>
      </div>
    </div>
  );
}
