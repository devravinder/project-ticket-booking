import { HOLD_MODES, type HoldMode, type ShowSummary } from "@tix/contracts";
import { useState } from "react";
import { api, ApiError } from "../../api.js";
import { errorText, usePoll } from "../../hooks.js";

type Attempt = {
  user: string;
  via: string;
  status: number;
  code: string;
  holdId?: string;
  stillHeld?: number;
  ms: number;
};

// N people click "hold" on one seat at the same instant; the database picks the winner.
export function RaceScenario() {
  const shows = usePoll<ShowSummary[]>(api.shows, 5000).data ?? [];
  const [showId, setShowId] = useState("SHOW-3");
  const [seat, setSeat] = useState("A1");
  const [people, setPeople] = useState(2);
  const [spread, setSpread] = useState(false);
  const [mode, setMode] = useState<HoldMode | null>(null);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const setHoldMode = async (m: HoldMode) => {
    try {
      // Both instances, so a spread race uses the same rule everywhere.
      await api.setSwitches("booking", { holdMode: m });
      await api.setSwitches("booking-2", { holdMode: m }).catch(() => undefined);
      setMode(m);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const race = async () => {
    setBusy(true);
    setError(null);
    setAttempts([]);
    try {
      const users = Array.from({ length: people }, (_, i) => `racer-${i + 1}`);
      const results = await Promise.all(
        users.map(async (user, i): Promise<Attempt> => {
          const via = spread && i % 2 ? "booking-2" : "booking";
          const started = performance.now();
          try {
            const hold = await api.holdVia(via, user, showId, [seat]);
            return {
              user,
              via,
              status: 201,
              code: "HELD",
              holdId: hold.id,
              ms: performance.now() - started,
            };
          } catch (e) {
            const status = e instanceof ApiError ? e.status : 0;
            const code = e instanceof ApiError ? e.code : errorText(e);
            return { user, via, status, code, ms: performance.now() - started };
          }
        }),
      );
      // Ask again afterwards: in naive mode a "winner" may have silently lost the seat.
      for (const r of results) {
        if (r.holdId) r.stillHeld = (await api.getHold(r.holdId)).seatsStillHeld;
      }
      setAttempts(results);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const cleanUp = async () => {
    try {
      await Promise.all(
        attempts.filter((a) => a.holdId).map((a) => api.release(a.user, a.holdId!)),
      );
      setAttempts([]);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const told = attempts.filter((a) => a.status === 201).length;
  const really = attempts.filter((a) => a.stillHeld).length;
  return (
    <section className="rounded-lg bg-white p-4 shadow" aria-label="Scenario race">
      <h3 className="font-semibold">Same seat, same moment</h3>
      <p className="text-sm text-gray-600">
        Fires all hold requests at once. Try it in each mode; watch the seat in another tab. You can
        also do it by hand: two browser tabs, two user names, click Hold together.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col">
          Show
          <select
            aria-label="Race show"
            className="rounded border px-1"
            value={showId}
            onChange={(e) => setShowId(e.target.value)}
          >
            {shows.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id} · {s.movie.title}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col">
          Seat
          <input
            aria-label="Race seat"
            className="w-16 rounded border px-1"
            value={seat}
            onChange={(e) => setSeat(e.target.value.toUpperCase())}
          />
        </label>
        <label className="flex flex-col">
          People
          <input
            aria-label="Race people"
            type="number"
            min={2}
            max={50}
            className="w-16 rounded border px-1"
            value={people}
            onChange={(e) => setPeople(Number(e.target.value))}
          />
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={spread} onChange={(e) => setSpread(e.target.checked)} />
          split over both instances
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-sm" role="group" aria-label="Hold mode">
        {HOLD_MODES.map((m) => (
          <button
            key={m}
            aria-pressed={mode === m}
            className={`rounded border px-2 py-1 ${mode === m ? "bg-gray-800 text-white" : ""}`}
            onClick={() => void setHoldMode(m)}
          >
            {m}
          </button>
        ))}
        <button
          className="rounded bg-rose-700 px-3 py-1 font-medium text-white disabled:opacity-40"
          disabled={busy}
          onClick={() => void race()}
        >
          Race!
        </button>
        {attempts.some((a) => a.holdId) && (
          <button className="rounded border px-2 py-1" onClick={() => void cleanUp()}>
            Release the winners
          </button>
        )}
      </div>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      {attempts.length > 0 && (
        <>
          <p
            className={`mt-3 font-medium ${told === 1 ? "text-green-800" : "text-red-700"}`}
            aria-label="Race verdict"
            data-told={told}
            data-really={really}
          >
            {told === 1
              ? "✔ Exactly one person got the seat."
              : told === 0
                ? "Nobody got it (already held or booked?)."
                : `✘ ${told} people were told the seat is theirs; it really belongs to ${really}.`}
          </p>
          <table className="mt-2 w-full text-left text-sm">
            <thead>
              <tr className="text-gray-500">
                <th>User</th>
                <th>Instance</th>
                <th>Answer</th>
                <th>Seat still theirs?</th>
                <th>ms</th>
              </tr>
            </thead>
            <tbody>
              {attempts.map((a) => (
                <tr key={a.user} data-code={a.code}>
                  <td>{a.user}</td>
                  <td>{a.via}</td>
                  <td>
                    {a.status} {a.code}
                  </td>
                  <td>{a.holdId ? (a.stillHeld ? "yes" : "no - overwritten") : "-"}</td>
                  <td>{Math.round(a.ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
