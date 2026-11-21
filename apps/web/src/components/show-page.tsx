import type { Seat, ShowDetail } from "@tix/contracts";
import { api } from "../api.js";
import { money, usePoll } from "../hooks.js";
import { SeatMap, type SeatLook } from "./seat-map.js";

const lookOf = (seat: Seat): SeatLook =>
  seat.status === "BOOKED" ? "booked" : seat.status === "HELD" ? "held" : "free";

export function ShowPage({ showId, onBack }: { showId: string; onBack: () => void }) {
  const { data: show, error } = usePoll<ShowDetail>(() => api.show(showId), 2000, [showId]);
  return (
    <section className="rounded-lg bg-white p-6 shadow" aria-label={`Show page ${showId}`}>
      <button className="text-sm text-rose-700 underline" onClick={onBack}>
        ← All shows
      </button>
      {error && <p className="mt-2 text-red-700">{error}</p>}
      {show && (
        <>
          <h2 className="mt-2 text-xl font-semibold">{show.movie.title}</h2>
          <p className="mb-6 text-sm text-gray-600">
            {show.screen.name} · {new Date(show.startsAt).toLocaleString()} · regular{" "}
            {money(show.seats.find((s) => s.tier === "REGULAR")?.priceCents)}
          </p>
          <SeatMap show={show} lookOf={lookOf} />
        </>
      )}
    </section>
  );
}
