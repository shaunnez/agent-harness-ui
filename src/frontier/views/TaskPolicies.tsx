import { LockKey, Sliders } from "@phosphor-icons/react";
import { useState } from "react";
import { resolveRolePolicyLifecycleEligibility } from "../../../server/role-policy-eligibility.mjs";
import type { RolePolicyId, RuntimeAgentPolicy, RuntimeStatus } from "../../domain";
import type { TaskEvidence } from "../runtime/contracts";
import { policyRoles } from "../runtime/policies";
import { modelLabel, reasoningLabel } from "../runtime/presentation";
import { PolicyChoice } from "./PolicyMatrix";

export function TaskPolicies({
  evidence,
  status,
  busy,
  connected,
  fixture,
  error,
  onSave,
  onMore,
}: {
  evidence: TaskEvidence;
  status: RuntimeStatus | null;
  busy: boolean;
  connected: boolean;
  fixture: boolean;
  error: string | null;
  onSave(role: RolePolicyId, policy: RuntimeAgentPolicy, done: () => void): Promise<void>;
  onMore(kind: "artifacts" | "runs"): void;
}) {
  const task = evidence.core;
  const [selection, select] = useState<{ role: RolePolicyId; policy: RuntimeAgentPolicy } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const complete =
    !evidence.runs.nextCursor &&
    !task.artifactNextCursor &&
    evidence.runs.items.length >= (task.runCount ?? 0);
  const eligible = (role: RolePolicyId) =>
    complete
      ? resolveRolePolicyLifecycleEligibility({ ...task, runs: evidence.runs.items }, role)
      : { ok: false, reason: "Load the full retained evidence before changing a future role." };
  const discoveryStatus =
    fixture || !status?.catalog
      ? status
      : {
          ...status,
          catalog: {
            ...status.catalog,
            models: status.catalog.models.filter(
              (model) => model.availability === "discovered" && model.provenance !== "configured",
            ),
          },
        };
  return (
    <div className="overlay-body task-policies-body">
      <div className="section-heading">
        <div>
          <small>{task.id} · Task snapshot</small>
          <h2>{task.title}</h2>
          <p className="quiet">
            Running and historical roles are frozen. Future-role changes apply across this task’s risk
            profiles.
          </p>
        </div>
        <Sliders size={28} />
      </div>
      {!complete && (
        <section className="workflow-card">
          <p>Load the remaining role history before editing a future policy.</p>
          {task.artifactNextCursor && (
            <button type="button" onClick={() => onMore("artifacts")}>
              Load earlier artifacts
            </button>
          )}
          {evidence.runs.nextCursor && (
            <button type="button" onClick={() => onMore("runs")}>
              Load earlier runs
            </button>
          )}
        </section>
      )}
      <table className="policy-matrix">
        <thead>
          <tr>
            <th>Role</th>
            <th>Recorded policy</th>
            <th>Source / eligibility</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {policyRoles.map((role) => {
            const policy = task.agentConfig?.stagePolicies?.[role.id];
            const eligibility = eligible(role.id);
            const editing = selection?.role === role.id;
            return (
              <tr key={role.id}>
                <th>
                  <strong>{role.label}</strong>
                  <small>{role.skill}</small>
                </th>
                <td>
                  {editing ? (
                    <div className="policy-selects">
                      <PolicyChoice
                        label={role.label}
                        value={selection.policy}
                        status={discoveryStatus}
                        disabled={busy || confirm}
                        onChange={(value) => select({ role: role.id, policy: value })}
                      />
                    </div>
                  ) : policy ? (
                    `${modelLabel(policy.model)} · ${reasoningLabel(policy.reasoning)}`
                  ) : (
                    "Snapshot unavailable"
                  )}
                </td>
                <td>
                  <span>
                    {task.agentConfig?.rolePolicySources?.[role.id]?.replaceAll("-", " ") ??
                      "Recorded task policy"}
                  </span>
                  <small>{eligibility.ok ? "Future role" : eligibility.reason}</small>
                </td>
                <td>
                  {editing ? (
                    <button
                      type="button"
                      disabled={busy || !connected || !eligibility.ok}
                      onClick={() => setConfirm(true)}
                    >
                      Review change
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={!policy || !eligibility.ok || busy}
                      onClick={() => {
                        if (policy) {
                          select({ role: role.id, policy });
                          setConfirm(false);
                        }
                      }}
                    >
                      {eligibility.ok ? (
                        "Change"
                      ) : (
                        <>
                          <LockKey size={16} />
                          Locked
                        </>
                      )}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {selection && confirm && (
        <section className="policy-confirmation">
          <h3>
            Change {selection.role} for {task.id}?
          </h3>
          <p>
            {task.agentConfig?.stagePolicies?.[selection.role]?.model} /{" "}
            {task.agentConfig?.stagePolicies?.[selection.role]?.reasoning} →{" "}
            <strong>
              {selection.policy.model} / {selection.policy.reasoning}
            </strong>
          </p>
          <p className="quiet">
            The server rechecks role history, repository authority and the current model allowlist. Existing
            runs and global defaults stay intact.
          </p>
          <div className="inline-controls">
            <button
              type="button"
              className="primary"
              disabled={busy || !connected || !eligible(selection.role).ok}
              onClick={() =>
                void onSave(selection.role, selection.policy, () => {
                  select(null);
                  setConfirm(false);
                })
              }
            >
              {busy ? "Saving…" : "Confirm role policy"}
            </button>
            <button type="button" disabled={busy} onClick={() => setConfirm(false)}>
              Back to choices
            </button>
          </div>
        </section>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </div>
  );
}
