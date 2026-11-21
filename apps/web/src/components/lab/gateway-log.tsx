import type { GatewaySession, GatewaySessionDetail } from "@tix/contracts";
import { useState } from "react";
import { api } from "../../api.js";
import { errorText, money, timeOf, usePoll } from "../../hooks.js";

// What the gateway knows: sessions and every webhook it tried to send.
export function GatewayLog() {
  const { data, error } = usePoll<GatewaySession[]>(api.gatewaySessions, 1500);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section className="rounded-lg bg-white p-4 shadow" aria-label="Gateway log">
      <h3 className="font-semibold">Payment gateway: sessions and webhooks</h3>
      <p className="text-sm text-gray-600">
        The gateway's own records. A dropped webhook (switch <code>dropWebhooks</code>) can be sent
        after all with Redeliver.
      </p>
      {error && <p className="text-sm text-red-700">Not reachable: {error}</p>}
      <table className="mt-2 w-full text-left text-sm">
        <thead>
          <tr className="text-gray-500">
            <th>Session</th>
            <th>For</th>
            <th>Amount</th>
            <th>Status</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {(data ?? []).slice(0, 12).map((s) => (
            <SessionRow
              key={s.id}
              session={s}
              open={open === s.id}
              onToggle={() => setOpen(open === s.id ? null : s.id)}
            />
          ))}
        </tbody>
      </table>
    </section>
  );
}

type RowProps = { session: GatewaySession; open: boolean; onToggle: () => void };

function SessionRow({ session: s, open, onToggle }: RowProps) {
  return (
    <>
      <tr className="cursor-pointer hover:bg-gray-50" onClick={onToggle} data-session={s.id}>
        <td className="font-mono text-xs">{s.id}</td>
        <td className="font-mono text-xs">{s.merchantRef.slice(0, 13)}</td>
        <td>{money(s.amountCents)}</td>
        <td data-status={s.status}>{s.status}</td>
        <td>{timeOf(s.createdAt)}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5}>
            <Webhooks id={s.id} />
          </td>
        </tr>
      )}
    </>
  );
}

function Webhooks({ id }: { id: string }) {
  const { data, refresh } = usePoll<GatewaySessionDetail>(() => api.gatewaySession(id), 1000, [id]);
  const [problem, setProblem] = useState<string | null>(null);
  const redeliver = async (eventId: string) => {
    try {
      await api.redeliver(eventId);
    } catch (e) {
      setProblem(errorText(e));
    } finally {
      refresh();
    }
  };
  if (!data) return <p className="text-xs">Loading…</p>;
  if (!data.webhooks.length) return <p className="text-xs text-gray-500">No webhooks yet.</p>;
  return (
    <ul className="my-1 space-y-1 rounded bg-gray-50 p-2 text-xs" aria-label="Webhooks">
      {data.webhooks.map((w) => (
        <li key={w.id} className="flex items-center gap-2" data-webhook-status={w.status}>
          <span className="font-mono">{w.type}</span>
          <span className="font-semibold">{w.status}</span>
          <span>
            {w.attempts} attempt{w.attempts === 1 ? "" : "s"}
          </span>
          {w.lastError && <span className="text-red-700">{w.lastError}</span>}
          {w.status !== "DELIVERED" && (
            <button className="rounded border px-1" onClick={() => void redeliver(w.id)}>
              Redeliver
            </button>
          )}
        </li>
      ))}
      {problem && <li className="text-red-700">{problem}</li>}
    </ul>
  );
}
