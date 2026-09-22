import { useEffect, useState } from "react";
import type { LinearIntegrationStatus } from "../../api";
import type { FrontierGateway } from "../runtime/contracts";

export function LinearSettings({
  gateway,
  connected,
  busy,
  error,
  command,
}: {
  gateway: FrontierGateway;
  connected: boolean;
  busy: boolean;
  error: string | null;
  command(action: () => Promise<unknown>, then?: () => void): Promise<void>;
}) {
  const [status, setStatus] = useState<LinearIntegrationStatus | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Refresh explicitly re-reads the companion setting.
  useEffect(() => {
    let disposed = false;
    setStatus(null);
    setReadError(null);
    gateway
      .linearIntegration()
      .then((next) => {
        if (!disposed) setStatus(next);
      })
      .catch((reason) => {
        if (!disposed) setReadError(String(reason));
      });
    return () => {
      disposed = true;
    };
  }, [gateway, connected, refresh]);
  return (
    <>
      <h2>Integrations</h2>
      <section className="workflow-card">
        <h3>Linear</h3>
        <p>Import tagged tickets, publish workflow updates, and answer manual Grill questions from Linear.</p>
        <label className="setting-row">
          <span>
            <strong>Enable Linear integration</strong>
            <small>
              {!status
                ? "Checking configuration…"
                : !status.configured
                  ? "Not configured on this companion"
                  : status.changing
                    ? "Finishing the current message…"
                    : status.enabled
                      ? "On"
                      : "Off"}
            </small>
          </span>
          <input
            type="checkbox"
            checked={status?.enabled ?? false}
            disabled={!connected || busy || !status?.configured || status.changing}
            onChange={(event) => {
              const enabled = event.target.checked;
              void command(async () => {
                setStatus(await gateway.setLinearIntegration(enabled));
              });
            }}
          />
        </label>
        <p>
          Changes save immediately for this Harness and survive restarts. Turning Off finishes any message
          already being processed, then pauses imports, Linear replies and outbound updates.
        </p>
        <p>
          Existing tasks keep working in Harness, including manual Grill, approvals and running agents. New
          mentions and replies received while Off are ignored; send them again after enabling. Previously
          queued work resumes when enabled.
        </p>
        {status && !status.configured && (
          <p>Configure the private Linear app on the companion before enabling this integration.</p>
        )}
        {(readError || error) && (
          <p role="alert" className="form-error">
            {readError || error}
          </p>
        )}
        <button type="button" disabled={!connected || busy} onClick={() => setRefresh((value) => value + 1)}>
          Refresh integration status
        </button>
      </section>
    </>
  );
}
