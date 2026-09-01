import { type StageId, stageIds, workflowStages } from "../domain.ts";
import type { CompanionContext } from "./contracts.ts";

interface CandidateContextSource {
  id: string;
  revisionNumber: number;
}

export interface CompanionTaskContextSource {
  id: string;
  currentStage: StageId;
  candidates?: readonly CandidateContextSource[];
}

export interface CompanionContextInput {
  route: string;
  task?: CompanionTaskContextSource | null;
  taskId?: string | null;
  activeStage?: StageId | null;
  viewedStage?: StageId | null;
  candidateId?: string | null;
  candidateRevision?: number | null;
}

export function deriveCompanionContext(input: CompanionContextInput): CompanionContext {
  const taskId = nonEmpty(input.task?.id) ?? nonEmpty(input.taskId) ?? nonEmpty(taskIdFromRoute(input.route));
  const activeStage = stageId(input.task?.currentStage ?? input.activeStage);
  const viewedStage = Object.hasOwn(input, "viewedStage")
    ? stageId(input.viewedStage)
    : input.task || activeStage
      ? activeStage
      : null;
  const latestCandidate = input.task?.candidates?.at(-1);
  const latestCandidateId = nonEmpty(latestCandidate?.id);
  const latestCandidateRevision = validRevision(latestCandidate?.revisionNumber);
  const hasLatestCandidate = latestCandidate !== undefined;
  const candidateId = hasLatestCandidate ? latestCandidateId : nonEmpty(input.candidateId);
  const candidateRevision = hasLatestCandidate
    ? latestCandidateRevision
    : validRevision(input.candidateRevision);

  return {
    route: input.route,
    ...(taskId ? { taskId } : {}),
    activeStage,
    viewedStage,
    ...(candidateId && candidateRevision !== undefined ? { candidateId, candidateRevision } : {}),
  };
}

/** A deterministic, evidence-first answer suitable for the message thread and live region. */
export function contextualAnswer(context: CompanionContext): string {
  const activeLabel = stageLabel(context.activeStage);
  const viewedLabel = stageLabel(context.viewedStage);
  const viewedRelation = describeViewedRelation(context.activeStage, context.viewedStage);
  const candidate =
    context.candidateId && context.candidateRevision !== undefined
      ? `${context.candidateId} at revision ${context.candidateRevision}`
      : "none recorded";

  return [
    `Route: ${context.route}`,
    `Selected task: ${context.taskId ?? "none selected"}`,
    `Active runtime stage: ${activeLabel}`,
    `Viewed stage: ${viewedLabel} (${viewedRelation})`,
    `Candidate: ${candidate}`,
  ].join("\n");
}

export const answerContext = contextualAnswer;
export const getContextualAnswer = contextualAnswer;

function describeViewedRelation(activeStage: StageId | null, viewedStage: StageId | null) {
  if (!viewedStage) return "no stage selected";
  if (!activeStage || activeStage === viewedStage) return "current runtime stage";
  const activeIndex = workflowStages.findIndex((stage) => stage.id === activeStage);
  const viewedIndex = workflowStages.findIndex((stage) => stage.id === viewedStage);
  if (viewedIndex >= 0 && activeIndex >= 0 && viewedIndex < activeIndex) {
    return `stale inspection; runtime remains ${stageLabel(activeStage)}`;
  }
  return `future inspection; runtime remains ${stageLabel(activeStage)}`;
}

function stageLabel(stageId: StageId | null) {
  return stageId ? (workflowStages.find((stage) => stage.id === stageId)?.label ?? stageId) : "none";
}

function stageId(value: StageId | null | undefined): StageId | null {
  return typeof value === "string" && stageIds.includes(value as StageId) ? value : null;
}

function taskIdFromRoute(route: string) {
  const match = route.match(/(?:^|#?\/)tasks\/([^/?#]+)/);
  if (!match?.[1]) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
}

function nonEmpty(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function validRevision(value: number | null | undefined) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}
