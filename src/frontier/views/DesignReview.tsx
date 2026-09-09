import { ArrowSquareOut, CheckCircle, Warning } from "@phosphor-icons/react";
import { useState } from "react";
import type { FrontierGateway, TaskCore } from "../runtime/contracts";
import { modelLabel, reasoningLabel } from "../runtime/presentation";

export function DesignReview({
  task,
  gateway,
  busy,
  connected,
  command,
}: {
  task: TaskCore;
  gateway: FrontierGateway;
  busy: boolean;
  connected: boolean;
  command(action: () => Promise<unknown>, then?: () => void): Promise<void>;
}) {
  const [chosen, choose] = useState<string | null>(null);
  const request = task.designRequest;
  if (!request) return <p>Design generation was not requested for this task.</p>;
  const active = chosen ? request.variants.find((variant) => variant.id === chosen) : null;
  const latest = new Map(request.variants.map((variant) => [variant.generator, variant]));
  const maySelect = ["awaiting-selection", "failed"].includes(request.status) && task.activeRunKind == null;
  const hasPreview = (url: string | null) =>
    Boolean(
      url &&
        (/^\/api\//.test(url) ||
          /^https:\/\//.test(url) ||
          (gateway.mode === "fixture" && url === "/assets/fixture-evidence-desk.html")),
    );
  return (
    <section className="design-review">
      <div className="section-heading">
        <div>
          <small>Optional design gate · {request.status.replaceAll("-", " ")}</small>
          <h2>Choose a design direction</h2>
        </div>
        {request.status === "failed" && (
          <button
            type="button"
            disabled={busy || !connected}
            onClick={() => void command(() => gateway.retryDesign(task.id))}
          >
            Retry failed design
          </button>
        )}
      </div>
      <p>
        Each provider retains its own model, reasoning and revision. A retry preserves successful directions
        and the failed provider’s original policy.
      </p>
      <div className="design-variants">
        {[...latest.values()].map((variant) => (
          <article
            className={`workflow-card ${request.selectedVariantId === variant.id ? "selected" : ""}`}
            key={variant.id}
          >
            <div className="section-heading">
              <h3>{variant.generator === "codex-design" ? "Codex Design" : "Claude Design"}</h3>
              <small>
                r{variant.revision} · {variant.status}
              </small>
            </div>
            <small>
              {modelLabel(variant.policy.model)} · {reasoningLabel(variant.policy.reasoning)} ·{" "}
              {variant.policy.provenance.replaceAll("-", " ")}
            </small>
            <div className="design-preview">
              {variant.status === "ready" && variant.previewUrl && hasPreview(variant.previewUrl) ? (
                <iframe
                  title={`${variant.title} r${variant.revision}`}
                  src={variant.previewUrl}
                  sandbox="allow-scripts"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div>
                  {variant.status === "failed" ? <Warning size={34} /> : <CheckCircle size={34} />}
                  <h3>
                    {variant.status === "failed"
                      ? "Provider failed"
                      : variant.status === "ready"
                        ? "Preview unavailable"
                        : "Generation in progress"}
                  </h3>
                  <p>{variant.error ?? "Retained output appears when this provider finishes."}</p>
                </div>
              )}
            </div>
            <h3>{variant.title}</h3>
            <p>{variant.summary}</p>
            <div className="review-actions">
              {variant.previewUrl && hasPreview(variant.previewUrl) && (
                <a href={variant.previewUrl} target="_blank" rel="noreferrer">
                  Open full preview <ArrowSquareOut size={17} />
                </a>
              )}
              {variant.status === "ready" && maySelect && (
                <button
                  type="button"
                  className="primary"
                  disabled={busy || !connected}
                  onClick={() => choose(variant.id)}
                >
                  Review selection
                </button>
              )}
            </div>
            {variant.contextManifest && (
              <details>
                <summary>Prompt / context supplied</summary>
                <p>{variant.contextManifest.policy}</p>
                {variant.contextManifest.sources.map((source) => (
                  <p key={`${source.kind}:${source.id}`}>
                    {source.label} · {source.includedCharacters ?? "Unknown"} characters{" "}
                    {source.truncated ? "· Truncated" : ""}
                  </p>
                ))}
              </details>
            )}
          </article>
        ))}
      </div>
      {active && (
        <div className="action-review">
          <h3>
            Approve {active.title} r{active.revision}?
          </h3>
          <p>This exact design becomes specification input. It has not been implemented.</p>
          <div className="review-actions">
            <button type="button" onClick={() => choose(null)}>
              Keep comparing
            </button>
            <button
              type="button"
              className="primary"
              disabled={busy || !connected || !maySelect || active.status !== "ready"}
              onClick={() =>
                void command(
                  () => gateway.selectDesign(task.id, active.id),
                  () => choose(null),
                )
              }
            >
              Approve selected design
            </button>
          </div>
        </div>
      )}
      {request.variants.length > latest.size && (
        <details>
          <summary>Previous design attempts ({request.variants.length - latest.size})</summary>
          {request.variants
            .filter((variant) => latest.get(variant.generator)?.id !== variant.id)
            .map((variant) => (
              <p key={variant.id}>
                {variant.generator} r{variant.revision} · {variant.status} ·{" "}
                {variant.error ?? variant.summary}
              </p>
            ))}
        </details>
      )}
      {request.error && <p className="form-error">{request.error}</p>}
    </section>
  );
}
