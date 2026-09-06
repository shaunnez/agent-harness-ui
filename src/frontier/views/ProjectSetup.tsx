import { ArrowRight, Buildings, CheckCircle } from "@phosphor-icons/react";
import { useState } from "react";
import type { RuntimeProject, RuntimeRepositoryContract } from "../../domain";
import type { OnboardingReview } from "../../domain/onboarding";
import type { FrontierGateway } from "../runtime/contracts";
import { errorMessage } from "../runtime/coordinator";
import { RepositoryReadiness } from "./RepositoryReadiness";

export function ProjectSetup({
  project,
  gateway,
  connected,
  busy,
  error,
  command,
  onDone,
  onClose,
}: {
  project?: RuntimeProject;
  gateway: FrontierGateway;
  connected: boolean;
  busy: boolean;
  error: string | null;
  command(action: () => Promise<unknown>, then?: () => void): Promise<void>;
  onDone(): void;
  onClose(): void;
}) {
  const [name, setName] = useState(project?.name ?? "");
  const [path, setPath] = useState(project?.repositoryPath ?? "");
  const [contract, setContract] = useState<RuntimeRepositoryContract | null>(null);
  const [review, setReview] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [proposal, setProposal] = useState<OnboardingReview | null>(null);
  const [confirmedCommands, setConfirmedCommands] = useState(false);
  const [archiveReview, setArchiveReview] = useState(false);
  const registered = project && !project.id.startsWith("suggested:");
  const canSave = Boolean(name.trim() && contract && !busy && !checking && connected);
  async function validate() {
    if (checking) return;
    setChecking(true);
    setLocalError(null);
    try {
      const next = await gateway.repository(path.trim());
      setContract(next);
      setPath(next.repositoryRoot);
      setReview(true);
    } catch (reason) {
      setLocalError(errorMessage(reason));
    } finally {
      setChecking(false);
    }
  }
  async function propose() {
    if (!contract || checking) return;
    setChecking(true);
    setLocalError(null);
    try {
      setProposal(await gateway.proposeSetup(contract.repositoryRoot));
      setConfirmedCommands(false);
    } catch (reason) {
      setLocalError(errorMessage(reason));
    } finally {
      setChecking(false);
    }
  }
  return (
    <>
      <div className="overlay-body project-setup-layout">
        <section className="form-surface">
          <div className="form-progress">
            <span className={!review ? "current" : ""}>1 · Repository</span>
            <ArrowRight size={18} />
            <span className={review ? "current" : ""}>2 · Review setup</span>
          </div>
          <form
            id="project-setup-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!review) void validate();
              else if (canSave)
                void command(
                  () =>
                    registered
                      ? gateway.changeProject(project.id, { kind: "rename", name: name.trim() })
                      : gateway.createProject({
                          name: name.trim(),
                          repositoryPath: contract?.repositoryRoot ?? path,
                        }),
                  onDone,
                );
            }}
          >
            <label className="form-row">
              <span>Project name</span>
              <input
                required
                maxLength={120}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="My project"
              />
            </label>
            <label className="form-row">
              <span>Repository path</span>
              <input
                required
                disabled={Boolean(registered) || checking}
                value={path}
                onChange={(event) => {
                  setPath(event.target.value);
                  setContract(null);
                  setReview(false);
                  setProposal(null);
                }}
                placeholder="/Users/you/projects/my-project"
              />
            </label>
            <p className="quiet">
              {registered
                ? "The repository and project identity are fixed. Renaming preserves tasks and history."
                : "Connect an existing local Git repository. The runtime verifies the path before registration."}
            </p>
            {contract && <RepositoryReadiness contract={contract} />}
          </form>
          {contract && !contract.verification.valid && (
            <section className="setup-verification">
              <h3>Set up verification</h3>
              <p>
                The runtime can inspect this repository and propose verification commands. Review the exact
                commands before writing a manifest and running them.
              </p>
              <button type="button" disabled={busy || checking || !connected} onClick={() => void propose()}>
                {checking ? "Inspecting…" : "Propose verification setup"}
              </button>
              {proposal && (
                <div className="setup-proposal">
                  <p>{proposal.proposal.reason}</p>
                  {proposal.proposal.commands.map((entry) => (
                    <div key={entry.id}>
                      <strong>{entry.id}</strong>
                      <pre>{entry.command.join(" ")}</pre>
                      <small>
                        {entry.cwd ? `Working directory: ${entry.cwd}. ` : ""}
                        {entry.evidence.detail}
                      </small>
                    </div>
                  ))}
                  <details>
                    <summary>Proposed manifest · {proposal.manifestPath}</summary>
                    <pre>{proposal.manifestPreview}</pre>
                  </details>
                  {proposal.proposal.notes.map((note) => (
                    <p key={note} className="quiet">
                      {note}
                    </p>
                  ))}
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={confirmedCommands}
                      onChange={(event) => setConfirmedCommands(event.target.checked)}
                    />
                    <span>I reviewed these commands and the manifest.</span>
                  </label>
                  <button
                    type="button"
                    className="primary"
                    disabled={
                      busy ||
                      !connected ||
                      !confirmedCommands ||
                      !proposal.proposal.determined ||
                      !proposal.proposal.commands.length
                    }
                    onClick={() =>
                      void command(async () => {
                        await gateway.approveSetup(contract.repositoryRoot, proposal.proposal);
                        const next = await gateway.repository(contract.repositoryRoot);
                        setContract(next);
                        setProposal(null);
                      })
                    }
                  >
                    Write manifest & verify
                  </button>
                </div>
              )}
            </section>
          )}
          {(localError || error) && (
            <p role="alert" className="form-error">
              {localError ?? error}
            </p>
          )}
          {registered && (
            <section className="project-archive">
              <h3>{project.archivedAt ? "Archived project" : "Archive project"}</h3>
              <p>
                {project.archivedAt
                  ? "Restore this project to show its base and create tasks again."
                  : "Hides the base and prevents new tasks. Repository files and task history are retained. Resolve or close unfinished tasks first."}
              </p>
              {!archiveReview ? (
                <button type="button" disabled={busy || !connected} onClick={() => setArchiveReview(true)}>
                  {project.archivedAt ? "Review restore" : "Review archive"}
                </button>
              ) : (
                <div className="confirmation-row">
                  <strong>
                    {project.archivedAt ? "Restore" : "Archive"} {project.name}?
                  </strong>
                  <button
                    type="button"
                    disabled={busy || !connected}
                    onClick={() =>
                      void command(
                        () =>
                          gateway.changeProject(project.id, {
                            kind: project.archivedAt ? "restore" : "archive",
                          }),
                        onDone,
                      )
                    }
                  >
                    {project.archivedAt ? "Restore project" : "Archive project"}
                  </button>
                  <button type="button" disabled={busy} onClick={() => setArchiveReview(false)}>
                    Keep as is
                  </button>
                </div>
              )}
            </section>
          )}
        </section>
        <aside className="mission-briefing project-preview">
          <div className="section-heading">
            <h2>Project headquarters</h2>
            <Buildings size={23} />
          </div>
          <img
            className="base-preview-art"
            src="/assets/mf.ui.project-thumbnail.png"
            alt="Project headquarters platform"
          />
          <h2>{name.trim() || "Your project"}</h2>
          <p className="repository-path">
            {contract?.repositoryRoot ?? (path || "Choose a local repository")}
          </p>
          <p className="notice">
            <CheckCircle size={21} />
            One base for this project’s tasks, agents and handoffs.
          </p>
          <p className="quiet">
            Bases are placed automatically in v1. This screen manages the project’s repository and readiness.
          </p>
          {gateway.mode === "fixture" && (
            <p className="sample-note">Sample setup only. No local repository is inspected or changed.</p>
          )}
        </aside>
      </div>
      <footer className="overlay-footer">
        <button type="button" onClick={review && !registered ? () => setReview(false) : onClose}>
          {review && !registered ? "Back" : "Cancel"}
        </button>
        <button
          type="submit"
          form="project-setup-form"
          className="primary"
          disabled={busy || checking || !connected || !name.trim() || !path.trim() || (review && !canSave)}
        >
          {busy
            ? "Saving…"
            : checking
              ? "Checking repository…"
              : !review
                ? "Validate repository"
                : registered
                  ? "Save project name"
                  : "Add project"}
          <ArrowRight size={19} />
        </button>
      </footer>
    </>
  );
}
