import { type Hold, MAX_SEATS_PER_HOLD, type Seat } from "@tix/contracts";
import { useState } from "react";
import { api, ApiError, type ServiceName } from "../api.js";
import { clock, errorText, money, useCountdown, usePoll } from "../hooks.js";
import { type LiveState, useLiveShow } from "../live.js";
import { SeatMap, type SeatLook } from "./seat-map.js";
import { AdmittedBanner, useQueue, WaitingPanel } from "./waiting-room.js";

type Props = { user: string; showId: string; onBack: () => void };

export function ShowPage({ user, showId, onBack }: Props) {
  const [via, setVia] = useState<ServiceName>("booking");
  const live = useLiveShow(showId, via);
  const queue = useQueue(user, showId);
  const holdsPoll = usePoll<Hold[]>(() => api.myHolds(user, showId), 2000, [user, showId]);
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const show = live.show;
  const myHolds = holdsPoll.data ?? [];
  const mine = new Set(myHolds.map((h) => h.id));

  // The map updates itself; only my hold list is fetched again.
  const refresh = () => holdsPoll.refresh();

  const lookOf = (seat: Seat): SeatLook => {
    if (seat.status === "BOOKED") return "booked";
    if (seat.status === "HELD") return seat.holdId && mine.has(seat.holdId) ? "mine" : "held";
    return selected.includes(seat.seatNo) ? "selected" : "free";
  };

  const toggle = (seat: Seat) => {
    setMessage(null);
    setSelected((s) =>
      s.includes(seat.seatNo)
        ? s.filter((x) => x !== seat.seatNo)
        : s.length < MAX_SEATS_PER_HOLD
          ? [...s, seat.seatNo]
          : s,
    );
  };

  const hold = async () => {
    setBusy(true);
    try {
      const h = await api.hold(user, showId, selected, queue.token);
      setSelected([]);
      setMessage({
        tone: "info",
        text: `Held ${h.seats.join(", ")}. Pay before the timer runs out.`,
      });
    } catch (error) {
      const taken = error instanceof ApiError ? (error.body?.unavailable as string[]) : undefined;
      setMessage({
        tone: "error",
        text: taken ? `Just taken by someone else: ${taken.join(", ")}` : errorText(error),
      });
      if (taken) setSelected((s) => s.filter((x) => !taken.includes(x)));
      // Our turn ended: back into the line.
      if (error instanceof ApiError && error.code === "QUEUE_REQUIRED") queue.rejoin();
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const selectedCents = show
    ? show.seats.filter((s) => selected.includes(s.seatNo)).reduce((t, s) => t + s.priceCents, 0)
    : 0;

  if (queue.ticket?.status !== "OPEN" && queue.ticket?.status !== "ADMITTED") {
    return <WaitingPanel ticket={queue.ticket} error={queue.error} />;
  }

  return (
    <section className="grid gap-6 lg:grid-cols-[1fr_20rem]" aria-label={`Show page ${showId}`}>
      <div className="rounded-lg bg-white p-6 shadow">
        <button className="text-sm text-rose-700 underline" onClick={onBack}>
          ← All shows
        </button>
        <LiveBadge state={live.state} via={via} onVia={setVia} updates={live.updates} />
        {show && (
          <>
            <h2 className="mt-2 text-xl font-semibold">{show.movie.title}</h2>
            <p className="mb-6 text-sm text-gray-600">
              {show.screen.name} · {new Date(show.startsAt).toLocaleString()} · {show.id}
            </p>
            {queue.ticket.admittedUntil && <AdmittedBanner until={queue.ticket.admittedUntil} />}
            <SeatMap show={show} lookOf={lookOf} onToggle={toggle} />
          </>
        )}
      </div>
      <aside className="space-y-4">
        <div className="rounded-lg bg-white p-4 shadow" aria-label="Selection">
          <h3 className="font-semibold">Your selection</h3>
          <p className="mt-1 text-sm" data-testid="selected">
            {selected.length ? selected.join(", ") : `Pick up to ${MAX_SEATS_PER_HOLD} seats`}
          </p>
          {selected.length > 0 && <p className="text-sm">Total {money(selectedCents)}</p>}
          <button
            className="mt-3 w-full rounded bg-rose-700 py-2 font-medium text-white disabled:opacity-40"
            disabled={!selected.length || busy}
            onClick={() => void hold()}
          >
            Hold {selected.length || ""} seat{selected.length === 1 ? "" : "s"}
          </button>
          {message && (
            <p
              role={message.tone === "error" ? "alert" : "status"}
              className={`mt-2 text-sm ${message.tone === "error" ? "text-red-700" : "text-green-800"}`}
            >
              {message.text}
            </p>
          )}
        </div>
        {myHolds.map((h) => (
          <HoldCard key={h.id} user={user} hold={h} onChange={refresh} />
        ))}
      </aside>
    </section>
  );
}

function HoldCard({ user, hold, onChange }: { user: string; hold: Hold; onChange: () => void }) {
  const left = useCountdown(hold.expiresAt);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  // The gateway's page takes over the tab; it sends us back to /?booking=<id>.
  const pay = async () => {
    setPaying(true);
    try {
      const booking = await api.checkout(user, hold.id);
      if (booking.payUrl && booking.status === "PENDING_PAYMENT")
        window.location.assign(booking.payUrl);
      else setError(`booking is ${booking.status.toLowerCase()}`);
    } catch (e) {
      setError(errorText(e));
      setPaying(false);
    }
  };
  const release = async () => {
    try {
      await api.release(user, hold.id);
    } catch (e) {
      setError(errorText(e));
    } finally {
      onChange();
    }
  };
  return (
    <div className="rounded-lg border-2 border-blue-600 bg-white p-4 shadow" aria-label="Hold">
      <h3 className="flex justify-between font-semibold">
        Held for you
        <span
          className={`font-mono ${left < 15_000 ? "text-red-700" : "text-blue-800"}`}
          aria-label="Time left"
        >
          {left ? clock(left) : "expired"}
        </span>
      </h3>
      <p className="mt-1 text-sm">
        {hold.seats.join(", ")} · {money(hold.amountCents)}
      </p>
      <p className="text-xs text-gray-500">hold {hold.id.slice(0, 8)}</p>
      <button
        className="mt-3 w-full rounded bg-blue-700 py-2 font-medium text-white disabled:opacity-40"
        disabled={paying || !left}
        onClick={() => void pay()}
      >
        Pay {money(hold.amountCents)}
      </button>
      <button className="mt-2 w-full rounded border py-1 text-sm" onClick={() => void release()}>
        Release seats
      </button>
      {error && <p className="mt-1 text-sm text-red-700">{error}</p>}
    </div>
  );
}

const STATE_STYLE: Record<LiveState, string> = {
  connecting: "bg-gray-100 text-gray-700",
  live: "bg-green-100 text-green-900",
  reconnecting: "bg-amber-100 text-amber-900",
};

type BadgeProps = {
  state: LiveState;
  via: ServiceName;
  onVia: (via: ServiceName) => void;
  updates: number;
};

function LiveBadge({ state, via, onVia, updates }: BadgeProps) {
  return (
    <p className="float-right flex items-center gap-2 text-xs">
      <span
        className={`rounded px-2 py-0.5 font-semibold ${STATE_STYLE[state]}`}
        aria-label="Live state"
        data-state={state}
      >
        ● {state}
      </span>
      <span aria-label="Live updates">{updates} updates</span>
      <select
        aria-label="Live via"
        className="rounded border px-1"
        value={via}
        onChange={(e) => onVia(e.target.value as ServiceName)}
      >
        <option value="booking">via instance :7001</option>
        <option value="booking-2">via instance :7011</option>
      </select>
    </p>
  );
}
