import { type AgentRoleId, agentRoleIds } from "../domain.ts";
import {
  type CompanionGateStage,
  type CompanionIntent,
  companionActionTypes,
  companionGateStages,
} from "./contracts.ts";

export const companionIntentExamples = [
  "What am I looking at?",
  "Take me to Tasks",
  "Open OPS-2147",
  "Create a new task",
  "Change the implementation model",
  "Promote this to Dev Review",
] as const;

export type CompanionParseResult =
  | { status: "accepted"; intent: CompanionIntent }
  | {
      status: "rejected";
      reasonCode: "unknown-intent" | "ambiguous-intent" | "invalid-typed-intent";
      message: string;
      examples: readonly string[];
      intent: null;
    };

type CompanionRejectionCode = "unknown-intent" | "ambiguous-intent" | "invalid-typed-intent";

export function parseCompanionIntent(input: unknown): CompanionParseResult {
  if (typeof input === "object" && input !== null) return parseTypedIntent(input);
  if (typeof input !== "string")
    return rejected("invalid-typed-intent", "The companion accepts text or a closed typed intent.");

  const text = input.trim();
  if (!text)
    return rejected(
      "unknown-intent",
      "Ask about the current context or choose one of the available companion actions.",
    );
  const normalized = text
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/, "");

  if (
    /^(what(?: am)? i (?:looking at|seeing)|where am i|explain (?:this|the current (?:page|context)))$/.test(
      normalized,
    )
  ) {
    return accepted({ kind: "context" });
  }

  if (/^(?:take me to|go to|open|show me|navigate to) (?:the )?tasks(?: page)?$/.test(normalized)) {
    return accepted({ kind: "navigate", target: "tasks" });
  }

  const taskNavigation = text
    .replace(/[.!?]+$/, "")
    .replace(/\s+/g, " ")
    .match(/^(?:take me to|go to|open|show me|navigate to) (?:task )?([a-z][a-z0-9_-]{0,63})$/i);
  if (taskNavigation?.[1] && taskNavigation[1].toLocaleLowerCase() !== "tasks") {
    return accepted({ kind: "navigate", target: "task", taskId: taskNavigation[1] });
  }

  if (/^(?:please )?(?:create|start|make) (?:a )?(?:new )?task(?: now)?$/.test(normalized)) {
    return accepted({ kind: "create-task" });
  }

  if (/^(?:please )?(?:change|switch|set)\b.*\b(?:model|policy)\b/.test(normalized)) {
    const role = parseRole(normalized);
    if (!role)
      return rejected(
        "ambiguous-intent",
        "Name the agent role whose task-scoped model policy should change.",
      );
    const policy = parsePolicy(normalized);
    return accepted({ kind: "change-role-model", role, model: policy.model, reasoning: policy.reasoning });
  }

  if (/^(?:please )?(?:promote|advance|move|send)\b/.test(normalized)) {
    const stage = parseGateStage(normalized);
    if (!stage) return rejected("ambiguous-intent", "Name the next gate, such as Dev Review or Test.");
    return accepted({ kind: "promote-gate", nextStage: stage });
  }

  return rejected(
    "unknown-intent",
    "I can explain the current context, navigate, or propose one of the governed task actions.",
  );
}

export const parseIntent = parseCompanionIntent;

function parseTypedIntent(input: object): CompanionParseResult {
  const record = input as Record<string, unknown>;
  const kind = record.kind;
  if (typeof kind !== "string")
    return rejected("invalid-typed-intent", "A typed intent must identify one known intent kind.");

  switch (kind) {
    case "context":
      return exactKeys(record, ["kind"]) ? accepted({ kind: "context" }) : invalidTyped();
    case "create-task":
      return exactKeys(record, ["kind"]) ? accepted({ kind: "create-task" }) : invalidTyped();
    case "navigate": {
      if (record.target === "tasks" && exactKeys(record, ["kind", "target"])) {
        return accepted({ kind: "navigate", target: "tasks" });
      }
      if (
        record.target === "task" &&
        exactKeys(record, ["kind", "target", "taskId"]) &&
        typeof record.taskId === "string" &&
        validTaskId(record.taskId)
      ) {
        return accepted({ kind: "navigate", target: "task", taskId: record.taskId });
      }
      return invalidTyped();
    }
    case "change-role-model": {
      if (
        !exactKeys(record, ["kind", "role", "model", "reasoning"]) ||
        typeof record.role !== "string" ||
        !isAgentRole(record.role) ||
        !(record.model === null || (typeof record.model === "string" && validModelId(record.model))) ||
        !(
          record.reasoning === null ||
          (typeof record.reasoning === "string" && validReasoning(record.reasoning))
        )
      ) {
        return invalidTyped();
      }
      return accepted({
        kind: "change-role-model",
        role: record.role,
        model: record.model,
        reasoning: record.reasoning,
      });
    }
    case "promote-gate":
      return exactKeys(record, ["kind", "nextStage"]) && isGateStage(record.nextStage)
        ? accepted({ kind: "promote-gate", nextStage: record.nextStage })
        : invalidTyped();
    default:
      return invalidTyped();
  }
}

function parseRole(text: string): AgentRoleId | null {
  const roles: Array<[RegExp, AgentRoleId]> = [
    [/\bfinal review\b/, "final-review"],
    [/\bdev(?:elopment)? review\b/, "dev-review"],
    [/\bimplementation\b|\bimplement\b/, "implement"],
    [/\bscout[- ]code[- ]path\b/, "scout-code-path"],
    [/\bscout[- ]dependency\b/, "scout-dependency"],
    [/\bscout[- ]pattern\b/, "scout-pattern"],
    [/\bscout[- ]schema\b/, "scout-schema"],
    [/\bscout[- ]test[- ]inventory\b/, "scout-test-inventory"],
    [/\bscout[- ]user[- ]journey\b/, "scout-user-journey"],
    [
      /\bscouts?\b(?![- ](?:code[- ]path|dependency|pattern|schema|test[- ]inventory|user[- ]journey))|\brepository scout\b/,
      "scouts",
    ],
    [/\btask spec(?:ification)?\b|\bspecification\b/, "specification"],
    [/\bplanning\b|\bplan\b/, "plan"],
    [/\btriage\b/, "triage"],
    [/\bgrill\b|\bclarification\b/, "grill"],
    [/\btest(?:ing)?\b/, "test"],
    [/\brepair\b/, "repair"],
    [/\bhuman approval\b|\bapproval\b/, "approval"],
  ];
  const explicitReviewsRemoved = text
    .replace(/\bfinal review\b/g, " ")
    .replace(/\bdev(?:elopment)? review\b/g, " ");
  const matches = roles.flatMap(([pattern, role]) => {
    const haystack = role === "final-review" || role === "dev-review" ? text : explicitReviewsRemoved;
    return pattern.test(haystack) ? [role] : [];
  });
  if (/\breview\b/.test(explicitReviewsRemoved)) matches.push("dev-review");
  const uniqueRoles = [...new Set(matches)];
  return uniqueRoles.length === 1 ? (uniqueRoles[0] ?? null) : null;
}

function parsePolicy(text: string): { model: string | null; reasoning: string | null } {
  const model = text.match(/\b(?:gpt|claude)-[a-z0-9.-]+\b/)?.[0]?.toLocaleLowerCase() ?? null;
  const displayModel = text.match(/\b(sol|luna|terra)\b/)?.[1];
  const reasoning = text.match(/\b(?:low|medium|high|xhigh|max|ultra|none)\b/)?.[0] ?? null;
  if (model) return { model, reasoning };
  if (displayModel) return { model: `gpt-5.6-${displayModel}`, reasoning };
  return { model: null, reasoning: null };
}

function parseGateStage(text: string): CompanionGateStage | null {
  const matches: CompanionGateStage[] = [];
  if (/\bdev(?:elopment)? review\b/.test(text)) matches.push("dev-review");
  if (/\bfinal review\b/.test(text)) matches.push("final-review");
  if (/\bhuman approval\b|\bapproval\b/.test(text)) matches.push("approval");
  if (/\btest(?:ing)?\b/.test(text)) matches.push("test");
  const uniqueStages = [...new Set(matches)];
  return uniqueStages.length === 1 ? (uniqueStages[0] ?? null) : null;
}

function accepted(intent: CompanionIntent): CompanionParseResult {
  return { status: "accepted", intent };
}

function rejected(reasonCode: CompanionRejectionCode, message: string): CompanionParseResult {
  return { status: "rejected", reasonCode, message, examples: companionIntentExamples, intent: null };
}

function invalidTyped() {
  return rejected(
    "invalid-typed-intent",
    `Typed intent must be one of: ${companionActionTypes.join(", ")} or a read-only navigation/context intent.`,
  );
}

function exactKeys(record: Record<string, unknown>, keys: string[]) {
  const actual = Object.keys(record).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}

function isAgentRole(value: string): value is AgentRoleId {
  return agentRoleIds.includes(value as AgentRoleId);
}

function isGateStage(value: unknown): value is CompanionGateStage {
  return typeof value === "string" && companionGateStages.includes(value as CompanionGateStage);
}

function validTaskId(value: string) {
  return /^[a-z][a-z0-9_-]{0,63}$/i.test(value);
}

function validModelId(value: string) {
  return /^(?:gpt|claude)-[a-z0-9][a-z0-9.-]{1,63}$/i.test(value);
}

function validReasoning(value: string) {
  return /^(?:low|medium|high|xhigh|max|ultra|none)$/i.test(value);
}
