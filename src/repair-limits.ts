export interface RepairLimits {
  package: number;
  candidate: { fast: number; standard: number; "high-risk": number };
}

export const MAX_REPAIR_ATTEMPTS = 10;
export const DEFAULT_REPAIR_LIMITS: Readonly<RepairLimits> = Object.freeze({
  package: 2,
  candidate: Object.freeze({ fast: 1, standard: 2, "high-risk": 3 }),
});

const validLimit = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_REPAIR_ATTEMPTS;

export function repairLimitsIssue(value: unknown): string | null {
  const limits = value as Partial<RepairLimits> | null;
  if (
    !limits ||
    !validLimit(limits.package) ||
    !["fast", "standard", "high-risk"].every((profile) =>
      validLimit(limits.candidate?.[profile as keyof RepairLimits["candidate"]]),
    )
  )
    return `Repair limits must be whole numbers from 0 to ${MAX_REPAIR_ATTEMPTS}.`;
  return null;
}

export function normalizeRepairLimits(value: unknown): RepairLimits {
  if (repairLimitsIssue(value)) return structuredClone(DEFAULT_REPAIR_LIMITS);
  const limits = value as RepairLimits;
  return {
    package: limits.package,
    candidate: {
      fast: limits.candidate.fast,
      standard: limits.candidate.standard,
      "high-risk": limits.candidate["high-risk"],
    },
  };
}
