import { renderInvestigationResultMarkdown } from "./contract-rendering.mjs";
import {
  createStageRunReservation,
  removeStageArtifacts,
  throwIfAborted,
} from "./orchestrator-run-policy.mjs";
import { activity, completeGrillSession, now } from "./orchestrator-stage-support.mjs";
import { applyStageRunReservation, requireActiveRunReservation } from "./orchestrator-task-helpers.mjs";
import { getStageMetadata } from "./prompts.mjs";
import { stageRunLimitFor } from "./run-activity.mjs";
import {
  aggregateScoutReports,
  buildScoutRequest,
  parseScoutReport,
  scoutCatalog,
  scoutReportMarkdown,
  selectScoutDispatch,
} from "./scouts.mjs";
import {
  parseFastChangeContract,
  parseGrillQuestions,
  parseInvestigationResult,
} from "./structured-output.mjs";
import { recordEdge, recordNodeSkipped } from "./topology-trace.mjs";
import { fastEscalation } from "./workflow-profiles.mjs";

export class InvestigationProgressionOrchestrator {
  constructor({ store, escalateProfile, executeAgent, retainAgentResult, runSpecification }) {
    this._store = store;
    this._escalateProfile = escalateProfile;
    this._executeAgent = executeAgent;
    this._retainAgentResult = retainAgentResult;
    this._runSpecification = runSpecification;
  }

  async _runInvestigation(id, signal) {
    let task = await this._store.get(id);
    if (!task.completedStages.includes("triage")) {
      if (signal.aborted) throw new Error("Codex run cancelled.");
      await this._reserveInvestigationStage(id, "triage");
      task = await this._store.get(id);
      const result = await this._executeAgent(task, "triage", signal, task.repositoryPath, "read-only");
      throwIfAborted(signal);
      await this._retainAgentResult(id, "triage", result, { replace: true });
    }

    task = await this._store.get(id);
    if (task.workflowProfile?.selected === "fast") {
      const triageArtifact = [...task.artifacts].reverse().find((artifact) => artifact.stage === "triage");
      let contract = null;
      try {
        contract = parseFastChangeContract(triageArtifact?.content, task.repositoryPath);
      } catch (error) {
        await this._escalateProfile(
          id,
          {
            target: "standard",
            reason: `Fast automatically escalated to standard because triage did not produce a valid bounded change contract: ${error.message}`,
          },
          "triage",
        );
      }
      if (contract) {
        const escalation = fastEscalation({
          profile: "fast",
          kind: "triage",
          text: triageArtifact?.content,
          riskSignals: contract.riskSignals,
          unresolvedDecisions: contract.unresolvedDecisions,
          ownedPaths: contract.ownedPaths,
        });
        if (escalation) await this._escalateProfile(id, escalation, "triage");
      }
      task = await this._store.get(id);
      if (contract && task.workflowProfile?.selected === "fast") {
        const dispatch = selectScoutDispatch(task, triageArtifact?.content ?? "").selected;
        if (dispatch.length) {
          await this._reserveInvestigationStage(id, "scouts");
          await this._runScouts(id, await this._store.get(id), signal);
          const scoutArtifact = [...(await this._store.get(id)).artifacts]
            .reverse()
            .find((artifact) => artifact.name === "repository-scout.md");
          const scoutEscalation = fastEscalation({
            profile: "fast",
            kind: "triage",
            text: scoutArtifact?.content,
            ownedPaths: contract.ownedPaths,
          });
          if (scoutEscalation) await this._escalateProfile(id, scoutEscalation, "scouts");
        } else {
          await this._store.update(id, (draft) => {
            draft.scoutDispatch = {
              selected: [],
              skipped: scoutCatalog().map((scout) => scout.id),
              rationale: "Fast profile had no unresolved repository fact, so no scout model was invoked.",
              createdAt: now(),
              completedAt: now(),
            };
            draft.stageDispositions.scouts = {
              status: "not-required",
              reason:
                "No unresolved repository fact remained after bounded triage; zero scouts is the fast-path default.",
              decidedAt: now(),
            };
            draft.events.push(
              activity(
                "scouts",
                "Repository scouts not required",
                draft.stageDispositions.scouts.reason,
                "info",
                "decision",
              ),
            );
          });
        }
        task = await this._store.get(id);
        if (task.workflowProfile?.selected === "fast") {
          await this._store.update(id, (draft) => {
            draft.workPackages = [contract.workPackage];
            for (const [stage, reason] of Object.entries({
              synthesis:
                "A bounded fast change has one hypothesis by construction, so ranking competing diagnoses would cost a model call without changing the route.",
              grill:
                "Authoritative acceptance criteria contained no unresolved product decision, so Grill Me was not invoked.",
              specification:
                "The bounded fast change contract carries the acceptance criteria; a separate Specification model call is not required.",
              plan: "The bounded fast change contract defines exactly one package and its focused manifest command IDs; a separate Plan model call is not required.",
            })) {
              draft.stageDispositions[stage] = { status: "not-required", reason, decidedAt: now() };
              recordNodeSkipped(draft, stage, reason);
              draft.events.push(
                activity(stage, `${getStageMetadata(stage).label} not required`, reason, "info", "decision"),
              );
            }
            draft.status = "awaiting-plan-approval";
            draft.currentStage = "plan";
            draft.activeRunKind = null;
            draft.activeRunReservationId = null;
            draft.error = null;
            draft.events.push(
              activity(
                "plan",
                "Bounded fast change ready",
                "Approve the one-package contract or change the workflow profile before implementation.",
                "success",
                "decision",
              ),
            );
          });
          return;
        }
      }
    }

    task = await this._store.get(id);
    const stages = ["scouts", "synthesis", "grill"].filter((stage) => !task.completedStages.includes(stage));
    for (const stageId of stages) {
      if (signal.aborted) throw new Error("Codex run cancelled.");
      await this._reserveInvestigationStage(id, stageId);
      task = await this._store.get(id);
      if (stageId === "scouts") {
        await this._runScouts(id, task, signal);
        await this._store.update(id, (draft) => recordEdge(draft, "triage", "scouts"));
        continue;
      }
      if (stageId === "synthesis") {
        await this._runSynthesis(id, task, signal);
        continue;
      }
      const result = await this._executeAgent(task, stageId, signal, task.repositoryPath, "read-only");
      throwIfAborted(signal);
      const grillQuestions = parseGrillQuestions(result.finalText);
      await this._retainAgentResult(id, stageId, result, {
        replace: true,
        complete: grillQuestions.length === 0,
      });
      await this._store.update(id, (draft) => {
        recordEdge(draft, task.completedStages.includes("synthesis") ? "synthesis" : "scouts", "grill");
        draft.grillSession = {
          status: grillQuestions.length ? "open" : "completed",
          questions: grillQuestions,
          createdAt: now(),
          completedAt: grillQuestions.length ? null : now(),
          completionReason: grillQuestions.length
            ? null
            : "No material product decisions remained after repository investigation.",
          completionSource: grillQuestions.length ? null : "no-questions",
          policySnapshot: draft.grillPolicy ?? "manual",
          acceptedRecommendationCount: 0,
        };
      });
    }
    task = await this._store.get(id);
    if (task.grillSession?.status === "completed" && task.grillSession.questions.length === 0) {
      await this._store.update(id, (draft) => {
        draft.events.push(
          activity(
            "grill",
            "Grill Me completed automatically",
            draft.grillSession.completionReason,
            "success",
            "decision",
          ),
        );
      });
      await this._reserveInvestigationStage(id, "specification");
      await this._runSpecification(id, signal);
      return;
    }
    if (task.grillSession?.status === "open" && task.grillPolicy === "auto-accept-recommendations") {
      await this._store.update(id, (draft) => {
        completeGrillSession(draft, { source: "automation-policy", acceptRemaining: true });
      });
      await this._reserveInvestigationStage(id, "specification");
      await this._runSpecification(id, signal);
      return;
    }
    await this._store.update(id, (draft) => {
      draft.status = "awaiting-grill";
      draft.currentStage = "grill";
      draft.activeRunKind = null;
      draft.activeRunReservationId = null;
      const count = draft.grillSession?.questions.length ?? 0;
      draft.events.push(
        activity(
          "grill",
          "Grill Me ready",
          `${count} material question${count === 1 ? "" : "s"} need a decision.`,
          "success",
          "decision",
        ),
      );
    });
  }

  /**
   * Facts become a belief. The scouts produced a concatenated evidence report; this stage is
   * the first thing in the pipeline whose job is to decide what that evidence *means*, and it
   * is the only investigation stage whose output downstream stages read in place of the raw
   * aggregate.
   *
   * Read-only and fresh-context like every other investigation stage. The parsed contract is
   * authoritative; the Markdown retained alongside it is a rendering of that contract, so the
   * UI and the next agent can never disagree about what was concluded.
   */
  async _runSynthesis(id, task, signal) {
    const result = await this._executeAgent(task, "synthesis", signal, task.repositoryPath, "read-only");
    throwIfAborted(signal);
    const investigation = parseInvestigationResult(result.finalText);
    await this._retainAgentResult(
      id,
      "synthesis",
      { ...result, finalText: renderInvestigationResultMarkdown(investigation) },
      { replace: true, name: "investigation-synthesis.md", artifactTitle: "Investigation synthesis ready" },
    );
    await this._store.update(id, (draft) => {
      draft.investigation = investigation;
      recordEdge(draft, "scouts", "synthesis");
      const recommended = investigation.hypotheses.find(
        (hypothesis) => hypothesis.id === investigation.recommendedDiagnosis,
      );
      draft.events.push(
        activity(
          "synthesis",
          `${investigation.recommendedDiagnosis} at ${Math.round(recommended.confidence * 100)}% confidence`,
          `${recommended.claim} · ${Math.round(investigation.remainingUncertainty * 100)}% uncertainty remains across ${investigation.hypotheses.length} hypothes${investigation.hypotheses.length === 1 ? "is" : "es"}.`,
          "success",
          "agent",
        ),
      );
    });
  }

  async _reserveInvestigationStage(id, stageId) {
    const task = await this._store.get(id);
    const activeReservation = Object.values(task.stageRunReservations ?? {}).find(
      (entry) => entry?.id === task.activeRunReservationId,
    );
    if (activeReservation?.stage === stageId) {
      requireActiveRunReservation(task, "investigation", stageId);
      return;
    }
    if (
      task.status !== "running" ||
      task.activeRunKind !== "investigation" ||
      !activeReservation ||
      activeReservation.kind !== "investigation" ||
      (task.activeRunIds?.length ?? 0) > 0
    ) {
      throw new Error(`The ${stageId} investigation stage cannot reserve over inconsistent active state.`);
    }
    const priorReservationId = activeReservation.id;
    try {
      await this._store.transition(
        id,
        (draft) => {
          const currentReservation = Object.values(draft.stageRunReservations ?? {}).find(
            (entry) => entry?.id === draft.activeRunReservationId,
          );
          const attempts = draft.attemptsByStage?.[stageId] ?? 0;
          return (
            draft.status === "running" &&
            draft.activeRunKind === "investigation" &&
            currentReservation?.id === priorReservationId &&
            currentReservation.kind === "investigation" &&
            (draft.activeRunIds?.length ?? 0) === 0 &&
            attempts < stageRunLimitFor(draft, stageId)
          );
        },
        (draft) => {
          const reservation = createStageRunReservation(draft, "investigation", stageId);
          applyStageRunReservation(draft, reservation);
          draft.currentStage = stageId;
          draft.events.push(
            activity(
              stageId,
              `${getStageMetadata(stageId)?.label ?? stageId} attempt reserved`,
              `Workflow attempt ${reservation.workflowAttempt} is bound to ${reservation.id}.`,
              "info",
              "agent",
            ),
          );
        },
      );
    } catch (error) {
      if (error.code === "TASK_TRANSITION_CONFLICT") {
        throw new Error(
          `The ${stageId} investigation stage has exhausted its retry allowance or changed before reservation.`,
        );
      }
      throw error;
    }
  }

  async _runScouts(id, task, signal) {
    const triageArtifact = [...task.artifacts].reverse().find((artifact) => artifact.stage === "triage");
    const selection = selectScoutDispatch(task, triageArtifact?.content ?? "");
    const dispatch = selection.selected;
    await this._store.update(id, (draft) => {
      removeStageArtifacts(draft, "scouts");
      const reservation = requireActiveRunReservation(draft, "investigation", "scouts");
      reservation.authorizedRunScopes = dispatch.map((spec) => spec.name);
      draft.scoutDispatch = {
        selected: dispatch.map((spec) => ({ ...spec, status: "queued" })),
        skipped: scoutCatalog()
          .filter((scout) => !dispatch.some((spec) => spec.name === scout.id))
          .map((scout) => scout.id),
        rationale: selection.rationale,
        createdAt: now(),
        completedAt: null,
      };
      draft.events.push(
        activity(
          "scouts",
          "Scout dispatch selected",
          `${dispatch.length} selected · ${selection.rationale}`,
          "info",
          "agent",
        ),
      );
    });

    const reports = await Promise.all(
      dispatch.map(async (spec) => {
        try {
          const request = buildScoutRequest(task, spec, triageArtifact);
          const result = await this._executeAgent(
            task,
            "scouts",
            signal,
            task.repositoryPath,
            "read-only",
            null,
            request,
            `${spec.name} scout`,
            "scouts",
            null,
            spec.name,
          );
          const report = parseScoutReport(result.finalText);
          await this._retainAgentResult(
            id,
            "scouts",
            { ...result, finalText: scoutReportMarkdown(spec, report) },
            {
              complete: false,
              replace: false,
              name: `${spec.name}.md`,
              artifactTitle: `${spec.name} report ready`,
              agentRole: spec.name,
            },
          );
          await this._store.update(id, (draft) => {
            const selected = draft.scoutDispatch?.selected.find((entry) => entry.name === spec.name);
            if (selected) selected.status = "complete";
          });
          return { spec, report, status: "ok" };
        } catch (error) {
          await this._store.update(id, (draft) => {
            const selected = draft.scoutDispatch?.selected.find((entry) => entry.name === spec.name);
            if (selected) {
              selected.status = "failed";
              selected.error = error.message;
            }
            draft.events.push(activity("scouts", `${spec.name} failed`, error.message, "warning", "agent"));
          });
          return { spec, status: "error", error: error.message, report: { findings: [], uncertainties: [] } };
        }
      }),
    );
    throwIfAborted(signal);
    const successful = reports.filter((entry) => entry.status === "ok").length;
    const required = dispatch.length === 0 ? 0 : Math.max(1, dispatch.length - 1);
    const aggregate = aggregateScoutReports(dispatch, reports);
    await this._retainAgentResult(
      id,
      "scouts",
      {
        finalText: aggregate,
        usage: { inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0, totalTokens: 0 },
        runtimeEvents: [],
        model: "deterministic-aggregation",
        reasoning: null,
        contextManifest: {
          stage: "scouts",
          promptCharacters: 0,
          estimatedPromptTokens: 0,
          repositoryAccess: "read-only",
          policy:
            "Deterministic aggregation of selected scout reports; no additional model or repository access.",
          sources: reports
            .filter((entry) => entry.status === "ok")
            .map((entry) => ({
              kind: "artifact",
              id: entry.spec.name,
              label: `${entry.spec.name}.md`,
              stage: "scouts",
              includedCharacters: null,
              originalCharacters: null,
              truncated: false,
            })),
        },
      },
      {
        complete: successful >= required,
        replace: false,
        name: "repository-scout.md",
        artifactTitle: "Scout evidence aggregated",
      },
    );
    await this._store.update(id, (draft) => {
      if (draft.scoutDispatch) draft.scoutDispatch.completedAt = now();
    });
    if (successful < required) {
      throw new Error(
        `Scout coverage was incomplete: ${successful} of ${dispatch.length} selected scouts completed; ${required} required.`,
      );
    }
  }
}
