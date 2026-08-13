import { CaretDown, FileCode } from "@phosphor-icons/react";

type DiffLine = { id: string; text: string; kind: "add" | "remove" | "hunk" | "meta" | "context" };

function lineKind(line: string): DiffLine["kind"] {
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+") && !line.startsWith("+++")) return "add";
  if (line.startsWith("-") && !line.startsWith("---")) return "remove";
  if (/^(diff --git|index |--- |\+\+\+ |new file|deleted file|similarity)/.test(line)) return "meta";
  return "context";
}

function parseDiff(diff: string) {
  const files: Array<{ id: string; name: string; lines: DiffLine[] }> = [];
  let serial = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const match = line.match(/ b\/(.+)$/);
      const name = match?.[1] ?? line.replace("diff --git ", "");
      files.push({
        id: `file-${serial++}-${name}`,
        name,
        lines: [{ id: `line-${serial++}`, text: line, kind: "meta" }],
      });
      continue;
    }
    if (!files.length) files.push({ id: "file-candidate", name: "Candidate changes", lines: [] });
    files.at(-1)?.lines.push({ id: `line-${serial++}`, text: line, kind: lineKind(line) });
  }
  return files;
}

export function UnifiedDiff({ diff }: { diff: string }) {
  const files = parseDiff(diff);
  return (
    <div className="unified-diff">
      {files.map((file) => (
        <details key={file.id} open>
          <summary>
            <FileCode size={16} />
            <strong>{file.name}</strong>
            <span>
              {file.lines.filter((line) => line.kind === "add").length} additions ·{" "}
              {file.lines.filter((line) => line.kind === "remove").length} deletions
            </span>
            <CaretDown size={15} />
          </summary>
          <pre>
            <code>
              {file.lines.map((line, lineIndex) => (
                <span className={`unified-diff__line unified-diff__line--${line.kind}`} key={line.id}>
                  <i>{lineIndex + 1}</i>
                  <b>{line.kind === "add" ? "+" : line.kind === "remove" ? "−" : ""}</b>
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
