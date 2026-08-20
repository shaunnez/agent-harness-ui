import { normalizeModelId, readExecutionProviderCatalog } from "./model-catalog.mjs";
import { inspectRepositoryContract } from "./repository-contract.mjs";
import { projectTaskSummary } from "./task-projections.mjs";
import { WORKFLOW_PROFILE_IDS } from "./workflow-profiles.mjs";

const APPROVAL_COMPLETIONS = new Set(["pull-request", "local-merge"]);

const GRILL_POLICIES = new Set(["manual", "auto-accept-recommendations"]);

export function createRuntimeSettingsRoutes({
  store,
  orchestrator,
  suggestedRepository,
  csrfToken,
  worktrees,
  send,
  readJson,
  validateRepository,
  validateStagePolicies,
  worktreeEntriesForTask,
  runtimeSchemaVersion,
}) {
  return async function handleRuntimeSettingsRoute(request, response, url) {
    if (request.method === "GET" && url.pathname === "/api/health") {
      send(response, 200, { ok: true, service: "agent-harness-local", runtimeSchemaVersion });
      return true;
    }
    if (request.method === "GET" && url.pathname === "/api/runtime/status") {
      const runtime = await orchestrator.status();
      send(response, 200, { ...runtime, suggestedRepository, runtimeSchemaVersion, csrfToken });
      return true;
    }
    if (request.method === "GET" && url.pathname === "/api/settings") {
      send(response, 200, { settings: await store.settings(), runtimeSchemaVersion });
      return true;
    }
    if (request.method === "PUT" && url.pathname === "/api/settings") {
      const input = await readJson(request);
      const catalog = await readExecutionProviderCatalog();
      const known = new Map(
        catalog.models.filter((model) => model.editable).map((model) => [model.id, model]),
      );
      const allowedModels = [
        ...new Set((Array.isArray(input.allowedModels) ? input.allowedModels : []).map(normalizeModelId)),
      ].filter((modelId) => known.has(modelId));
      const defaultModel = normalizeModelId(input.defaultModel);
      const selected = known.get(defaultModel);
      if (!allowedModels.length) throw new Error("Allow at least one model.");
      if (!allowedModels.includes(defaultModel) || !selected)
        throw new Error("The default model must be in the allowed model list.");
      const defaultReasoning = String(input.defaultReasoning ?? "");
      if (!selected.reasoningLevels.includes(defaultReasoning))
        throw new Error(`${selected.label} does not support ${defaultReasoning || "that"} reasoning.`);
      const currentSettings = await store.settings();
      const grillPolicy =
        input.grillPolicy === undefined ? currentSettings.grillPolicy : String(input.grillPolicy);
      if (!GRILL_POLICIES.has(grillPolicy)) throw new Error("Choose a supported Grill interaction policy.");
      const approvalCompletion =
        input.approvalCompletion === undefined
          ? (currentSettings.approvalCompletion ?? "pull-request")
          : String(input.approvalCompletion);
      if (!APPROVAL_COMPLETIONS.has(approvalCompletion)) {
        throw new Error("Approval must complete by raising a pull request or by a local merge.");
      }
      const stagePolicies = validateStagePolicies(
        input.stagePolicies,
        known,
        allowedModels,
        currentSettings.stagePolicies,
      );
      const profileStagePolicies = Object.fromEntries(
        WORKFLOW_PROFILE_IDS.map((profile) => [
          profile,
          validateStagePolicies(
            input.profileStagePolicies?.[profile] ?? (profile === "standard" ? stagePolicies : null),
            known,
            allowedModels,
            currentSettings.profileStagePolicies?.[profile] ?? stagePolicies,
          ),
        ]),
      );
      const settings = await store.updateSettings((draft) => {
        draft.allowedModels = allowedModels;
        draft.defaultModel = defaultModel;
        draft.defaultReasoning = defaultReasoning;
        draft.grillPolicy = grillPolicy;
        draft.approvalCompletion = approvalCompletion;
        draft.stagePolicies = stagePolicies;
        draft.profileStagePolicies = profileStagePolicies;
      });
      send(response, 200, { settings });
      return true;
    }
    if (request.method === "POST" && url.pathname === "/api/runtime/pricing/verify") {
      if (typeof orchestrator.verifyPricing !== "function")
        throw new Error("Pricing verification is unavailable in this runtime.");
      send(response, 200, await orchestrator.verifyPricing());
      return true;
    }
    // Two separate calls on purpose. Proposing is read-only and cheap to repeat; approving
    // writes to the operator's repository and runs its commands unsandboxed. Collapsing them
    // into one endpoint would make approval implicit, and #47's guarantee depends on a human
    // ratifying the commands before they become the harness's source of truth.
    if (request.method === "POST" && url.pathname === "/api/runtime/onboarding/propose") {
      if (typeof orchestrator.proposeOnboarding !== "function")
        throw new Error("Repository onboarding is unavailable in this runtime.");
      const body = await readJson(request);
      send(response, 200, await orchestrator.proposeOnboarding(body?.repositoryPath));
      return true;
    }
    if (request.method === "POST" && url.pathname === "/api/runtime/repository-contract") {
      const body = await readJson(request);
      const repositoryPath = await validateRepository(body?.repositoryPath);
      send(response, 200, { contract: await inspectRepositoryContract(repositoryPath) });
      return true;
    }
    if (request.method === "POST" && url.pathname === "/api/runtime/onboarding/approve") {
      if (typeof orchestrator.approveOnboarding !== "function")
        throw new Error("Repository onboarding is unavailable in this runtime.");
      const body = await readJson(request);
      send(response, 200, await orchestrator.approveOnboarding(body?.repositoryPath, body?.proposal));
      return true;
    }
    if (request.method === "GET" && url.pathname === "/api/runtime/worktrees") {
      const tasks =
        typeof store.listWorktreeTasks === "function"
          ? await store.listWorktreeTasks()
          : typeof store.listSummaries === "function"
            ? await store.listSummaries()
            : (await store.list()).map(projectTaskSummary);
      const entries = tasks.flatMap(worktreeEntriesForTask);
      const rows = await worktrees.inventory(entries);
      send(response, 200, { rows });
      return true;
    }

    return false;
  };
}
