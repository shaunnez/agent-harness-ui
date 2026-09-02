import { ArrowSquareOut, Check, CircleNotch, Palette, WarningCircle } from "@phosphor-icons/react";
import { useState } from "react";
import type { RuntimePrototypeVariant, RuntimeTask } from "../../domain";
import { Button } from "../Primitives";

function providerLabel(variant: RuntimePrototypeVariant) {
  return variant.generator === "claude-design" ? "Claude Design" : "Codex Design";
}

export function RuntimePrototypeComparison({
  task,
  onSelect,
  onRetry,
}: {
  task: RuntimeTask;
  onSelect: (variantId: string) => Promise<void>;
  onRetry: () => Promise<void>;
}) {
  const request = task.designRequest;
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!request?.requested) return null;
  const latestRevision = Math.max(0, ...request.variants.map((variant) => variant.revision));
  const visibleVariants = request.variants.filter((variant) => variant.revision === latestRevision);
  const retainedPreviousCount = request.variants.length - visibleVariants.length;

  const select = async (variantId: string) => {
    setPendingId(variantId);
    setError(null);
    try {
      await onSelect(variantId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The design could not be selected.");
    } finally {
      setPendingId(null);
    }
  };

  const retry = async () => {
    setPendingId("retry");
    setError(null);
    try {
      await onRetry();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Design generation could not be retried.");
    } finally {
      setPendingId(null);
    }
  };

  return (
    <section className="runtime-prototype-comparison" aria-labelledby="prototype-comparison-title">
      <header>
        <span>
          <Palette size={19} />
          <span>
            <small>Optional pre-spec design gate</small>
            <strong id="prototype-comparison-title">
              {request.status === "generating"
                ? "Generating two independent directions"
                : request.status === "selected"
                  ? "Selected design input"
                  : request.status === "failed"
                    ? "Design generation needs attention"
                    : "Compare and select one prototype"}
            </strong>
          </span>
        </span>
        <span className={`badge badge--${request.status === "failed" ? "red" : "blue"}`}>
          {request.status.replaceAll("-", " ")}
        </span>
      </header>
      <p>
        Both variants are retained with provider and revision provenance. Task Spec will not start until one
        exact revision is selected.
        {retainedPreviousCount > 0
          ? ` ${retainedPreviousCount} earlier attempt${retainedPreviousCount === 1 ? " is" : "s are"} retained for audit.`
          : ""}
      </p>

      <div className="runtime-prototype-grid">
        {visibleVariants.map((variant) => {
          const selected = request.selectedVariantId === variant.id;
          const ready = variant.status === "ready";
          return (
            <article className={selected ? "selected" : ""} key={variant.id}>
              <header>
                <span>
                  <small>{providerLabel(variant)}</small>
                  <strong>{variant.title}</strong>
                </span>
                <code>r{variant.revision}</code>
              </header>
              <div className="runtime-prototype-preview">
                {ready && variant.previewUrl ? (
                  <iframe
                    title={`${providerLabel(variant)} prototype revision ${variant.revision}`}
                    src={variant.previewUrl}
                    sandbox="allow-scripts allow-popups"
                    referrerPolicy="no-referrer"
                  />
                ) : variant.status === "failed" ? (
                  <span className="runtime-prototype-state runtime-prototype-state--failed">
                    <WarningCircle size={22} />
                    <strong>Generation failed</strong>
                    <small>{variant.error}</small>
                  </span>
                ) : (
                  <span className="runtime-prototype-state">
                    <CircleNotch className="spin" size={22} />
                    <strong>{variant.status === "queued" ? "Queued" : "Generating prototype"}</strong>
                    <small>The other provider runs independently.</small>
                  </span>
                )}
              </div>
              <p>{variant.summary || "A retained summary will appear when this provider completes."}</p>
              <footer>
                <small>
                  {variant.policy.model} · {formatReasoning(variant.policy.reasoning)} ·{" "}
                  {variant.policy.provenance.replaceAll("-", " ")}
                  {variant.bundleHash ? ` · ${variant.bundleHash.slice(0, 10)}` : " · provider-hosted"}
                </small>
                <span>
                  {variant.previewUrl ? (
                    <a href={variant.previewUrl} target="_blank" rel="noreferrer">
                      Open <ArrowSquareOut size={14} />
                    </a>
                  ) : null}
                  {request.status === "awaiting-selection" && ready ? (
                    <Button
                      tone="primary"
                      compact
                      icon={Check}
                      disabled={pendingId != null}
                      onClick={() => void select(variant.id)}
                    >
                      {pendingId === variant.id ? "Selecting..." : "Select for Task Spec"}
                    </Button>
                  ) : null}
                </span>
              </footer>
            </article>
          );
        })}
      </div>

      {request.status === "failed" ? (
        <div className="runtime-prototype-retry">
          <span>
            <WarningCircle size={17} />
            <small>{request.error}</small>
          </span>
          <Button tone="primary" compact disabled={pendingId != null} onClick={() => void retry()}>
            {pendingId === "retry" ? "Retrying..." : "Retry both designs"}
          </Button>
        </div>
      ) : null}
      {error ? <div className="runtime-command-error">{error}</div> : null}
    </section>
  );
}

function formatReasoning(reasoning: string | null) {
  if (!reasoning) return "provider default";
  return reasoning.toLowerCase() === "xhigh"
    ? "XHigh"
    : reasoning.charAt(0).toUpperCase() + reasoning.slice(1);
}
