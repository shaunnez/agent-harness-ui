import { CheckCircle, WarningCircle } from "@phosphor-icons/react";
import type { RuntimeRepositoryContract } from "../../domain";

export function RepositoryReadiness({ contract }: { contract: RuntimeRepositoryContract }) {
  const checks = [
    {
      label: "Git repository",
      ready: true,
      detail: `${contract.git.branch} · ${contract.git.headRevision.slice(0, 12)}${contract.git.clean ? " · clean" : " · local changes present"}`,
    },
    {
      label: "Project instructions",
      ready: contract.instructions.present,
      detail: contract.instructions.present
        ? contract.instructions.path
        : "No AGENTS.md at the repository root",
    },
    {
      label: "Verification manifest",
      ready: contract.verification.valid,
      detail: contract.verification.valid
        ? contract.verification.commandIds.join(", ")
        : contract.verification.error || "Set up verification before implementing tasks",
    },
    {
      label: "GitHub delivery",
      ready: contract.delivery.github,
      detail: contract.delivery.remoteUrl ?? "No GitHub remote detected",
    },
  ];
  return (
    <div className="repository-readiness">
      <h3>Repository readiness</h3>
      {checks.map((check) => (
        <div key={check.label}>
          {check.ready ? (
            <CheckCircle size={21} className="ready-icon" />
          ) : (
            <WarningCircle size={21} className="waiting-icon" />
          )}
          <span>
            <strong>{check.label}</strong>
            <small>{check.detail}</small>
          </span>
        </div>
      ))}
      {contract.runtime.declarations.length > 0 && (
        <p className="quiet">
          {contract.runtime.declarations.map((entry) => `${entry.source}: ${entry.value}`).join(" · ")}
        </p>
      )}
    </div>
  );
}
