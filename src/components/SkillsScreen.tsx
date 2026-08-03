import { ArrowLeft, ArrowRight, CaretDown, Code } from "@phosphor-icons/react";
import domainRuntimeSource from "../domain.ts?raw";
import type { RuntimeTask, StageId } from "../domain";
import apiRuntimeSource from "../../server/api.mjs?raw";
import promptRuntimeSource from "../../server/prompts.mjs?raw";
import scoutRuntimeSource from "../../server/scouts.mjs?raw";
import parserRuntimeSource from "../../server/structured-output.mjs?raw";
import { stageUsage } from "./LibraryShared";
import { SectionHeader } from "./Primitives";
import { formatApproximateCost, formatTokenCount, workflowStages } from "../domain";

type TypeReference = { label: string; file: string; description: string; code: string };
type SourceReference = { label: string; file: string; symbol: string; description: string; code: string };
type SkillContract = {
  input: TypeReference;
  persisted: TypeReference;
  ui: TypeReference;
  prompt: SourceReference | null;
  promptDefinition: SourceReference | null;
  parser: SourceReference | null;
  parserNote?: string;
};

const typeReferences = {
  task: typeReference("RuntimeTask", "Prompt input", "The prompt builders receive the persisted task and select its retained context."),
  artifact: typeReference("RuntimeArtifact", "RuntimeArtifact", "The runner retains the Markdown result, model, reasoning, usage, and context manifest in .data/tasks.json."),
  artifactUi: typeReference("RuntimeTask", "RuntimeTask.artifacts", "The UI receives persisted artifacts through the typed /api/tasks response; it does not manufacture run results."),
  scoutDispatch: typeReference("RuntimeScoutDispatch", "RuntimeScoutDispatch", "Triage routing is stored on the task as a selected/skipped scout dispatch."),
  grill: typeReference("RuntimeGrillSession", "RuntimeGrillSession", "The parsed questions are retained alongside the Markdown decision brief and drive the Grill UI."),
  workPackages: typeReference("RuntimeWorkPackage", "RuntimeWorkPackage[]", "The parsed work-package manifest is stored on the task and rendered by Implement."),
  focusedTests: typeReference("RuntimeFocusedTestEvidence", "RuntimeFocusedTestEvidence", "The normalized focused-test block is persisted on the Markdown artifact and rendered as test rows."),
  candidate: typeReference("RuntimeCandidate", "RuntimeCandidate", "The implementation result is bound to a persisted candidate revision, not merely a green slice."),
  approval: typeReference("RuntimeApproval", "RuntimeApproval[]", "Human approval records an operator decision; it is not a model artifact or a generated verdict."),
} as const;

const promptBuilder = (stageId: StageId): SourceReference => {
  if (stageId === "scouts") {
    return sourceReference("Prompt builder", "server/scouts.mjs", "buildScoutRequest", "Each selected scout receives fresh, read-only task and triage context.", scoutRuntimeSource, "export function buildScoutRequest", "export function parseScoutReport");
  }
  if (["implement", "dev-review", "test", "final-review"].includes(stageId)) {
    return sourceReference("Prompt builder", "server/prompts.mjs", "buildExecutionRequest", "Candidate-bound stages build their prompt from the exact candidate and retained artifacts.", promptRuntimeSource, "export function buildExecutionRequest", "export function buildWorkPackagePrompt");
  }
  return sourceReference("Prompt builder", "server/prompts.mjs", "buildStageRequest", "Read-only stages build a prompt from the task and limited retained artifacts.", promptRuntimeSource, "export function buildStageRequest", "export function buildExecutionPrompt");
};

const parserByStage: Partial<Record<StageId, SourceReference>> = {
  triage: sourceReference("Parser", "server/scouts.mjs", "selectScoutDispatch", "Reads the optional tagged scout-dispatch block and applies the task-priority cap.", scoutRuntimeSource, "export function selectScoutDispatch", "export function buildScoutRequest"),
  scouts: sourceReference("Parser", "server/scouts.mjs", "parseScoutReport", "Normalizes each selected scout's tagged JSON report before it is rendered as persisted Markdown evidence.", scoutRuntimeSource, "export function parseScoutReport", "export function scoutReportMarkdown"),
  grill: sourceReference("Parser", "server/structured-output.mjs", "parseGrillQuestions", "Validates the tagged grill-questions JSON before storing a RuntimeGrillSession.", parserRuntimeSource, "export function parseGrillQuestions", "export function parseFocusedTestEvidence"),
  plan: sourceReference("Parser", "server/structured-output.mjs", "parseWorkPackages", "Validates IDs, dependency order, safe owned paths, and parallel ownership before storing work packages.", parserRuntimeSource, "export function parseWorkPackages", "function normalizeOwnedPath"),
  test: sourceReference("Parser", "server/structured-output.mjs", "tryParseFocusedTestEvidence", "Keeps the Markdown narrative and, when present, parses candidate-bound focused test rows.", parserRuntimeSource, "export function tryParseFocusedTestEvidence", "export function parseWorkPackages"),
};

function contractFor(stageId: StageId): SkillContract {
  const base = {
    input: typeReferences.task,
    persisted: typeReferences.artifact,
    ui: typeReferences.artifactUi,
    prompt: stageId === "approval" ? null : promptBuilder(stageId),
    promptDefinition: stageId === "approval" || stageId === "scouts" ? null : stageDefinition(stageId),
    parser: parserByStage[stageId] ?? null,
    parserNote: parserByStage[stageId] ? undefined : "No structured parser runs for this stage. The Markdown response is retained as RuntimeArtifact.content.",
  };
  if (stageId === "triage") return { ...base, ui: typeReferences.scoutDispatch };
  if (stageId === "grill") return { ...base, ui: typeReferences.grill };
  if (stageId === "plan") return { ...base, ui: typeReferences.workPackages };
  if (stageId === "implement") return { ...base, ui: typeReferences.candidate };
  if (stageId === "test") return { ...base, ui: typeReferences.focusedTests };
  if (stageId === "approval") {
    return {
      input: typeReferences.candidate,
      persisted: typeReferences.approval,
      ui: typeReferences.approval,
      prompt: sourceReference("Human action", "server/api.mjs", "approve-merge route", "The API dispatches the human fast-forward merge action; no model prompt is generated.", apiRuntimeSource, 'if (action === "approve-merge")', 'if (action === "grant-retry")'),
      promptDefinition: null,
      parser: null,
      parserNote: "Human Approval is deterministic: it has no model prompt or model-output parser.",
    };
  }
  return base;
}

export function SkillsScreen({
  runtimeTasks,
  selectedId,
  onSelect,
}: {
  runtimeTasks: RuntimeTask[];
  selectedId: StageId | null;
  onSelect: (stageId: StageId | null) => void;
}) {
  const selected = workflowStages.find((stage) => stage.id === selectedId);
  if (selected) {
    const usage = stageUsage(runtimeTasks, selected.id);
    const contract = contractFor(selected.id);
    return (
      <div className="page library-page detail-page skill-detail-page">
        <button type="button" className="detail-back" onClick={() => onSelect(null)}><ArrowLeft size={16} /> Back to Skills</button>
        <SectionHeader eyebrow="Runtime capability" title={selected.skill} description={`${selected.label} is a workflow-stage contract executed by ${selected.provider === "harness" ? "the deterministic harness" : "the configured Codex runtime"}.`} />
        <div className="detail-metrics detail-metrics--truthful">
          <Metric label="Recorded artifacts" value={String(usage.runs)} />
          <Metric label="Recorded tokens" value={formatTokenCount(usage.tokens)} />
          <Metric label="Approx. API-rate cost" value={usage.pricedRuns ? formatApproximateCost(usage.cost) : "Unavailable"} />
          <Metric label="Source set" value={selected.id === "scouts" ? "prompts + scouts" : selected.id === "approval" ? "API action" : "prompts"} />
        </div>
        <section className="skill-contract-map">
          <header><span><h3>Contract boundary</h3><p>These are actual runtime domain/API types. They identify the data passed in, retained by the runtime, and read by the UI; they are not a speculative schema.</p></span></header>
          <div className="skill-contract-map__grid">
            <TypeReferenceCard label="Input type" reference={contract.input} />
            <TypeReferenceCard label="Persisted artifact" reference={contract.persisted} />
            <TypeReferenceCard label="UI type" reference={contract.ui} />
          </div>
        </section>
        <section className="skill-runtime-sources">
          <header><span><h3>Actual JavaScript runtime sources</h3><p>Prompt and parser code below is read-only source from the local runtime. A parser may add structured task state while the original Markdown artifact remains retained.</p></span></header>
          <div className="skill-source-list">
            {contract.promptDefinition ? <SourceDisclosure source={contract.promptDefinition} /> : null}
            {contract.prompt ? <SourceDisclosure source={contract.prompt} /> : null}
            {contract.parser ? <SourceDisclosure source={contract.parser} /> : <div className="skill-source-note"><strong>Parser</strong><span>{contract.parserNote}</span></div>}
          </div>
        </section>
      </div>
    );
  }
  return (
    <div className="page library-page">
      <SectionHeader eyebrow="Runtime contracts" title="Skills" description="These are the ten actual workflow-stage capabilities. Metrics are limited to persisted artifacts and reported tokens." />
      <div className="skill-list">
        {workflowStages.map((stage) => {
          const usage = stageUsage(runtimeTasks, stage.id);
          return (
            <button className="skill-row" type="button" key={stage.id} onClick={() => onSelect(stage.id)}>
              <Code size={20} />
              <span><strong>{stage.skill}</strong><small>{stage.label} · {stage.provider === "harness" ? "deterministic harness" : "Codex prompt"}</small></span>
              <span className="skill-metric"><strong>{usage.runs}</strong><small>recorded artifacts</small></span>
              <span className="skill-metric"><strong>{formatTokenCount(usage.tokens)}</strong><small>recorded tokens</small></span>
              <ArrowRight size={16} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TypeReferenceCard({ label, reference }: { label: string; reference: TypeReference }) {
  return (
    <details className="skill-type-card">
      <summary><span><small>{label}</small><strong>{reference.label}</strong><em>{reference.description}</em></span><code>{reference.file}</code><CaretDown size={16} /></summary>
      <pre className="runtime-source"><code>{reference.code}</code></pre>
    </details>
  );
}

function SourceDisclosure({ source }: { source: SourceReference }) {
  return (
    <details className="skill-source">
      <summary><span><small>{source.label}</small><strong>{source.symbol}</strong><em>{source.description}</em></span><code>{source.file}</code><CaretDown size={16} /></summary>
      <pre className="runtime-source"><code>{source.code}</code></pre>
    </details>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function typeReference(name: string, label: string, description: string): TypeReference {
  return { label, file: "src/domain.ts", description, code: sourceBlock(domainRuntimeSource, `export interface ${name}`, "\n}\n") };
}

function stageDefinition(stageId: StageId): SourceReference {
  const key = stageId.includes("-") ? `"${stageId}"` : stageId;
  return sourceReference("Prompt definition", "server/prompts.mjs", `STAGE_PROMPTS.${stageId}`, "The stage label, artifact filename, instructions, and required Markdown headings.", promptRuntimeSource, `  ${key}: {`, "\n  },");
}

function sourceReference(label: string, file: string, symbol: string, description: string, source: string, start: string, end: string): SourceReference {
  return { label, file, symbol, description, code: sourceBlock(source, start, end) };
}

function sourceBlock(source: string, startMarker: string, endMarker: string) {
  const start = source.indexOf(startMarker);
  if (start < 0) return "Source declaration was not found in this local runtime checkout.";
  const end = source.indexOf(endMarker, start + startMarker.length);
  return source.slice(start, end < 0 ? Math.min(source.length, start + 5_000) : end + endMarker.length).trim();
}
