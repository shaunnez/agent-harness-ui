import { FileText } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { RuntimeArtifact } from "../../domain";
import type { FrontierGateway } from "../runtime/contracts";
import { modelLabel, reasoningLabel } from "../runtime/presentation";
import { DocumentHeading } from "./DocumentHeading";

export function ArtifactViewer({
  gateway,
  taskId,
  artifactId,
  workspace = false,
}: {
  gateway: FrontierGateway;
  taskId: string;
  artifactId: string;
  workspace?: boolean;
}) {
  const [artifact, setArtifact] = useState<RuntimeArtifact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [raw, setRaw] = useState(false);
  const [attempt, retry] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: An explicit retry epoch must restart this failed read.
  useEffect(() => {
    let disposed = false;
    setArtifact(null);
    setError(null);
    gateway
      .artifact(taskId, artifactId)
      .then((value) => {
        if (!disposed) setArtifact(value);
      })
      .catch((error: unknown) => {
        if (!disposed) setError(error instanceof Error ? error.message : "Evidence could not be loaded.");
      });
    return () => {
      disposed = true;
    };
  }, [gateway, taskId, artifactId, attempt]);
  return (
    <div className={`overlay-body artifact-body ${workspace ? "workspace-document" : ""}`}>
      {error ? (
        <p role="alert" className="form-error">
          {error}
          <button type="button" onClick={() => retry(attempt + 1)}>
            Retry evidence
          </button>
        </p>
      ) : !artifact ? (
        <p>Loading retained evidence…</p>
      ) : (
        <>
          <div className="artifact-toolbar">
            <div>
              <strong>
                {workspace && <FileText size={18} />}
                {artifact.name}
              </strong>
              <small>
                {taskId} · {artifact.id}
              </small>
            </div>
            <button type="button" aria-pressed={raw} onClick={() => setRaw(!raw)}>
              {raw ? "Rendered document" : "Raw source"}
            </button>
          </div>
          <p className="artifact-provenance">
            Recorded model {modelLabel(artifact.model)} · {reasoningLabel(artifact.reasoning)} ·{" "}
            {new Date(artifact.createdAt).toLocaleString()}
            {artifact.candidateId && ` · ${artifact.candidateId} r${artifact.candidateRevision}`}
          </p>
          {raw ? (
            <pre className="raw-artifact">{artifact.content}</pre>
          ) : (
            <article className="markdown-artifact">
              <Markdown
                remarkPlugins={[remarkGfm]}
                components={{
                  ...(workspace
                    ? {
                        h2: ({ children }: { children?: React.ReactNode }) => (
                          <DocumentHeading level={2}>{children}</DocumentHeading>
                        ),
                        h3: ({ children }: { children?: React.ReactNode }) => (
                          <DocumentHeading level={3}>{children}</DocumentHeading>
                        ),
                      }
                    : {}),
                  a: ({ href, children }) =>
                    href && /^https?:\/\//i.test(href) ? (
                      <a href={href} target="_blank" rel="noreferrer">
                        {children}
                      </a>
                    ) : (
                      <code title={href}>{children}</code>
                    ),
                  img: ({ alt }) => <span>{alt ?? "Retained image reference"}</span>,
                }}
              >
                {artifact.content
                  .replace(/<grill-questions>[\s\S]*?<\/grill-questions>/g, "")
                  .replace(/#+ Grill questions\s*$/i, "")}
              </Markdown>
            </article>
          )}
          {artifact.contextManifest && (
            <section className="context-manifest">
              <h3>Context supplied</h3>
              <p>{artifact.contextManifest.policy}</p>
              <p>Repository access: {artifact.contextManifest.repositoryAccess}</p>
              <p>{artifact.contextManifest.promptCharacters.toLocaleString()} prompt characters</p>
              <ul>
                {artifact.contextManifest.sources.map((source) => (
                  <li key={`${source.kind}:${source.id}`}>
                    {source.label} · {source.includedCharacters ?? "Unknown"} characters
                    {source.truncated ? " · Truncated" : ""}
                  </li>
                ))}
              </ul>
              <p className="quiet">
                Supplied context and repository permission do not prove what the model used.
              </p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
