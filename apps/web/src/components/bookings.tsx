import type { Booking } from "@tix/contracts";
import { api } from "../api.js";
import { money, timeOf, usePoll } from "../hooks.js";
import { BookingBadge } from "./badges.js";

type Props = { user: string; selected: string | null; onSelect: (id: string) => void };

export function Bookings({ user, selected, onSelect }: Props) {
  const { data, error } = usePoll<Booking[]>(() => api.bookings(user), 1500, [user]);
  const current = selected ?? data?.[0]?.id ?? null;
  return (
    <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
      <section className="rounded-lg bg-white p-4 shadow" aria-label="My bookings">
        <h2 className="font-semibold">My bookings</h2>
        {error && <p className="text-sm text-red-700">{error}</p>}
        {data && !data.length && <p className="text-sm text-gray-600">Nothing booked yet.</p>}
        <ul className="mt-2 space-y-1">
          {data?.map((b) => (
            <li key={b.id}>
              <button
                className={`w-full rounded px-2 py-1 text-left text-sm ${b.id === current ? "bg-rose-50 ring-1 ring-rose-300" : "hover:bg-gray-50"}`}
                onClick={() => onSelect(b.id)}
                aria-label={`Booking ${b.id.slice(0, 8)}`}
              >
                <span className="font-medium">{b.showId}</span> {b.seats.join(", ")}{" "}
                <BookingBadge status={b.status} />
              </button>
            </li>
          ))}
        </ul>
      </section>
      {current && <BookingDetail id={current} />}
    </div>
  );
}

export function BookingDetail({ id }: { id: string }) {
  const { data: b, error } = usePoll<Booking>(() => api.booking(id), 1000, [id]);
  if (error) return <p className="text-red-700">{error}</p>;
  if (!b) return <p>Loading…</p>;
  return (
    <section className="rounded-lg bg-white p-4 shadow" aria-label="Booking detail">
      <h2 className="flex items-center gap-2 font-semibold">
        {b.showId} · {b.seats.join(", ")} · {money(b.amountCents)}
        <BookingBadge status={b.status} />
      </h2>
      <p className="text-xs text-gray-500">
        booking {b.id} · session {b.sessionId ?? "-"}
      </p>
      {b.failureReason && (
        <p className="mt-2 text-sm text-red-700" aria-label="Failure reason">
          {b.failureReason}
        </p>
      )}
      {b.status === "PENDING_PAYMENT" && b.payUrl && (
        <a className="mt-2 inline-block text-sm text-rose-700 underline" href={b.payUrl}>
          Continue to payment
        </a>
      )}
      <h3 className="mt-4 text-sm font-semibold">What happened</h3>
      <ol className="mt-1 space-y-1 border-l-2 border-gray-200 pl-3 text-sm" aria-label="Timeline">
        {b.log.map((l, i) => (
          <li key={i}>
            <span className="font-mono text-xs text-gray-500">{timeOf(l.at)}</span>{" "}
            <span className="font-medium">{l.what}</span>
            {l.detail && <span className="text-gray-600"> · {l.detail}</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}
