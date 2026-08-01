import type { RuntimeApproval } from "../domain";

export function getApprovalHistory(approvals?: RuntimeApproval[]): RuntimeApproval[];
export function formatApprovalStage(stage: RuntimeApproval["stage"]): string;
export function formatApprovalTimestamp(createdAt: string): string;
