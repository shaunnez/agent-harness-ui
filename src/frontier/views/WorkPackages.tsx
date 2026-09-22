import {
  Binoculars,
  Code,
  Cube,
  Flask,
  FolderOpen,
  GitCommit,
  Graph,
  Link,
  ShieldCheck,
} from "@phosphor-icons/react";
import type { RuntimeRun, RuntimeWorkPackage } from "../../domain";
import { usePanelState } from "../app/panel-state";
import { packageState, splitRecordedDetail } from "../runtime/presentation";
import { ScrollArea } from "../ui/ScrollArea";
import { PackageDiagram } from "./PackageDiagram";

export function WorkPackages({
  packages,
  runs,
  onWatch,
  taskId,
  stage,
}: {
  packages: RuntimeWorkPackage[];
  runs: RuntimeRun[];
  onWatch(runId: string): void;
  taskId: string;
  stage: string;
}) {
  const preferred =
    packages.find((item) => item.status === "failed") ??
    packages.find((item) => item.status === "running") ??
    (stage === "implement" ? packages.at(-1) : packages[0]);
  const [selectedId, setSelectedId] = usePanelState<string | null>(
    `package:${taskId}:${stage}`,
    preferred?.id ?? null,
  );
  const selected = packages.find((item) => item.id === selectedId) ?? packages[0];
  const run = [...runs]
    .filter((item) => item.workPackageId === selected?.id)
    .sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""))[0];
  const counts = {
    running: packages.filter((item) => item.status === "running").length,
    ready: packages.filter((item) => item.status === "ready_for_integration").length,
    integrated: packages.filter((item) => item.status === "integrated").length,
    waiting: packages.filter(
      (item) =>
        item.status === "planned" && (stage === "plan" || packageState(item, packages).startsWith("Waiting")),
    ).length,
    queued: packages.filter(
      (item) => item.status === "planned" && packageState(item, packages) === "Ready to start",
    ).length,
    failed: packages.filter((item) => item.status === "failed").length,
  };

  if (!packages.length)
    return (
      <section className="workflow-card package-workbench">
        <div className="section-heading">
          <h3>{stage === "plan" ? "Plan overview" : "Work packages"}</h3>
        </div>
        <p className="quiet">No work packages are recorded for this stage.</p>
      </section>
    );

  return (
    <section className="package-workbench" aria-label="Work packages">
      <section className="workflow-card package-overview">
        <div className="panel-heading">
          <span>
            <Graph size={18} />
            <h3>{stage === "plan" ? "Plan overview" : "Work packages"}</h3>
          </span>
          <small>
            {packages.length} {packages.length === 1 ? "package" : "packages"}
          </small>
        </div>
        {stage !== "plan" && (
          <fieldset className="package-status-summary">
            <legend className="sr-only">Work package totals</legend>
            <span>
              <strong>{counts.running}</strong>
              <small>Running</small>
            </span>
            <span>
              <strong>{counts.ready}</strong>
              <small>Ready to integrate</small>
            </span>
            <span>
              <strong>{counts.integrated}</strong>
              <small>Integrated</small>
            </span>
            <span>
              <strong>{counts.waiting}</strong>
              <small>{stage === "plan" ? "Planned" : "Waiting"}</small>
            </span>
          </fieldset>
        )}
        {stage === "implement" && counts.queued > 0 && (
          <p className="package-queued-total">{counts.queued} ready to start</p>
        )}
        {counts.failed > 0 && <p className="package-failed-total">{counts.failed} failed qualification</p>}
        <PackageDiagram
          packages={packages}
          selectedId={selected?.id}
          onSelect={setSelectedId}
          planning={stage === "plan"}
        />
        <p className="package-plan-note">
          Connections show recorded dependencies. Qualified slices still require candidate review and tests.
        </p>
      </section>

      {selected && (
        <section className="workflow-card package-detail" aria-label={`Selected package ${selected.id}`}>
          <div className="panel-heading">
            <span>
              <Cube size={18} />
              <h3>Selected package</h3>
            </span>
          </div>
          <div className="package-detail-title">
            <div>
              <h3>{selected.title}</h3>
              <span className={`package-state ${selected.status}`}>
                {stage === "plan" && selected.status === "planned"
                  ? "Planned"
                  : packageState(selected, packages)}
              </span>
            </div>
            <strong>{selected.id}</strong>
          </div>
          {(() => {
            const { headline, body } = splitRecordedDetail(selected.error ?? selected.description);
            return (
              <>
                <p className="package-purpose">{headline}</p>
                {body && (
                  <ScrollArea
                    className="package-failure-output"
                    label={`${selected.id} qualification output`}
                  >
                    <pre>{body}</pre>
                  </ScrollArea>
                )}
              </>
            );
          })()}
          <dl className="package-detail-list">
            <div>
              <Code size={18} />
              <span>
                <dt>Owned paths</dt>
                <dd>
                  <code>{selected.ownedPaths.join(", ") || "Not recorded"}</code>
                </dd>
              </span>
            </div>
            <div>
              <Link size={18} />
              <span>
                <dt>Dependencies</dt>
                <dd>
                  {selected.dependencies
                    .map(
                      (id) =>
                        `${id} · ${packages.find((item) => item.id === id)?.title ?? "Unloaded package"}`,
                    )
                    .join("; ") || "None"}
                </dd>
              </span>
            </div>
            <div>
              <Flask size={18} />
              <span>
                <dt>Verification</dt>
                <dd>
                  <code>{selected.verification.join(" · ") || "Not recorded"}</code>
                  <small className="package-record-note">
                    Command IDs: {selected.verificationCommandIds?.join(", ") || "Not recorded"}
                  </small>
                </dd>
              </span>
            </div>
            {(stage !== "plan" || selected.headRevision || selected.files.length > 0) && (
              <div>
                <GitCommit size={18} />
                <span>
                  <dt>Slice commit</dt>
                  <dd>
                    <code>{selected.headRevision ?? "Not recorded"}</code>
                    <small className="package-record-note">
                      Changed files: {selected.files.join(", ") || "Not recorded"}
                    </small>
                  </dd>
                </span>
              </div>
            )}
            {(stage !== "plan" || (selected.verificationRuns?.length ?? 0) > 0) && (
              <div>
                <ShieldCheck size={18} />
                <span>
                  <dt>Qualification</dt>
                  <dd>
                    {selected.verificationRuns?.length
                      ? selected.verificationRuns.map((item) => item.status).join(" · ")
                      : "No result recorded yet"}
                  </dd>
                </span>
              </div>
            )}
            {(stage !== "plan" || selected.worktreePath) && (
              <div>
                <FolderOpen size={18} />
                <span>
                  <dt>Retained worktree</dt>
                  <dd>
                    <code>{selected.worktreePath ?? "Not recorded"}</code>
                  </dd>
                </span>
              </div>
            )}
          </dl>
          {selected.verificationRuns?.map((verification) => (
            <p
              className="qualification-record"
              key={`${verification.candidateRevision}:${verification.startedAt}:${verification.command}`}
            >
              Qualification: {verification.status} · {verification.command} ·{" "}
              {verification.durationMs == null ? "Time unavailable" : `${verification.durationMs / 1000}s`}
            </p>
          ))}
          <div className="package-detail-footer">
            <small>
              Attempt {selected.attempts} · {run ? `worker ${run.status}` : "no loaded run"}
            </small>
            {run && (
              <button type="button" onClick={() => onWatch(run.id)}>
                <Binoculars size={18} />
                Inspect package run
              </button>
            )}
          </div>
        </section>
      )}
    </section>
  );
}
