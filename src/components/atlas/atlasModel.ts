import {
  type RuntimeTaskSummary,
  type RuntimeWorkPackage,
  type StageId,
  workflowStages,
} from "../../domain.ts";

export type AtlasTaskTone = "running" | "blocked" | "attention" | "complete" | "idle";

export interface AtlasRoom {
  stageId: StageId;
  number: number;
  roomName: string;
  x: number;
  y: number;
  width: number;
  height: number;
  accent: string;
  motif:
    | "intake"
    | "radar"
    | "question"
    | "draft"
    | "route"
    | "build"
    | "inspect"
    | "test"
    | "review"
    | "approval";
}

export interface AtlasPoint {
  x: number;
  y: number;
}

export interface AtlasRoad {
  from: StageId;
  to: StageId;
  points: AtlasPoint[];
}

export const ATLAS_WORLD_WIDTH = 1240;
export const ATLAS_WORLD_HEIGHT = 650;

const roomDetails: Record<StageId, Omit<AtlasRoom, "stageId" | "number">> = {
  triage: {
    roomName: "Intake Dock",
    x: 18,
    y: 68,
    width: 142,
    height: 170,
    accent: "#5a9df5",
    motif: "intake",
  },
  scouts: {
    roomName: "Survey Bay",
    x: 176,
    y: 68,
    width: 142,
    height: 170,
    accent: "#4bb7aa",
    motif: "radar",
  },
  grill: {
    roomName: "Decision Chamber",
    x: 334,
    y: 68,
    width: 142,
    height: 170,
    accent: "#65c48d",
    motif: "question",
  },
  specification: {
    roomName: "Drafting Room",
    x: 492,
    y: 68,
    width: 142,
    height: 170,
    accent: "#d0a766",
    motif: "draft",
  },
  plan: {
    roomName: "Route Table",
    x: 650,
    y: 68,
    width: 142,
    height: 170,
    accent: "#47a6c6",
    motif: "route",
  },
  implement: {
    roomName: "Build Hangar",
    x: 136,
    y: 290,
    width: 478,
    height: 300,
    accent: "#65c48d",
    motif: "build",
  },
  "dev-review": {
    roomName: "Inspection Booth",
    x: 662,
    y: 282,
    width: 190,
    height: 308,
    accent: "#5a9df5",
    motif: "inspect",
  },
  test: { roomName: "Test Lab", x: 820, y: 68, width: 142, height: 170, accent: "#a56df0", motif: "test" },
  "final-review": {
    roomName: "Synthesis Room",
    x: 1035,
    y: 168,
    width: 154,
    height: 176,
    accent: "#d0a766",
    motif: "review",
  },
  approval: {
    roomName: "Human Gate",
    x: 1035,
    y: 382,
    width: 154,
    height: 196,
    accent: "#efab24",
    motif: "approval",
  },
};

export const atlasRooms: AtlasRoom[] = workflowStages.map((stage, index) => ({
  stageId: stage.id,
  number: index + 1,
  ...roomDetails[stage.id],
}));

export const atlasConnections: Array<[StageId, StageId]> = workflowStages
  .slice(0, -1)
  .map((stage, index) => [stage.id, workflowStages[index + 1]?.id ?? stage.id]);

export const atlasRoads: AtlasRoad[] = [
  {
    from: "triage",
    to: "scouts",
    points: [
      { x: 160, y: 153 },
      { x: 176, y: 153 },
    ],
  },
  {
    from: "scouts",
    to: "grill",
    points: [
      { x: 318, y: 153 },
      { x: 334, y: 153 },
    ],
  },
  {
    from: "grill",
    to: "specification",
    points: [
      { x: 476, y: 153 },
      { x: 492, y: 153 },
    ],
  },
  {
    from: "specification",
    to: "plan",
    points: [
      { x: 634, y: 153 },
      { x: 650, y: 153 },
    ],
  },
  {
    from: "plan",
    to: "implement",
    points: [
      { x: 721, y: 238 },
      { x: 721, y: 258 },
      { x: 374, y: 258 },
      { x: 374, y: 290 },
    ],
  },
  {
    from: "implement",
    to: "dev-review",
    points: [
      { x: 614, y: 442 },
      { x: 662, y: 442 },
    ],
  },
  {
    from: "dev-review",
    to: "test",
    points: [
      { x: 757, y: 282 },
      { x: 757, y: 256 },
      { x: 891, y: 256 },
      { x: 891, y: 238 },
    ],
  },
  {
    from: "test",
    to: "final-review",
    points: [
      { x: 962, y: 153 },
      { x: 1002, y: 153 },
      { x: 1002, y: 256 },
      { x: 1035, y: 256 },
    ],
  },
  {
    from: "final-review",
    to: "approval",
    points: [
      { x: 1112, y: 344 },
      { x: 1112, y: 382 },
    ],
  },
];

export const atlasRepairRoads: Array<{ from: "dev-review" | "test"; points: AtlasPoint[] }> = [
  {
    from: "dev-review",
    points: [
      { x: 696, y: 574 },
      { x: 642, y: 574 },
      { x: 642, y: 620 },
      { x: 525, y: 620 },
      { x: 525, y: 590 },
    ],
  },
  {
    from: "test",
    points: [
      { x: 938, y: 224 },
      { x: 990, y: 252 },
      { x: 990, y: 620 },
      { x: 590, y: 620 },
      { x: 590, y: 590 },
    ],
  },
];

const blockedStatuses = new Set<RuntimeTaskSummary["status"]>([
  "failed",
  "blocked",
  "cancelled",
  "repair-required",
]);
const completeStatuses = new Set<RuntimeTaskSummary["status"]>([
  "merged-to-target",
  "completed",
  "closed",
  "archived",
]);

export function getAtlasTaskTone(task: RuntimeTaskSummary): AtlasTaskTone {
  if (blockedStatuses.has(task.status)) return "blocked";
  if (completeStatuses.has(task.status)) return "complete";
  if ((task.status === "running" || task.status === "cancelling") && (task.activeRunIds?.length ?? 0) > 0)
    return "running";
  if (task.status === "running" || task.status === "cancelling") return "attention";
  if (task.status === "merging") return "attention";
  if (task.status.startsWith("awaiting-") || task.status.startsWith("ready-for-")) return "attention";
  return "idle";
}

export function getAtlasStatusLabel(task: RuntimeTaskSummary) {
  const labels: Partial<Record<RuntimeTaskSummary["status"], string>> = {
    queued: "Queued",
    "awaiting-grill": "Needs input",
    "awaiting-spec-approval": "Spec approval",
    "awaiting-plan-approval": "Plan approval",
    "awaiting-human-approval": "Human approval",
    "ready-for-implementation": "Ready to implement",
    "ready-for-review": "Ready for review",
    "ready-for-test": "Ready for test",
    "ready-for-final-review": "Ready for final review",
    "repair-required": "Repair required",
    merging: "Needs input",
    "merged-to-target": "Merged",
  };
  return labels[task.status] ?? task.status.replaceAll("-", " ");
}

export function getTaskColor(taskId: string): string {
  const palette = ["#efab24", "#a56df0", "#5a9df5", "#d6815f", "#65c48d", "#47a6c6"];
  const hash = [...taskId].reduce((total, character) => total + character.charCodeAt(0), 0);
  return palette[hash % palette.length] ?? "#efab24";
}

export interface PackageOverview {
  total: number;
  active: number;
  blocked: number;
  ready: number;
  integrated: number;
  queued: number;
  batches: number;
}

export function getPackageOverview(packages: RuntimeWorkPackage[]): PackageOverview {
  return {
    total: packages.length,
    active: packages.filter((item) => item.status === "running").length,
    blocked: packages.filter((item) => item.status === "failed").length,
    ready: packages.filter((item) => item.status === "ready_for_integration").length,
    integrated: packages.filter((item) => item.status === "integrated").length,
    queued: packages.filter((item) => item.status === "planned").length,
    batches: new Set(packages.map((item) => item.batch)).size,
  };
}

export function getStageRoom(stageId: StageId) {
  return atlasRooms.find((room) => room.stageId === stageId) ?? atlasRooms[0];
}

export function getAtlasTransitionPath(from: StageId, to: StageId): AtlasPoint[] {
  const forward = atlasRoads.find((road) => road.from === from && road.to === to);
  if (forward) return forward.points;
  if (to === "implement" && (from === "dev-review" || from === "test")) {
    return atlasRepairRoads.find((road) => road.from === from)?.points ?? [];
  }
  return [];
}

export function formatAtlasTime(value: string | null | undefined) {
  if (!value) return "Not started";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
