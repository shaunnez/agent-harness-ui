import { getStageMetadata } from "./prompts.mjs";
import { enrichUsage, resolveAgentPolicy } from "./model-catalog.mjs";
import {
  attachRunArtifact,
  CANDIDATE_GATE_STAGES,
  completeAgentRun,
  runEventMetadata,
} from "./run-activity.mjs";

import { RepairExecutionOrchestrator } from "./orchestrator-repair-execution.mjs";
import { now, activity } from "./orchestrator-stage-support.mjs";
import { removeStageArtifacts } from "./orchestrator-run-policy.mjs";

export class RetentionOrchestrator extends RepairExecutionOrchestrator {
  async _finishAgentRun(id, stageId, label, result, status) {
    await this._store.update(id, (draft) => {
      const run = completeAgentRun(draft, result.runId, {
        status,
        completedAt: result.completedAt,
        durationMs: result.durationMs,
        usage: result.usage,
        runtimeEvents: result.runtimeEvents,
        error: result.error,
      });
      for (const event of result.runtimeEvents?.slice(-100) ?? []) {
        draft.events.push(
          activity(
            stageId,
            event.title,
            event.detail,
            event.tone,
            event.toolCall ? "tool" : "agent",
            runEventMetadata(run, { toolCall: event.toolCall ?? null }),
          ),
        );
      }
      const duration =
        result.durationMs == null ? "Duration unavailable" : `${(result.durationMs / 1_000).toFixed(1)}s`;
      draft.events.push(
        activity(
          stageId,
          `${label} agent ${status === "completed" ? "completed" : status}`,
          status === "completed" ? duration : (result.error ?? duration),
          status === "completed" ? "success" : "danger",
          "agent",
          runEventMetadata(run),
        ),
      );
    });
  }

  async _retainAgentResult(id, stageId, result, options = {}) {
    const metadata = getStageMetadata(stageId);
    const task = await this._store.get(id);
    const settings = await this._store.settings();
    const fallbackPolicy = resolveAgentPolicy(task, stageId, settings);
    // A harness-generated artifact (candidate assembly, say) never called a model at all.
    // Attributing it to the stage's configured policy anyway would fabricate a Model /
    // Reasoning pairing next to honestly-zero usage, which reads as a broken agent run
    // rather than as the mechanical step it actually was.
    const resultModel = options.synthetic
      ? null
      : (result.model ?? fallbackPolicy.model ?? task.models[0]?.model ?? "gpt-5.6-luna");
    const resultUsage = enrichUsage(
      resultModel,
      result.usage,
      settings.pricing?.rates,
      settings.pricing?.version,
    );
    await this._store.update(id, (draft) => {
      if (options.replace) removeStageArtifacts(draft, stageId);
      const artifact = {
        id: crypto.randomUUID(),
        runId: result.runId ?? null,
        stage: stageId,
        name: options.name ?? metadata.artifactName,
        kind: "markdown",
        content: result.finalText,
        createdAt: now(),
        startedAt: result.startedAt ?? null,
        completedAt: result.completedAt ?? null,
        durationMs: result.durationMs ?? null,
        model: resultModel,
        reasoning: options.synthetic
          ? null
          : result.reasoning !== undefined
            ? result.reasoning
            : fallbackPolicy.reasoning,
        agentRole: options.agentRole ?? result.agentRole ?? stageId,
        usage: resultUsage,
        candidateId: options.candidateId ?? null,
        candidateRevision: options.candidateRevision ?? null,
        workPackageId: options.workPackageId ?? null,
        focusedTest: options.focusedTestEvidence ?? null,
        evidenceError: options.evidenceError ?? null,
        gateResult: options.gateResult ?? null,
        contextManifest: result.contextManifest ?? null,
      };
      draft.artifacts.push(artifact);
      const run = attachRunArtifact(draft, result.runId, artifact);
      const stageIsAuthoritative = !CANDIDATE_GATE_STAGES.includes(stageId) || run?.freshness?.fresh === true;
      if (options.complete !== false && stageIsAuthoritative && !draft.completedStages.includes(stageId)) {
        draft.completedStages.push(stageId);
      }
      for (const key of [
        "inputTokens",
        "cachedInputTokens",
        "cacheWriteTokens",
        "outputTokens",
        "totalTokens",
      ]) {
        draft.usage[key] += resultUsage[key] ?? 0;
      }
      draft.usage.cost = (draft.usage.cost ?? 0) + (resultUsage.cost ?? 0);
      draft.usage.credits = (draft.usage.credits ?? 0) + (resultUsage.credits ?? 0);
      draft.usage.pricingVersion = resultUsage.pricingVersion ?? draft.usage.pricingVersion;
      draft.events.push(
        activity(
          stageId,
          options.artifactTitle ?? `${metadata.label} artifact ready`,
          options.name ?? metadata.artifactName,
          options.artifactTone ?? "success",
          "artifact",
          runEventMetadata(run, { artifactId: artifact.id }),
        ),
      );
    });
  }
}
