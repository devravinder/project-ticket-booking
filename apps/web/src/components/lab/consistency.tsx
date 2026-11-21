import type { ConsistencyReport } from "@tix/contracts";
import { api } from "../../api.js";
import { timeOf, usePoll } from "../../hooks.js";

// Invariants across seats, holds and bookings; try it after a naive race.
export function Consistency() {
  const { data, error } = usePoll<ConsistencyReport>(api.consistency, 2000);
  return (
    <section className="rounded-lg bg-white p-4 shadow" aria-label="Consistency">
      <h3 className="flex items-center justify-between font-semibold">
        Consistency check
        {data && (
          <span
            className={`rounded px-2 py-0.5 text-xs ${data.ok ? "bg-green-100 text-green-900" : "bg-red-100 text-red-900"}`}
            data-ok={data.ok ? "yes" : "no"}
            aria-label="Consistency verdict"
          >
            {data.ok ? "OK" : "BROKEN"}
          </span>
        )}
      </h3>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {data && (
        <>
          <p className="text-xs text-gray-500">checked {timeOf(data.checkedAt)}</p>
          <p className="mt-1 text-sm">
            {Object.entries(data.bookings)
              .map(([s, n]) => `${s} ${n}`)
              .join(" · ") || "no bookings yet"}
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {data.problems.length === 0 && <li className="text-green-800">No problems found.</li>}
            {data.problems.map((p, i) => (
              <li key={i} className={p.severity === "error" ? "text-red-700" : "text-amber-800"}>
                {p.severity === "error" ? "✘" : "!"} {p.kind}:{" "}
                <span className="font-mono text-xs">{p.detail}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export function CrashHelp() {
  return (
    <section className="rounded-lg bg-white p-4 text-sm shadow" aria-label="Crash help">
      <h3 className="font-semibold">Real crashes (by hand)</h3>
      <p className="mt-1 text-gray-600">
        The <code>crashPoint</code> switch makes booking-service exit for real, so you restart it
        yourself (<code>pnpm start:booking</code>):
      </p>
      <ul className="mt-1 list-disc pl-5 text-gray-600">
        <li>
          <code>beforeConfirm</code>: dies when a webhook arrives. The gateway keeps retrying; after
          the restart the retry (or reconciliation) books the seat.
        </li>
        <li>
          <code>afterSession</code>: dies after the gateway created the payment session, before we
          saved its id. Pay again reuses the same session; reconciliation finds it by booking id.
        </li>
      </ul>
    </section>
  );
}
