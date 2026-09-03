import { readFile } from "node:fs/promises";
import path from "node:path";
import { validateStagePolicies } from "../../server/api.mjs";
import { normalizeModelId, POLICY_IDS } from "../../server/model-catalog.mjs";

// Section 4.2 of docs/model-evaluation-plan.md.
const VARIANT_FILE_KEYS = new Set(["schemaVersion", "baselineId", "variants"]);
const VARIANT_KEYS = new Set(["matrix", "extends", "override"]);
const POLICY_ID_SET = new Set(POLICY_IDS);

/**
 * Load and validate a variants file (section 4.2). `catalog` is the object
 * `readExecutionProviderCatalog()` returns and `allowedModels` is the settings allow-list; both are
 * the caller's responsibility to fetch fresh so this stays a pure function of its inputs.
 *
 * Returns `{ baselineId, variants: Map<variantId, matrix> }`, where every matrix is a full,
 * validated ten-role policy matrix — `extends` is already resolved and `override` already applied.
 */
export async function loadVariants(variantsPath, { catalog, allowedModels }) {
  const absolutePath = path.resolve(variantsPath);
  const raw = await readJsonFile(absolutePath);
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("variants file must be a JSON object.");
  assertOnlyKeys(raw, VARIANT_FILE_KEYS, "variants");

  if (raw.schemaVersion !== 1)
    throw new Error(`variants.schemaVersion must be 1, got ${JSON.stringify(raw.schemaVersion)}.`);
  const baselineId = requireNonEmptyString(raw.baselineId, "variants.baselineId");
  if (!raw.variants || typeof raw.variants !== "object" || Array.isArray(raw.variants))
    throw new Error("variants.variants must be an object.");
  const variantIds = Object.keys(raw.variants);
  if (!variantIds.length) throw new Error("variants.variants must define at least one variant.");
  if (!variantIds.includes(baselineId))
    throw new Error(`variants.baselineId "${baselineId}" is not defined in variants.variants.`);

  const known = buildKnownModels(catalog);
  const normalizedAllowedModels = normalizeAllowedModels(allowedModels);

  const resolved = new Map();
  for (const variantId of variantIds) {
    resolved.set(variantId, resolveVariant(variantId, raw.variants, known, normalizedAllowedModels));
  }
  return { baselineId, variants: resolved };
}

function resolveVariant(variantId, rawVariants, known, allowedModels) {
  const label = `variants.variants["${variantId}"]`;
  const entry = rawVariants[variantId];
  if (!entry || typeof entry !== "object" || Array.isArray(entry))
    throw new Error(`${label} must be an object.`);
  assertOnlyKeys(entry, VARIANT_KEYS, label);

  const hasMatrix = entry.matrix !== undefined;
  const hasExtends = entry.extends !== undefined;
  const hasOverride = entry.override !== undefined;
  if (hasMatrix && (hasExtends || hasOverride))
    throw new Error(`${label} must not combine "matrix" with "extends"/"override".`);
  if (hasMatrix) return validateFullMatrix(entry.matrix, known, allowedModels, label);
  if (!hasExtends || !hasOverride)
    throw new Error(`${label} must set either "matrix", or both "extends" and "override".`);

  const baseId = requireNonEmptyString(entry.extends, `${label}.extends`);
  const baseEntry = rawVariants[baseId];
  if (!baseEntry) throw new Error(`${label}.extends refers to an unknown variant: "${baseId}".`);
  if (baseEntry.extends !== undefined) {
    throw new Error(
      `${label}.extends must resolve to a variant with a full matrix; "${baseId}" itself uses ` +
        `"extends", and only one level of extends is supported.`,
    );
  }
  const baseMatrix = validateFullMatrix(
    baseEntry.matrix,
    known,
    allowedModels,
    `variants.variants["${baseId}"]`,
  );

  const override = entry.override;
  if (!override || typeof override !== "object" || Array.isArray(override))
    throw new Error(`${label}.override must be an object.`);
  const merged = { ...baseMatrix };
  for (const [roleId, policy] of Object.entries(override)) {
    if (!POLICY_ID_SET.has(roleId)) throw new Error(`${label}.override has an unknown role: "${roleId}".`);
    merged[roleId] = policy;
  }
  return validateFullMatrix(merged, known, allowedModels, label);
}

function validateFullMatrix(matrix, known, allowedModels, label) {
  if (!matrix || typeof matrix !== "object" || Array.isArray(matrix))
    throw new Error(`${label}.matrix must be an object.`);
  for (const roleId of Object.keys(matrix)) {
    if (!POLICY_ID_SET.has(roleId)) throw new Error(`${label}.matrix has an unknown role: "${roleId}".`);
  }
  for (const roleId of POLICY_IDS) {
    if (matrix[roleId] === undefined) throw new Error(`${label}.matrix is missing role: "${roleId}".`);
  }
  // `fallback` is unused here because every role is already required above, so
  // `validateStagePolicies` only ever validates the caller's values — it never fills a gap.
  return validateStagePolicies(matrix, known, allowedModels, null);
}

function buildKnownModels(catalog) {
  const models = Array.isArray(catalog?.models) ? catalog.models : [];
  return new Map(models.filter((entry) => entry?.editable).map((entry) => [entry.id, entry]));
}

function normalizeAllowedModels(allowedModels) {
  if (!Array.isArray(allowedModels) || !allowedModels.length)
    throw new Error("allowedModels must be a non-empty array of model ids.");
  return [...new Set(allowedModels.map(normalizeModelId))];
}

async function readJsonFile(absolutePath) {
  let text;
  try {
    text = await readFile(absolutePath, "utf8");
  } catch (error) {
    throw new Error(`Could not read variants file at ${absolutePath}: ${error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Could not parse variants JSON at ${absolutePath}: ${error.message}`);
  }
}

function requireNonEmptyString(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string.`);
  return value;
}

function assertOnlyKeys(object, allowed, label) {
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) throw new Error(`${label} has an unknown field: "${key}".`);
  }
}
