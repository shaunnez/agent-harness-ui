# Candidate Provider-Neutral Contracts

These are candidates for architecture review, not final APIs.

```ts
export interface ResearchRuntime {
  readonly id: string;

  start(request: ResearchRequest): Promise<ResearchRunHandle>;
  status(runId: string): Promise<ResearchRunStatus>;
  cancel(runId: string): Promise<void>;

  // Only expose when it means genuine continuation.
  resume?(runId: string): Promise<ResearchRunHandle>;

  events?(
    runId: string,
    cursor?: string,
  ): AsyncIterable<ResearchEvent>;

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
  metadata?: Record<string, string>;
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
  runtimeThreadId?: string;
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
  modelCalls?: number;
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
  sourceType: "web" | "project_document" | "internal_record" | "other";
  url?: string;
  title?: string;
  retrievedAt: string;
  locator?: {
    page?: number;
    section?: string;
    lineStart?: number;
    lineEnd?: number;
    selector?: string;
  };
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

## Important distinction

LangGraph checkpoint restoration, conversational continuation and “rerun a new research job using prior artifacts” are different semantics.

Do not expose all three as `resume()` unless the implementation truly supports continuation of the same logical execution.
