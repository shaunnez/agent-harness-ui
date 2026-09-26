// The realm model: Frontier's fixture projects, tasks and policies re-read as an Age-of-Empires world.
// Everything here is derived from the recorded sample data; nothing is invented about task state.
import type { RolePolicyId, RuntimeTask, StageId } from "../domain.ts";
import { projectTaskAttention } from "../../server/task-attention.mjs";
import { fixtureProjects, makeFixtureTasks } from "../frontier/fixtures/scenarios.ts";
import { enrichWorkflowScenarios } from "../frontier/fixtures/workflow-scenarios.ts";
import type { Attention } from "../frontier/runtime/contracts.ts";
import { fixtureSettings } from "../frontier/fixtures/settings.ts";
import { policyRoles } from "../frontier/runtime/policies.ts";

/** Index into a list the realm defines itself, where a miss is a programming error. */
export function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing realm definition");
  return value;
}

export type AgeId = "dark" | "feudal" | "castle" | "imperial";
export const ages: { id: AgeId; name: string; numeral: string; stages: StageId[]; motto: string }[] = [
  {
    id: "dark",
    name: "Dark Age",
    numeral: "I",
    stages: ["triage", "scouts", "grill"],
    motto: "Survey the land",
  },
  {
    id: "feudal",
    name: "Feudal Age",
    numeral: "II",
    stages: ["specification", "plan"],
    motto: "Draw the charter",
  },
  {
    id: "castle",
    name: "Castle Age",
    numeral: "III",
    stages: ["implement", "dev-review", "test"],
    motto: "Raise the walls",
  },
  {
    id: "imperial",
    name: "Imperial Age",
    numeral: "IV",
    stages: ["final-review", "approval"],
    motto: "Crown the work",
  },
];

export type BuildingKind =
  | "tower"
  | "stable"
  | "council"
  | "library"
  | "warroom"
  | "workshop"
  | "monastery"
  | "range"
  | "keep"
  | "harbour";

export interface StageBuilding {
  stage: StageId;
  kind: BuildingKind;
  name: string;
  stageLabel: string;
  verb: string;
  lore: string;
}
export const stageBuildings: StageBuilding[] = [
  {
    stage: "triage",
    kind: "tower",
    name: "Watch Tower",
    stageLabel: "Triage",
    verb: "sizing up the request",
    lore: "Sentries judge each arriving order: its scope, its risk, and which doctrine it needs.",
  },
  {
    stage: "scouts",
    kind: "stable",
    name: "Scout Stables",
    stageLabel: "Scouts",
    verb: "scouting the repository",
    lore: "Up to three riders map code paths, dependencies, schemas and journeys. Only the scouts the risk calls for ride out.",
  },
  {
    stage: "grill",
    kind: "council",
    name: "Council Hall",
    stageLabel: "Grill",
    verb: "questioning the plan",
    lore: "The Council puts material questions to you, one at a time, with evidence and a recommended decree.",
  },
  {
    stage: "specification",
    kind: "library",
    name: "Scriptorium",
    stageLabel: "Specification",
    verb: "writing the charter",
    lore: "Scribes set down the specification and its acceptance criteria. You seal it before building starts.",
  },
  {
    stage: "plan",
    kind: "warroom",
    name: "War Room",
    stageLabel: "Plan",
    verb: "drawing battle plans",
    lore: "Generals split the work into packages and dependency batches: S1 → S2 + S3 → S4.",
  },
  {
    stage: "implement",
    kind: "workshop",
    name: "Great Workshop",
    stageLabel: "Implement",
    verb: "building the packages",
    lore: "Villager crews build each package in its own walled yard, then assemble them into one candidate.",
  },
  {
    stage: "dev-review",
    kind: "monastery",
    name: "Monastery",
    stageLabel: "Dev review",
    verb: "inspecting the candidate",
    lore: "Fresh-eyed monks read the exact candidate and record P0–P3 findings. One revision is allowed.",
  },
  {
    stage: "test",
    kind: "range",
    name: "Proving Grounds",
    stageLabel: "Test",
    verb: "testing the candidate",
    lore: "The candidate faces the verification manifest. Failures send repair crews back to the Workshop.",
  },
  {
    stage: "final-review",
    kind: "keep",
    name: "The Keep",
    stageLabel: "Final review",
    verb: "reviewing the whole campaign",
    lore: "The Keep reviews every age of the campaign, its costs and its outcome, before the crown decides.",
  },
  {
    stage: "approval",
    kind: "harbour",
    name: "Royal Harbour",
    stageLabel: "Approval",
    verb: "awaiting your seal",
    lore: "Approve & raise PR: an envoy ship carries the exact approved candidate to the GitHub capital.",
  },
];
export const buildingFor = (stage: StageId) =>
  must(stageBuildings.find((item) => item.stage === stage) ?? stageBuildings[0]);
export const ageOf = (stage: StageId) => must(ages.find((age) => age.stages.includes(stage)) ?? ages[0]);

// Civilisations are the project base types. Relay (Starwatch) is research-only, as in Frontier.
export type CivId = "bastion" | "command" | "foundry" | "relay";
export interface Civ {
  id: CivId;
  name: string;
  base: string;
  motto: string;
  palette: { stone: string; roof: string; trim: string };
  researchOnly?: boolean;
}
export const civs: Civ[] = [
  {
    id: "bastion",
    name: "The Stoneward",
    base: "Bastion",
    motto: "Walls first, then banners.",
    palette: { stone: "#b9ad96", roof: "#7a4a2c", trim: "#e6d9b8" },
  },
  {
    id: "command",
    name: "The Crown Legion",
    base: "Command",
    motto: "One keep, many roads.",
    palette: { stone: "#c9c0ae", roof: "#3f4f73", trim: "#efe6cf" },
  },
  {
    id: "foundry",
    name: "The Forgeborn",
    base: "Foundry",
    motto: "Iron, fire, and tested steel.",
    palette: { stone: "#9a8f84", roof: "#5b2f24", trim: "#d8c0a0" },
  },
  {
    id: "relay",
    name: "The Starwatch",
    base: "Relay",
    motto: "Every price has a source.",
    palette: { stone: "#cfc8bf", roof: "#3a3f4a", trim: "#f2ead8" },
    researchOnly: true,
  },
];
export const deliveryBanners = [
  { id: "crimson", label: "Crimson", hex: "#b32b2b" },
  { id: "azure", label: "Azure", hex: "#2f63c4" },
  { id: "gold", label: "Gold", hex: "#d9a21b" },
  { id: "teal", label: "Teal", hex: "#1f8f86" },
  { id: "violet", label: "Violet", hex: "#7a3fb0" },
  { id: "orange", label: "Orange", hex: "#d8661c" },
  { id: "cyan", label: "Cyan", hex: "#2aa7c9" },
  { id: "grey", label: "Grey", hex: "#8a8d93" },
];
export const researchBanners = [
  { id: "green", label: "Green", hex: "#3c9a4a" },
  { id: "pink", label: "Pink", hex: "#d1508f" },
  { id: "silver", label: "Silver", hex: "#c3c7cf" },
  { id: "black", label: "Black", hex: "#3b2350" },
];

export interface Kingdom {
  id: string;
  name: string;
  repository: string | null;
  civ: CivId;
  banner: string;
  origin: { x: number; y: number };
  research?: boolean;
}

const kingdomSeeds: Record<string, { civ: CivId; banner: string; origin: { x: number; y: number } }> = {
  plancheck: { civ: "bastion", banner: "#2f63c4", origin: { x: 20, y: 22 } },
  harness: { civ: "foundry", banner: "#d8661c", origin: { x: 58, y: 21 } },
  mystrata: { civ: "command", banner: "#1f8f86", origin: { x: 22, y: 58 } },
};

export function makeKingdoms(): Kingdom[] {
  const delivery = fixtureProjects.map((project) => ({
    id: project.id,
    name: project.name,
    repository: project.repositoryPath,
    ...(kingdomSeeds[project.id] ?? { civ: "bastion" as CivId, banner: "#8a8d93", origin: { x: 30, y: 30 } }),
  }));
  return [
    ...delivery,
    {
      id: "research",
      name: "QS Rates Research",
      repository: null,
      civ: "relay",
      banner: "#3b2350",
      origin: { x: 60, y: 58 },
      research: true,
    },
  ];
}

// Unit types stand for models; ranks stand for reasoning effort.
export interface UnitType {
  id: string;
  model: string;
  modelLabel: string;
  unit: string;
  army: string;
  provider: "codex" | "claude" | "research";
  role: string;
}
export const unitTypes: UnitType[] = [
  {
    id: "gpt-6-luna",
    model: "gpt-6-luna",
    modelLabel: "GPT-6 Luna",
    unit: "Man-at-Arms",
    army: "Codex Legion",
    provider: "codex",
    role: "The general worker. Fast, tireless, cheap to field in numbers.",
  },
  {
    id: "gpt-6-sol",
    model: "gpt-6-sol",
    modelLabel: "GPT-6 Sol",
    unit: "Knight",
    army: "Codex Legion",
    provider: "codex",
    role: "The heavy cavalry you send to planning and review gates.",
  },
  {
    id: "claude-opus-5-5",
    model: "claude-opus-5-5",
    modelLabel: "Opus 5.5",
    unit: "Paladin",
    army: "Order of Claude",
    provider: "claude",
    role: "The consistent heavy unit; Claude's subscription CLI runs every delivery stage it holds.",
  },
  {
    id: "deepseek-4.1-flash",
    model: "deepseek-4.1-flash",
    modelLabel: "DeepSeek 4.1 Flash",
    unit: "Scholar",
    army: "Starwatch Scholars",
    provider: "research",
    role: "Research only: the API loop, five runs per question, host-checked citations.",
  },
];
export const ranks = [
  { id: "low", numeral: "I", title: "Militia" },
  { id: "medium", numeral: "II", title: "Veteran" },
  { id: "high", numeral: "III", title: "Elite" },
  { id: "xhigh", numeral: "IV", title: "Champion" },
  { id: "max", numeral: "V", title: "Legendary" },
  { id: "ultra", numeral: "VI", title: "Mythic" },
];
export function unitFor(model: string | null | undefined): UnitType {
  const id = model ?? "";
  if (id.includes("sol")) return must(unitTypes[1]);
  if (id.includes("opus") || id.includes("claude")) return must(unitTypes[2]);
  if (id.includes("deepseek")) return must(unitTypes[3]);
  return must(unitTypes[0]);
}
export type UnitKindId = "villager" | "man-at-arms" | "knight" | "paladin" | "scholar" | "monk" | "envoy";
/** The sprite a model fields on the map. */
export function unitKindFor(model: string | null | undefined): UnitKindId {
  const unit = unitFor(model).unit;
  if (unit === "Knight") return "knight";
  if (unit === "Paladin") return "paladin";
  if (unit === "Scholar") return "scholar";
  return "man-at-arms";
}
export const rankFor = (reasoning: string | null | undefined) =>
  must(ranks.find((rank) => rank.id === reasoning) ?? ranks[2]);

export type Doctrine = "fast" | "standard" | "high-risk";
export const doctrines: { id: Doctrine; name: string; profile: string; blurb: string }[] = [
  { id: "fast", name: "Skirmish", profile: "Fast", blurb: "Small raid. One scout, lighter gates." },
  { id: "standard", name: "Campaign", profile: "Standard", blurb: "The default march through every age." },
  {
    id: "high-risk",
    name: "Siege",
    profile: "High-risk",
    blurb: "Heavy escort. Up to three scouts, strict gates.",
  },
];

export type Posture =
  | "working"
  | "needs-you"
  | "blocked"
  | "failed"
  | "waiting"
  | "external"
  | "idle"
  | "done";
export interface Campaign {
  id: string;
  title: string;
  kingdomId: string;
  stage: StageId;
  status: string;
  posture: Posture;
  attentionLabel: string;
  reason: string | null;
  nextActor: string | null;
  completed: StageId[];
  task: RuntimeTask;
  tokens: { input: number; output: number; cached: number; total: number };
  runs: number;
  running: number;
  packages: { id: string; status: string }[];
}

function postureOf(kind: string | undefined): Posture {
  switch (kind) {
    case "running":
      return "working";
    case "answer":
    case "approval":
      return "needs-you";
    case "blocked":
    case "repair":
      return "blocked";
    case "failed":
      return "failed";
    case "dependency":
      return "waiting";
    case "external":
      return "external";
    case "completed":
      return "done";
    default:
      return "idle";
  }
}
export const postureStyle: Record<Posture, { label: string; color: string; glyph: string }> = {
  working: { label: "At work", color: "#e8a33a", glyph: "⚒" },
  "needs-you": { label: "Awaits your decree", color: "#f3d36b", glyph: "!" },
  blocked: { label: "Under siege · repair", color: "#d4402f", glyph: "⚔" },
  failed: { label: "Setback · needs orders", color: "#c0392b", glyph: "✖" },
  waiting: { label: "Waiting on allies", color: "#9aa7b5", glyph: "⧗" },
  external: { label: "Envoy at sea", color: "#5fa8d3", glyph: "⛵" },
  idle: { label: "Awaiting orders", color: "#c9b98f", glyph: "•" },
  done: { label: "Victory", color: "#7bc46b", glyph: "✦" },
};

/** Frontier's sample tasks with its richer workflow scenarios: review findings, test rows, a 12-package plan. */
export function sampleTasks(): (RuntimeTask & { attention: Attention })[] {
  const tasks = makeFixtureTasks() as RuntimeTask[];
  enrichWorkflowScenarios(tasks);
  return tasks.map((task) => ({ ...task, attention: projectTaskAttention(task) }));
}

export function makeCampaigns(kingdoms: Kingdom[]): Campaign[] {
  return sampleTasks().map((task) => {
    const kingdom = must(kingdoms.find((item) => item.repository === task.repositoryPath) ?? kingdoms[0]);
    const runs = task.runs ?? [];
    return {
      id: task.id,
      title: task.title,
      kingdomId: kingdom.id,
      stage: task.currentStage,
      status: task.status,
      posture: postureOf(task.attention?.kind),
      attentionLabel: task.attention?.label ?? task.status,
      reason: task.attention?.reason ?? null,
      nextActor: task.attention?.nextActor ?? null,
      completed: task.completedStages ?? [],
      task: task as RuntimeTask,
      tokens: {
        input: task.usage?.inputTokens ?? 0,
        output: task.usage?.outputTokens ?? 0,
        cached: task.usage?.cachedInputTokens ?? 0,
        total: task.usage?.totalTokens ?? 0,
      },
      runs: runs.length,
      running: runs.filter((run) => run.status === "running").length,
      packages: (task.workPackages ?? []).map((item) => ({ id: item.id, status: item.status })),
    };
  });
}

export interface ResearchQuestion {
  id: string;
  question: string;
  runs: number;
  grade: "confident" | "unsure" | "review" | "no_price" | "running";
  band: string | null;
}
// Sample research questions for the Starwatch; labelled as sample in the UI.
export const researchQuestions: ResearchQuestion[] = [
  {
    id: "RQ-12",
    question: "Supply & install 90mm GIB-lined partition, per m²",
    runs: 5,
    grade: "confident",
    band: "$118–$142 /m²",
  },
  { id: "RQ-13", question: "Replace HV supply to switchroom", runs: 5, grade: "no_price", band: null },
  {
    id: "RQ-14",
    question: "Scaffold hire, 3-storey façade, per week",
    runs: 5,
    grade: "unsure",
    band: "$2.1k–$3.4k /wk",
  },
  { id: "RQ-15", question: "Remove & dispose asbestos vinyl, per m²", runs: 3, grade: "running", band: null },
];

export function makeRoster() {
  const { settings, catalog } = fixtureSettings();
  const profiles = must(settings.profileStagePolicies);
  return {
    profiles,
    roles: policyRoles as { id: RolePolicyId; label: string; skill: string }[],
    settings,
    catalog,
  };
}

export function formatTokens(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${Math.round(value / 1000)}k`;
  return String(value);
}
