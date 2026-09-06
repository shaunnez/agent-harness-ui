import * as api from "../../api.ts";
import type { FrontierGateway } from "./contracts.ts";

const readOptions = () => ({ signal: AbortSignal.timeout(12_000) });

export const liveGateway: FrontierGateway = {
  mode: "live",
  status: () => api.getRuntimeStatus(readOptions()),
  saveSettings: api.updateRuntimeSettings,
  worktrees: async (id) => (await api.getRuntimeWorktreeInventory(id)).rows,
  removeWorktree: async (id, row) => (await api.removeRuntimeWorktree(id, row)).rows,
  projects: () => api.listProjects(readOptions()),
  createProject: api.createProject,
  changeProject: api.changeProject,
  repository: api.getRepositoryContract,
  proposeSetup: api.proposeRepositorySetup,
  approveSetup: api.approveRepositorySetup,
  updateRole: (id, role, policy) => api.updateTaskRolePolicy(id, { role, ...policy }),
  cancel: api.cancelTask,
  closeTask: (id, input) => api.closeTask(id, input.reason, input.note, input.supersededBy),
  archiveTask: api.archiveTask,
  summaries: () => api.listTasks(readOptions()),
  markers: () => api.listTaskPollStates(readOptions()),
  async core(id) {
    const core = await api.getTaskCore(id, readOptions());
    const artifacts = await api.getTaskArtifacts(id, { limit: 50, ...readOptions() });
    return { ...core, artifacts: artifacts.items, artifactNextCursor: artifacts.nextCursor };
  },
  runs: (id, cursor) => api.getTaskRuns(id, { cursor, limit: 50, ...readOptions() }),
  activity: (id, cursor) => api.getTaskActivity(id, { cursor, limit: 50, ...readOptions() }),
  artifact: (id, artifactId) => api.getTaskArtifact(id, artifactId, readOptions()),
  artifacts: (id, cursor) => api.getTaskArtifacts(id, { cursor, limit: 50, ...readOptions() }),
  diff: api.getCandidateDiff,
  action: (id, action, note, scope) => api.runTaskAction(id, action, note, scope, { retryOnCsrf: false }),
  decision: api.recordTaskDecision,
  continueImplementation: api.continueTaskToImplementation,
  selectDesign: api.selectTaskDesign,
  retryDesign: api.retryTaskDesigns,
  create: (draft) => api.createTask(draft, { retryOnCsrf: false }),
  start: (id) => api.runTask(id, { retryOnCsrf: false }),
  answer: api.answerGrillQuestion,
  finishGrill: (id, acceptRemaining = false) => api.finishGrill(id, acceptRemaining),
  approveSpecification: (id) => api.runTaskAction(id, "approve-spec"),
};
