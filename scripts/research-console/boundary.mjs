// What the research console's bundle may not contain (`32-RESEARCH-SPLIT-PLAN.md`, Phase 4). The
// console is the research service's own build of Frontier: the world, the research bases and the
// research windows. The harness's delivery surfaces (task workspace, New task, Grill, the agent
// roster, Linear, the Companion), its API client and its task-polling runtime stay out.
//
// Checked on the module graph at build time, so a stray import fails `build:research-console`
// rather than shipping quietly. Paths are relative to the repository root.

import path from "node:path";

export const FORBIDDEN_CONSOLE_MODULES = [
  // The harness app shell and its overlays.
  /^src\/frontier\/app\/(FrontierApp|OverlayHost|command-context|navigation|routes|use-briefing|use-command-memory|command-memory)\./,
  // Delivery views.
  /^src\/frontier\/views\/(TaskPanel|TaskPolicies|TaskLifecycle|TaskJournal|TaskUsage|TaskAttachments|WorkflowCommand|Grill|NewTask|AgentPanel|AgentActivity|LinearSettings|ExecutionSettings|PolicyMatrix|ProjectSetup|Projects|RepositoryReadiness|RetainedWorktrees|Skills|RunLibrary|Usage|WorkPackages|PackageDiagram|CandidateDiff|CandidateEvidence|CandidateReadiness|DecisionNavigation|DesignReview|StageEvidence|StageSummary|ReviewEvidence|TestEvidence|DeliveryEvidence|InvestigationEvidence|JourneyEvidence|ArtifactViewer|DiffDocument|WatchPins|Welcome|WorldHud|WorldNavigation|WorldSettings|ReturnBriefing|SelectionDock|BaseSelection|ResearchSettings)\.tsx$/,
  // The harness's gateways, task polling and delivery fixtures.
  /^src\/frontier\/runtime\/(live-gateway|coordinator|decision-session|workflow|briefing|pages|run-records|test-evidence|settings|policies|diff)\.ts$/,
  /^src\/frontier\/fixtures\/(?!research\/)/,
  // The harness companion's API client.
  /^src\/api\.ts$/,
  // Anything named for Linear or the Companion.
  /(^|\/)(linear|companion)[^/]*$/i,
];

/** The forbidden modules among `ids`, as repository-relative paths. */
export function forbiddenConsoleModules(ids, root) {
  return ids
    .filter((id) => !id.startsWith("\0") && !id.includes("/node_modules/"))
    .map((id) => path.relative(root, id.split("?")[0]).split(path.sep).join("/"))
    .filter((relative) => FORBIDDEN_CONSOLE_MODULES.some((pattern) => pattern.test(relative)));
}

/** Fails the build when a forbidden module reaches the console's module graph. */
export function researchConsoleBoundary(root) {
  return {
    name: "research-console-boundary",
    buildEnd(error) {
      if (error) return;
      const found = forbiddenConsoleModules([...this.getModuleIds()], root);
      if (found.length)
        this.error(
          `The research console bundled harness modules it must not carry:\n  ${found.join("\n  ")}\n` +
            "Import only research views, the world and shared UI (research-console/boundary.mjs).",
        );
    },
  };
}
