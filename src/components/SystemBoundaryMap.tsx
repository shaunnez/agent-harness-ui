import type { Icon } from "@phosphor-icons/react";
import { Checks, Desktop, GithubLogo, GitBranch, Robot, User } from "@phosphor-icons/react";
import type { RuntimeStatus } from "../domain";
import { useRepositoryContract } from "./RepositoryContractPanel";

interface BoundaryNode {
  label: string;
  detail: string;
  status: string;
  tone: "ready" | "conditional" | "attention";
  icon: Icon;
}

export function SystemBoundaryMap({ runtimeStatus }: { runtimeStatus: RuntimeStatus | null }) {
  const repositoryPath = runtimeStatus?.suggestedRepository ?? "";
  const { contract, loading, error } = useRepositoryContract(repositoryPath);
  const providerReady = Boolean(runtimeStatus?.available && runtimeStatus.authenticated);
  const nodes: BoundaryNode[] = [
    {
      label: "Operator",
      detail: "Approves decisions and the exact candidate",
      status: "Human authority",
      tone: "ready",
      icon: User,
    },
    {
      label: "Local companion",
      detail: "Loopback API and transactional task state",
      status: runtimeStatus?.available ? "Available" : "Offline",
      tone: runtimeStatus?.available ? "ready" : "attention",
      icon: Desktop,
    },
    {
      label: "Model session",
      detail: "ChatGPT-authenticated Codex CLI; no API key",
      status: providerReady ? "Authenticated" : "Unavailable",
      tone: providerReady ? "ready" : "attention",
      icon: Robot,
    },
    {
      label: "Isolated worktree",
      detail: "Created only after an approved implementation plan",
      status: "On demand",
      tone: "conditional",
      icon: GitBranch,
    },
    {
      label: "Verification",
      detail: contract?.verification.valid
        ? `${contract.verification.commandIds.length} repository-owned command${contract.verification.commandIds.length === 1 ? "" : "s"}`
        : (error ?? "Waiting for a valid verification manifest"),
      status: loading ? "Inspecting" : contract?.verification.valid ? "Declared" : "Setup required",
      tone: contract?.verification.valid ? "ready" : "attention",
      icon: Checks,
    },
    {
      label: "GitHub PR",
      detail: contract?.delivery.github
        ? (contract.delivery.remoteUrl ?? "GitHub origin")
        : "A GitHub origin remote is required",
      status: loading ? "Inspecting" : contract?.delivery.github ? "Configured" : "Unavailable",
      tone: contract?.delivery.github ? "ready" : "attention",
      icon: GithubLogo,
    },
  ];

  return (
    <section className="system-boundary" aria-labelledby="system-boundary-title">
      <header>
        <div>
          <h3 id="system-boundary-title">Execution boundary</h3>
          <p>What can act, where code may change, and which evidence must exist before delivery.</p>
        </div>
        <code>{contract?.repositoryRoot ?? (repositoryPath || "Repository not selected")}</code>
      </header>
      <ol>
        {nodes.map(({ icon: Icon, ...node }) => (
          <li className={`system-boundary__node system-boundary__node--${node.tone}`} key={node.label}>
            <span className="system-boundary__icon">
              <Icon size={20} weight="duotone" />
            </span>
            <span>
              <strong>{node.label}</strong>
              <small>{node.detail}</small>
            </span>
            <em>{node.status}</em>
          </li>
        ))}
      </ol>
    </section>
  );
}
