import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { hashTaskBrief, normalizeExperimentInput } from "./evaluation.mjs";
import { normalizeModelId, POLICY_IDS, readExecutionProviderCatalog } from "./model-catalog.mjs";
import { selectWorkflowProfile, WORKFLOW_PROFILE_IDS } from "./workflow-profiles.mjs";

export function createTaskCreationRoutes({
  store,
  send,
  readJson,
  validateAttachments,
  validateRepository,
  git,
  repositoryAuthorityService,
  validWorkflows: VALID_WORKFLOWS,
}) {
  return async function handleTaskCreationRoute(request, response, url) {
    if (request.method === "POST" && url.pathname === "/api/tasks") {
      const input = await readJson(request);
      if (!input.title?.trim() || !input.description?.trim())
        throw new Error("Title and description are required.");
      if (!VALID_WORKFLOWS.has(input.workflow)) throw new Error("invalid workflow");
      if (
        input.workflowProfile != null &&
        input.workflowProfile !== "auto" &&
        !WORKFLOW_PROFILE_IDS.includes(input.workflowProfile)
      ) {
        throw new Error("Workflow profile must be auto, fast, standard, or high-risk.");
      }
      const attachments = validateAttachments(input.attachments);
      const settings = await store.settings();
      const catalog = await readExecutionProviderCatalog();
      const requestedModel = normalizeModelId(input.model ?? settings.defaultModel);
      const selectedModel = catalog.models.find((model) => model.id === requestedModel && model.editable);
      if (!settings.allowedModels.includes(requestedModel) || !selectedModel)
        throw new Error("Choose a model from the allowed runtime list in Settings.");
      const requestedReasoning = String(input.reasoning ?? settings.defaultReasoning);
      if (!selectedModel.reasoningLevels.includes(requestedReasoning))
        throw new Error(`${selectedModel.label} does not support ${requestedReasoning} reasoning.`);
      const workflowProfile = selectWorkflowProfile({
        title: input.title,
        description: input.description,
        requestedProfile: WORKFLOW_PROFILE_IDS.includes(input.workflowProfile) ? input.workflowProfile : null,
      });
      const taskProfilePolicies =
        input.model || input.reasoning
          ? Object.fromEntries(
              WORKFLOW_PROFILE_IDS.map((profile) => [
                profile,
                Object.fromEntries(
                  POLICY_IDS.map((policyId) => [
                    policyId,
                    { model: requestedModel, reasoning: requestedReasoning },
                  ]),
                ),
              ]),
            )
          : structuredClone(settings.profileStagePolicies);
      const taskPolicies = structuredClone(
        taskProfilePolicies?.[workflowProfile.selected] ?? settings.stagePolicies,
      );
      const repositoryPath = await validateRepository(input.repositoryPath);
      const priority = ["low", "medium", "high"].includes(input.priority) ? input.priority : "medium";
      let experiment = null;
      if (input.experiment != null) {
        const requestedBase = String(input.experiment.frozenBaseSha ?? "").trim();
        if (!/^[a-f0-9]{40,64}$/i.test(requestedBase))
          throw new Error("Controlled experiments require a full frozen base commit SHA.");
        const frozenBaseSha = String(
          await git(repositoryPath, ["rev-parse", "--verify", `${requestedBase}^{commit}`]),
        ).trim();
        const repositoryHead = String(await git(repositoryPath, ["rev-parse", "HEAD"])).trim();
        if (repositoryHead !== frozenBaseSha)
          throw new Error("The selected repository must be checked out at the frozen experiment base.");
        experiment = normalizeExperimentInput(input.experiment, {
          taskBriefHash: hashTaskBrief({ ...input, priority, attachments }),
          policyMatrix: taskPolicies,
          frozenBaseSha,
        });
      }
      const repositoryAuthority = await repositoryAuthorityService.capture(repositoryPath, {
        frozenRevision: experiment?.frozenBaseSha ?? null,
      });
      let task = await store.create({
        title: input.title.trim().slice(0, 300),
        description: input.description.trim().slice(0, 20_000),
        repositoryPath,
        workflow: input.workflow,
        priority,
        designRequested: input.designRequested === true,
        model: requestedModel,
        reasoning: requestedReasoning,
        stagePolicies: taskPolicies,
        profileStagePolicies: taskProfilePolicies,
        workflowProfile,
        experiment,
        repositoryAuthority,
      });
      if (attachments.length) {
        const attachmentRoot = path.join(store.dataDirectory(), "attachments", task.id);
        await mkdir(attachmentRoot, { recursive: true });
        const saved = [];
        for (const attachment of attachments) {
          const extension = path.extname(attachment.name).toLowerCase();
          const storedPath = path.join(attachmentRoot, `${crypto.randomUUID()}${extension}`);
          await writeFile(storedPath, Buffer.from(attachment.data, "base64"));
          saved.push({
            id: crypto.randomUUID(),
            name: attachment.name,
            type: attachment.type,
            size: attachment.size,
            path: storedPath,
          });
        }
        task = await store.update(task.id, (draft) => {
          draft.attachments = saved;
        });
      }
      send(response, 201, { task });
      return true;
    }

    return false;
  };
}
