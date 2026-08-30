import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer as createViteServer } from "vite";
import {
  buildCodexSpawnArgs,
  buildCodexEnvironment,
  DEFAULT_MODEL,
  DEFAULT_REASONING,
  parseCodexEvent,
  ProcessTimeoutError,
  runProcess,
  selectCodexCandidate,
} from "../server/codex-runtime.mjs";
import {
  hasExecutionProvider,
  listExecutionProviders,
  resolveExecutionProvider,
} from "../server/execution-providers.mjs";
import {
  DEFAULT_RUN_LABEL,
  DEFAULT_STDOUT_BUDGET,
  isProcessTimeoutError,
  ProcessTimeoutError as SharedProcessTimeoutError,
  runProcess as sharedRunProcess,
} from "../server/process-runtime.mjs";
import {
  normalizeModelId,
  priceUsage,
  readCodexModelCatalog,
  withConfiguredModels,
} from "../server/model-catalog.mjs";
import {
  buildExecutionRequest,
  buildRepairRequest,
  buildStageRequest,
  buildWorkPackageRequest,
} from "../server/prompts.mjs";
import { buildScoutRequest } from "../server/scouts.mjs";
import { JsonTaskStore } from "../server/store.mjs";
import { TaskOrchestrator } from "./orchestrator-test-support.mjs";
import { parseGateEvidence } from "../server/structured-output.mjs";
import { runtimeTaskToRecentTask } from "../src/domain.ts";

function attachRepairAuthorizerFixture(draft, candidate, findings = null) {
  const reservationId = `reservation-${candidate.id.toLowerCase()}-repair-authorizer-1`;
  const runId = `run-${reservationId}`;
  const artifactId = `artifact-${reservationId}`;
  const gateFindings = findings ?? [
    {
      severity: "P1",
      title: "Repair required",
      detail: "The exact candidate requires a repair.",
      file: "server/orchestrator.mjs",
      line: 1,
      candidateId: candidate.id,
      candidateRevision: candidate.revisionNumber,
      bindingExplicit: true,
    },
  ];
  const gateResult = {
    schemaVersion: 1,
    stage: "dev-review",
    verdict: "REPAIR",
    reportedVerdict: "REPAIR",
    candidateId: candidate.id,
    candidateRevision: candidate.revisionNumber,
    evaluatedAt: "2026-08-01T12:00:03.000Z",
    blockingReasons: ["P1: exact candidate repair is required."],
    findings: gateFindings,
  };
  draft.attemptsByStage ??= {};
  draft.attemptsByStage["dev-review"] = 1;
  draft.stageRunReservations ??= {};
  draft.stageRunReservations["dev-review"] = {
    id: reservationId,
    stage: "dev-review",
    kind: "review",
    workflowAttempt: 1,
    candidateId: candidate.id,
    candidateRevision: candidate.revisionNumber,
    candidateHeadRevision: candidate.headRevision,
    authorizedRunScopes: [],
    reservedAt: "2026-08-01T12:00:00.000Z",
  };
  draft.runs = (draft.runs ?? []).filter((run) => run.id !== runId);
  draft.runs.push({
    id: runId,
    artifactId,
    kind: "review",
    stage: "dev-review",
    role: "dev-review",
    status: "completed",
    startedAt: "2026-08-01T12:00:01.000Z",
    completedAt: "2026-08-01T12:00:02.000Z",
    candidateId: candidate.id,
    candidateRevision: candidate.revisionNumber,
    candidateHeadRevision: candidate.headRevision,
    workPackageId: null,
    attempt: 1,
    workflowAttempt: 1,
    workflowReservationId: reservationId,
    gateResult,
  });
  draft.artifacts = (draft.artifacts ?? []).filter((artifact) => artifact.id !== artifactId);
  draft.artifacts.push({
    id: artifactId,
    runId,
    stage: "dev-review",
    name: "dev-review.md",
    kind: "markdown",
    content: "# Development review\n\nTyped repair evidence.",
    createdAt: "2026-08-01T12:00:04.000Z",
    candidateId: candidate.id,
    candidateRevision: candidate.revisionNumber,
    workPackageId: null,
    gateResult,
  });
}

async function waitUntil(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for condition.");
}

function createTask(overrides = {}) {
  const now = "2026-08-01T12:00:00.000Z";
  return {
    id: "AH-999",
    title: "Approval history",
    description: "Render approval history in the inspector.",
    repositoryPath: "C:/repo/task",
    workflow: "implement",
    priority: "medium",
    status: "awaiting-spec-approval",
    currentStage: "specification",
    completedStages: [],
    stageRun: 1,
    stageRunLimit: 3,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
    error: null,
    activeRunKind: null,
    activeRunIds: [],
    attemptsByStage: {},
    models: [{ provider: "openai", model: "GPT-5.4-mini" }],
    usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2, cost: null },
    artifacts: [],
    decisions: [],
    grillSession: null,
    approvals: [],
    workPackages: [],
    candidates: [],
    runs: [],
    events: [],
    ...overrides,
  };
}

function makeGateFreshness(
  stage,
  {
    fresh = false,
    sourceRunId = null,
    sourceArtifactId = null,
    candidateId = "C1",
    candidateRevision = 2,
    reasonCode = fresh ? "fresh" : "missing_authoritative_summary",
    reasonCopy = fresh
      ? "The latest terminal run is authoritative for the active candidate."
      : "No authoritative persisted terminal run summary is available for this gate.",
    focusedTest = null,
  } = {},
) {
  const reason = { code: reasonCode, copy: reasonCopy };
  return {
    stage,
    candidateId,
    candidateRevision,
    target: { candidateId, candidateRevision },
    state: fresh ? "fresh" : "stale",
    fresh,
    sourceRunId,
    sourceArtifactId,
    reasonCode,
    reasonCopy,
    reason,
    staleReasonCode: fresh ? null : reasonCode,
    staleReasonCopy: fresh ? null : reasonCopy,
    staleReason: fresh ? null : reason,
    focusedTest,
    focusedTestRows: focusedTest?.rows ?? [],
  };
}

async function withWorkspace(run) {
  const vite = await createViteServer({
    configFile: false,
    logLevel: "error",
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false },
  });
  try {
    const module = await vite.ssrLoadModule("/src/components/RuntimeTaskWorkspace.tsx");
    const candidateDiffViewer = await vite.ssrLoadModule("/src/components/CandidateDiffViewer.tsx");
    const runActivity = await vite.ssrLoadModule("/src/components/RunActivity.tsx");
    const runtimeInspector = await vite.ssrLoadModule("/src/components/runtime/RuntimeInspectorPanels.tsx");
    const runtimeWorkflow = await vite.ssrLoadModule("/src/components/runtime/workflow.ts");
    const runtimeCommandBar = await vite.ssrLoadModule("/src/components/runtime/RuntimeCommandBar.tsx");
    const runtimeStageLimits = await vite.ssrLoadModule("/src/runtime-stage-limits.ts");
    const requestIdentity = await vite.ssrLoadModule("/src/requestIdentity.ts");
    const artifactPresentation = await vite.ssrLoadModule("/src/artifactPresentation.ts");
    const libraryShared = await vite.ssrLoadModule("/src/components/LibraryShared.tsx");
    const skillsScreen = await vite.ssrLoadModule("/src/components/SkillsScreen.tsx");
    const agentsScreen = await vite.ssrLoadModule("/src/components/AgentsScreen.tsx");
    const commandCentre = await vite.ssrLoadModule("/src/components/CommandCentre.tsx");
    return await run({
      ...module,
      ...candidateDiffViewer,
      ...runActivity,
      ...runtimeInspector,
      ...runtimeWorkflow,
      ...runtimeCommandBar,
      ...runtimeStageLimits,
      ...requestIdentity,
      ...artifactPresentation,
      ...libraryShared,
      ...skillsScreen,
      ...agentsScreen,
      ...commandCentre,
      loadApiModule: () => vite.ssrLoadModule("/src/api.ts"),
    });
  } finally {
    await vite.close();
  }
}

export {
  DEFAULT_MODEL,
  DEFAULT_REASONING,
  DEFAULT_RUN_LABEL,
  DEFAULT_STDOUT_BUDGET,
  JsonTaskStore,
  ProcessTimeoutError,
  React,
  SharedProcessTimeoutError,
  TaskOrchestrator,
  access,
  assert,
  attachRepairAuthorizerFixture,
  buildCodexEnvironment,
  buildCodexSpawnArgs,
  buildExecutionRequest,
  buildRepairRequest,
  buildScoutRequest,
  buildStageRequest,
  buildWorkPackageRequest,
  createTask,
  createViteServer,
  hasExecutionProvider,
  isProcessTimeoutError,
  listExecutionProviders,
  makeGateFreshness,
  mkdtemp,
  normalizeModelId,
  os,
  parseCodexEvent,
  parseGateEvidence,
  path,
  priceUsage,
  readCodexModelCatalog,
  readFile,
  renderToStaticMarkup,
  resolveExecutionProvider,
  rm,
  runProcess,
  runtimeTaskToRecentTask,
  selectCodexCandidate,
  sharedRunProcess,
  waitUntil,
  withConfiguredModels,
  withWorkspace,
  writeFile,
};
