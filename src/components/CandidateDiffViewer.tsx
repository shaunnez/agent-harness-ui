import { ArrowLeft, FileCode, GitDiff, X } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
import type { CandidateDiffResponse } from "../api";
import { Button } from "./Primitives";
import { UnifiedDiff } from "./UnifiedDiff";

interface CandidateDiffViewerProps {
  candidateIdentity: string;
  diff: CandidateDiffResponse;
  onClose: () => void;
  taskId: string;
}

export function CandidateDiffViewer({ candidateIdentity, diff, onClose, taskId }: CandidateDiffViewerProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeButtonRef.current?.focus();
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onClose]);
  return (
    <div
      className="artifact-overlay candidate-diff-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Candidate diff"
    >
      <button
        type="button"
        className="artifact-overlay__backdrop"
        onClick={onClose}
        aria-label="Close candidate diff"
      />
      <section className="artifact-viewer candidate-diff-viewer">
        <header>
          <span>
            <FileCode size={18} />
            <span>
              <small>Candidate diff</small>
              <strong>{candidateIdentity}</strong>
            </span>
          </span>
          <code>Task {taskId}</code>
          <button
            ref={closeButtonRef}
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Return to inspector"
          >
            <X size={17} />
          </button>
        </header>
        <div className="artifact-viewer__summary">
          <span>
            Revision {diff.revisionNumber}
            {" \u00b7 "}
            {diff.worktreePath}
          </span>
          <p>
            Head revision <code>{diff.headRevision}</code>
            {diff.truncated ? " \u00b7 diff capped at 300000 characters" : ""}
          </p>
        </div>
        <UnifiedDiff diff={diff.diff} />
        <footer>
          <Button tone="secondary" icon={ArrowLeft} onClick={onClose}>
            Back to inspector
          </Button>
          <small>Read-only candidate-bound diff</small>
        </footer>
      </section>
    </div>
  );
}

interface CandidateDiffErrorViewerProps {
  candidateIdentity: string;
  error: string;
  onClose: () => void;
  onRetry: () => void;
  taskId: string;
}

export function CandidateDiffErrorViewer({
  candidateIdentity,
  error,
  onClose,
  onRetry,
  taskId,
}: CandidateDiffErrorViewerProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeButtonRef.current?.focus();
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onClose]);
  return (
    <div
      className="artifact-overlay candidate-diff-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Candidate diff error"
    >
      <button
        type="button"
        className="artifact-overlay__backdrop"
        onClick={onClose}
        aria-label="Dismiss candidate diff error"
      />
      <section className="artifact-viewer candidate-diff-viewer">
        <header>
          <span>
            <FileCode size={18} />
            <span>
              <small>Candidate diff unavailable</small>
              <strong>{candidateIdentity}</strong>
            </span>
          </span>
          <code>Task {taskId}</code>
          <button
            ref={closeButtonRef}
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close error viewer"
          >
            <X size={17} />
          </button>
        </header>
        <div className="artifact-viewer__summary">
          <span>Fresh candidate verification failed</span>
          <p>{error}</p>
        </div>
        <footer>
          <Button tone="primary" icon={GitDiff} onClick={onRetry}>
            Retry fresh fetch
          </Button>
          <Button tone="secondary" icon={ArrowLeft} onClick={onClose}>
            Back to inspector
          </Button>
        </footer>
      </section>
    </div>
  );
}
