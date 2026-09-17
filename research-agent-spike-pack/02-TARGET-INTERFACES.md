# Candidate Research Runtime Contracts

These are candidate interfaces, not approved production APIs.

```ts
export interface ResearchRuntime {
  readonly id: string;
  start(request: ResearchRequest): Promise<ResearchRunHandle>;
  status(runId: string): Promise<ResearchRunStatus>;
  cancel(runId: string): Promise<void>;
  resume?(runId: string): Promise<ResearchRunHandle>;
  events?(runId: string, cursor?: string): AsyncIterable<ResearchEvent>;
  result(runId: string): Promise<ResearchResult>;
}

export interface ResearchRequest {
  id: string;
  objective: string;
  profile: string;
  context: ResearchContextRef[];
  constraints?: Record<string, unknown>;
  budget: ResearchBudget;
  outputSchema?: Record<string, unknown>;
}

export interface ResearchBudget {
  maxUsd?: number;
  maxRuntimeMs?: number;
  maxResearchers?: number;
  maxSearchCalls?: number;
  maxToolCalls?: number;
  maxDepth?: number;
  maxTokens?: number;
}

export type ResearchRunState =
  | "queued"
  | "running"
  | "awaiting_approval"
  | "cancelling"
  | "cancelled"
  | "failed"
  | "completed";

export interface ResearchRunHandle {
  runId: string;
  runtimeId: string;
  runtimeSessionId?: string;
  status: ResearchRunState;
  startedAt: string;
}

export interface ResearchRunStatus {
  runId: string;
  status: ResearchRunState;
  usage: ResearchUsage;
  progress?: {
    phase?: string;
    completedWorkers?: number;
    activeWorkers?: number;
    totalWorkers?: number;
  };
  error?: { code?: string; message: string };
}

export interface ResearchUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  toolCalls?: number;
  searchCalls?: number;
  estimatedCostUsd?: number;
  byModel?: Record<string, {
    inputTokens?: number;
    outputTokens?: number;
    estimatedCostUsd?: number;
  }>;
}

export interface ResearchEvent {
  id: string;
  runId: string;
  timestamp: string;
  type:
    | "run.started"
    | "run.completed"
    | "run.failed"
    | "run.cancelled"
    | "phase.started"
    | "phase.completed"
    | "worker.started"
    | "worker.completed"
    | "tool.called"
    | "finding.created"
    | "usage.updated"
    | "artifact.created"
    | "log";
  data: unknown;
}

export interface ResearchResult {
  runId: string;
  summary?: string;
  findings: ResearchFinding[];
  artifacts: ResearchArtifact[];
  usage: ResearchUsage;
  unresolvedQuestions?: string[];
}

export interface ResearchFinding {
  id: string;
  claim: string;
  evidence: EvidenceRef[];
  assumptions?: string[];
  contradictions?: string[];
  confidence?: number;
  verification?: {
    status: "unverified" | "supported" | "weakened" | "rejected";
    notes?: string;
  };
}

export interface EvidenceRef {
  sourceId: string;
  sourceType: string;
  url?: string;
  title?: string;
  retrievedAt: string;
  locator?: Record<string, unknown>;
  excerpt?: string;
  authority?: "primary" | "secondary" | "unknown";
}

export interface ResearchArtifact {
  id: string;
  kind: string;
  name: string;
  contentRef: string;
}

export interface ResearchContextRef {
  type: string;
  id: string;
}
```

Important: do not fake a common `resume()` semantic. True checkpoint continuation and “start a new run using retained context” are different capabilities.
