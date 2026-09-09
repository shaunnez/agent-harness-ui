import type { RuntimeTask } from "../src/domain/runtime";
import type { Attention } from "../src/frontier/runtime/contracts";

export function projectTaskAttention(task: Partial<RuntimeTask> & Pick<RuntimeTask, "currentStage" | "status">): Attention;
