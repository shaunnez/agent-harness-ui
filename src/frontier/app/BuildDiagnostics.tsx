import { useState } from "react";
import type { RefreshCoordinator } from "../runtime/coordinator";
import type { WorldRenderer } from "../world/renderer";

/** Explicit QA-only entry; never opens in the ordinary product route. */
export function BuildDiagnostics({
  renderer,
  runtime,
  selectionTiming,
}: {
  renderer: React.RefObject<WorldRenderer | null>;
  runtime: RefreshCoordinator;
  selectionTiming: React.RefObject<{ samples: number[] }>;
}) {
  const [sample, setSample] = useState<unknown>(null);
  const [deliveryError, setDeliveryError] = useState<string | null>(null);
  if (new URLSearchParams(window.location.search).get("qa") !== "1") return null;
  const previewLink = (query: string, hash = "world") =>
    `/?mode=fixture&qa=1&art=${new URLSearchParams(window.location.search).get("art") === "cinematic" ? "cinematic" : "classic"}${query}#${hash}`;
  return (
    <details className="build-diagnostics panel">
      <summary>Build diagnostics</summary>
      <p>Explicit visual QA. Sample controls cannot reach live mutations.</p>
      <a href={previewLink("&load=normal")}>Normal load · 10 projects / 100 tasks</a>
      <a href={previewLink("&load=stress")}>Stress load · 50 projects / 1,000 tasks</a>
      <a href={previewLink("")}>Return to twelve-task sample</a>
      <a href={previewLink("&scenario=workflow")}>Full workflow scenarios</a>
      <a href={previewLink("&scenario=stations", "project/station-qa")}>All eleven station compositions</a>
      {runtime.gateway.mode === "fixture" && "setDeliveryOutcome" in runtime.gateway && (
        <>
          <p>Delivery QA applies only to the selected sample task with an open PR.</p>
          {(["merged", "closed", "drift"] as const).map((outcome) => (
            <button
              type="button"
              key={outcome}
              onClick={() => {
                const id = runtime.getSnapshot().selectedId;
                if (!id) {
                  setDeliveryError("Select a sample task first.");
                  return;
                }
                try {
                  if (
                    "setDeliveryOutcome" in runtime.gateway &&
                    typeof runtime.gateway.setDeliveryOutcome === "function"
                  )
                    runtime.gateway.setDeliveryOutcome(id, outcome);
                  setDeliveryError(null);
                  runtime.retry();
                } catch (error) {
                  setDeliveryError(error instanceof Error ? error.message : "Sample delivery update failed.");
                }
              }}
            >
              Sample PR {outcome}
            </button>
          ))}
          {deliveryError && <p role="alert">{deliveryError}</p>}
        </>
      )}
      <button
        type="button"
        onClick={() => {
          renderer.current?.beginMeasurement();
          selectionTiming.current.samples = [];
          setSample(null);
        }}
      >
        Begin performance measurement
      </button>
      {runtime.gateway.mode === "fixture" &&
        "setDisconnected" in runtime.gateway &&
        typeof runtime.gateway.setDisconnected === "function" && (
          <button
            type="button"
            onClick={() => {
              if (
                "setDisconnected" in runtime.gateway &&
                typeof runtime.gateway.setDisconnected === "function"
              )
                runtime.gateway.setDisconnected(runtime.getSnapshot().connection !== "offline");
              runtime.retry();
            }}
          >
            Toggle sample connection
          </button>
        )}
      <button
        type="button"
        onClick={() =>
          setSample({
            capturedAt: new Date().toISOString(),
            viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
            mode: runtime.gateway.mode,
            projects: runtime.getSnapshot().projects.length,
            tasks: runtime.getSnapshot().tasks.length,
            refresh: runtime.metrics,
            renderer: renderer.current?.metrics,
            selectionAckMs: selectionTiming.current.samples,
            selectionMeasurement:
              "Selection event to the second animation frame after committed state and scene effects",
            pageTransfer: [
              ...performance.getEntriesByType("navigation"),
              ...performance.getEntriesByType("resource"),
            ]
              .map((entry) => entry as PerformanceResourceTiming)
              .reduce(
                (total, entry) => ({
                  requests: total.requests + 1,
                  transferBytes: total.transferBytes + entry.transferSize,
                  encodedBytes: total.encodedBytes + entry.encodedBodySize,
                }),
                { requests: 0, transferBytes: 0, encodedBytes: 0 },
              ),
            artworkNetwork: performance
              .getEntriesByType("resource")
              .filter((entry) => new URL(entry.name).pathname.startsWith("/assets/"))
              .map((entry) => {
                const resource = entry as PerformanceResourceTiming;
                return {
                  path: new URL(resource.name).pathname,
                  transferBytes: resource.transferSize,
                  encodedBytes: resource.encodedBodySize,
                  decodedBodyBytes: resource.decodedBodySize,
                };
              }),
            network: performance
              .getEntriesByType("resource")
              .filter((entry) => entry.name.includes("/api/"))
              .slice(-200)
              .map((entry) => {
                const resource = entry as PerformanceResourceTiming;
                return {
                  path: new URL(resource.name).pathname,
                  durationMs: resource.duration,
                  transferBytes: resource.transferSize,
                  decodedBodyBytes: resource.decodedBodySize,
                };
              }),
          })
        }
      >
        Capture performance sample
      </button>
      <pre>{sample ? JSON.stringify(sample, null, 2) : "Capture after the scene has warmed up."}</pre>
    </details>
  );
}
