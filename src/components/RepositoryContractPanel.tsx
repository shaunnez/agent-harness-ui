import {
  CheckCircle,
  FileText,
  GithubLogo,
  GitBranch,
  SpinnerGap,
  TerminalWindow,
  WarningCircle,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { getRepositoryContract } from "../api";
import type { RuntimeRepositoryContract } from "../domain";

function isAbsolutePath(value: string) {
  return value.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(value);
}

export function useRepositoryContract(repositoryPath: string) {
  const [contract, setContract] = useState<RuntimeRepositoryContract | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const target = repositoryPath.trim();
    setContract(null);
    setError(null);
    if (!isAbsolutePath(target)) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      void getRepositoryContract(target)
        .then((next) => {
          if (!cancelled) setContract(next);
        })
        .catch((reason) => {
          if (!cancelled)
            setError(reason instanceof Error ? reason.message : "Repository inspection failed.");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [repositoryPath]);

  return { contract, loading, error };
}

function ContractRow({
  icon: Icon,
  label,
  detail,
  state,
}: {
  icon: typeof GitBranch;
  label: string;
  detail: string;
  state: "ready" | "attention";
}) {
  return (
    <li>
      <Icon size={16} aria-hidden />
      <span>
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
      <span className={`repository-contract__state repository-contract__state--${state}`}>
        {state === "ready" ? (
          <CheckCircle size={15} weight="fill" />
        ) : (
          <WarningCircle size={15} weight="fill" />
        )}
        {state === "ready" ? "Discovered" : "Needs setup"}
      </span>
    </li>
  );
}

export function RepositoryContractPanel({ repositoryPath }: { repositoryPath: string }) {
  const { contract, loading, error } = useRepositoryContract(repositoryPath);
  const runtimeDetail = contract?.runtime.declarations.length
    ? contract.runtime.declarations.map((item) => `${item.source}: ${item.value}`).join(" · ")
    : "No Node runtime declaration found";
  const verificationDetail = contract?.verification.valid
    ? `${contract.verification.path} · ${contract.verification.commandIds.join(", ")}`
    : (contract?.verification.error ??
      `${contract?.verification.path ?? ".agent-harness/verification.json"} is not configured`);

  return (
    <section className="repository-contract" aria-label="Repository contract" aria-live="polite">
      <header>
        <span>
          <strong>Repository contract</strong>
          <small>Read-only discovery before task creation</small>
        </span>
        {loading ? (
          <span className="repository-contract__loading">
            <SpinnerGap size={15} className="spin" /> Inspecting
          </span>
        ) : null}
      </header>
      {!repositoryPath.trim() || !isAbsolutePath(repositoryPath.trim()) ? (
        <p>
          Choose an absolute repository path to inspect its instructions, verification, runtime, and delivery
          boundary.
        </p>
      ) : error ? (
        <p className="repository-contract__error">
          <WarningCircle size={15} /> {error}
        </p>
      ) : contract ? (
        <ul>
          <ContractRow
            icon={GitBranch}
            label={`${contract.git.branch} · ${contract.git.clean ? "clean" : "local changes"}`}
            detail={`${contract.git.headRevision.slice(0, 10)} · ${contract.repositoryRoot}`}
            state="ready"
          />
          <ContractRow
            icon={FileText}
            label="Repository instructions"
            detail={
              contract.instructions.present
                ? contract.instructions.path
                : `${contract.instructions.path} not found at repository root`
            }
            state={contract.instructions.present ? "ready" : "attention"}
          />
          <ContractRow
            icon={TerminalWindow}
            label="Verification commands"
            detail={verificationDetail}
            state={contract.verification.valid ? "ready" : "attention"}
          />
          <ContractRow
            icon={TerminalWindow}
            label="Runtime declaration"
            detail={runtimeDetail}
            state={contract.runtime.declarations.length ? "ready" : "attention"}
          />
          <ContractRow
            icon={GithubLogo}
            label="GitHub delivery"
            detail={contract.delivery.remoteUrl ?? "No origin remote configured"}
            state={contract.delivery.github ? "ready" : "attention"}
          />
        </ul>
      ) : null}
    </section>
  );
}
