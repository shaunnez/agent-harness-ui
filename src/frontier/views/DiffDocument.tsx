import { CaretDown, FileCode } from "@phosphor-icons/react";
import { parseDiff } from "../runtime/diff";

export function DiffDocument({ diff }: { diff: string }) {
  return (
    <div className="unified-diff diff-document">
      {parseDiff(diff).map((file) => (
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
