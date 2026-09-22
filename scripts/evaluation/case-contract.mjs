import { readFile } from "node:fs/promises";

// Deliberately explicit: a selected case is not automatically a runnable case.
// Cross-project dependency/database provisioning is not supported here yet.
const definitions = {
  H02: {
    workflowProfile: "high-risk",
    grader: "evaluations/graders/h02.mjs",
    graderOutput: "file",
    checkIds: [
      "default-and-persistence",
      "api-validation",
      "task-snapshot",
      "manual-decisions",
      "automatic-provenance",
      "automatic-specification-context",
      "manual-specification-context",
      "zero-questions",
      "operator-api-boundary",
      "legacy-evidence",
      "settings-browser",
    ],
  },
  H05: {
    // Catalog projection plus UI regression tests crosses the narrow fast path.
    workflowProfile: "standard",
    grader: "evaluations/graders/h05.mjs",
    graderOutput: "directory",
    checkIds: [
      "discovered-claude-default",
      "discovered-claude-allowlist",
      "discovered-claude-stage",
      "codex-and-catalog-metadata",
      "undiscovered-stays-disabled",
      "unique-and-immutable",
      "actual-policy-editor",
    ],
  },
};

export async function loadEvaluationCase(caseId = "H02") {
  const definition = definitions[caseId];
  if (!definition) throw new Error(`Case ${caseId} has no qualified runner integration.`);
  const read = async (file) => readFile(new URL(`../../${file}`, import.meta.url), "utf8");
  const bank = JSON.parse(await read("evaluations/cases/delivery-v1.json"));
  const item = bank.cases.find((entry) => entry.id === caseId);
  if (item?.repository !== "harness") throw new Error(`Invalid Harness case: ${caseId}`);
  const contract = await read(`evaluations/cases/${caseId.toLowerCase()}-public-contract.md`);
  const rubric = JSON.parse(await read("evaluations/rubric-v1.json"));
  if (caseId === "H05") {
    rubric.version = "delivery-rubric-h05-v1";
    rubric.criteria[1] =
      "Existing behavior remains compatible except the explicitly requested catalog projection correction.";
  }
  return { ...structuredClone(definition), item, contract, rubric };
}
