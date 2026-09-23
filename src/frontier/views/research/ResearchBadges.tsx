import { CheckCircle, Clock, Info, Question, WarningCircle } from "@phosphor-icons/react";
import {
  type ResearchCheck,
  type ResearchQuestion,
  researchCheckCopy,
  researchStatusCopy,
} from "../../runtime/research";

export function ResearchStatusBadge({ question }: { question: Pick<ResearchQuestion, "status"> }) {
  const copy = researchStatusCopy[question.status];
  const Icon =
    question.status === "agreed"
      ? CheckCircle
      : question.status === "disputed"
        ? Question
        : question.status === "incomplete"
          ? WarningCircle
          : question.status === "running"
            ? Clock
            : Info;
  return (
    <span className={`state-badge tone-${copy.tone}`}>
      <Icon size={17} />
      {copy.label}
    </span>
  );
}

export function ResearchCheckBadge({ check }: { check: ResearchCheck }) {
  const copy = researchCheckCopy[check];
  return (
    <span className={`research-check tone-${copy.tone}`} title={copy.detail}>
      {copy.label}
    </span>
  );
}
