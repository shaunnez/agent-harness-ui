import { resolveRolePolicyLifecycleEligibility } from "../../../server/role-policy-eligibility.mjs";
import type { RuntimeProject, RuntimeTask } from "../../domain.ts";
import type { FrontierGateway } from "../runtime/contracts.ts";
import { draftPolicies, draftProfile, policyRoles } from "../runtime/policies.ts";
import { isExecuting } from "../runtime/presentation.ts";
import { fixtureSettings } from "./settings.ts";
import { settingsIssue } from "../runtime/settings.ts";

/** Local sample management never writes a repository, store, or model configuration. */
export function fixtureManagement(
  projects: RuntimeProject[],
  tasks: Map<string, RuntimeTask>,
  online: () => void,
  changed: () => void,
) {
  const configuration = fixtureSettings();
  const verified = new Set(projects.map((project) => project.repositoryPath));
  const taskFor = (id: string) => {
    online();
    const task = tasks.get(id);
    if (!task) throw new Error("Sample task not found.");
    return task;
  };
  const methods: Pick<
    FrontierGateway,
    | "createProject"
    | "changeProject"
    | "repository"
    | "proposeSetup"
    | "approveSetup"
    | "updateRole"
    | "cancel"
    | "closeTask"
    | "archiveTask"
    | "saveSettings"
    | "worktrees"
    | "removeWorktree"
  > = {
    async saveSettings(input) {
      online();
      const issue = settingsIssue(input, {
        ...configuration,
        available: false,
        authenticated: false,
        authMethod: null,
        model: "",
        reasoning: "",
        binary: null,
        message: "Sample",
        suggestedRepository: "",
      });
      if (issue) throw new Error(issue);
      configuration.settings = { ...configuration.settings, ...structuredClone(input) };
      changed();
      return structuredClone(configuration.settings);
    },
    async worktrees(id) {
      return structuredClone(taskFor(id).worktreeInventory ?? []);
    },
    async removeWorktree(id, rowId) {
      const task = taskFor(id);
      const row = task.worktreeInventory?.find((item) => item.id === rowId);
      if (!row?.cleanupReady || row.retainedRequired || row.lifecycleState === "active")
        throw new Error("This sample copy must be retained.");
      task.worktreeInventory = task.worktreeInventory?.filter((item) => item.id !== rowId);
      changed();
      return structuredClone(task.worktreeInventory ?? []);
    },
    async createProject(input) {
      online();
      const name = input.name.trim(),
        repositoryPath = input.repositoryPath.trim().replace(/\/$/, "");
      if (!name || !repositoryPath.startsWith("/"))
        throw new Error("Enter a project name and absolute repository path.");
      if (
        projects.some(
          (project) =>
            project.repositoryPath === repositoryPath || project.name.toLowerCase() === name.toLowerCase(),
        )
      )
        throw new Error("That project is already registered.");
      const project = { id: crypto.randomUUID(), name, repositoryPath, createdAt: new Date().toISOString() };
      projects.push(project);
      changed();
      return structuredClone(project);
    },
    async changeProject(id, change) {
      online();
      const project = projects.find((item) => item.id === id);
      if (!project) throw new Error("Sample project not found.");
      if (change.kind === "rename") {
        const name = change.name?.trim();
        if (
          !name ||
          projects.some((item) => item.id !== id && item.name.toLowerCase() === name.toLowerCase())
        )
          throw new Error("Choose a unique project name.");
        project.name = name;
      } else if (change.kind === "archive") {
        const unresolved = [...tasks.values()].find(
          (task) =>
            task.repositoryPath === project.repositoryPath &&
            (!["completed", "closed", "archived"].includes(task.status) || isExecuting(task)),
        );
        if (unresolved)
          throw new Error(`${unresolved.id} still has unresolved work. Finish or close it first.`);
        project.archivedAt = new Date().toISOString();
      } else project.archivedAt = null;
      changed();
      return structuredClone(project);
    },
    async repository(repositoryPath) {
      online();
      if (!repositoryPath.startsWith("/")) throw new Error("Use an absolute repository path.");
      return {
        repositoryRoot: repositoryPath,
        git: { branch: "demo/main", headRevision: "sample-revision", clean: true },
        instructions: { path: `${repositoryPath}/AGENTS.md`, present: true },
        verification: {
          path: `${repositoryPath}/verification.json`,
          present: verified.has(repositoryPath),
          valid: verified.has(repositoryPath),
          commandIds: verified.has(repositoryPath) ? ["sample-test"] : [],
          error: null,
        },
        runtime: { declarations: [{ source: "Sample world", value: "No repository has been inspected" }] },
        delivery: { remoteName: null, remoteUrl: null, github: false },
      };
    },
    async proposeSetup(repositoryPath) {
      online();
      return {
        repositoryRoot: repositoryPath,
        alreadyOnboarded: verified.has(repositoryPath),
        manifestPath: `${repositoryPath}/verification.json`,
        manifestPreview: "Sample verification manifest — no file will be written.",
        proposal: {
          determined: true,
          reason: "Sample proposal for reviewing the setup flow.",
          commands: [
            {
              id: "sample-test",
              command: ["npm", "test"],
              evidence: { kind: "sample", detail: "Sample command, never executed" },
            },
          ],
          notes: ["No model or repository is accessed in sample mode."],
        },
      };
    },
    async approveSetup(repositoryPath) {
      online();
      verified.add(repositoryPath);
      changed();
    },
    async updateRole(id, role, policy) {
      const task = taskFor(id);
      const eligibility = resolveRolePolicyLifecycleEligibility(task, role);
      if (!eligibility.ok) throw new Error(eligibility.reason);
      if (!task.agentConfig) throw new Error("Sample policy snapshot unavailable.");
      task.agentConfig.stagePolicies = { ...task.agentConfig.stagePolicies, [role]: policy };
      task.agentConfig.rolePolicySources = {
        ...task.agentConfig.rolePolicySources,
        [role]: "future-role-override",
      };
      task.agentConfig.rolePolicyOverrides = { ...task.agentConfig.rolePolicyOverrides, [role]: policy };
      for (const matrix of Object.values(task.agentConfig.profileStagePolicies ?? {})) matrix[role] = policy;
      changed();
    },
    async cancel(id) {
      const task = taskFor(id);
      if (!isExecuting(task)) throw new Error("There is no active sample run to cancel.");
      task.status = "cancelled";
      task.activeRunIds = [];
      task.activeRunKind = null;
      for (const run of task.runs ?? [])
        if (run.status === "running") {
          run.status = "cancelled";
          run.completedAt = new Date().toISOString();
        }
      for (const item of task.workPackages) if (item.status === "running") item.status = "failed";
      changed();
    },
    async closeTask(id, input) {
      const task = taskFor(id);
      if (isExecuting(task) || task.status === "awaiting-pr-merge")
        throw new Error("Resolve the active execution or PR before closing.");
      if (input.reason === "superseded" && !input.supersededBy?.trim())
        throw new Error("Enter the replacement task ID.");
      task.status = "closed";
      task.closure = {
        ...input,
        supersededBy: input.supersededBy ?? null,
        closedAt: new Date().toISOString(),
      };
      changed();
    },
    async archiveTask(id, note) {
      const task = taskFor(id);
      if (isExecuting(task) || task.status === "awaiting-pr-merge")
        throw new Error("Resolve the active execution or PR before archiving.");
      task.archive = {
        previousStatus: task.status,
        note,
        archivedAt: new Date().toISOString(),
        removedWorktrees: [],
        retainedWorktrees: [],
      };
      task.status = "archived";
      changed();
    },
  };
  return {
    configuration,
    methods,
    snapshotPolicies(draft: Parameters<FrontierGateway["create"]>[0]) {
      const workflowProfile = draftProfile(draft);
      const profiles = structuredClone(configuration.settings.profileStagePolicies);
      for (const matrix of Object.values(profiles ?? {}))
        Object.assign(matrix, structuredClone(draft.rolePolicyOverrides ?? {}));
      return {
        workflowProfile,
        grillPolicy: configuration.settings.grillPolicy,
        agentConfig: {
          model: configuration.settings.defaultModel,
          reasoning: configuration.settings.defaultReasoning,
          stagePolicies: draftPolicies(draft, configuration.settings),
          profileStagePolicies: profiles,
          rolePolicyOverrides: structuredClone(draft.rolePolicyOverrides ?? {}),
          rolePolicySources: Object.fromEntries(
            policyRoles.map(({ id }) => [
              id,
              draft.rolePolicyOverrides?.[id] ? ("task-override" as const) : ("settings-default" as const),
            ]),
          ),
        },
      };
    },
  };
}
