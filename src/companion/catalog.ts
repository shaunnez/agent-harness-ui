import { type ActionProposal, assertActionProposal, companionActionTypes } from "./contracts.ts";

export interface TrustedActionCard {
  type: (typeof companionActionTypes)[number];
  proposal: ActionProposal;
}

/**
 * Return a card only when it is a member of the fixed local catalogue. The
 * catalogue intentionally contains data, not handlers, URLs, endpoints, JSX,
 * repository commands, or model-defined component descriptions.
 */
export function createTrustedActionCard(proposal: ActionProposal): TrustedActionCard {
  assertActionProposal(proposal);
  return { type: proposal.actionType, proposal };
}

export function assertTrustedActionCard(value: unknown): asserts value is TrustedActionCard {
  if (!isRecord(value) || !exactKeys(value, ["type", "proposal"])) {
    throw new Error("Action card must contain only a catalogue type and proposal.");
  }
  if (!isActionType(value.type)) throw new Error(`Unknown action card type: ${String(value.type)}.`);
  assertActionProposal(value.proposal);
  if (value.proposal.actionType !== value.type) {
    throw new Error("Action card type must match the proposal action type.");
  }
}

export function isTrustedActionCard(value: unknown): value is TrustedActionCard {
  try {
    assertTrustedActionCard(value);
    return true;
  } catch {
    return false;
  }
}

export const validateActionCard = isTrustedActionCard;
export { assertActionProposal };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(record: Record<string, unknown>, expected: string[]) {
  const actual = Object.keys(record).sort();
  const keys = [...expected].sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

function isActionType(value: unknown): value is (typeof companionActionTypes)[number] {
  return (
    typeof value === "string" && companionActionTypes.includes(value as (typeof companionActionTypes)[number])
  );
}
