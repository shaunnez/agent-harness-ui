// A sample campaign's march through all ten buildings, for the replay. It follows the
// workflow Frontier records: triage, scouts, Grill, a sealed specification and plan, packages
// in dependency batches, an assembled candidate, a review finding that sends a repair crew
// back to the Workshop (making the review stale), fresh gates, human approval and a merged PR.
// It is sample data, labelled as a replay everywhere it appears.
import type { StageId } from "../../domain.ts";
import type { Posture } from "../realm.ts";

export type ReplayPlace = StageId | "market" | "capital";
export interface ReplayPackage {
  id: string;
  title: string;
  status: "planned" | "running" | "ready_for_integration" | "integrated";
  after: string[];
}
export interface ReplayStep {
  kind: "march" | "work" | "decree" | "sail" | "victory";
  at: ReplayPlace;
  from?: ReplayPlace;
  repair?: boolean;
  seconds: number;
  posture: Posture;
  caption: string;
  herald?: string;
  model?: string;
  packages?: ReplayPackage[];
  candidate?: number;
  complete?: StageId[];
  stale?: StageId[];
  fresh?: StageId[];
  scouts?: boolean;
}

export const replayCampaign = {
  id: "MS-100",
  title: "Send levy reminders",
  kingdomId: "mystrata",
};

const pkg = (
  id: string,
  title: string,
  status: ReplayPackage["status"],
  after: string[] = [],
): ReplayPackage => ({
  id,
  title,
  status,
  after,
});
const plan = (s1: ReplayPackage["status"], s23: ReplayPackage["status"]) => [
  pkg("S1", "Reminder schedule contract", s1),
  pkg("S2", "Email reminder sender", s23, ["S1"]),
  pkg("S3", "Portal reminder banner", s23, ["S1"]),
];
const march = (from: ReplayPlace, at: StageId, extra: Partial<ReplayStep> = {}): ReplayStep => ({
  kind: "march",
  from,
  at,
  seconds: 3,
  posture: "working",
  caption: "Marching",
  ...extra,
});

export const replayScript: ReplayStep[] = [
  march("market", "triage", {
    seconds: 7,
    caption: "A Linear caravan brings MS-100 from the Grand Market to MyStrataAssist",
    herald: "A caravan from the Merchant League arrives: MS-100 · Send levy reminders.",
  }),
  {
    kind: "work",
    at: "triage",
    seconds: 5,
    posture: "working",
    model: "gpt-6-luna",
    caption: "Watch Tower: medium risk, Campaign doctrine, two scouts",
    herald: "The Watch Tower judges MS-100: medium risk. The Campaign doctrine is chosen.",
    complete: ["triage"],
  },
  march("triage", "scouts"),
  {
    kind: "work",
    at: "scouts",
    seconds: 7,
    posture: "working",
    model: "gpt-6-luna",
    scouts: true,
    caption: "Code-path and user-journey scouts ride out; four others stay stabled",
    herald: "Two scouts ride out to map the notice code and the resident journey.",
    complete: ["scouts"],
  },
  march("scouts", "grill"),
  {
    kind: "decree",
    at: "grill",
    seconds: 6,
    posture: "needs-you",
    model: "gpt-6-luna",
    caption: "The Council asks: which channel first? Counsel recommends email",
    herald: "The Council awaits your decree: which channel should a levy reminder use first?",
  },
  {
    kind: "work",
    at: "grill",
    seconds: 2,
    posture: "working",
    caption: "Decree recorded in the replay: Email first",
    herald: "Decree (replay): Email first, as the Council recommended.",
    complete: ["grill"],
  },
  march("grill", "specification"),
  {
    kind: "work",
    at: "specification",
    seconds: 4,
    posture: "working",
    model: "gpt-6-luna",
    caption: "Scribes write the charter and its acceptance criteria",
  },
  {
    kind: "decree",
    at: "specification",
    seconds: 3,
    posture: "needs-you",
    caption: "The charter awaits your seal",
    herald: "The Scriptorium's charter awaits your seal.",
  },
  {
    kind: "work",
    at: "specification",
    seconds: 1,
    posture: "working",
    caption: "Charter sealed in the replay",
    complete: ["specification"],
  },
  march("specification", "plan"),
  {
    kind: "work",
    at: "plan",
    seconds: 4,
    posture: "working",
    model: "gpt-6-sol",
    caption: "Generals split the work: S1 → S2 + S3 in parallel",
    herald: "The War Room draws the plan: S1, then S2 and S3 side by side.",
    packages: plan("planned", "planned"),
  },
  {
    kind: "decree",
    at: "plan",
    seconds: 3,
    posture: "needs-you",
    caption: "The battle plan awaits your approval",
  },
  {
    kind: "work",
    at: "plan",
    seconds: 1,
    posture: "working",
    caption: "Plan approved in the replay",
    complete: ["plan"],
  },
  march("plan", "implement"),
  {
    kind: "work",
    at: "implement",
    seconds: 5,
    posture: "working",
    model: "gpt-6-luna",
    caption: "Batch 1: S1 is built in its own walled yard",
    herald: "Villagers raise S1 in an isolated yard.",
    packages: plan("running", "planned"),
  },
  {
    kind: "work",
    at: "implement",
    seconds: 6,
    posture: "working",
    model: "gpt-6-luna",
    caption: "Batch 2: S2 and S3 in parallel; S1 is integrated",
    herald: "S1 qualifies. S2 and S3 rise side by side.",
    packages: plan("integrated", "running"),
  },
  {
    kind: "work",
    at: "implement",
    seconds: 3,
    posture: "working",
    caption: "Every slice qualifies; candidate r1 is assembled",
    herald: "The Workshop assembles candidate r1 from S1, S2 and S3.",
    packages: plan("integrated", "integrated"),
    candidate: 1,
    complete: ["implement"],
  },
  march("implement", "dev-review"),
  {
    kind: "work",
    at: "dev-review",
    seconds: 4,
    posture: "working",
    model: "gpt-6-sol",
    caption: "Fresh-eyed monks read candidate r1",
  },
  {
    kind: "work",
    at: "dev-review",
    seconds: 3,
    posture: "blocked",
    caption: "P1 finding: a resident with no email is skipped silently. Repair required",
    herald: "The Monastery finds a P1 defect in r1. Repair required.",
  },
  march("dev-review", "implement", {
    seconds: 4,
    repair: true,
    posture: "blocked",
    caption: "The repair road: back to the Workshop",
    stale: ["dev-review"],
  }),
  {
    kind: "work",
    at: "implement",
    seconds: 5,
    posture: "working",
    model: "gpt-6-sol",
    caption: "Repair crew builds candidate r2. The r1 review is now stale",
    herald: "Repair crew raises candidate r2. The Monastery's verdict on r1 is stale.",
    candidate: 2,
  },
  march("implement", "dev-review"),
  {
    kind: "work",
    at: "dev-review",
    seconds: 4,
    posture: "working",
    model: "gpt-6-sol",
    caption: "A fresh review of r2: no blocking findings",
    herald: "The Monastery passes candidate r2.",
    fresh: ["dev-review"],
    complete: ["dev-review"],
  },
  march("dev-review", "test"),
  {
    kind: "work",
    at: "test",
    seconds: 5,
    posture: "working",
    model: "gpt-6-luna",
    caption: "The verification manifest passes on r2",
    herald: "Every target falls at the Proving Grounds: r2 passes its manifest.",
    complete: ["test"],
  },
  march("test", "final-review"),
  {
    kind: "work",
    at: "final-review",
    seconds: 4,
    posture: "working",
    model: "gpt-6-sol",
    caption: "The Keep reviews the whole campaign",
    complete: ["final-review"],
  },
  march("final-review", "approval"),
  {
    kind: "decree",
    at: "approval",
    seconds: 4,
    posture: "needs-you",
    caption: "Approve & raise PR for exactly r2",
    herald: "The Royal Harbour awaits your seal on candidate r2.",
  },
  {
    kind: "sail",
    from: "approval",
    at: "capital",
    seconds: 8,
    posture: "external",
    caption: "The envoy sails r2 to the GitHub Capital; awaiting PR merge",
    herald: "An envoy sails for the GitHub Capital with MS-100 (replay).",
  },
  {
    kind: "victory",
    at: "capital",
    seconds: 4,
    posture: "done",
    caption: "Merged at the Capital. Victory",
    herald: "The Capital merges MS-100. Victory (replay)!",
    complete: ["approval"],
  },
];
