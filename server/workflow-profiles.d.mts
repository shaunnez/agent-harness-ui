import type { WorkflowProfileId, RuntimeTask } from "../src/domain/runtime.ts";
export const WORKFLOW_PROFILE_IDS: readonly WorkflowProfileId[];
export function selectWorkflowProfile(input: { title?: string; description?: string; requestedProfile?: WorkflowProfileId | null }): NonNullable<RuntimeTask["workflowProfile"]>;
