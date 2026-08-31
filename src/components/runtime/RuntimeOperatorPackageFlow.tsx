import { ArrowRight, CheckCircle, CircleNotch, Package, WarningCircle } from "@phosphor-icons/react";
import type { RuntimeWorkPackage } from "../../domain";
import type { OperatorPackageBatch } from "./operatorViewModel";

export function RuntimeOperatorPackageFlow({
  batches,
  stageFailed,
  stageError,
}: {
  batches: OperatorPackageBatch[];
  stageFailed: boolean;
  stageError: string | null;
}) {
  const packages = batches.flatMap((batch) => batch.packages);
  if (!packages.length) {
    return (
      <section className={`runtime-operator-packages__empty ${stageFailed ? "is-error" : ""}`}>
        {stageFailed ? <WarningCircle size={22} weight="fill" /> : <Package size={22} weight="duotone" />}
        <span>
          <strong>{stageFailed ? "Package plan unavailable" : "No work packages produced"}</strong>
          <small>
            {stageError ??
              "This task does not yet carry an approved package plan. No package topology is inferred."}
          </small>
        </span>
      </section>
    );
  }

  const single = packages.length === 1;
  return (
    <section
      className={`runtime-operator-packages ${single ? "runtime-operator-packages--single" : ""}`}
      aria-label={single ? "Single work package" : "Dependency-batched work packages"}
    >
      <div className="runtime-operator-packages__canvas">
        {batches.map((batch, index) => (
          <div className="runtime-operator-packages__flow" key={batch.batch}>
            {index > 0 ? (
              <span className="runtime-operator-packages__connector">
                <ArrowRight size={20} aria-hidden />
                <span className="sr-only">Then</span>
              </span>
            ) : null}
            <section className="runtime-operator-batch">
              <header>
                <span>Batch {batch.batch}</span>
                <small>
                  {batch.packages.length === 1
                    ? "1 package"
                    : `${batch.packages.length} packages in parallel`}
                </small>
              </header>
              <div>
                {batch.packages.map((workPackage) => (
                  <PackageCard workPackage={workPackage} key={workPackage.id} />
                ))}
              </div>
            </section>
          </div>
        ))}
      </div>
      <footer className="runtime-operator-packages__legend">
        <span>
          <i className="is-planned" /> Planned
        </span>
        <span>
          <i className="is-running" /> Running
        </span>
        <span>
          <i className="is-ready" /> Ready for integration
        </span>
        <span>
          <i className="is-integrated" /> Integrated
        </span>
        <span>
          <i className="is-failed" /> Failed
        </span>
      </footer>
    </section>
  );
}

function PackageCard({ workPackage }: { workPackage: RuntimeWorkPackage }) {
  const Icon =
    workPackage.status === "running"
      ? CircleNotch
      : workPackage.status === "failed"
        ? WarningCircle
        : ["ready_for_integration", "integrated"].includes(workPackage.status)
          ? CheckCircle
          : Package;
  const dependencies = (workPackage.dependencies ?? []).length
    ? `Depends on ${(workPackage.dependencies ?? []).join(" + ")}`
    : "No package dependencies";
  return (
    <article className={`runtime-operator-package runtime-operator-package--${workPackage.status}`}>
      <Icon
        size={20}
        weight={workPackage.status === "planned" ? "duotone" : "fill"}
        className={workPackage.status === "running" ? "spin" : undefined}
      />
      <span>
        <small>
          {workPackage.id} · {packageStatusLabel(workPackage.status)}
        </small>
        <strong>{workPackage.title}</strong>
        <p>{dependencies}</p>
        {workPackage.error ? <em>{workPackage.error}</em> : null}
        {workPackage.retainedContinuation ? (
          <em className="runtime-operator-package__continuation">
            Retained continuation · {workPackage.retainedContinuation.files?.length ?? 0} changed file
            {(workPackage.retainedContinuation.files?.length ?? 0) === 1 ? "" : "s"}
            {workPackage.retainedContinuation.qualificationFailure
              ? ` · requalification required: ${workPackage.retainedContinuation.qualificationFailure}`
              : " · exact worktree validation required"}
          </em>
        ) : workPackage.retainedForRequalification ? (
          <em className="runtime-operator-package__continuation">
            Retained for requalification
            {workPackage.retainedReplacementReason
              ? ` · ${workPackage.retainedReplacementReason.replaceAll("-", " ")}`
              : ""}
          </em>
        ) : null}
      </span>
      <dl>
        <div>
          <dt>Attempts</dt>
          <dd>{workPackage.attempts}</dd>
        </div>
        <div>
          <dt>Checks</dt>
          <dd>{workPackage.verification?.length ?? 0}</dd>
        </div>
        <div>
          <dt>Files</dt>
          <dd>{workPackage.files?.length ?? 0}</dd>
        </div>
      </dl>
    </article>
  );
}

function packageStatusLabel(status: RuntimeWorkPackage["status"]) {
  if (status === "ready_for_integration") return "Ready for integration";
  return `${status.charAt(0).toUpperCase()}${status.slice(1)}`;
}
