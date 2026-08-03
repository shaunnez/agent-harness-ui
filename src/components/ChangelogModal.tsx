import { ArrowLeft, FileCode, GitCommit, X } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getChangelogCommit, getChangelogFileDiff, listChangelog } from "../api";
import {
  formatTaskDate,
  type RuntimeChangelogCommit,
  type RuntimeChangelogDetail,
  type RuntimeChangelogDiff,
} from "../domain";
import { Button } from "./Primitives";
import { UnifiedDiff } from "./UnifiedDiff";

export function ChangelogModal({
  commitSha,
  filePath,
  onClose,
  onSelectCommit,
  onSelectFile,
}: {
  commitSha?: string;
  filePath?: string;
  onClose: () => void;
  onSelectCommit: (sha: string) => void;
  onSelectFile: (filePath: string) => void;
}) {
  const [commits, setCommits] = useState<RuntimeChangelogCommit[]>([]);
  const [selected, setSelected] = useState<RuntimeChangelogDetail | null>(null);
  const [fileDiff, setFileDiff] = useState<RuntimeChangelogDiff | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const loadCommit = useCallback(async (sha: string) => {
    setError(null);
    setDetailLoading(true);
    try {
      setSelected(await getChangelogCommit(sha));
    } catch (reason) {
      setSelected(null);
      setError(reason instanceof Error ? reason.message : "Commit details could not be loaded.");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const loadFileDiff = useCallback(async (sha: string, path: string) => {
    setError(null);
    setDetailLoading(true);
    try {
      setFileDiff(await getChangelogFileDiff(sha, path));
    } catch (reason) {
      setFileDiff(null);
      setError(reason instanceof Error ? reason.message : "The file diff could not be loaded.");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    let current = true;
    void listChangelog().then((value) => {
      if (current) setCommits(value);
    }).catch((reason) => {
      if (current) setError(reason instanceof Error ? reason.message : "Live git history could not be loaded.");
    }).finally(() => {
      if (current) setLoading(false);
    });
    closeRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleKey);
    return () => { current = false; window.removeEventListener("keydown", handleKey); };
  }, [onClose]);

  useEffect(() => {
    if (!commitSha) {
      setSelected(null);
      setFileDiff(null);
      return;
    }
    void loadCommit(commitSha);
  }, [commitSha, loadCommit]);

  useEffect(() => {
    if (!commitSha || !filePath) {
      setFileDiff(null);
      return;
    }
    void loadFileDiff(commitSha, filePath);
  }, [commitSha, filePath, loadFileDiff]);

  return (
    <div className="changelog-overlay" role="dialog" aria-modal="true" aria-label="Repository changelog">
      <button type="button" className="changelog-overlay__backdrop" aria-label="Close changelog" onClick={onClose} />
      <section className="changelog-modal">
        <header>
          <span><GitCommit size={20} /><span><small>Live git history · read-only</small><strong>Repository changelog</strong></span></span>
          <button ref={closeRef} type="button" className="icon-button" onClick={onClose} aria-label="Close changelog"><X size={18} /></button>
        </header>
        {error ? <div className="changelog-error" role="alert">{error}</div> : null}
        {fileDiff ? (
          <div className="changelog-diff">
            <div className="changelog-detail__bar"><Button tone="ghost" compact icon={ArrowLeft} onClick={() => onSelectCommit(fileDiff.sha)}>Back to commit</Button><span><strong>{fileDiff.path}</strong><small>{fileDiff.sha.slice(0, 8)}{fileDiff.truncated ? " · truncated" : ""}</small></span></div>
            {fileDiff.diff.trim() ? <UnifiedDiff diff={fileDiff.diff} /> : <div className="changelog-empty">Git returned no textual diff for this file.</div>}
          </div>
        ) : (
          <div className="changelog-layout">
            <aside className="changelog-list">
              <div><strong>Last 10 commits</strong><small>{loading ? "Loading live history…" : `${commits.length} commits`}</small></div>
              {commits.map((commit) => <button type="button" key={commit.sha} className={selected?.sha === commit.sha ? "is-selected" : ""} onClick={() => onSelectCommit(commit.sha)}><GitCommit size={16} /><span><strong>{commit.subject}</strong><small><code>{commit.shortSha}</code> · {commit.author} · {formatTaskDate(commit.authoredAt)}</small></span></button>)}
              {!loading && !commits.length ? <div className="changelog-empty">No live commits were returned.</div> : null}
            </aside>
            <main className="changelog-detail">
              {detailLoading ? <ChangelogDetailSkeleton /> : selected ? (
                <>
                  <header><span><small>{selected.shortSha} · {formatTaskDate(selected.authoredAt)}</small><h2>{selected.subject}</h2><p>{selected.author}</p></span></header>
                  {selected.body ? <p className="changelog-detail__body">{selected.body}</p> : null}
                  <div className="changelog-files"><strong>{selected.files.length} changed files</strong>{selected.files.map((file) => <button type="button" key={`${file.status}:${file.path}`} onClick={() => onSelectFile(file.path)}><span className="changelog-file-status">{file.status}</span><FileCode size={16} /><span><strong>{file.path}</strong>{file.previousPath ? <small>from {file.previousPath}</small> : null}</span></button>)}</div>
                </>
              ) : <div className="changelog-empty changelog-empty--center"><GitCommit size={28} /><strong>Select a commit</strong><span>Inspect its metadata, changed files, and file-level diff.</span></div>}
            </main>
          </div>
        )}
      </section>
    </div>
  );
}

function ChangelogDetailSkeleton() {
  return <div className="changelog-skeleton" role="status" aria-label="Loading commit details"><span /><span /><span /><span /></div>;
}
