import { Paperclip, X } from "@phosphor-icons/react";
import { useState } from "react";
import type { NewTaskDraft } from "../../domain";

export function TaskAttachments({
  files,
  onChange,
}: {
  files: NonNullable<NewTaskDraft["attachments"]>;
  onChange(files: NonNullable<NewTaskDraft["attachments"]>): void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  async function add(input: FileList | File[]) {
    const selected = Array.from(input);
    try {
      const names = [...files, ...selected].map((file) => file.name);
      if (new Set(names).size !== names.length) throw new Error("Each attachment needs a distinct filename.");
      if (files.length + selected.length > 6) throw new Error("Attach no more than six files.");
      if (selected.some((file) => !/\.(html?|png|jpe?g|webp|gif|zip)$/i.test(file.name)))
        throw new Error("Choose HTML, image, or ZIP files.");
      if (selected.some((file) => file.size === 0 || file.size > 5_000_000))
        throw new Error("Each file must be between 1 byte and 5 MB.");
      if ([...files, ...selected].reduce((sum, file) => sum + file.size, 0) > 6_000_000)
        throw new Error("Attachments must total 6 MB or less.");
      setLoading(true);
      setError(null);
      const additions = await Promise.all(
        selected.map(
          (file) =>
            new Promise<NonNullable<NewTaskDraft["attachments"]>[number]>((resolve, reject) => {
              const reader = new FileReader();
              reader.onerror = () => reject(new Error(`${file.name} could not be read.`));
              reader.onload = () =>
                resolve({
                  name: file.name,
                  type: file.type,
                  size: file.size,
                  data: String(reader.result).split(",")[1] ?? "",
                });
              reader.readAsDataURL(file);
            }),
        ),
      );
      onChange([...files, ...additions]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to read these files.");
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="attachment-control">
      <label
        className="attachment-drop"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          if (!loading) void add(event.dataTransfer.files);
        }}
      >
        <Paperclip size={20} />
        <span>{loading ? "Reading files…" : "Drop files or click to browse"}</span>
        <input
          type="file"
          aria-label="Attach files"
          accept=".html,.htm,.png,.jpg,.jpeg,.webp,.gif,.zip"
          multiple
          disabled={loading}
          onChange={(event) => {
            if (event.target.files) void add(event.target.files);
            event.target.value = "";
          }}
        />
      </label>
      <small>
        HTML, images or ZIP · up to 6 files, 5 MB each / 6 MB total. Attachments stay in memory until you
        create the task.
      </small>
      {files.map((file, index) => (
        <div className="attachment-row" key={file.name}>
          <Paperclip size={17} />
          <span>
            {file.name} <small>{(file.size / 1000).toFixed(0)} KB</small>
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label={`Remove ${file.name}`}
            disabled={loading}
            onClick={() => onChange(files.filter((_, position) => position !== index))}
          >
            <X size={17} />
          </button>
        </div>
      ))}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
