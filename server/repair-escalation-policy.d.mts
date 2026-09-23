import type { RuntimeAgentPolicy } from "../src/domain/runtime.ts";
export function isStrongerRepairPolicy(
  selected: RuntimeAgentPolicy | undefined,
  proposed: RuntimeAgentPolicy | undefined,
): boolean;
