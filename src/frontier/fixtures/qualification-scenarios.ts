import type { RuntimeTask } from "../../domain";
import { fixtureArtifact, fixtureRun, fixtureTask, fixtureTime } from "./scenarios.ts";

/** Bounded, fictional records for integrated workspace qualification only. */
export function qualificationScenarios(): RuntimeTask[] {
  const runs = Array.from({ length: 55 }, (_, index) => ({
    ...fixtureRun("QA-206", "specification", "completed"),
    id: `R-QA-206-${String(index).padStart(2, "0")}`,
    attempt: index + 1,
  }));
  const completed = fixtureTask(
    "QA-206",
    "Sample completed investigation with a deliberately long task title: retain source references, explain unavailable records, and keep every review decision inspectable through partial history and return paths",
    "/demo/agent-harness-ui",
    {
      status: "completed",
      currentStage: "specification",
      completedStages: ["triage", "specification"],
      stageRunLimit: 60,
      stageDispositions: {
        scouts: {
          status: "not-required",
          reason: "Sample bounded investigation needed no repository scouts.",
          decidedAt: fixtureTime,
        },
        grill: {
          status: "not-required",
          reason: "Sample investigation had no material questions.",
          decidedAt: fixtureTime,
        },
      },
      startedAt: new Date(Date.parse(fixtureTime) - 3600000).toISOString(),
      completedAt: fixtureTime,
      runs,
      artifacts: [
        fixtureArtifact(
          "QA-206-spec",
          "specification",
          `# Sample retained investigation\n\nA completed investigation is not an implemented candidate.\n\n## Retained output\n\n\`\`\`text\n${Array.from({ length: 100 }, (_, index) => `Observation ${index + 1}: ${"source-reference/".repeat(16)}missing stays unknown`).join("\n")}\n\`\`\`\n\nEnd of retained sample output.`,
        ),
      ],
    },
  );
  const unavailable = fixtureTask(
    "QA-207",
    "Sample unavailable retained evidence",
    "/demo/agent-harness-ui",
    {
      status: "awaiting-spec-approval",
      currentStage: "specification",
      runs: [fixtureRun("QA-207", "specification", "completed")],
      artifacts: [fixtureArtifact("QA-207-unavailable", "specification", "")],
    },
  );
  return [completed, unavailable];
}
