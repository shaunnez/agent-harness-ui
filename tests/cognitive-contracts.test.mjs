import assert from "node:assert/strict";
import test from "node:test";
import {
  renderFailureDiagnosisMarkdown,
  renderInvestigationResultMarkdown,
  renderPlanCritiqueMarkdown,
} from "../server/contract-rendering.mjs";
import {
  COGNITIVE_STAGE_IDS,
  PLAN_CRITIQUE_DIMENSIONS,
  parseFailureDiagnosis,
  parseInvestigationResult,
  parsePlanCritique,
} from "../server/structured-output.mjs";

function block(label, payload) {
  return `Some prose the harness ignores.\n<${label}>\n${JSON.stringify(payload)}\n</${label}>\n`;
}

const INVESTIGATION = {
  hypotheses: [
    {
      id: "H-alpha",
      claim: "Visibility filtering drops delegated mailbox connections",
      confidence: 0.82,
      supportingEvidence: ["backend/mailbox/service.py:183", "test_mailbox_visibility.py:91"],
      contradictingEvidence: ["backend/mailbox/roles.py:40"],
      unknowns: ["Whether role inheritance occurs upstream"],
    },
    {
      id: "H-beta",
      claim: "The delegation join is missing an index",
      confidence: 0.2,
      supportingEvidence: ["backend/mailbox/models.py:12"],
    },
  ],
  recommendedDiagnosis: "H-alpha",
  remainingUncertainty: 0.18,
  additionalEvidenceNeeded: [],
};

const CRITIQUE = {
  verdict: "REVISE",
  blocking: [
    {
      dimension: "acceptance-coverage",
      claim: "No step covers the delegated-connection acceptance criterion",
      evidence: ["spec.md:14"],
    },
  ],
  advisory: [{ dimension: "scope", claim: "Renaming the helper is unrelated to the brief" }],
};

const DIAGNOSIS = {
  classification: "plan_defect",
  rewindTo: "plan",
  rationale: "The plan never touched the visibility predicate the failing test exercises.",
  evidence: ["tests/test_mailbox_visibility.py:91"],
  confidence: 0.74,
};

// --- investigation result --------------------------------------------------------

test("an investigation result canonicalises hypothesis ids and resolves the recommendation", () => {
  const result = parseInvestigationResult(block("investigation-result", INVESTIGATION));
  assert.deepEqual(
    result.hypotheses.map((hypothesis) => hypothesis.id),
    ["H1", "H2"],
  );
  assert.equal(result.recommendedDiagnosis, "H1");
  assert.equal(result.hypotheses[0].confidence, 0.82);
  assert.equal(result.remainingUncertainty, 0.18);
  assert.deepEqual(result.hypotheses[1].unknowns, []);
});

test("a hypothesis with no supporting evidence is refused", () => {
  const payload = structuredClone(INVESTIGATION);
  payload.hypotheses[1].supportingEvidence = [];
  assert.throws(
    () => parseInvestigationResult(block("investigation-result", payload)),
    /supporting evidence must list at least 1 entry/,
  );
});

test("a recommendation pointing at no hypothesis is refused", () => {
  const payload = { ...INVESTIGATION, recommendedDiagnosis: "H-nonexistent" };
  assert.throws(
    () => parseInvestigationResult(block("investigation-result", payload)),
    /does not match any hypothesis/,
  );
});

test("claiming zero uncertainty while listing unknowns is refused as contradictory", () => {
  const payload = { ...INVESTIGATION, remainingUncertainty: 0 };
  assert.throws(
    () => parseInvestigationResult(block("investigation-result", payload)),
    /cannot also list unknowns/,
  );
});

test("reporting uncertainty without naming what is unknown is refused", () => {
  const payload = structuredClone(INVESTIGATION);
  payload.hypotheses[0].unknowns = [];
  assert.throws(
    () => parseInvestigationResult(block("investigation-result", payload)),
    /must say what is still unknown/,
  );
});

test("investigation confidence outside 0-1 and oversized hypothesis lists are refused", () => {
  assert.throws(
    () =>
      parseInvestigationResult(
        block("investigation-result", {
          ...INVESTIGATION,
          hypotheses: [{ ...INVESTIGATION.hypotheses[0], confidence: 1.4 }],
        }),
      ),
    /confidence must be a number from 0 to 1/,
  );
  assert.throws(
    () =>
      parseInvestigationResult(
        block("investigation-result", {
          ...INVESTIGATION,
          hypotheses: new Array(9).fill(INVESTIGATION.hypotheses[0]),
        }),
      ),
    /1-8 hypotheses/,
  );
});

test("a duplicated hypothesis id is refused rather than silently collapsed", () => {
  const payload = structuredClone(INVESTIGATION);
  payload.hypotheses[1].id = "H-alpha";
  assert.throws(
    () => parseInvestigationResult(block("investigation-result", payload)),
    /reuses the hypothesis id/,
  );
});

// --- plan critique --------------------------------------------------------------

test("a plan critique keeps evidenced blocking findings and unevidenced taste as advisory", () => {
  const critique = parsePlanCritique(block("plan-critique", CRITIQUE));
  assert.equal(critique.verdict, "REVISE");
  assert.equal(critique.blocking.length, 1);
  assert.deepEqual(critique.blocking[0].evidence, ["spec.md:14"]);
  assert.equal(critique.advisory[0].dimension, "scope");
  assert.deepEqual(critique.advisory[0].evidence, []);
});

test("a blocking finding without evidence cannot block", () => {
  const payload = structuredClone(CRITIQUE);
  payload.blocking[0].evidence = [];
  assert.throws(
    () => parsePlanCritique(block("plan-critique", payload)),
    /Blocking finding 1 evidence must list at least 1 entry/,
  );
});

test("a blocking finding outside the closed dimension list cannot block", () => {
  const payload = structuredClone(CRITIQUE);
  payload.blocking[0].dimension = "elegance";
  assert.throws(() => parsePlanCritique(block("plan-critique", payload)), /not a plan defect/);
  assert.equal(PLAN_CRITIQUE_DIMENSIONS.includes("elegance"), false);
});

test("verdict and blocking findings must agree in both directions", () => {
  assert.throws(
    () => parsePlanCritique(block("plan-critique", { verdict: "REVISE", blocking: [], advisory: [] })),
    /REVISE verdict must name at least one blocking finding/,
  );
  assert.throws(
    () => parsePlanCritique(block("plan-critique", { ...CRITIQUE, verdict: "PASS" })),
    /PASS verdict cannot carry blocking findings/,
  );
});

test("an unknown plan critique verdict is refused", () => {
  assert.throws(
    () => parsePlanCritique(block("plan-critique", { verdict: "MAYBE", blocking: [] })),
    /verdict must be PASS or REVISE/,
  );
});

// --- failure diagnosis ---------------------------------------------------------

test("a failure diagnosis normalises its classification and keeps the proposal separate", () => {
  const diagnosis = parseFailureDiagnosis(block("failure-diagnosis", DIAGNOSIS));
  assert.equal(diagnosis.classification, "PLAN_DEFECT");
  assert.equal(diagnosis.proposedRewindTo, "plan");
  assert.equal(diagnosis.confidence, 0.74);
  assert.equal("rewindTo" in diagnosis, false);
});

test("an unknown classification or unknown rewind stage is refused", () => {
  assert.throws(
    () => parseFailureDiagnosis(block("failure-diagnosis", { ...DIAGNOSIS, classification: "VIBES" })),
    /classification must be one of/,
  );
  assert.throws(
    () => parseFailureDiagnosis(block("failure-diagnosis", { ...DIAGNOSIS, rewindTo: "coffee" })),
    /must name a known stage/,
  );
  assert.equal(COGNITIVE_STAGE_IDS.includes("plan-review"), true);
});

test("a failure diagnosis without evidence or rationale is refused", () => {
  assert.throws(
    () => parseFailureDiagnosis(block("failure-diagnosis", { ...DIAGNOSIS, evidence: [] })),
    /evidence must list at least 1 entry/,
  );
  assert.throws(
    () => parseFailureDiagnosis(block("failure-diagnosis", { ...DIAGNOSIS, rationale: "  " })),
    /rationale is required/,
  );
});

// --- shared parse behaviour -----------------------------------------------------

test("every contract refuses a missing block and malformed JSON", () => {
  const cases = [
    ["investigation-result", parseInvestigationResult],
    ["plan-critique", parsePlanCritique],
    ["failure-diagnosis", parseFailureDiagnosis],
  ];
  for (const [label, parse] of cases) {
    assert.throws(() => parse("no block here at all"), new RegExp(`required ${label} JSON block`));
    assert.throws(
      () => parse(`<${label}>\n{ not json\n</${label}>`),
      new RegExp(`${label} JSON block was invalid`),
    );
  }
});

test("a contract wrapped in a single markdown fence still parses", () => {
  const fenced = `<plan-critique>\n\`\`\`json\n${JSON.stringify(CRITIQUE)}\n\`\`\`\n</plan-critique>`;
  assert.equal(parsePlanCritique(fenced).verdict, "REVISE");
});

// --- renderings ----------------------------------------------------------------

test("the investigation rendering leads with the recommendation and cites its evidence", () => {
  const markdown = renderInvestigationResultMarkdown(
    parseInvestigationResult(block("investigation-result", INVESTIGATION)),
  );
  assert.match(markdown, /\*\*Recommended diagnosis:\*\* H1 — Visibility filtering/);
  assert.match(markdown, /\*\*Confidence:\*\* 82% · \*\*Remaining uncertainty:\*\* 18%/);
  assert.match(markdown, /### H1 — 82% \(recommended\)/);
  assert.match(markdown, /- backend\/mailbox\/service\.py:183/);
  assert.match(markdown, /Contradicting evidence:/);
  assert.match(markdown, /Unknowns:/);
});

test("the critique rendering separates blocking from advisory", () => {
  const markdown = renderPlanCritiqueMarkdown(parsePlanCritique(block("plan-critique", CRITIQUE)));
  assert.match(markdown, /\*\*Verdict:\*\* REVISE/);
  assert.match(markdown, /1 blocking finding must be answered/);
  assert.match(markdown, /### Blocking/);
  assert.match(markdown, /### Advisory \(non-blocking\)/);
});

test("the diagnosis rendering says plainly when the router overruled the agent", () => {
  const diagnosis = parseFailureDiagnosis(block("failure-diagnosis", DIAGNOSIS));
  assert.match(
    renderFailureDiagnosisMarkdown(diagnosis, { routedTo: "plan" }),
    /\*\*Router agreed:\*\* rewinding to plan\./,
  );
  assert.match(
    renderFailureDiagnosisMarkdown(diagnosis, { routedTo: "specification" }),
    /Router overruled the proposal:\*\* rewinding to specification, not plan/,
  );
  assert.doesNotMatch(renderFailureDiagnosisMarkdown(diagnosis), /Router/);
});
