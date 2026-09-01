import { ArrowRight, CheckCircle, CircleNotch, Package, WarningCircle } from "@phosphor-icons/react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
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
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (
      !packages.some(
        (workPackage) =>
          workPackage.status === "failed" ||
          workPackage.status === "running" ||
          workPackage.retainedContinuation ||
          workPackage.retainedForRequalification,
      )
    )
      return;
    const viewport = viewportRef.current;
    const exception =
      viewport?.querySelector<HTMLElement>(".runtime-operator-package--failed") ??
      viewport?.querySelector<HTMLElement>("[data-package-exception='true']");
    if (viewport && exception) {
      viewport.scrollLeft = Math.max(
        0,
        exception.offsetLeft - (viewport.clientWidth - exception.offsetWidth) / 2,
      );
      viewport.scrollTop = Math.max(
        0,
        exception.offsetTop - (viewport.clientHeight - exception.offsetHeight) / 2,
      );
    }
  }, [packages]);
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
  const statusOrder: RuntimeWorkPackage["status"][] = [
    "failed",
    "running",
    "ready_for_integration",
    "integrated",
    "planned",
  ];
  return (
    <section
      className={`runtime-operator-packages ${single ? "runtime-operator-packages--single" : ""}`}
      aria-label={single ? "Single work package" : "Dependency-batched work packages"}
    >
      <section
        className="runtime-operator-packages__viewport"
        ref={viewportRef}
        tabIndex={single ? undefined : 0}
        aria-label={single ? "Single package viewport" : "Scrollable package dependency lanes"}
        onKeyDown={single ? undefined : scrollPackageViewport}
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
                    <PackageCard
                      workPackage={workPackage}
                      key={workPackage.id}
                      expanded={
                        workPackage.status === "failed" ||
                        workPackage.status === "running" ||
                        Boolean(workPackage.retainedContinuation || workPackage.retainedForRequalification) ||
                        selectedPackageId === workPackage.id
                      }
                      single={single}
                      onToggle={() =>
                        setSelectedPackageId((current) =>
                          current === workPackage.id ? null : workPackage.id,
                        )
                      }
                    />
                  ))}
                </div>
              </section>
            </div>
          ))}
        </div>
      </section>
      {!single ? (
        <footer className="runtime-operator-packages__summary">
          <span>Package status</span>
          {statusOrder.flatMap((status) => {
            const count = packages.filter((workPackage) => workPackage.status === status).length;
            return count ? (
              <strong key={status} className={`is-${status}`}>
                {packageStatusLabel(status)} {count}
              </strong>
            ) : (
              []
            );
          })}
          <small>Scroll locally to inspect later dependency batches.</small>
        </footer>
      ) : null}
    </section>
  );
}

function scrollPackageViewport(event: KeyboardEvent<HTMLDivElement>) {
  const movement: Record<string, ScrollToOptions> = {
    ArrowDown: { top: 56 },
    ArrowUp: { top: -56 },
    ArrowRight: { left: 96 },
    ArrowLeft: { left: -96 },
    PageDown: { top: event.currentTarget.clientHeight * 0.8 },
    PageUp: { top: event.currentTarget.clientHeight * -0.8 },
  };
  const delta = movement[event.key];
  if (!delta) return;
  event.preventDefault();
  event.currentTarget.scrollBy({ ...delta, behavior: "smooth" });
}

function PackageCard({
  workPackage,
  expanded,
  single,
  onToggle,
}: {
  workPackage: RuntimeWorkPackage;
  expanded: boolean;
  single: boolean;
  onToggle: () => void;
}) {
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
  const exceptional =
    workPackage.status === "failed" ||
    workPackage.status === "running" ||
    Boolean(workPackage.retainedContinuation || workPackage.retainedForRequalification);
  return (
    <button
      type="button"
      className={`runtime-operator-package runtime-operator-package--${workPackage.status} ${expanded ? "is-expanded" : ""}`}
      aria-expanded={expanded}
      onClick={onToggle}
      data-package-exception={exceptional ? "true" : undefined}
    >
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
        {!single || (workPackage.dependencies?.length ?? 0) > 0 ? <p>{dependencies}</p> : null}
        {expanded && workPackage.error ? <em>{workPackage.error}</em> : null}
        {expanded && workPackage.retainedContinuation ? (
          <em className="runtime-operator-package__continuation">
            Retained continuation · {workPackage.retainedContinuation.files?.length ?? 0} changed file
            {(workPackage.retainedContinuation.files?.length ?? 0) === 1 ? "" : "s"}
            {workPackage.retainedContinuation.qualificationFailure
              ? ` · requalification required: ${workPackage.retainedContinuation.qualificationFailure}`
              : " · exact worktree validation required"}
          </em>
        ) : expanded && workPackage.retainedForRequalification ? (
          <em className="runtime-operator-package__continuation">
            Retained for requalification
            {workPackage.retainedReplacementReason
              ? ` · ${workPackage.retainedReplacementReason.replaceAll("-", " ")}`
              : ""}
          </em>
        ) : null}
      </span>
      {expanded ? (
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
      ) : null}
    </button>
  );
}

function packageStatusLabel(status: RuntimeWorkPackage["status"]) {
  if (status === "ready_for_integration") return "Ready for integration";
  return `${status.charAt(0).toUpperCase()}${status.slice(1)}`;
}
