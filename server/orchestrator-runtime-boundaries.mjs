import path from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { buildOnboardingRequest } from "./prompts.mjs";
import { resolveExecutionProvider } from "./execution-providers.mjs";
import {
  CREDIT_SOURCE_URL,
  enrichUsage,
  PRICING_SOURCE_URL,
  providerForModelId,
  readExecutionProviderCatalog,
  validatePricingRates,
  withConfiguredModels,
} from "./model-catalog.mjs";
import { scoutCatalog } from "./scouts.mjs";
import { DEFAULT_EXECUTION_PROVIDER } from "./run-activity.mjs";
import {
  discoverVerificationEvidence,
  OnboardingError,
  parseOnboardingProposal,
  renderManifestFile,
  VERIFICATION_MANIFEST_PATH,
} from "./onboarding.mjs";
import { gitHeadRevision } from "./verification.mjs";

import { OrchestratorRuntimeBase } from "./orchestrator-runtime-base.mjs";
import { now } from "./orchestrator-stage-support.mjs";
import { throwIfAborted } from "./orchestrator-run-policy.mjs";

export class RuntimeBoundariesOrchestrator extends OrchestratorRuntimeBase {
  _qualifyPackage(input) {
    const run = () => {
      throwIfAborted(input.signal);
      return this._runPackageVerification(input);
    };
    const pending = this._packageVerificationQueue.then(run, run);
    this._packageVerificationQueue = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }

  /**
   * Dispatch one agent run to the named execution provider.
   *
   * `options.runCodex` remains an honoured injection point and overrides the
   * resolved provider entirely, which is what keeps the existing runtime tests
   * driving the orchestrator without knowing the seam exists.
   */

  _runAgent(providerId, request) {
    if (this._runCodex) return this._runCodex(request);
    return resolveExecutionProvider(providerId).run(request);
  }

  /**
   * The seam's teeth. A provider that reports anything weaker than an OS-enforced
   * sandbox for this posture gets the harness's own verification *required*, and the
   * stage refuses to run when that verification is not wired. A provider whose
   * confinement is one OS-level guarantee is verified anyway where the hook exists —
   * both additions strengthen existing checks — but is not blocked by its absence,
   * which is what lets an injected partial worktree manager keep working.
   */

  _requiresHarnessConfinement(providerId, sandbox) {
    if (this._runCodex) return false;
    const provider = resolveExecutionProvider(providerId);
    return provider.capabilities().sandboxes?.[sandbox] !== "os-enforced";
  }

  /**
   * Refuse a stage the provider cannot confine, before anything is spawned.
   *
   * A posture the provider does not list is unavailable, not weakly available —
   * this is what keeps `workspace-write` on Codex. And a provider whose confinement
   * is verified by the harness rather than by the OS must demonstrate it on *this*
   * host: the layered posture depends on mechanisms a CLI release can change without
   * a changelog entry the harness reads, so configuration is not evidence.
   *
   * A provider may also refuse on host capacity rather than on confinement. That
   * refusal runs first and is not overridable: it names what the operator must do, and
   * a stage that cannot exec a shell would produce unverifiable evidence at best. Its
   * check is racy by construction — the exec-argument budget is per repository, so a
   * concurrent task can consume the headroom after this returns — which is why the
   * mid-run shell-start guard stays as well.
   */

  async _assertProviderConfinement(providerId, sandbox, networkAccess = false, cwd = null) {
    if (this._runCodex) return;
    const provider = resolveExecutionProvider(providerId);
    const capabilities = provider.capabilities();
    const posture = capabilities.sandboxes?.[sandbox];
    if (!posture) {
      throw new Error(
        `${provider.label} does not support the ${sandbox} sandbox, so this stage cannot run on it.`,
      );
    }
    if (networkAccess && !capabilities.grantsNetworkAccess) {
      throw new Error(
        `${provider.label} cannot grant the network access this stage requires, so it cannot run on it.`,
      );
    }
    if (typeof provider.preflight === "function") {
      const budget = await provider.preflight({ sandbox, cwd });
      if (budget && budget.ok === false) throw new Error(budget.refusal ?? budget.detail);
    }
    if (capabilities.confinementVerifiedBy !== "harness") return;
    if (typeof provider.canary !== "function") {
      throw new Error(
        `${provider.label} reports ${posture} confinement but provides no way to verify it on this host.`,
      );
    }
    const canary = await provider.canary({ sandbox, cwd });
    if (!canary?.passed) {
      throw new Error(
        `${provider.label} ${sandbox} confinement is not established on this host: ${canary?.detail ?? "the sandbox canary did not pass."}`,
      );
    }
  }

  async _snapshotSource(providerId, cwd, sandbox) {
    const available =
      typeof this._worktrees.snapshotRepository === "function" &&
      typeof this._worktrees.assertRepositoryUnchanged === "function";
    const snapshot = available ? await this._worktrees.snapshotRepository(cwd) : null;
    if (snapshot) return snapshot;
    // Unverifiable. A provider whose confinement is one OS-level guarantee proceeds
    // exactly as it does today; a provider relying on the harness as its enforcement
    // of record refuses rather than running unverified.
    if (this._requiresHarnessConfinement(providerId, sandbox)) {
      throw new Error(
        `A ${sandbox} stage on this provider requires source-repository verification, and ${cwd} cannot be verified.`,
      );
    }
    return null;
  }

  async status() {
    const [runtime, settings] = await Promise.all([this._getStatus(), this._store.settings()]);
    // Every provider's models, so the picker can offer a Claude model for one stage and
    // a Codex model for another with each model's own reasoning levels.
    const catalog = runtime.catalog ? await readExecutionProviderCatalog() : runtime.catalog;
    return {
      ...runtime,
      catalog: withConfiguredModels(catalog, settings),
      model: settings.defaultModel,
      reasoning: settings.defaultReasoning,
      settings,
      scouts: scoutCatalog(),
    };
  }

  /**
   * Propose a verification manifest for a repository that has none.
   *
   * Read-only and operator-initiated. Nothing here is reachable from a stage: if a failing test
   * stage could ask for a new manifest, a failing candidate could clear itself by having a model
   * rewrite its own verification commands, which is exactly what #47 removed. The proposal is
   * returned for approval; it is not written.
   */

  async proposeOnboarding(repositoryPath) {
    const repositoryRoot = await this._worktrees.repositoryRoot(repositoryPath);
    const existing = await readFile(path.join(repositoryRoot, VERIFICATION_MANIFEST_PATH), "utf8").catch(
      () => null,
    );
    const evidence = await discoverVerificationEvidence(repositoryRoot);
    const settings = await this._store.settings();
    // The provider follows the model, never a constant. `verifyPricing` is pinned to Codex on
    // purpose (#27, it hard-requires GPT-5.6 ids); copying that shape here was wrong, because
    // this call uses the operator's *default* model, and Codex rejects a model it does not own
    // with "not supported when using Codex with a ChatGPT account".
    const provider =
      providerForModelId(settings.defaultModel) ?? settings.defaultProvider ?? DEFAULT_EXECUTION_PROVIDER;
    const result = await this._runAgent(provider, {
      cwd: repositoryRoot,
      prompt: buildOnboardingRequest(repositoryRoot, evidence).prompt,
      sandbox: "read-only",
      model: settings.defaultModel,
      reasoning: settings.defaultReasoning,
      // 300s was not enough for a real repository at the operator's default reasoning effort: the
      // run is a read-only exploration of a whole codebase, and it timed out with nothing to show
      // for the call. A timeout here wastes an operator-initiated, paid call and teaches nothing,
      // whereas the run itself is bounded by having a single artifact to produce.
      timeoutMs: 900_000,
    });
    const proposal = parseOnboardingProposal(result.finalText, evidence);
    return {
      repositoryRoot,
      evidence,
      proposal,
      alreadyOnboarded: existing != null,
      manifestPath: VERIFICATION_MANIFEST_PATH,
      manifestPreview: proposal.determined
        ? renderManifestFile(proposal, { model: settings.defaultModel, at: now() })
        : null,
      usage: enrichUsage(
        settings.defaultModel,
        result.usage,
        settings.pricing?.rates,
        settings.pricing?.version,
      ),
    };
  }

  /**
   * Write an approved manifest, confirm its commands actually run, then commit.
   *
   * The confirmation is not ceremony: a manifest that does not execute converts a configuration
   * error into a per-task failure, so the harness must not commit one it has never seen work. A
   * failed confirmation removes the file and reports, leaving the repository as it was.
   *
   * This runs repository commands unsandboxed with the harness's privileges — the same trade #47
   * documents — and only ever after an explicit approval from the operator.
   */

  async approveOnboarding(repositoryPath, proposal, options = {}) {
    if (!proposal?.determined) throw new OnboardingError("An undetermined proposal cannot be approved.");
    const repositoryRoot = await this._worktrees.repositoryRoot(repositoryPath);
    const settings = await this._store.settings();
    const target = path.join(repositoryRoot, VERIFICATION_MANIFEST_PATH);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(
      target,
      renderManifestFile(proposal, { model: options.model ?? settings.defaultModel, at: now() }),
      "utf8",
    );
    try {
      const confirmation = await this._runVerification({
        worktreePath: repositoryRoot,
        candidate: {
          id: "onboarding",
          revisionNumber: 1,
          headRevision: await gitHeadRevision(repositoryRoot),
        },
      });
      if (confirmation.status !== "passed") {
        throw new OnboardingError(
          `The approved commands did not pass in this repository, so the manifest was not committed: ` +
            `${confirmation.rows
              .filter((row) => row.status !== "passed")
              .map((row) => row.command)
              .join(", ")}.`,
        );
      }
      return { repositoryRoot, manifestPath: VERIFICATION_MANIFEST_PATH, confirmation };
    } catch (error) {
      // The repository is left exactly as it was. A half-onboarded repository whose manifest has
      // never run is worse than one that still refuses, because the refusal is honest.
      await rm(target, { force: true });
      throw error;
    }
  }

  async verifyPricing() {
    const settings = await this._store.settings();
    // Pricing verification prompts for OpenAI rates and `validatePricingRates`
    // hard-requires the GPT-5.6 ids, so it stays pinned to Codex until it is
    // provider-scoped with its own required-id set.
    const result = await this._runAgent(DEFAULT_EXECUTION_PROVIDER, {
      cwd: process.cwd(),
      prompt: `You are verifying a local GPT-5.6 pricing registry. Use current official OpenAI documentation only: API prices from ${PRICING_SOURCE_URL} and ChatGPT/Codex credit rates from ${CREDIT_SOURCE_URL}. Do not modify files. Return exactly one JSON object between <pricing-rates> and </pricing-rates>. Include gpt-5.6-sol, gpt-5.6-terra, and gpt-5.6-luna. Each value must have short and, when documented, long objects with numeric input, cachedInput, cacheWrite (or null), and output USD prices per 1M tokens. Do not include prose inside the tags.`,
      sandbox: "read-only",
      model: settings.defaultModel,
      reasoning: "low",
      timeoutMs: 180_000,
    });
    const match = result.finalText.match(/<pricing-rates>\s*([\s\S]*?)\s*<\/pricing-rates>/i);
    if (!match) throw new Error("The pricing verifier did not return the required structured rate card.");
    const rates = validatePricingRates(JSON.parse(match[1]));
    const updated = await this._store.updateSettings((draft) => {
      draft.pricing = {
        version: new Date().toISOString().slice(0, 10),
        sourceUrl: PRICING_SOURCE_URL,
        verifiedAt: now(),
        verifiedBy: `${settings.defaultModel} read-only verification agent`,
        rates: { ...draft.pricing.rates, ...rates },
        creditRates: draft.pricing.creditRates,
        creditSourceUrl: draft.pricing.creditSourceUrl ?? CREDIT_SOURCE_URL,
      };
    });
    return {
      settings: updated,
      usage: enrichUsage(settings.defaultModel, result.usage, updated.pricing.rates, updated.pricing.version),
    };
  }
}
