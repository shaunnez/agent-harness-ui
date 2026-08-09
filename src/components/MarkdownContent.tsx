import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { stripStructuredArtifactPayloads } from "../artifactPresentation";

export function MarkdownContent({ content, className = "" }: { content: string; className?: string }) {
  return (
    <div className={`markdown-content ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{stripStructuredArtifactPayloads(content)}</ReactMarkdown>
    </div>
  );
}
