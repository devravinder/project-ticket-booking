import type { QueueStats, ShowSummary } from "@tix/contracts";
import { useRef, useState } from "react";
import { api, ApiError } from "../../api.js";
import { errorText, usePoll } from "../../hooks.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Bot = {
  user: string;
  state: "waiting" | "admitted" | "holding" | "no seat";
  seat?: string;
  holdId?: string;
};

// A crowd of bots arrives at once; each takes one seat when the waiting room lets it in.
export function FlashCrowd() {
  const shows = usePoll<ShowSummary[]>(api.shows, 5000).data ?? [];
  const [showId, setShowId] = useState("SHOW-1");
  const [size, setSize] = useState(30);
  const [perSecond, setPerSecond] = useState(3);
  const [bots, setBots] = useState<Bot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const stop = useRef(false);
  const stats = usePoll<QueueStats>(() => api.queueStats(showId), 1000, [showId]).data;

  const setRoom = async (on: boolean) => {
    const patch = { waitingRoom: on, admitPerSecond: perSecond };
    await api.setSwitches("booking", patch);
    await api.setSwitches("booking-2", patch).catch(() => undefined);
  };

  const send = async () => {
    setRunning(true);
    setError(null);
    stop.current = false;
    try {
      await setRoom(true);
      const crowd: Bot[] = Array.from({ length: size }, (_, i) => ({
        user: `bot-${String(i + 1).padStart(3, "0")}`,
        state: "waiting",
      }));
      setBots([...crowd]);
      await Promise.all(crowd.map((b) => api.joinQueue(b.user, showId)));
      while (!stop.current && crowd.some((b) => b.state === "waiting")) {
        await sleep(1000);
        const free = (await api.show(showId)).seats.filter((s) => s.status === "AVAILABLE");
        for (const b of crowd.filter((x) => x.state === "waiting")) {
          const t = await api.queueMe(b.user, showId);
          if (t.status !== "ADMITTED") continue;
          b.state = "admitted";
          const seat = free.splice(Math.floor(Math.random() * free.length), 1)[0];
          if (!seat) {
            b.state = "no seat";
            continue;
          }
          try {
            const h = await api.hold(b.user, showId, [seat.seatNo], t.token);
            Object.assign(b, { state: "holding", seat: seat.seatNo, holdId: h.id });
          } catch (e) {
            b.state = e instanceof ApiError && e.code === "SEATS_UNAVAILABLE" ? "no seat" : b.state;
          }
        }
        setBots([...crowd]);
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setRunning(false);
    }
  };

  const cleanUp = async () => {
    stop.current = true;
    try {
      await Promise.all(bots.filter((b) => b.holdId).map((b) => api.release(b.user, b.holdId!)));
      await api.resetQueue(showId);
      await setRoom(false);
      setBots([]);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const count = (state: Bot["state"]) => bots.filter((b) => b.state === state).length;
  return (
    <section className="rounded-lg bg-white p-4 shadow" aria-label="Scenario flash crowd">
      <h3 className="font-semibold">Flash crowd and waiting room</h3>
      <p className="text-sm text-gray-600">
        A crowd of bots opens a show at the same second. With the waiting room on they queue in
        Redis and are let in {perSecond} per second; each admitted bot holds one seat. Open the show
        in another tab to see it fill up, or to stand in the line yourself.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col">
          Show
          <select
            aria-label="Crowd show"
            className="rounded border px-1"
            value={showId}
            onChange={(e) => setShowId(e.target.value)}
          >
            {shows.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id} · {s.movie.title} ({s.seatsAvailable} free)
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col">
          Crowd
          <input
            aria-label="Crowd size"
            type="number"
            min={1}
            max={200}
            className="w-20 rounded border px-1"
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
          />
        </label>
        <label className="flex flex-col">
          Let in per second
          <input
            aria-label="Admit per second"
            type="number"
            min={1}
            max={50}
            className="w-20 rounded border px-1"
            value={perSecond}
            onChange={(e) => setPerSecond(Number(e.target.value))}
          />
        </label>
        <button
          className="rounded bg-rose-700 px-3 py-1 font-medium text-white disabled:opacity-40"
          disabled={running}
          onClick={() => void send()}
        >
          Send the crowd
        </button>
        <button className="rounded border px-2 py-1" onClick={() => void cleanUp()}>
          Stop, release and turn the room off
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm md:grid-cols-5" aria-label="Crowd stats">
        <Stat label="Room" value={stats?.enabled ? "on" : "off"} />
        <Stat label="In line (Redis)" value={stats?.waiting ?? 0} name="waiting" />
        <Stat label="Let in so far" value={stats?.admittedTotal ?? 0} name="admitted" />
        <Stat label="Bots holding a seat" value={count("holding")} name="holding" />
        <Stat label="Bots without a seat" value={count("no seat")} name="no-seat" />
      </dl>
    </section>
  );
}

function Stat({ label, value, name }: { label: string; value: string | number; name?: string }) {
  return (
    <div className="rounded bg-gray-50 p-2">
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="text-lg font-semibold" data-stat={name}>
        {value}
      </dd>
    </div>
  );
}
