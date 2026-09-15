import { ArrowSquareOut, CircleNotch, Warning } from "@phosphor-icons/react";
import { useState } from "react";
import type { RuntimePrototypeVariant } from "../../domain";
import { canonicalClaudeDesignUrl, claudePreviewImageUrl } from "../../prototype-design";
import type { FrontierGateway, TaskCore } from "../runtime/contracts";
import { modelLabel, reasoningLabel } from "../runtime/presentation";

function DesignMedia({ taskId, variant }: { taskId: string; variant: RuntimePrototypeVariant }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  if (variant.status === "failed") {
    return (
      <div className="design-preview-state">
        <Warning size={34} />
        <h3>Provider failed</h3>
        <p>{variant.error}</p>
      </div>
    );
  }
  if (variant.status !== "ready") {
    return (
      <div className="design-preview-state" aria-live="polite">
        <CircleNotch className="spin" size={34} />
        <h3>{variant.status === "queued" ? "Queued" : "Generation in progress"}</h3>
        <p>Retained output appears when this provider finishes.</p>
      </div>
    );
  }
  const isClaude = variant.generator === "claude-design";
  const source = isClaude ? claudePreviewImageUrl(taskId, variant.id) : variant.previewUrl;
  if (!source || failed) {
    return (
      <div className="design-preview-state">
        <Warning size={34} />
        <h3>Preview unavailable</h3>
        <p>
          {isClaude
            ? "Open the retained Claude project to inspect this design."
            : "No retained preview is available."}
        </p>
      </div>
    );
  }
  return (
    <>
      {!loaded && (
        <div className="design-preview-state design-preview-loading" aria-live="polite">
          <CircleNotch className="spin" size={34} />
          <h3>Loading preview</h3>
        </div>
      )}
      {isClaude ? (
        <img
          src={source}
          alt={`${variant.title} screenshot`}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      ) : (
        <iframe
          title={`${variant.title} r${variant.revision}`}
          src={source}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          onLoad={() => setLoaded(true)}
        />
      )}
    </>
  );
}

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
    Boolean(url && (/^\/api\//.test(url) || (gateway.mode === "fixture" && url.startsWith("/assets/"))));
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
              <DesignMedia taskId={task.id} variant={variant} />
            </div>
            <h3>{variant.title}</h3>
            <p>{variant.summary}</p>
            <div className="review-actions">
              {(variant.generator === "claude-design"
                ? canonicalClaudeDesignUrl(variant.externalUrl ?? variant.previewUrl)
                : variant.previewUrl && hasPreview(variant.previewUrl)
                  ? variant.previewUrl
                  : null) && (
                <a
                  href={
                    variant.generator === "claude-design"
                      ? (canonicalClaudeDesignUrl(variant.externalUrl ?? variant.previewUrl) ?? undefined)
                      : (variant.previewUrl ?? undefined)
                  }
                  target="_blank"
                  rel="noreferrer"
                >
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
