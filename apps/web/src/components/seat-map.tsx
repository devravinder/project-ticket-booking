import type { Seat, ShowDetail } from "@tix/contracts";

export type SeatLook = "free" | "selected" | "mine" | "held" | "booked";

const LOOK: Record<SeatLook, string> = {
  free: "border-green-600 bg-white text-green-800 hover:bg-green-100",
  selected: "border-green-700 bg-green-600 text-white",
  mine: "border-blue-700 bg-blue-600 text-white",
  held: "border-amber-500 bg-amber-200 text-amber-900 cursor-not-allowed",
  booked: "border-gray-400 bg-gray-400 text-white cursor-not-allowed",
};

export const LEGEND: { look: SeatLook; label: string }[] = [
  { look: "free", label: "Free" },
  { look: "selected", label: "Selected" },
  { look: "mine", label: "Held by you" },
  { look: "held", label: "Held by someone" },
  { look: "booked", label: "Booked" },
];

type Props = {
  show: ShowDetail;
  lookOf: (seat: Seat) => SeatLook;
  onToggle?: (seat: Seat) => void;
};

// The aisle splits each row in half, like most cinemas.
export function SeatMap({ show, lookOf, onToggle }: Props) {
  const byRow = new Map(show.rows.map((r) => [r, show.seats.filter((s) => s.row === r)]));
  const aisleAfter = Math.floor(show.cols / 2);
  return (
    <div className="overflow-x-auto">
      <div className="mx-auto mb-6 h-2 w-2/3 rounded-full bg-gray-300" title="Screen" />
      <p className="-mt-5 mb-4 text-center text-xs text-gray-500">SCREEN THIS WAY</p>
      <div className="flex flex-col items-center gap-1" role="grid" aria-label="Seat map">
        {[...byRow].map(([row, seats]) => (
          <div key={row} className="flex items-center gap-1" role="row">
            <span className="w-5 text-right text-xs text-gray-500">{row}</span>
            {seats.map((seat) => {
              const look = lookOf(seat);
              const clickable = onToggle && (look === "free" || look === "selected");
              return (
                <button
                  key={seat.seatNo}
                  role="gridcell"
                  aria-label={`Seat ${seat.seatNo}`}
                  data-status={seat.status}
                  data-look={look}
                  disabled={!clickable}
                  title={`${seat.seatNo} · ${seat.tier}`}
                  onClick={() => onToggle?.(seat)}
                  className={`h-7 w-7 rounded-t-md border text-[10px] ${LOOK[look]} ${seat.col === aisleAfter ? "mr-4" : ""} ${seat.tier === "PREMIUM" ? "ring-1 ring-purple-300" : ""}`}
                >
                  {seat.col}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <ul className="mt-4 flex flex-wrap justify-center gap-4 text-xs">
        {LEGEND.map((l) => (
          <li key={l.look} className="flex items-center gap-1">
            <span className={`inline-block h-3 w-3 rounded-sm border ${LOOK[l.look]}`} />
            {l.label}
          </li>
        ))}
        <li className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-sm border ring-1 ring-purple-300" />
          Premium
        </li>
      </ul>
    </div>
  );
}
