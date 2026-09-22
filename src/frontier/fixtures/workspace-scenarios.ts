import type { RuntimeTask } from "../../domain";
import { qualificationScenarios } from "./qualification-scenarios.ts";
import { reviewScenarios } from "./review-scenarios.ts";
import { fixtureArtifact, fixtureRun, fixtureTask, fixtureTime } from "./scenarios.ts";

/** Explicit workflow QA records for long input, failed scouts and variable documents. */
export function workspaceScenarios(): RuntimeTask[] {
  const repository = "/demo/agent-harness-ui";
  const run = fixtureRun("QA-201", "scouts", "failed");
  run.role = "code-path scout";
  run.error = "Sample scout could not read the captured source. Earlier evidence is retained.";
  const scouts = fixtureTask("QA-201", "Sample failed scout and retained assessment", repository, {
    status: "failed",
    currentStage: "scouts",
    completedStages: ["triage"],
    error: run.error,
    runs: [run],
    workflowProfile: {
      selected: "standard",
      reason: "Source ownership needs investigation before planning.",
      source: "automatic",
      selectedAt: fixtureTime,
      history: [],
    },
    scoutDispatch: {
      selected: [
        {
          name: "code-path",
          focus: "Locate the captured source boundary",
          reason: "Establish ownership before changing behaviour",
          status: "failed",
          error: run.error,
        },
        {
          name: "test-inventory",
          focus: "Inspect the verification manifest",
          reason: "Identify checks for this boundary",
          status: "queued",
        },
      ],
      skipped: ["dependency", "pattern", "schema", "user-journey"],
      createdAt: fixtureTime,
      completedAt: null,
    },
    artifacts: [
      fixtureArtifact(
        "QA-201-triage",
        "triage",
        "# Retained assessment\n\n## Outcome\nInvestigate the source boundary before planning.\n\n## Scope\nA failed read does not establish repository facts.",
      ),
    ],
  });
  const document = fixtureArtifact(
    "QA-202-spec",
    "specification",
    "# Sample document with varied sections\n\nIntroductory text remains visible.\n\n## Outcome\nKeep every recorded observation traceable.\n\n## Scope\n- Preserve source documents.\n- Inspect only the selected records.\n\n## Acceptance criteria\n- Source links remain available.\n- Unknown values remain unknown.\n\n## Verification\nRead the retained evidence.\n\n### Unexpected **heading**\nThis nonstandard section must not disappear.\n\n| Evidence | State |\n| --- | --- |\n| Sample source | Retained |\n\n```text\nUnstructured retained output stays readable.\n```",
  );
  document.contextManifest = {
    stage: "specification",
    promptCharacters: 4200,
    estimatedPromptTokens: 1050,
    repositoryAccess: "read-only",
    policy: "Sample bounded context manifest",
    sources: [
      {
        kind: "artifact",
        id: "sample-source",
        label: "Sample investigation source",
        includedCharacters: 4000,
        originalCharacters: 6000,
        truncated: true,
      },
    ],
  };
  const spec = fixtureTask("QA-202", "Sample variable-shape specification", repository, {
    status: "awaiting-spec-approval",
    currentStage: "specification",
    artifacts: [document],
    runs: [fixtureRun("QA-202", "specification", "completed")],
  });
  const grill = fixtureTask("QA-203", "Sample long decision and custom draft", repository, {
    status: "awaiting-grill",
    currentStage: "grill",
    completedStages: ["triage", "scouts"],
    runs: [fixtureRun("QA-203", "grill", "completed")],
    artifacts: [
      fixtureArtifact(
        "QA-203-source",
        "scouts",
        "# Sample retained source\n\nThe operator must decide how partial evidence should be reported.",
      ),
    ],
    grillSession: {
      status: "open",
      createdAt: fixtureTime,
      completedAt: null,
      completionReason: null,
      questions: [
        {
          id: "Q1",
          question: "How should partial evidence be presented when several source records are unavailable?",
          whyItMatters: Array.from(
            { length: 12 },
            (_, index) =>
              `Sample observation ${index + 1}: some records have source links and others remain unavailable; the decision must preserve that distinction.`,
          ).join("\n\n"),
          options: [
            {
              id: "retain",
              label: "Retain partial evidence",
              description: "Show available references and identify missing records.",
              recommended: true,
            },
          ],
          allowCustom: true,
          answer: null,
          answerSource: null,
          resolvedAt: null,
        },
        {
          id: "Q2",
          question: "What should the summary call missing evidence?",
          whyItMatters: "Missing evidence must not become a success claim.",
          options: [
            {
              id: "unknown",
              label: "Unknown",
              description: "Keep the missing-data state explicit.",
              recommended: true,
            },
          ],
          allowCustom: true,
          answer: null,
          answerSource: null,
          resolvedAt: null,
        },
      ],
    },
  });
  return [scouts, spec, grill, ...reviewScenarios(), ...qualificationScenarios()];
}
