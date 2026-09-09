export interface DiffLine {
  id: string;
  text: string;
  kind: "add" | "remove" | "hunk" | "meta" | "context";
  old: number | null;
  next: number | null;
}
export function parseDiff(diff: string) {
  const files: Array<{ id: string; name: string; lines: DiffLine[] }> = [];
  let serial = 0;
  let old: number | null = null,
    next: number | null = null;
  for (const text of diff.replace(/\n$/, "").split("\n")) {
    if (text.startsWith("diff --git ")) {
      files.push({ id: `file-${serial++}`, name: text.match(/ b\/(.+)$/)?.[1] ?? text, lines: [] });
      old = null;
      next = null;
    }
    if (!files.length) files.push({ id: `file-${serial++}`, name: "Candidate changes", lines: [] });
    const hunk = text.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    let kind: DiffLine["kind"] = "meta";
    if (hunk) {
      old = Number(hunk[1]);
      next = Number(hunk[2]);
      kind = "hunk";
    } else if (old !== null && next !== null && text.startsWith("+")) kind = "add";
    else if (old !== null && next !== null && text.startsWith("-")) kind = "remove";
    else if (old !== null && next !== null && text.startsWith(" ")) kind = "context";
    files.at(-1)?.lines.push({
      id: `line-${serial++}`,
      text,
      kind,
      old: ["context", "remove"].includes(kind) ? old : null,
      next: ["context", "add"].includes(kind) ? next : null,
    });
    if (["context", "remove"].includes(kind) && old !== null) old++;
    if (["context", "add"].includes(kind) && next !== null) next++;
  }
  return files;
}
