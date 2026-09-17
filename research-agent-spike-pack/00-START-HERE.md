# Research Agent Spike — Start Here

## Purpose

Extend the existing Eversor agent harness with a **provider-neutral research runtime capability** without destabilising the current SDLC workflow.

This is a spike, not a rewrite.

### Keep Eversor responsible for
- UI and operator experience
- task/run ownership
- approvals
- budgets and policy
- normalized usage/cost
- high-level events
- artifacts/results
- product integration
- evidence/provenance

### Prefer the research runtime to own
- persistent research sessions
- context management / compaction
- subagent lifecycle
- bounded fan-out/fan-in
- resumability/checkpoint mechanics
- worker execution

Read `HARNESS-RESEARCH-AUDIT.md` first.

## Architectural hypothesis

Do **not** put research inside `TaskControlOrchestrator`.

Introduce a separate Eversor-owned seam:

```ts
interface ResearchRuntime {
  start(request: ResearchRequest): Promise<ResearchRunHandle>;
  status(runId: string): Promise<ResearchRunStatus>;
  cancel(runId: string): Promise<void>;
  resume?(runId: string): Promise<ResearchRunHandle>;
  events?(runId: string, cursor?: string): AsyncIterable<ResearchEvent>;
  result(runId: string): Promise<ResearchResult>;
}
```

Initial candidates:
1. DeepSeek Harness
2. Deep Agents JS
3. managed research API baseline
4. NVIDIA AI-Q later if justified

Initial topology:

```text
frontier planner
      |
      v
3–5 cheap researchers
      |
      v
frontier verifier
      |
      v
frontier synthesiser
```

Do not start with a large swarm.

## Execution order

1. Run `prompts/01-ARCHITECT-PLAN.md` using **Claude Opus 5, high effort**.
2. Review `RESEARCH-RUNTIME-ARCHITECTURE.md`.
3. Run `prompts/02-IMPLEMENT-CONTRACTS.md` using **Claude Sonnet 5, high effort**.
4. Run `prompts/03-DEEPSEEK-HARNESS-SPIKE.md` using **Claude Sonnet 5, high effort**. Escalate to Opus only for hard integration decisions.
5. Run `prompts/04-ADVERSARIAL-REVIEW.md` with **a different strong model**. Prefer GPT-5.6 Sol High for model-family diversity, or Claude Fable 5.1 if staying inside Claude.
6. Benchmark DeepSeek Harness vs Deep Agents JS vs one managed research API before choosing production architecture.
