import { Shuffle, X } from "@phosphor-icons/react";
import type { CSSProperties } from "react";
import {
  type BaseAppearance,
  type BaseVariant,
  baseNames,
  basePalettes,
  type ProjectKind,
  palettesFor,
  randomAppearance,
  variantsFor,
} from "./appearance";
import type { ProjectBase } from "./layout";
import type { ProofManifest } from "./model";

export function BaseAppearancePicker({
  bases,
  projectId,
  manifest,
  storageProblem,
  onProject,
  onChoose,
  onClose,
}: {
  bases: ProjectBase[];
  projectId: string;
  manifest: ProofManifest | null;
  storageProblem: boolean;
  onProject(id: string): void;
  onChoose(base: ProjectBase, appearance: BaseAppearance): void;
  onClose(): void;
}) {
  const base = bases.find((entry) => entry.project.id === projectId) ?? bases[0];
  if (!base) return null;
  return (
    <section className="proof-appearance panel" aria-label="Base appearance">
      <header>
        <strong>Base appearance</strong>
        <button type="button" onClick={onClose} aria-label="Close base appearance">
          <X size={18} />
        </button>
      </header>
      <label>
        Project
        <select value={base.project.id} onChange={(event) => onProject(event.target.value)}>
          {bases.map((entry) => (
            <option key={entry.project.id} value={entry.project.id}>
              {entry.project.name}
            </option>
          ))}
        </select>
      </label>
      <BaseAppearanceControls
        kind={base.project.kind}
        appearance={base.appearance}
        manifest={manifest}
        onChoose={(appearance) => onChoose(base, appearance)}
      />
      <footer>
        <button
          type="button"
          onClick={() => onChoose(base, randomAppearance(Math.random, base.project.kind))}
        >
          <Shuffle size={16} /> Randomise
        </button>
        <small role="status">
          {storageProblem
            ? "Saved for this session. Browser storage is unavailable."
            : "Saved for this project in this browser."}
        </small>
      </footer>
    </section>
  );
}

export function BaseAppearanceControls({
  kind,
  appearance,
  manifest,
  onChoose,
}: {
  kind?: ProjectKind;
  appearance: BaseAppearance;
  manifest: ProofManifest | null;
  onChoose(appearance: BaseAppearance): void;
}) {
  // Crowns on one shared shell. This control is shared by the in-world Appearance tab and
  // new-project setup so both paths use the same model catalogue, palette and selection behavior.
  // Relay and the research colours belong to research projects; delivery projects get the rest.
  const variants: readonly BaseVariant[] = variantsFor(kind);
  const preview = (variant: BaseVariant) => manifest?.colony?.crownPreviews?.[variant];
  return (
    <div className="proof-appearance-controls">
      <fieldset>
        <legend>Building</legend>
        <div className="proof-building-options" data-count={variants.length}>
          {variants.map((variant) => (
            <button
              type="button"
              key={variant}
              aria-pressed={appearance.variant === variant}
              onClick={() => onChoose({ ...appearance, variant })}
            >
              {preview(variant) && <img src={preview(variant)} alt="" />}
              <span>{baseNames[variant]}</span>
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Project colour</legend>
        <div className="proof-palette-options">
          {palettesFor(kind).map((palette) => (
            <button
              type="button"
              key={palette}
              style={{ "--base-colour": basePalettes[palette].color } as CSSProperties}
              aria-pressed={appearance.palette === palette}
              onClick={() => onChoose({ ...appearance, palette })}
            >
              <i aria-hidden="true" />
              {basePalettes[palette].label}
            </button>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
