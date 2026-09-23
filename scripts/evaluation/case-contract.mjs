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
  H06: {
    workflowProfile: "standard",
    grader: "evaluations/graders/h06.mjs",
    graderOutput: "directory",
    checkIds: [
      "api-persistence-and-boundary",
      "off-pauses-intake-and-on-resumes",
      "off-waits-for-current-receipt",
      "off-pauses-publication",
      "off-pauses-linear-replies-but-local-grill-works",
      "unconfigured-fails-closed-and-local-continues",
      "frontier-integrations-control",
    ],
  },
  P05: {
    workflowProfile: "standard",
    // Record-claim tests resolve this ancestor by SHA; a shallow base checkout omits it.
    historicalGitPins: ["5f71139dc92e41ac867fd7f309f2b8b297d266fd"],
    // macOS Seatbelt refuses ps even with allow default. These unrelated host-process
    // lifecycle checks pass in the unsandboxed frozen-base/reference qualification.
    sandboxUnsupportedTestIds: [
      "test_pid_reuse_is_never_signalled",
      "test_managed_worker_start_duplicate_guard_and_graceful_stop",
    ],
    grader: "evaluations/graders/p05.mjs",
    graderAssets: [
      "evaluations/graders/p05/test_p317_pg.py",
      "evaluations/graders/p05/p317-hidden.spec.ts",
      "evaluations/graders/p05/synthetic_register.json",
    ],
    graderOutput: "directory",
    graderTimeoutMs: 900000,
    checkIds: ["postgres-persistence-and-totals", "review-browser-selection"],
  },
};

export async function loadEvaluationCase(caseId = "H02") {
  const definition = definitions[caseId];
  if (!definition) throw new Error(`Case ${caseId} has no qualified runner integration.`);
  const read = async (file) => readFile(new URL(`../../${file}`, import.meta.url), "utf8");
  const bank = JSON.parse(await read("evaluations/cases/delivery-v1.json"));
  const item = bank.cases.find((entry) => entry.id === caseId);
  if (!item || !["harness", "plancheck"].includes(item.repository))
    throw new Error(`Invalid evaluation case: ${caseId}`);
  const contract = await read(`evaluations/cases/${caseId.toLowerCase()}-public-contract.md`);
  const rubric = JSON.parse(await read("evaluations/rubric-v1.json"));
  if (caseId === "H05") {
    rubric.version = "delivery-rubric-h05-v1";
    rubric.criteria[1] =
      "Existing behavior remains compatible except the explicitly requested catalog projection correction.";
  }
  if (caseId === "H06") {
    rubric.version = "delivery-rubric-h06-v1";
    rubric.criteria[1] =
      "Existing behavior remains compatible except the explicitly requested Linear pause/resume control.";
  }
  if (caseId === "P05") {
    rubric.version = "delivery-rubric-p05-v1";
    rubric.criteria[1] =
      "Existing PlanCheck behavior remains compatible except the requested candidate persistence and Review states.";
  }
  return { ...structuredClone(definition), item, contract, rubric };
}
