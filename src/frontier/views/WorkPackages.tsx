import { ArrowLeft, ArrowRight, Binoculars } from "@phosphor-icons/react";
import { usePanelState } from "../app/panel-state";
import type { RuntimeRun, RuntimeWorkPackage } from "../../domain";
import { packageState } from "../runtime/presentation";

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
  const [selectedId, setSelectedId] = usePanelState<string | null>(
    `package:${taskId}:${stage}`,
    stage === "implement"
      ? (packages.find((item) => item.status === "failed")?.id ??
          packages.find((item) => item.status === "running")?.id ??
          null)
      : null,
  );
  const selected = packages.find((item) => item.id === selectedId);
  const run = [...runs]
    .filter((item) => item.workPackageId === selectedId)
    .sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""))[0];
  const batches = [...new Set(packages.map((item) => item.batch))].sort((a, b) => a - b);
  return (
    <section className="workflow-card package-workbench">
      <div className="section-heading">
        <h3>
          {selected
            ? `${selected.id} · ${selected.title}`
            : packages.length === 1
              ? "Delivery slice"
              : "Dependency plan"}
        </h3>
        {selected && (
          <button type="button" onClick={() => setSelectedId(null)}>
            <ArrowLeft size={17} />
            Back to packages
          </button>
        )}
      </div>
      <p className="quiet">
        {packages.filter((item) => item.status === "running").length} running ·{" "}
        {packages.filter((item) => item.status === "ready_for_integration").length} ready for integration ·{" "}
        {packages.filter((item) => item.status === "integrated").length} integrated
      </p>
      {!selected ? (
        <div className="dependency-batches">
          {batches.map((batch) => (
            <section key={batch} className="dependency-batch">
              <h4>
                Batch {batch} {packages.filter((item) => item.batch === batch).length > 1 ? "· parallel" : ""}
              </h4>
              <div>
                {packages
                  .filter((item) => item.batch === batch)
                  .map((item) => (
                    <article key={item.id} className={`package ${item.status}`}>
                      <button
                        type="button"
                        className="package-select"
                        aria-label={`Inspect package ${item.id}`}
                        onClick={() => setSelectedId(item.id)}
                      >
                        <span>
                          <strong>
                            {item.id} · {item.title}
                          </strong>
                          <small>{packageState(item, packages)}</small>
                        </span>
                        <ArrowRight size={18} />
                      </button>
                      {["running", "failed"].includes(item.status) && <p>{item.error ?? item.description}</p>}
                      <small>
                        {item.dependencies.length
                          ? `Depends on ${item.dependencies.join(", ")}`
                          : "No dependencies"}
                      </small>
                    </article>
                  ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <section className="package-detail" aria-label={`Selected package ${selected.id}`}>
          <p>
            {packageState(selected, packages)} · {selected.error ?? selected.description}
          </p>
          <dl>
            <dt>Owned paths</dt>
            <dd>{selected.ownedPaths.join(", ") || "Not recorded"}</dd>
            <dt>Dependencies</dt>
            <dd>{selected.dependencies.join(", ") || "None"}</dd>
            <dt>Verification</dt>
            <dd>{selected.verification.join(" · ") || "Not recorded"}</dd>
            <dt>Command IDs</dt>
            <dd>{selected.verificationCommandIds?.join(", ") || "Not recorded"}</dd>
            <dt>Attempt</dt>
            <dd>{selected.attempts}</dd>
            <dt>Slice commit</dt>
            <dd>{selected.headRevision ?? "Not recorded"}</dd>
            <dt>Changed files</dt>
            <dd>{selected.files.join(", ") || "Not recorded"}</dd>
            <dt>Retained worktree</dt>
            <dd>{selected.worktreePath ?? "Not recorded"}</dd>
          </dl>
          {selected.verificationRuns?.map((verification) => (
            <p key={`${verification.candidateRevision}:${verification.startedAt}:${verification.command}`}>
              Qualification: {verification.status} · {verification.command} ·{" "}
              {verification.durationMs == null ? "Time unavailable" : `${verification.durationMs / 1000}s`}
            </p>
          ))}
          {run ? (
            <button type="button" onClick={() => onWatch(run.id)}>
              <Binoculars size={18} />
              Watch {selected.id} worker
            </button>
          ) : (
            <p className="quiet">No recorded run is loaded for this package.</p>
          )}
        </section>
      )}
    </section>
  );
}
