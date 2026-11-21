import { type Hold, MAX_SEATS_PER_HOLD, type Seat, type ShowDetail } from "@tix/contracts";
import { useState } from "react";
import { api, ApiError } from "../api.js";
import { clock, errorText, money, useCountdown, usePoll } from "../hooks.js";
import { SeatMap, type SeatLook } from "./seat-map.js";

type Props = { user: string; showId: string; onBack: () => void };

export function ShowPage({ user, showId, onBack }: Props) {
  const showPoll = usePoll<ShowDetail>(() => api.show(showId), 2000, [showId]);
  const holdsPoll = usePoll<Hold[]>(() => api.myHolds(user, showId), 2000, [user, showId]);
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const show = showPoll.data;
  const myHolds = holdsPoll.data ?? [];
  const mine = new Set(myHolds.map((h) => h.id));

  const refresh = () => {
    showPoll.refresh();
    holdsPoll.refresh();
  };

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
      const h = await api.hold(user, showId, selected);
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
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const selectedCents = show
    ? show.seats.filter((s) => selected.includes(s.seatNo)).reduce((t, s) => t + s.priceCents, 0)
    : 0;

  return (
    <section className="grid gap-6 lg:grid-cols-[1fr_20rem]" aria-label={`Show page ${showId}`}>
      <div className="rounded-lg bg-white p-6 shadow">
        <button className="text-sm text-rose-700 underline" onClick={onBack}>
          ← All shows
        </button>
        {showPoll.error && <p className="mt-2 text-red-700">{showPoll.error}</p>}
        {show && (
          <>
            <h2 className="mt-2 text-xl font-semibold">{show.movie.title}</h2>
            <p className="mb-6 text-sm text-gray-600">
              {show.screen.name} · {new Date(show.startsAt).toLocaleString()} · {show.id}
            </p>
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
      <button className="mt-3 w-full rounded border py-1 text-sm" onClick={() => void release()}>
        Release seats
      </button>
      {error && <p className="mt-1 text-sm text-red-700">{error}</p>}
    </div>
  );
}
