import { useId, useLayoutEffect, useRef, useState } from "react";
import type { RuntimeWorkPackage } from "../../domain";
import { packageState, splitRecordedDetail } from "../runtime/presentation";

interface Connection {
  from: string;
  to: string;
  path: string;
}

/** Connect the rendered cards, including uneven batches and wrapped long names. */
export function PackageDiagram({
  packages,
  selectedId,
  onSelect,
}: {
  packages: RuntimeWorkPackage[];
  selectedId?: string;
  onSelect(id: string): void;
}) {
  const root = useRef<HTMLElement>(null);
  const arrow = useId().replaceAll(":", "");
  const [connections, setConnections] = useState<Connection[]>([]);
  const batches = [...new Set(packages.map((item) => item.batch))].sort((a, b) => a - b);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const measure = () => {
      const bounds = element.getBoundingClientRect();
      const nodes = new Map(
        Array.from(element.querySelectorAll<HTMLElement>("[data-package-id]")).map((node) => [
          node.dataset.packageId,
          node.getBoundingClientRect(),
        ]),
      );
      const next: Connection[] = [];
      for (const item of packages) {
        const target = nodes.get(item.id);
        if (!target) continue;
        for (const id of item.dependencies) {
          const source = nodes.get(id);
          if (!source) continue;
          let path: string;
          const sourcePackage = packages.find((entry) => entry.id === id);
          const sourceWrapped = packages.filter((entry) => entry.batch === sourcePackage?.batch).length > 2;
          const targetWrapped = packages.filter((entry) => entry.batch === item.batch).length > 2;
          if (sourceWrapped || targetWrapped) {
            // Wrapped batches use the central gutter so edges never pass through other cards.
            const spine = bounds.width / 2;
            const sourceLeft = source.left + source.width / 2 < bounds.left + spine;
            const targetLeft = target.left + target.width / 2 < bounds.left + spine;
            const x1 =
              (sourceWrapped ? (sourceLeft ? source.right : source.left) : source.left + source.width / 2) -
              bounds.left;
            const y1 = (sourceWrapped ? source.top + source.height / 2 : source.bottom) - bounds.top;
            const x2 =
              (targetWrapped
                ? targetLeft
                  ? target.right + 4
                  : target.left - 4
                : target.left + target.width / 2) - bounds.left;
            const y2 = (targetWrapped ? target.top + target.height / 2 : target.top - 4) - bounds.top;
            path = `M${x1},${y1} H${spine} V${y2} H${x2}`;
          } else if (target.top >= source.bottom) {
            const x1 = source.left + source.width / 2 - bounds.left;
            const x2 = target.left + target.width / 2 - bounds.left;
            const y1 = source.bottom - bounds.top;
            const y2 = target.top - bounds.top;
            const middle = y1 + (y2 - y1) / 2;
            path = `M${x1},${y1} V${middle} H${x2} V${y2 - 4}`;
          } else {
            // Same-batch dependencies are not parallel: route between facing sides.
            const forward = target.left > source.left;
            const x1 = (forward ? source.right : source.left) - bounds.left;
            const x2 = (forward ? target.left : target.right) - bounds.left;
            const y1 = source.top + source.height / 2 - bounds.top;
            const y2 = target.top + target.height / 2 - bounds.top;
            const middle = (x1 + x2) / 2;
            path = `M${x1},${y1} H${middle} V${y2} H${x2 + (forward ? -4 : 4)}`;
          }
          next.push({ from: id, to: item.id, path });
        }
      }
      setConnections(next);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    element.querySelectorAll("[data-package-id]").forEach((node) => {
      observer.observe(node);
    });
    measure();
    return () => observer.disconnect();
  }, [packages]);
  return (
    <section className="dependency-flow" ref={root} aria-label="Recorded package dependencies">
      <svg className="package-connections" aria-hidden="true">
        <defs>
          <marker
            id={arrow}
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M0 0 L8 4 L0 8 Z" fill="context-stroke" />
          </marker>
        </defs>
        {connections.map((edge) => (
          <path
            key={`${edge.from}:${edge.to}`}
            data-dependency={`${edge.from}:${edge.to}`}
            className={edge.from === selectedId || edge.to === selectedId ? "selected-path" : ""}
            d={edge.path}
            markerEnd={`url(#${arrow})`}
          />
        ))}
      </svg>
      {batches.map((batch, index) => {
        const members = packages.filter((item) => item.batch === batch);
        const linkedWithinBatch = members.some((item) =>
          item.dependencies.some((id) => members.some((other) => other.id === id)),
        );
        return (
          <section
            className={`dependency-batch ${members.length === 1 ? "single" : members.length > 2 ? "wrapped" : ""}`}
            key={batch}
          >
            <h4>
              Batch {batch}
              <small>
                ·{" "}
                {members.length > 1
                  ? linkedWithinBatch
                    ? "Dependent work"
                    : "Parallel work"
                  : index
                    ? "Dependency gate"
                    : "Foundation"}
              </small>
            </h4>
            <div className={members.length > 1 ? "parallel-packages" : ""}>
              {members.map((item) => (
                <article
                  key={item.id}
                  data-package-id={item.id}
                  className={`package ${item.status} ${item.id === selectedId ? "selected" : ""}`}
                >
                  <button
                    type="button"
                    className="package-select"
                    aria-label={`Inspect package ${item.id}: ${item.title}`}
                    aria-pressed={item.id === selectedId}
                    title={
                      item.dependencies.length
                        ? `Depends on ${item.dependencies.join(" + ")}`
                        : "No package dependencies"
                    }
                    onClick={() => onSelect(item.id)}
                  >
                    <span className="package-id">{item.id}</span>
                    <span>
                      <strong>{item.title}</strong>
                      <small>{packageState(item, packages)}</small>
                    </span>
                  </button>
                  {item.status === "failed" && (
                    <p className="package-headline">
                      {splitRecordedDetail(item.error ?? item.description).headline}
                    </p>
                  )}
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </section>
  );
}
