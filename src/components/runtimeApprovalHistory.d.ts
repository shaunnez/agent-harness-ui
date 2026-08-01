import type { RuntimeApproval } from "../domain";
import type { ReactNode } from "react";

export function getApprovalHistory(approvals?: RuntimeApproval[]): RuntimeApproval[];
export function formatApprovalStage(stage: RuntimeApproval["stage"]): string;
export function formatApprovalTimestamp(createdAt: string): string;
export function ApprovalHistorySection(props: { approvals?: RuntimeApproval[] }): ReactNode;
