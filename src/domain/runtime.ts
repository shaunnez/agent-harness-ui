import type { StageId } from "../domain";
import type { RuntimeEvent, RuntimeGateFreshness, RuntimeGateStage, RuntimeRun } from "../runtime-activity";

export type RuntimeTaskStatus =
  | "queued"
  | "running"
  | "cancelling"
  | "failed"
  | "blocked"
  | "cancelled"
  | "awaiting-grill"
  | "awaiting-spec-approval"
  | "awaiting-plan-approval"
  | "ready-for-implementation"
  | "ready-for-review"
  | "review-retry-required"
  | "ready-for-test"
  | "ready-for-final-review"
  | "repair-required"
  | "awaiting-human-approval"
  | "merging"
  | "merged-to-target"
  | "completed"
  | "closed"
  | "archived";

export interface RuntimeUsage {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens?: number;
  outputTokens: number;
  totalTokens: number;
  cost?: number | null;
  credits?: number | null;
  pricingVersion?: string | null;
}

export interface RuntimeContextSource {
  kind: "task" | "decisions" | "attachments" | "artifact" | "repository" | "structured-evidence";
  id: string;
  label: string;
  stage?: StageId;
  includedCharacters: number | null;
  originalCharacters: number | null;
  truncated: boolean;
}

export interface RuntimeContextManifest {
  stage: StageId;
  promptCharacters: number;
  estimatedPromptTokens: number;
  repositoryAccess: "read-only" | "workspace-write";
  policy: string;
  candidateId?: string | null;
  candidateRevision?: number | null;
  workPackageId?: string | null;
  scoutName?: string | null;
  scoutFocus?: string | null;
  sources: RuntimeContextSource[];
}

export interface RuntimeArtifact {
  id: string;
  runId?: string | null;
  stage: StageId;
  name: string;
  kind: "markdown";
  content: string;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  durationMs?: number | null;
  // null for a harness-generated artifact (e.g. candidate assembly) that never called a model.
  model: string | null;
  reasoning?: string | null;
  agentRole?: string | null;
  usage: RuntimeUsage;
  contextManifest?: RuntimeContextManifest | null;
  candidateId?: string | null;
  candidateRevision?: number | null;
  workPackageId?: string | null;
  focusedTest?: RuntimeFocusedTestEvidence | null;
  evidenceError?: { code: string; copy: string } | null;
  freshness?: RuntimeGateFreshness | null;
  sourceTaskId?: string | null;
  sourceArtifactId?: string | null;
  gateResult?: {
    schemaVersion?: number;
    stage?: StageId;
    verdict: "PASS" | "REPAIR";
    reportedVerdict?: "PASS" | "REPAIR";
    candidateId: string;
    candidateRevision: number;
    evaluatedAt: string;
    blockingReasons: string[];
    findings?: Array<{
      kind: "candidate-defect" | "verification-gap";
      severity: "P0" | "P1" | "P2" | "P3";
      title: string;
      detail: string;
      file: string | null;
      line: number | null;
      candidateId: string;
      candidateRevision: number;
      bindingExplicit?: boolean;
      blocking?: boolean;
      acceptanceCriterion?: string | null;
      reproductionEvidence?: string | null;
    }>;
  } | null;
}

export type RuntimeArtifactMetadata = Omit<
  RuntimeArtifact,
  "content" | "contextManifest" | "focusedTest" | "gateResult" | "freshness"
>;

export interface RuntimeFocusedTestArtifactReference {
  name: string;
  path?: string | null;
  kind: string;
}

export interface RuntimeFocusedTestAssertion {
  label: string;
  actual: string;
  expected?: string | null;
}

export interface RuntimeFocusedTestRow {
  id: string;
  candidateId: string;
  candidateRevision: number;
  bindingExplicit?: boolean;
  command: string;
  status: "passed" | "failed";
  durationMs: number | null;
  title: string;
  artifactReferences: RuntimeFocusedTestArtifactReference[];
  assertions: RuntimeFocusedTestAssertion[];
  failureDetails: string | null;
  exitCode?: number | null;
  output?: string | null;
}

export interface RuntimeFocusedTestEvidence {
  headRevision?: string;
  candidateId: string;
  candidateRevision: number;
  bindingExplicit?: boolean;
  command: string;
  status: "passed" | "failed";
  startedAt?: string | null;
  completedAt?: string | null;
  durationMs: number | null;
  rows: RuntimeFocusedTestRow[];
  executionKind?: "focused-package" | "full-manifest";
  executedCommandIds?: string[];
  declaredCommandIds?: string[];
  retryDisposition?: "human-rerun-requested";
  retryRequestedAt?: string | null;
}

export interface RuntimeDecision {
  id: string;
  grillQuestionId?: string;
  question: string;
  answer: string;
  createdAt: string;
  grantedStage?: StageId;
  previousLimit?: number;
  newLimit?: number;
  sourceRunId?: string | null;
  sourceRunIds?: string[];
  sourceTaskId?: string | null;
  sourceDecisionId?: string | null;
  candidateId?: string | null;
  candidateRevision?: number | null;
  candidateHeadRevision?: string | null;
  authorizingGateArtifactId?: string | null;
  authorizingGateCandidateId?: string | null;
  authorizingGateCandidateRevision?: number | null;
  authorizingGateCandidateHeadRevision?: string | null;
  authorizingGateKind?: string | null;
  authorizingGateReservedAt?: string | null;
  authorizingGateReservationId?: string | null;
  authorizingGateRunId?: string | null;
  authorizingGateStage?: StageId | null;
  authorizingGateWorkflowAttempt?: number | null;
  candidateAuthorizerArtifactIds?: string[];
  candidateAuthorizerReservationIds?: string[];
  candidateAuthorizerRunIds?: string[];
  candidateProducerArtifactIds?: string[];
  candidateProducerRunIds?: string[];
  workflowAttempt?: number | null;
  workflowCandidateId?: string | null;
  workflowCandidateRevision?: number | null;
  workflowCandidateHeadRevision?: string | null;
  workflowReservationId?: string | null;
}

export interface RuntimeScoutDispatch {
  selected: Array<{ name: string; focus: string; reason: string; status: "queued" | "complete" | "failed"; error?: string }>;
  skipped: string[];
  rationale?: string;
  createdAt: string;
  completedAt: string | null;
}

export interface RuntimeGrillOption {
  id: string;
  label: string;
  description: string;
  recommended: boolean;
}

export type RuntimeGrillPolicy = "manual" | "auto-accept-recommendations";

export type RuntimeGrillAnswerSource =
  | "operator-answer"
  | "operator-accepted-recommendation"
  | "automation-policy"
  | "user"
  | "accepted-assumption"
  | null;

export type RuntimeGrillCompletionSource =
  | "operator"
  | "automation-policy"
  | "no-questions"
  | "legacy-unverified"
  | null;

export interface RuntimeGrillQuestion {
  id: string;
  question: string;
  whyItMatters: string;
  options: RuntimeGrillOption[];
  allowCustom: boolean;
  answer: string | null;
  answerSource: RuntimeGrillAnswerSource;
  resolvedAt: string | null;
}

export interface RuntimeGrillSession {
  status: "open" | "completed";
  questions: RuntimeGrillQuestion[];
  createdAt: string;
  completedAt: string | null;
  completionReason: string | null;
  completionSource?: RuntimeGrillCompletionSource;
  policySnapshot?: RuntimeGrillPolicy;
  acceptedRecommendationCount?: number;
}

export interface RuntimeWorkPackage {
  id: string;
  title: string;
  description: string;
  dependencies: string[];
  batch: number;
  ownedPaths: string[];
  verification: string[];
  verificationCommandIds?: string[];
  verificationRuns?: RuntimeFocusedTestEvidence[];
  status: "planned" | "running" | "ready_for_integration" | "failed" | "integrated";
  attempts: number;
  branch: string | null;
  worktreePath: string | null;
  baseRevision: string | null;
  headRevision: string | null;
  files: string[];
  error: string | null;
}

export interface RuntimeWorktreeInventoryRow {
  id: string;
  kind: "slice" | "candidate";
  label: string;
  worktreePath: string;
  branch: string;
  baseRevision: string | null;
  headRevision: string | null;
  taskId: string;
  workPackageId: string | null;
  lifecycleState: "retained" | "active" | "stale";
  gitExists: boolean;
  gitHeadRevision: string | null;
  gitClean: boolean | null;
  cleanupReady: boolean;
}

export interface RuntimeApproval {
  id: string;
  stage: StageId;
  note: string;
  createdAt: string;
  sourceTaskId?: string | null;
  sourceApprovalId?: string | null;
}

export interface RuntimeCandidate {
  id: string;
  revisionNumber: number;
  baseRevision: string;
  baseBranch: string;
  baseRef?: string | null;
  headRevision: string | null;
  branch: string;
  repositoryRoot: string;
  worktreePath: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  sourceWorkflowAttempt?: number | null;
  sourceWorkflowReservationId?: string | null;
  revisions: Array<{
    number: number;
    headRevision: string;
    reason: string;
    createdAt: string;
    sourceWorkflowAttempt?: number | null;
    sourceWorkflowReservationId?: string | null;
    sourceWorkflowReservedAt?: string | null;
    authorizingGateStage?: StageId | null;
    authorizingGateWorkflowAttempt?: number | null;
    authorizingGateReservationId?: string | null;
    authorizingGateReservedAt?: string | null;
    authorizingGateRunId?: string | null;
    authorizingGateArtifactId?: string | null;
  }>;
  members?: Array<{ packageId: string; headRevision: string; order: number }>;
  verificationRuns?: RuntimeFocusedTestEvidence[];
}

export type WorkflowProfileId = "fast" | "standard" | "high-risk";

export interface RuntimeWorkflowProfile {
  selected: WorkflowProfileId;
  reason: string;
  source: "automatic" | "operator" | "migration" | "automatic-escalation";
  selectedAt: string;
  history: Array<{
    from: WorkflowProfileId | null;
    to: WorkflowProfileId;
    reason: string;
    source: string;
    at: string;
  }>;
}

export interface RuntimeStageDisposition {
  status: "not-required" | "deterministic";
  reason: string;
  decidedAt: string;
}

export interface RuntimeTask {
  id: string;
  title: string;
  description: string;
  repositoryPath: string;
  workflow: "investigate" | "implement";
  continuedFromTaskId?: string | null;
  continuedByTaskId?: string | null;
  priority: "low" | "medium" | "high";
  grillPolicy?: RuntimeGrillPolicy;
  workflowProfile?: RuntimeWorkflowProfile;
  stageDispositions?: Partial<Record<StageId, RuntimeStageDisposition>>;
  reviewRetries?: Array<{
    stage?: "dev-review" | "final-review";
    candidateId: string;
    candidateRevision: number;
    runId: string | null;
    reasonCode: string;
    reason: string;
    createdAt: string;
  }>;
  automaticRepairCycles?: number;
  sameCandidateTestRetries?: Array<{
    id: string;
    candidateId: string;
    candidateRevision: number;
    candidateHeadRevision: string;
    failedVerificationCompletedAt: string | null;
    requestedAt: string;
  }>;
  agentConfig?: {
    model: string;
    reasoning: string;
    stagePolicies?: Record<string, RuntimeAgentPolicy>;
    profileStagePolicies?: Record<WorkflowProfileId, Record<string, RuntimeAgentPolicy>>;
    policySnapshotVersion?: number;
  };
  attachments?: Array<{ id: string; name: string; type: string; size: number; path: string }>;
  status: RuntimeTaskStatus;
  closure?: { reason: "not-needed" | "superseded" | "duplicate"; supersededBy: string | null; note: string; closedAt: string } | null;
  /** `previousStatus` is where the task actually stopped; archiving is a visibility decision, not a verdict. */
  archive?: {
    archivedAt: string;
    previousStatus: RuntimeTaskStatus;
    note: string;
    removedWorktrees: string[];
    retainedWorktrees: string[];
  } | null;
  evaluation?: RuntimeTaskEvaluation | null;
  experiment?: RuntimeExperimentSnapshot | null;
  mergeIntent?: {
    candidateId: string;
    candidateRevision: number;
    baseRevision: string;
    headRevision: string;
    targetRef: string;
    note: string;
    status: "pending" | "completed" | "failed";
    startedAt: string;
    completedAt: string | null;
    error: string | null;
  } | null;
  blocker?: {
    code: "target-diverged" | "merge-reconciliation" | string;
    detail: string;
    detectedAt: string;
    candidateId?: string | null;
    candidateRevision?: number | null;
    candidateBaseRevision?: string | null;
  } | null;
  scoutDispatch?: RuntimeScoutDispatch | null;
  currentStage: StageId;
  completedStages: StageId[];
  stageRun: number;
  stageRunLimit: number;
  stageRunLimits?: Partial<Record<StageId, number | null>> | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  activeRunKind: string | null;
  activeRunIds?: string[];
  attemptsByStage: Partial<Record<StageId, number>>;
  models: Array<{ provider: "openai" | "anthropic"; model: string }>;
  usage: RuntimeUsage;
  artifacts: RuntimeArtifact[];
  decisions: RuntimeDecision[];
  grillSession: RuntimeGrillSession | null;
  approvals: RuntimeApproval[];
  workPackages: RuntimeWorkPackage[];
  candidates: RuntimeCandidate[];
  runs?: RuntimeRun[];
  gateFreshness?: Record<RuntimeGateStage, RuntimeGateFreshness> | null;
  worktreeInventory?: RuntimeWorktreeInventoryRow[];
  events: RuntimeEvent[];
  artifactCount?: number;
  eventCount?: number;
  runCount?: number;
}

export type RuntimeTaskSummary = Omit<RuntimeTask, "artifacts" | "events" | "runs" | "worktreeInventory"> & {
  artifacts: RuntimeArtifactMetadata[];
  events?: RuntimeEvent[];
  runs?: RuntimeRun[];
};

export type RuntimeTaskCore = RuntimeTaskSummary;

export interface RuntimePage<T> {
  items: T[];
  total: number;
  nextCursor: string | null;
}

export interface RuntimeStatus {
  available: boolean;
  authenticated: boolean;
  authMethod: string | null;
  model: string;
  reasoning: string;
  binary: string | null;
  message: string;
  suggestedRepository: string;
  csrfToken?: string;
  catalog?: RuntimeModelCatalog;
  settings?: RuntimeSettings;
  providers?: Array<{
    id: "codex" | "claude" | "local";
    label: string;
    available: boolean;
    authenticated: boolean;
    executionEnabled: boolean;
    // Present only when a sandbox canary actually ran. Status deliberately does not pay
    // for one, so for Claude this is null here and `executionEnabled` is false with it —
    // absence of a verdict, not a failed verdict.
    confinement?: { passed: boolean; detail?: string } | null;
    detail: string;
  }>;
  scouts?: Array<{ id: string; label: string; instruction: string; limits: string }>;
}

export interface RuntimeAgentPolicy {
  model: string;
  reasoning: string;
}

export interface RuntimeExperimentSnapshot {
  groupId: string;
  variantId: string;
  frozenBaseSha: string;
  taskBriefHash: string;
  policyMatrix: Record<string, RuntimeAgentPolicy>;
  acceptanceCriteria: string[];
  verificationCommands: string[];
  createdAt: string;
}

export interface RuntimeQualityScore {
  score: number;
  outcome: "accepted" | "rejected" | "mixed";
  rubric: Record<string, number>;
  notes: string;
  evaluator: string | null;
  evaluatedAt: string;
}

export interface RuntimeTaskEvaluation {
  score?: number;
  outcome?: "accepted" | "rejected" | "mixed";
  rubric?: Record<string, number>;
  notes?: string;
  evaluator?: string | null;
  suiteId: string | null;
  caseId: string | null;
  evaluatedAt?: string;
  scores?: Partial<Record<"human" | "blind", RuntimeQualityScore>>;
}

export interface RuntimeModelPriceBand {
  input: number;
  cachedInput: number;
  cacheWrite: number | null;
  output: number;
}

export interface RuntimeModelPricing {
  short: RuntimeModelPriceBand;
  long: RuntimeModelPriceBand | null;
}

export interface RuntimeModelOption {
  id: string;
  label: string;
  description: string;
  defaultReasoning: string;
  reasoningLevels: string[];
  pricing: RuntimeModelPricing | null;
  /** `null` when no execution provider claims the id, e.g. a stale configured model. */
  provider?: "codex" | "claude" | null;
  provenance: "discovered" | "configured" | "bundled-fallback" | "bundled";
  availability: "discovered" | "configured" | "unsupported";
  editable: boolean;
}

export interface RuntimeModelCatalog {
  models: RuntimeModelOption[];
  fetchedAt: string | null;
  source: string;
}

export interface RuntimeSettings {
  grillPolicy: RuntimeGrillPolicy;
  allowedModels: string[];
  defaultModel: string;
  defaultReasoning: string;
  stagePolicies: Record<string, RuntimeAgentPolicy>;
  profileStagePolicies?: Record<WorkflowProfileId, Record<string, RuntimeAgentPolicy>>;
  pricing: {
    version: string;
    sourceUrl: string;
    verifiedAt: string;
    verifiedBy: string;
    rates: Record<string, RuntimeModelPricing>;
    creditRates?: Record<string, { input: number; cachedInput: number; output: number }>;
    creditSourceUrl?: string;
  };
}

export interface RuntimeEvaluationVariant {
  role: string;
  model: string;
  reasoning: string;
  runs: number;
  tasks: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  cacheRate: number | null;
  cost: number | null;
  credits: number | null;
  gatePasses: number;
  gateRepairs: number;
  averageHumanScore: number | null;
}

export interface RuntimeEvaluationSummary {
  generatedAt: string;
  methodology: string;
  evaluatedTasks: number;
  variants: RuntimeEvaluationVariant[];
  observations: {
    methodology: string;
    evaluatedTasks: number;
    variants: RuntimeEvaluationVariant[];
  };
  experiments: {
    methodology: string;
    taskCount: number;
    variants: RuntimeExperimentVariant[];
  };
}

export interface RuntimeExperimentVariant {
  groupId: string;
  variantId: string;
  frozenBaseSha: string;
  taskIds: string[];
  sampleCount: number;
  taskBriefHashes: string[];
  policyMatrices: Array<Record<string, RuntimeAgentPolicy>>;
  acceptanceDefinitions: string[][];
  verificationDefinitions: string[][];
  gateAttempts: number;
  firstPassGateSuccesses: number;
  firstPassGateSuccessRate: number | null;
  eventualGateSuccesses: number;
  eventualGateSuccessRate: number | null;
  repairCount: number;
  retryCount: number;
  wallTimeMs: number | null;
  averageWallTimeMs: number | null;
  roleDurations: Record<string, number>;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  cacheRate: number | null;
  credits: number | null;
  apiEstimate: number | null;
  contextCharacters: number;
  estimatedContextTokens: number;
  averageHumanScore: number | null;
  averageBlindScore: number | null;
}

export interface RuntimeChangelogCommit {
  sha: string;
  shortSha: string;
  author: string;
  authoredAt: string;
  subject: string;
}

export interface RuntimeChangelogFile {
  status: string;
  path: string;
  previousPath: string | null;
}

export interface RuntimeChangelogDetail extends RuntimeChangelogCommit {
  body: string;
  files: RuntimeChangelogFile[];
}

export interface RuntimeChangelogDiff {
  sha: string;
  path: string;
  diff: string;
  truncated: boolean;
}
