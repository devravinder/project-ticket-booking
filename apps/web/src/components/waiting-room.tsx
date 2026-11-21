import type { QueueTicket } from "@tix/contracts";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { clock, errorText, useCountdown } from "../hooks.js";

// Joins the show's line on arrival and checks every second until let in (ADR-012).
export function useQueue(user: string, showId: string) {
  const [ticket, setTicket] = useState<QueueTicket | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const rejoin = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async (first: boolean) => {
      try {
        const t = first ? await api.joinQueue(user, showId) : await api.queueMe(user, showId);
        if (stopped) return;
        setTicket(t);
        setError(null);
        if (t.status === "WAITING") timer = setTimeout(() => void poll(false), 1000);
      } catch (e) {
        if (stopped) return;
        setError(errorText(e));
        timer = setTimeout(() => void poll(first), 2000);
      }
    };
    void poll(true);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [user, showId, nonce]);

  return { ticket, error, rejoin, token: ticket?.status === "ADMITTED" ? ticket.token : undefined };
}

export function WaitingPanel({
  ticket,
  error,
}: {
  ticket: QueueTicket | null;
  error: string | null;
}) {
  return (
    <section className="rounded-lg bg-white p-8 text-center shadow" aria-label="Waiting room">
      <h2 className="text-xl font-semibold text-rose-800">This show is busy</h2>
      <p className="mt-1 text-gray-600">
        You are in line. Keep this tab open; we let people in a few at a time.
      </p>
      {ticket?.status === "WAITING" && (
        <>
          <p className="mt-6 text-5xl font-bold" aria-label="Queue position">
            {ticket.position}
          </p>
          <p className="text-sm text-gray-600">
            in line · {ticket.waiting} waiting · about {ticket.etaSeconds} s
          </p>
        </>
      )}
      {!ticket && !error && <p className="mt-6">Joining the line…</p>}
      {error && <p className="mt-6 text-red-700">{error}</p>}
    </section>
  );
}

export function AdmittedBanner({ until }: { until: string }) {
  const left = useCountdown(until);
  return (
    <p className="mb-4 rounded bg-green-50 px-3 py-2 text-sm text-green-900" aria-label="Admitted">
      ✔ You are in. Pick your seats; your turn ends in{" "}
      <span className="font-mono">{clock(left)}</span>.
    </p>
  );
}
