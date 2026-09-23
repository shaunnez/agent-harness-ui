import {
  type ResearchQuestion,
  type ResearchScope,
  type ResearchScopeMeasure,
  researchScopeMeasures,
  scopedByLabel,
} from "../../runtime/research";

type ListField = "inclusions" | "exclusions" | "assumptions" | "clarifications";
type TextField = "item" | "unitText" | "quantityBasis" | "centre";

const listFields: Array<[ListField, string]> = [
  ["inclusions", "Includes"],
  ["exclusions", "Excludes"],
  ["assumptions", "Assumptions"],
  ["clarifications", "Not decided"],
];

const textFields: Array<[TextField, string]> = [
  ["unitText", "Unit in words"],
  ["quantityBasis", "Quantity"],
  ["centre", "Centre"],
];

/** The pinned scope, editable before the runs start. Lists are one entry per line. */
export function ResearchScopeEditor({
  scope,
  onChange,
}: {
  scope: ResearchScope;
  onChange(scope: ResearchScope): void;
}) {
  const setText = (field: TextField, value: string) => onChange({ ...scope, [field]: value });
  const setList = (field: ListField, value: string) =>
    onChange({ ...scope, [field]: value.split("\n").map((line) => line.trimStart()) });
  return (
    <fieldset className="research-scope-editor">
      <legend>Scope · every run is given exactly this</legend>
      <label className="form-row">
        <span>Item</span>
        <input required value={scope.item} onChange={(event) => setText("item", event.target.value)} />
      </label>
      <div className="research-scope-row">
        <label className="form-row">
          <span>Measure</span>
          <select
            value={scope.measure}
            onChange={(event) => onChange({ ...scope, measure: event.target.value as ResearchScopeMeasure })}
          >
            {researchScopeMeasures.map((measure) => (
              <option key={measure} value={measure}>
                {measure}
              </option>
            ))}
          </select>
        </label>
        {textFields.map(([field, label]) => (
          <label key={field} className="form-row">
            <span>{label}</span>
            <input value={scope[field]} onChange={(event) => setText(field, event.target.value)} />
          </label>
        ))}
      </div>
      <div className="research-scope-lists">
        {listFields.map(([field, label]) => (
          <label key={field} className="form-row">
            <span>{label}</span>
            <textarea
              rows={3}
              value={scope[field].join("\n")}
              onChange={(event) => setList(field, event.target.value)}
              placeholder="One per line"
            />
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Blank lines dropped, as the backend would drop them, before the scope is sent. */
export function cleanScope(scope: ResearchScope): ResearchScope {
  const list = (items: string[]) => items.map((item) => item.trim()).filter(Boolean);
  return {
    ...scope,
    item: scope.item.trim(),
    unitText: scope.unitText.trim(),
    quantityBasis: scope.quantityBasis.trim(),
    centre: scope.centre.trim(),
    inclusions: list(scope.inclusions),
    exclusions: list(scope.exclusions),
    assumptions: list(scope.assumptions),
    clarifications: list(scope.clarifications),
  };
}

/** The scope a question's runs were given, read-only, on the question detail. */
export function ResearchScopePanel({ question }: { question: ResearchQuestion }) {
  const scope = question.scope;
  if (!scope) return null;
  return (
    <section className="research-panel research-scope-panel">
      <h3>Pinned scope</h3>
      <p className="quiet">
        {scopedByLabel(question.scopedBy)}
        {question.scopeReviewed === false ? " · not reviewed before the runs started" : ""}
      </p>
      <p>
        <strong>{scope.item}</strong>
      </p>
      <dl className="research-facts">
        <div>
          <dt>Measure</dt>
          <dd>
            {scope.measure}
            {scope.unitText ? ` · ${scope.unitText}` : ""}
          </dd>
        </div>
        {scope.quantityBasis && (
          <div>
            <dt>Quantity</dt>
            <dd>{scope.quantityBasis}</dd>
          </div>
        )}
        {scope.centre && (
          <div>
            <dt>Centre</dt>
            <dd>{scope.centre}</dd>
          </div>
        )}
        {listFields.map(([field, label]) =>
          scope[field].length ? (
            <div key={field}>
              <dt>{label}</dt>
              <dd>{scope[field].join("; ")}</dd>
            </div>
          ) : null,
        )}
      </dl>
    </section>
  );
}
