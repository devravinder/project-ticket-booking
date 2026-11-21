import type { ShowSummary } from "@tix/contracts";
import { api } from "../api.js";
import { money, usePoll } from "../hooks.js";

const when = (iso: string) =>
  new Date(iso).toLocaleString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

export function Shows({ onOpen }: { onOpen: (id: string) => void }) {
  const { data, error } = usePoll<ShowSummary[]>(api.shows, 3000);
  if (error) return <p className="text-red-700">Could not load shows: {error}</p>;
  if (!data) return <p>Loading shows…</p>;
  return (
    <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-3" aria-label="Shows">
      {data.map((s) => (
        <button
          key={s.id}
          className="rounded-lg bg-white p-4 text-left shadow hover:ring-2 hover:ring-rose-400"
          aria-label={`Show ${s.id}`}
          onClick={() => onOpen(s.id)}
        >
          <h2 className="text-lg font-semibold">{s.movie.title}</h2>
          <p className="text-sm text-gray-600">
            {s.movie.rating} · {s.movie.minutes} min · {s.screen.name}
          </p>
          <p className="mt-2 font-medium">{when(s.startsAt)}</p>
          <p className="mt-1 text-sm">
            from {money(s.priceFromCents)} ·{" "}
            <span data-testid="available">
              {s.seatsAvailable}/{s.seatsTotal} seats free
            </span>
          </p>
          <p className="mt-1 text-xs text-gray-400">{s.id}</p>
        </button>
      ))}
    </section>
  );
}
