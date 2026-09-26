// Standing orders: how the Council is answered and how many repair crews a campaign may send.
import { useState } from "react";
import { MAX_REPAIR_ATTEMPTS, type RepairLimits, normalizeRepairLimits } from "../../../repair-limits";
import { doctrines, makeRoster } from "../../realm";

const roster = makeRoster();

function Stepper({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="ae-stepper">
      {label}
      <span className="ae-stepper-controls">
        <button type="button" onClick={() => onChange(Math.max(0, value - 1))} aria-label={`Fewer: ${label}`}>
          −
        </button>
        <b>{value}</b>
        <button
          type="button"
          onClick={() => onChange(Math.min(MAX_REPAIR_ATTEMPTS, value + 1))}
          aria-label={`More: ${label}`}
        >
          +
        </button>
      </span>
    </label>
  );
}

export function Orders() {
  const [council, setCouncil] = useState(roster.settings.grillPolicy);
  const [repair, setRepair] = useState<"manual" | "automatic">("manual");
  const [limits, setLimits] = useState<RepairLimits>(() =>
    normalizeRepairLimits(roster.settings.repairLimits),
  );
  return (
    <div className="ae-orders">
      <section className="ae-parchment">
        <div className="ae-eyebrow">The Council (Grill)</div>
        <div className="ae-segment">
          <button
            type="button"
            className={council === "manual" ? "is-active" : ""}
            onClick={() => setCouncil("manual")}
          >
            You decree
          </button>
          <button
            type="button"
            className={council !== "manual" ? "is-active" : ""}
            onClick={() => setCouncil("auto-accept-recommendations")}
          >
            Accept counsel
          </button>
        </div>
        <p className="ae-lore">
          {council === "manual"
            ? "The Council pauses for your answers when material questions exist. You may still accept all remaining counsel at once. A Council with no questions moves on by itself."
            : "Recommended answers are accepted inside the march, with the automation recorded. New campaigns take this order when they are raised."}
        </p>
      </section>
      <section className="ae-parchment">
        <div className="ae-eyebrow">Repair crews</div>
        <div className="ae-segment">
          <button
            type="button"
            className={repair === "manual" ? "is-active" : ""}
            onClick={() => setRepair("manual")}
          >
            On your order
          </button>
          <button
            type="button"
            className={repair === "automatic" ? "is-active" : ""}
            onClick={() => setRepair("automatic")}
          >
            Automatic
          </button>
        </div>
        <p className="ae-lore">
          A failed package check or a candidate finding sends a crew back to the Workshop. Every failed
          attempt is kept, and qualification runs again before anything is integrated. Cancellations, baseline
          failures and invalid plans still wait for you.
        </p>
        <Stepper
          label="Attempts per package"
          value={limits.package}
          onChange={(v) => setLimits((l) => ({ ...l, package: v }))}
        />
        <div className="ae-field-label">Attempts per candidate, shared by review, test and final review</div>
        {doctrines.map((d) => (
          <Stepper
            key={d.id}
            label={`${d.name} (${d.profile})`}
            value={limits.candidate[d.id]}
            onChange={(v) => setLimits((l) => ({ ...l, candidate: { ...l.candidate, [d.id]: v } }))}
          />
        ))}
        <p className="ae-muted">Limits are snapshotted on new campaigns, from 0 to {MAX_REPAIR_ATTEMPTS}.</p>
      </section>
    </div>
  );
}
