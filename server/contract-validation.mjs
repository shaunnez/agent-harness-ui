export function contractText(value, label, { max = 1_000, required = false } = {}) {
  const text = String(value ?? "")
    .trim()
    .slice(0, max);
  if (required && !text) throw new Error(`${label} is required and must be a non-empty string.`);
  return text || null;
}

export function contractList(value, label, { max, min = 0, itemMax = 500 } = {}) {
  if (value == null) {
    if (min > 0) throw new Error(`${label} must list at least ${min} entr${min === 1 ? "y" : "ies"}.`);
    return [];
  }
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  if (value.length > max) throw new Error(`${label} must list at most ${max} entries.`);
  const items = value
    .map((item) =>
      String(item ?? "")
        .trim()
        .slice(0, itemMax),
    )
    .filter(Boolean);
  if (items.length < min)
    throw new Error(`${label} must list at least ${min} entr${min === 1 ? "y" : "ies"}.`);
  return items;
}

export function contractUnitInterval(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1)
    throw new Error(`${label} must be a number from 0 to 1.`);
  return Math.round(number * 1_000) / 1_000;
}
