import { CaretDown, FileCode } from "@phosphor-icons/react";
import { useState } from "react";
import { parseDiff } from "../runtime/diff";

export function DiffDocument({ diff, selectable = false }: { diff: string; selectable?: boolean }) {
  const files = parseDiff(diff);
  const [selected, setSelected] = useState<string | null>(null);
  const current = files.find((file) => file.name === selected) ?? files[0];
  const visible = selectable && current ? [current] : files;
  return (
    <div className="unified-diff diff-document">
      {selectable && (
        <nav className="candidate-file-tabs" aria-label="Candidate diff files">
          {files.map((file) => (
            <button
              type="button"
              key={file.id}
              aria-pressed={current?.id === file.id}
              onClick={() => setSelected(file.name)}
            >
              <FileCode size={16} />
              {file.name}
            </button>
          ))}
        </nav>
      )}
      {visible.map((file) => (
        <details key={file.id} open>
          <summary>
            <FileCode size={17} />
            <strong>{file.name}</strong>
            <span>
              {file.lines.filter((line) => line.kind === "add").length} additions ·{" "}
              {file.lines.filter((line) => line.kind === "remove").length} deletions
            </span>
            <CaretDown size={17} />
          </summary>
          <pre>
            <code>
              {file.lines.map((line) => (
                <span className={`unified-diff__line unified-diff__line--${line.kind}`} key={line.id}>
                  <i title="Old source line">{line.old ?? ""}</i>
                  <i title="New source line">{line.next ?? ""}</i>
                  <em>{line.text || " "}</em>
                </span>
              ))}
            </code>
          </pre>
        </details>
      ))}
    </div>
  );
}
