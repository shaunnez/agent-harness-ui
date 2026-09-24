// Whether a web citation supports the number a run used, decided in code, never by a model.
//
// Two questions, answered one after the other (Shaun, 25 September: "we should ideally just be
// comparing the meaning behind the quotes, and/or comparing the numbers properly parsed"):
//
// 1. Where on the page is the quoted passage? Found by its words, not its exact characters: the
//    window of the page whose words best cover the quote's words. Figures are left out of that
//    score, because a figure is what a model reformats ("$1.1k" written as "$1,100").
// 2. Do the passage's own figures, read off the page and parsed, support the component's low and
//    high? The page's text is authoritative, not the quote's: a model that misquotes a number is
//    judged by what the page says.
//
// A model is not asked to judge either question. A model grading another model's quote is the
// lenient reviewer AGENTS.md warns about, and its verdict could not be reproduced.

/** Share of the quote's words the located window must contain. */
export const MIN_WORD_COVERAGE = 0.8;
/** A quote needs at least this many words to be located by its words alone. */
export const MIN_LOCATABLE_WORDS = 3;
/** Rounding a model may apply to a figure it took from the page. */
export const FIGURE_TOLERANCE = 0.03;
/** How far either end of a band set around one quoted price may sit from it: the 35% of the
 *  "wide estimate" rule. */
const BRACKET_RATIO = 1.35;
/** GST: a GST-inclusive figure divided by 1.15 is the same price, GST exclusive. */
const GST_FACTOR = 1.15;

const CURRENCY = String.raw`(?:NZ\$|NZD\s?|AU\$|AUD\s?|US\$|USD\s?|\$)`;
const NUMBER = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?`;
// `m` after a currency figure is millions; after a bare number it is metres, never a price.
const SUFFIX = String.raw`\s?(?:k|K|thousand|m|M|mil|million)(?![A-Za-z0-9])`;
const FIGURE = new RegExp(String.raw`(${CURRENCY})?\s?(${NUMBER})(${SUFFIX})?`, "g");
const RANGE_JOIN = /^\s*(?:-|–|—|to)\s*$/;

/**
 * Every figure in `text`, parsed: `[{ value, currency, start, end }]`. "$1.1k" is 1,100,
 * "$1,800–$2,300" is two figures, and "$20–30k" is 20,000 and 30,000 (the second end's
 * currency and multiplier carry back to a first end that has none and is smaller).
 */
export function parseFigures(text) {
  const source = foldDashes(decodeEntities(String(text ?? "")));
  const figures = [];
  for (const match of source.matchAll(FIGURE)) {
    const [whole, currency, digits, suffix] = match;
    const start = match.index + whole.search(/\S/);
    const raw = Number(digits.replace(/,/g, ""));
    if (!Number.isFinite(raw)) continue;
    // A digit run glued to letters ("14kVA", "A4", "2x4") is a code or a size, not a figure.
    const before = source[match.index - 1] ?? "";
    const after = source[match.index + whole.length] ?? "";
    if (/[A-Za-z]/.test(before) && !currency) continue;
    if (/[A-Za-z]/.test(after) && !suffix) continue;
    const scale = multiplier(suffix, Boolean(currency));
    if (scale == null) continue;
    figures.push({
      raw,
      value: raw * scale,
      scale,
      currency: Boolean(currency),
      start,
      end: match.index + whole.length,
    });
  }
  for (let index = 1; index < figures.length; index += 1) {
    const [first, second] = [figures[index - 1], figures[index]];
    if (!RANGE_JOIN.test(source.slice(first.end, second.start))) continue;
    if (first.scale === 1 && second.scale > 1 && first.raw < second.raw) {
      first.value = first.raw * second.scale;
      first.scale = second.scale;
    }
    if (!first.currency && second.currency) first.currency = true;
    if (first.currency && !second.currency) second.currency = true;
    first.rangeTo = second;
  }
  return figures.map(({ value, currency, start, end, rangeTo }) => ({
    value,
    currency,
    start,
    end,
    ...(rangeTo ? { rangeTo: rangeTo.value } : {}),
  }));
}

// Retained HTML text can still carry entities ("$10&ndash;$20"); read them as the characters.
const ENTITIES = { ndash: "–", mdash: "—", minus: "−", nbsp: " ", amp: "&", dollar: "$" };
function decodeEntities(value) {
  return value
    .replace(/&(ndash|mdash|minus|nbsp|amp|dollar);/g, (_, name) => ENTITIES[name])
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function multiplier(suffix, currency) {
  const word = String(suffix ?? "")
    .trim()
    .toLowerCase();
  if (!word) return 1;
  if (word === "k" || word === "thousand") return 1_000;
  // "3.6 m" is a length; only "$1.2m" is money.
  return currency ? 1_000_000 : null;
}

/**
 * The passage of `content` the quote came from, found by its words: `{ text, start, end,
 * coverage }`, or null when no window holds at least `MIN_WORD_COVERAGE` of the quote's words
 * or the quote has too few words to place.
 */
export function locatePassage(content, excerpt) {
  const text = String(content ?? "");
  const page = tokens(text);
  const quote = tokens(excerpt);
  const quoteWords = quote.filter((token) => token.word);
  if (quoteWords.length < MIN_LOCATABLE_WORDS || !page.length) return null;
  const wantedWords = counts(quoteWords.map((token) => token.text));
  const wantedFigures = counts(quote.filter((token) => !token.word).map((token) => token.text));
  const span = Math.ceil(quote.length * 1.3) + 2;
  let best = null;
  for (let start = 0; start < page.length; start += 1) {
    if (!wantedWords.has(page[start].text) && !wantedFigures.has(page[start].text)) continue;
    const have = new Map();
    let words = 0;
    let figures = 0;
    for (let end = start; end < Math.min(page.length, start + span); end += 1) {
      const token = page[end];
      const wanted = (token.word ? wantedWords : wantedFigures).get(token.text) ?? 0;
      const key = `${token.word ? "w" : "f"}:${token.text}`;
      const used = have.get(key) ?? 0;
      if (used < wanted) {
        have.set(key, used + 1);
        if (token.word) words += 1;
        else figures += 1;
        // Words place the passage; figures only break a tie between two equally worded
        // windows ("Asbestos Roofing Removal: $50 - $150" against "Asbestos Cladding Removal").
        const score = words * 1_000 + figures;
        if (!best || score > best.score || (score === best.score && end - start < best.end - best.start))
          best = { score, words, start, end };
      }
    }
  }
  const coverage = best ? best.words / quoteWords.length : 0;
  if (!best || coverage < MIN_WORD_COVERAGE) return null;
  // The window runs from its first matched token to its last, then out to the figures on either
  // side that belong to it: "$1,800–$2,300" before "per door" is part of the passage that states it.
  let from = page[best.start].start;
  let to = page[best.end].end;
  if (/^\W*\d|^\s*[$]/.test(foldDashes(String(excerpt)).trim())) from = extendBack(text, from);
  if (/\d\W*$/.test(String(excerpt).trim())) to = extendForward(text, to);
  return { text: text.slice(from, to), start: from, end: to, coverage };
}

// Out to the figures touching the window's edge, never past a line break or a word.
function extendBack(text, from) {
  const before = text.slice(Math.max(0, from - 60), from);
  const match = /((?:NZ\$|NZD\s?|\$)?\s?[\d,.]+\s?[kKmM]?\s?(?:[-–—]|to)?\s?)+$/.exec(before);
  const extended = match ? from - match[0].length : from;
  // The window can start on the digits, leaving their currency sign just outside it.
  const sign = /(?:NZ\$|NZD\s?|\$)\s?$/.exec(text.slice(Math.max(0, extended - 5), extended));
  return sign ? extended - sign[0].length : extended;
}

function extendForward(text, to) {
  const after = text.slice(to, to + 60);
  const match = /^(\s?(?:[-–—]|to)?\s?(?:NZ\$|NZD\s?|\$)?\s?[\d,.]+(?:\s?(?:k|K)(?![A-Za-z]))?)+/.exec(after);
  return match ? to + match[0].length : to;
}

function tokens(value) {
  const text = String(value ?? "");
  const folded = foldDashes(text).toLowerCase();
  const out = [];
  for (const match of folded.matchAll(/[a-z]+|\d[\d,.]*/g))
    out.push({
      text: match[0],
      word: /^[a-z]/.test(match[0]),
      start: match.index,
      end: match.index + match[0].length,
    });
  return out;
}

function counts(values) {
  const map = new Map();
  for (const value of values) map.set(value, (map.get(value) ?? 0) + 1);
  return map;
}

// One character for one character, so offsets into the folded text are offsets into the page.
function foldDashes(value) {
  return value.replace(/[‐-―−﹘﹣－]/g, "-");
}

/**
 * Whether `passage`'s figures support a component's `low` and `high`: `{ support, figures }`,
 * `support` being:
 *
 * - `match`: each end is one of the passage's figures, within `FIGURE_TOLERANCE`, after at most
 *   one factor the component itself states (a quantity in its role, unit or caveat) or GST;
 * - `within`: both ends lie inside one range the passage states ("$1,800–$2,300"), under the
 *   same factor;
 * - `no_figures`: the passage states no figure at all;
 * - `partial`: one end is the page's figure and the other is not, or the band is set close
 *   around one figure the page states;
 * - `derived`: the page's figures are not the component's, but the component states the
 *   quantities or adjustment it worked with, so the number may be worked from the quote;
 * - `mismatch`: the component's number is not one the page gives and it shows no working.
 *
 * Money figures are used when the passage has any; otherwise every figure is.
 */
export function figuresSupport(passage, { low, high, context = "" }) {
  const all = parseFigures(passage);
  const money = all.filter((figure) => figure.currency);
  const figures = (money.length ? money : all).filter((figure) => figure.value > 0);
  const values = figures.map((figure) => figure.value);
  // A component priced at nothing ("context only, $0") uses no figure, so none can be wrong.
  const ends = [low, high].filter((value) => value != null && Number.isFinite(Number(value))).map(Number);
  if (!ends.length || ends.every((end) => end === 0)) return { support: "match", figures: values };
  if (!values.length) return { support: "no_figures", figures: [] };
  const factors = componentFactors(context);
  const tolerance = FIGURE_TOLERANCE;
  const near = (x, y) => Math.abs(x - y) <= tolerance * Math.max(Math.abs(x), Math.abs(y));
  // A zero low end ("0 if the network already has capacity") is a judgement, not a quoted figure.
  const priced = ends.filter((end) => end !== 0);
  // A component that bundles two items the page prices separately ("photo-eyes $140 … edge
  // sensors $180") is their sum; pairs are tried only on short passages, where they stay few.
  const sums = values.length <= 12 ? values.flatMap((a, i) => values.slice(i + 1).map((b) => a + b)) : [];
  const onPage = (end, factor) => [...values, ...sums].some((value) => near(end, value * factor));
  for (const factor of factors)
    if (priced.every((end) => onPage(end, factor))) return { support: "match", figures: values };
  const ranges = figures
    .filter((figure) => figure.rangeTo != null)
    .map((figure) => [Math.min(figure.value, figure.rangeTo), Math.max(figure.value, figure.rangeTo)]);
  for (const factor of factors)
    for (const [from, to] of ranges)
      if (
        priced.every((end) => end >= from * factor * (1 - tolerance) && end <= to * factor * (1 + tolerance))
      )
        return { support: "within", figures: values };
  // The page states figures and the component's are not among them. When the component shows the
  // quantities it worked with, the figure was worked from the quote in a way this check cannot
  // follow (hours times a rate, spread over 40 fittings); when it shows none, it is simply not
  // the page's number.
  // One end on the page ("$146.41", the band's low) and the other from elsewhere is a band built
  // around the quote, which the check can confirm only half of.
  if (
    [1, 1 / GST_FACTOR].some((factor) =>
      priced.some((end) => values.some((value) => near(end, value * factor))),
    )
  )
    return { support: "partial", figures: values };
  // A band set around one quoted price ("$310 per metre" priced 280–340) contains it and stays
  // close to it; that too is worked from the quote, not a figure it states.
  const [bandLow, bandHigh] = [Math.min(...priced), Math.max(...priced)];
  const bracketed = [1, 1 / GST_FACTOR].some((factor) =>
    values.some((value) => {
      const price = value * factor;
      return (
        bandLow <= price &&
        price <= bandHigh &&
        bandLow >= price / BRACKET_RATIO &&
        bandHigh <= price * BRACKET_RATIO
      );
    }),
  );
  if (priced.length === 2 && bracketed) return { support: "partial", figures: values };
  const worked = statedQuantities(context).length > 0 || WORKED.test(String(context));
  return { support: worked ? "derived" : "mismatch", figures: values };
}

const WORKED =
  /\b(amorti[sz]ed|averaged|apportioned|pro[- ]?rata|share of|uplift|converted|scaled|adjusted|derived|allowance for)\b|[×*]/i;

/** 1, GST, and each quantity the component states, as a multiplier or a divisor. */
function componentFactors(context) {
  const factors = new Set([1, 1 / GST_FACTOR]);
  for (const quantity of statedQuantities(context))
    for (const factor of [quantity, 1 / quantity, quantity / GST_FACTOR, 1 / (quantity * GST_FACTOR)])
      factors.add(factor);
  return [...factors];
}

// A quantity is a number the component ties to a count or a measure ("x 18 m2", "over 40",
// "60 panels", "12-24 hours"), not any digit in its description: "6-pin cylinder" and "4mm core"
// are specifications, and multiplying by them would let almost any number match.
const COUNTED = String.raw`(?:x|×|no\.?|nr|off|panels?|fittings?|doors?|leaf|leaves|sets?|certs?|keys?|units?|lights?|items?|points?|pits?|days?|weeks?|hrs?|hours?|m2|m²|sq\s?m|lm|lin\s?m|metres?|meters?|m\b|kva|kw|tonnes?|t\b)`;
const QUANTITY_AFTER = new RegExp(
  String.raw`(\d[\d,]*(?:\.\d+)?)\s?(?:-|–|to)?\s?(?:\d[\d,]*(?:\.\d+)?)?\s?${COUNTED}`,
  "gi",
);
const QUANTITY_BEFORE = /(?:over|across|x|×|@|\/|per|for)\s?(\d[\d,]*(?:\.\d+)?)(?![\d.])/gi;

export function statedQuantities(context) {
  const text = foldDashes(String(context ?? ""));
  const found = new Set();
  for (const pattern of [QUANTITY_AFTER, QUANTITY_BEFORE])
    for (const match of text.matchAll(pattern)) {
      const value = Number(match[1].replace(/,/g, ""));
      if (value > 1 && value <= 100_000) found.add(value);
    }
  // "12-24 hours": both ends of a stated range are quantities.
  for (const match of text.matchAll(
    new RegExp(String.raw`(\d+(?:\.\d+)?)\s?(?:-|to)\s?(\d+(?:\.\d+)?)\s?${COUNTED}`, "gi"),
  ))
    for (const value of [Number(match[1]), Number(match[2])])
      if (value > 1 && value <= 100_000) found.add(value);
  return [...found];
}
