import { useEffect, useState } from "react";
import type { CandidateDiffResponse } from "../../api";
import { DiffDocument } from "./DiffDocument";
import type { FrontierGateway } from "../runtime/contracts";
export function CandidateDiff({
  gateway,
  taskId,
  candidateId,
  headRevision,
  revision,
}: {
  gateway: FrontierGateway;
  taskId: string;
  candidateId: string;
  headRevision: string;
  revision: number;
}) {
  const [value, setValue] = useState<CandidateDiffResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [raw, setRaw] = useState(false);
  const [attempt, retry] = useState(0);
  useEffect(() => {
    let gone = false;
    setValue(null);
    setError(null);
    if (attempt >= 0)
      gateway
        .diff(taskId, candidateId, headRevision)
        .then((result) => {
          if (!gone) {
            if (
              result.candidateId !== candidateId ||
              result.headRevision !== headRevision ||
              result.revisionNumber !== revision
            )
              setError("The returned diff no longer matches this exact candidate revision.");
            else setValue(result);
          }
        })
        .catch((reason) => {
          if (!gone) setError(reason instanceof Error ? reason.message : "Diff unavailable");
        });
    return () => {
      gone = true;
    };
  }, [gateway, taskId, candidateId, headRevision, revision, attempt]);
  return (
    <div className="overlay-body artifact-body">
      <div className="artifact-toolbar">
        <div>
          <strong>
            {taskId} · {candidateId} r{revision}
          </strong>
          <small>Exact candidate diff · {headRevision}</small>
        </div>
        <button type="button" aria-pressed={raw} onClick={() => setRaw(!raw)}>
          {raw ? "File diff" : "Raw source"}
        </button>
      </div>
      {error ? (
        <div role="alert">
          <p className="form-error">{error}</p>
          <button type="button" onClick={() => retry(attempt + 1)}>
            Retry exact diff
          </button>
        </div>
      ) : !value ? (
        <p>Loading exact candidate…</p>
      ) : (
        <>
          {value.truncated && (
            <p className="form-error">
              This diff is truncated by the runtime. Inspect the retained candidate before approving.
            </p>
          )}
          {!value.diff ? (
            <p>No changes were returned for this revision.</p>
          ) : raw ? (
            <pre className="raw-artifact">{value.diff}</pre>
          ) : (
            <DiffDocument diff={value.diff} />
          )}
        </>
      )}
    </div>
  );
}
