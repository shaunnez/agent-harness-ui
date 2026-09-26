// The Great Workshop: package yards, the assembled candidate and its diff.
import { useEffect, useState } from "react";
import type { RuntimeTask } from "../../../domain";
import { fixtureWorkflow } from "../../../frontier/fixtures/workflow.ts";
import { sampleTasks } from "../../realm";
import { Yards } from "../parts";

/** The sample diff comes from Frontier's fixture workflow, keyed by the exact candidate revision. */
async function sampleDiff(task: RuntimeTask, candidateId: string, head: string) {
  const tasks = new Map(sampleTasks().map((item) => [item.id, item as RuntimeTask]));
  const get = (id: string) => {
    const found = tasks.get(id);
    if (!found) throw new Error(`Sample ${id} missing`);
    return found;
  };
  return fixtureWorkflow(tasks, get, () => {}).diff(task.id, candidateId, head);
}

function DiffView({ diff }: { diff: string }) {
  return (
    <pre className="ae-diff">
      {diff.split("\n").map((line, i) => {
        const kind = line.startsWith("diff --git")
          ? "file"
          : line.startsWith("@@")
            ? "hunk"
            : line.startsWith("+") && !line.startsWith("+++")
              ? "add"
              : line.startsWith("-") && !line.startsWith("---")
                ? "del"
                : "ctx";
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: diff lines are positional
          <span key={i} className={`is-${kind}`}>
            {line || " "}
            {"\n"}
          </span>
        );
      })}
    </pre>
  );
}

export function GreatWorkshop({ task }: { task: RuntimeTask }) {
  const candidate = task.candidates?.[task.candidates.length - 1] ?? null;
  const revision = candidate?.revisions?.[candidate.revisions.length - 1] ?? null;
  const [diff, setDiff] = useState<{ text: string | null; error: string | null }>({
    text: null,
    error: null,
  });
  useEffect(() => {
    if (!candidate || !revision) return;
    let live = true;
    sampleDiff(task, candidate.id, revision.headRevision)
      .then((result) => live && setDiff({ text: result.diff, error: null }))
      .catch((error: Error) => live && setDiff({ text: null, error: error.message }));
    return () => {
      live = false;
    };
  }, [task, candidate, revision]);
  return (
    <>
      {(task.workPackages ?? []).length > 0 ? (
        <Yards task={task} />
      ) : (
        <section className="ae-parchment">
          <p className="ae-muted">No work packages are recorded for this campaign.</p>
        </section>
      )}
      <section className="ae-parchment">
        <div className="ae-eyebrow">The candidate</div>
        {candidate && revision ? (
          <>
            <p>
              <b>Candidate r{revision.number}</b> · {candidate.status.replaceAll("_", " ")} · head{" "}
              <code>{revision.headRevision.slice(0, 10)}</code> on <code>{candidate.branch}</code>
            </p>
            {diff.text && <DiffView diff={diff.text} />}
            {diff.error && <p className="ae-muted">{diff.error}</p>}
          </>
        ) : (
          <p className="ae-muted">
            No candidate has been assembled yet. Slices become a candidate only after every one qualifies.
          </p>
        )}
      </section>
    </>
  );
}
