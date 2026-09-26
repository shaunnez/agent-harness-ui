// The host's check of a finished answer, before it is accepted: arithmetic and wording rules in
// code, never a model's opinion. Each problem goes back to the model once, as feedback it may act on
// or answer; the second answer is final whatever it says.
//
// Every rule comes from a disagreement read in A8's runs (`29-EVAL-PREREGISTRATION.md`, 25
// September): one run in three making a mistake the other two did not, which turns a question
// the runs otherwise agree on into a dispute.

import { parseCostBand } from "./engine/qv-recipe.mjs";
import { unitMeasure } from "./research-question-record.mjs";

/** A band whose high end is more than this multiple of its low end is not an estimate. Replayed on
 *  the recorded runs, 2× also caught honest lump-sum ranges (solar's $10.5k–22k); 3× catches the
 *  hedges that broke agreement ($30–200 per m², $92k–292k). */
export const MAX_BAND_SPREAD = 3;
/** A one-off cost this large a share of a rate band's high end was not spread over the quantity. */
const ONE_OFF_SHARE = 0.25;

const ONE_OFF =
  /\b(lump[- ]?sum|per job|one[- ]off|deliver(y|ies)|pick[- ]?up|mobili[sz]ation|establishment|set[- ]?up|per visit|each way|call[- ]out|fixed fee|design fee|per connection|per application)\b/i;
const SPREAD = /\b(amorti[sz]ed|spread|shared|averaged|apportioned|pro[- ]?rata|divided)\b/i;
const CHANGE =
  /\b(instead of|in lieu of|in place of|replac(e|es|ing)\b|switch(ing)? (the|from|to)|swap(ping)? |cost impact of)/i;
// What QV never publishes, which the prompt sends to the web: network and lines-company charges,
// statutory and council fees, consultants' and engineers' fees, certification and inspection.
const WEB_ONLY =
  /\b(network|lines? company|vector|capital contribution|development contribution|connection (fee|charge)|consent|levy|council|statutory|engineer\w*|consultant|design fee|certific\w*|inspection|assessment|licen[cs]\w*|permit|clearance)\b/i;
const NOT_SUMMED = /\b(cross[- ]?check|comparison only|not summed|not in band|not added|for comparison)\b/i;
const CREDIT = /\b(deduct\w*|credit|omit\w*|less|saving|removed?|baseline|delete\w*)\b/i;

/**
 * Problems with a final answer, as sentences addressed to the model; empty when there are none or
 * the answer has no parseable band. `objective` is the question as asked: only its opening is read
 * for a change question, because a pinned scope's pasted notes mention "instead of" in passing.
 */
export function reviewAnswer({ objective = "", text }) {
  return reviewCostBand(parseCostBand(text), objective);
}

/** The same check on an answer already parsed with `parseCostBand`. */
export function reviewCostBand(answer, objective = "") {
  if (!answer?.band) return [];
  const { band } = answer;
  // A cross-check the answer shows but does not add is not part of the band.
  const components = answer.components.filter((component) => !NOT_SUMMED.test(component.role ?? ""));
  const problems = [];
  const low = Number(band.low);
  const high = Number(band.high);

  // A change's band is a difference, and a difference's ends can be far apart in ratio while close
  // in dollars; its spread is not checked.
  const change = CHANGE.test(String(objective).slice(0, 300));
  if (!change && low > 0 && high / low > MAX_BAND_SPREAD)
    problems.push(
      `Your band ${low}–${high} spans ${round(high / low)}×. A band that wide is not an estimate: narrow it to the specification the scope pins, or set it to not established and say what is missing.`,
    );

  const measure = unitMeasure(band.unit);
  if (measure && measure !== "total")
    for (const component of components) {
      // The role and unit say what the component is; a caveat mentions delivery in passing.
      const words = [component.role, component.unit].filter(Boolean).join(" ");
      const spread = SPREAD.test(words) || (component.quantity && component.quantity.high < 1);
      if (!ONE_OFF.test(words) || spread) continue;
      if (Number(component.high ?? 0) < ONE_OFF_SHARE * high) continue;
      problems.push(
        `"${clip(component.role)}" (${component.low}–${component.high}) reads as a one-off cost, but your band is ${measure}. Spread it over the quantity (give "quantity" as a fraction, such as 1/1200 for one delivery across 1,200 m²) or leave it out and say so.`,
      );
    }

  const hasCredit = components.some(
    (component) =>
      Number(component.low) < 0 || Number(component.high) < 0 || CREDIT.test(component.role ?? ""),
  );
  if (change && !hasCredit)
    problems.push(
      "The question asks what a change costs, but your answer has no credit for what the change removes. Price the new item less the item it replaces (a negative component for the omitted work), or say in the band basis why no credit applies.",
    );

  const main = [...components]
    .filter((component) => component.low != null && component.high != null)
    .sort((a, b) => b.low + b.high - (a.low + a.high))[0];
  if (
    main &&
    !main.rowId &&
    (main.sourceId || main.source) &&
    !/\bQV\b/i.test(main.caveat ?? "") &&
    !WEB_ONLY.test(main.role ?? "")
  )
    problems.push(
      `Your largest component, "${clip(main.role)}", is priced from a web page. Search QV for it and price it from a QV row if one fits the specification: a retail list price leaves out trade installation and margin. If no QV row fits, say in its caveat which QV searches you tried.`,
    );
  return problems;
}

/** The message the model gets back with the problems. */
export function reviewMessage(problems) {
  return [
    "The host checked your answer before accepting it and found:",
    ...problems.map((problem, index) => `${index + 1}. ${problem}`),
    "Fix what applies and give the complete answer again in the same JSON format. If a point is wrong for this scope, keep that part and say why in the caveat. This is the only check; your next answer is final.",
  ].join("\n");
}

function clip(value, limit = 80) {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function round(value) {
  return Math.round(value * 10) / 10;
}
