import type { ReactNode } from "react";
import type { RuntimeApproval } from "../domain";

export function getApprovalHistory(approvals?: RuntimeApproval[]): RuntimeApproval[];
export function formatApprovalStage(stage: RuntimeApproval["stage"]): string;
export function formatApprovalTimestamp(createdAt: string): string;
export function isPolicyApproval(approval: RuntimeApproval): boolean;
export function ApprovalHistorySection(props: { approvals?: RuntimeApproval[] }): ReactNode;
