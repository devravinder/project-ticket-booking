import type { Booking, ShowSummary } from "@tix/contracts";
import { useState } from "react";
import { api } from "../../api.js";
import { errorText, usePoll } from "../../hooks.js";
import { BookingDetail } from "../bookings.js";
import type { Ctx, Scenario } from "./scenarios.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Runs one payment scenario end to end and shows the booking's own timeline.
export function CheckoutLab({ title, scenarios }: { title: string; scenarios: Scenario[] }) {
  const shows = usePoll<ShowSummary[]>(api.shows, 5000).data ?? [];
  const [showId, setShowId] = useState("SHOW-2");
  const [running, setRunning] = useState<string | null>(null);
  const [steps, setSteps] = useState<string[]>([]);
  const [result, setResult] = useState<{ scenario: Scenario; booking: Booking } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (s: Scenario) => {
    setRunning(s.id);
    setSteps([]);
    setResult(null);
    setError(null);
    const step = (text: string) => setSteps((all) => [...all, text]);
    const user = `lab-${s.id}`.slice(0, 30);
    let current: Booking | null = null;
    const ctx: Ctx = {
      user,
      showId,
      step,
      sleep,
      hold: async (count = 1) => {
        const show = await api.show(showId);
        const free = show.seats.filter((x) => x.status === "AVAILABLE").slice(-count);
        if (free.length < count) throw new Error("not enough free seats in this show");
        const h = await api.hold(
          user,
          showId,
          free.map((x) => x.seatNo),
        );
        step(`${user} holds ${h.seats.join(", ")}`);
        return h;
      },
      checkout: async (h) => {
        current = await api.checkout(user, h.id);
        step(`checkout: booking ${current.id.slice(0, 8)}, gateway session ${current.sessionId}`);
        return current;
      },
      pay: async (b, outcome = "approve") => {
        step(outcome === "approve" ? "customer presses Pay on the gateway…" : "card is declined…");
        const s2 = await api.gatewayPay(b.sessionId!, outcome);
        step(`gateway: session ${s2.status}`);
      },
      verify: async (b, via = "booking") => {
        step(`customer back at the shop (${via}): ask the gateway`);
        await api.verifyVia(via, b.id);
      },
      waitFor: async (b, done, ms = 10_000) => {
        const end = Date.now() + ms;
        for (;;) {
          const now = await api.booking(b.id);
          if (done(now) || Date.now() > end) return now;
          await sleep(300);
        }
      },
    };
    try {
      if (s.booking) {
        await api.setSwitches("booking", s.booking);
        await api.setSwitches("booking-2", s.booking).catch(() => undefined);
      }
      if (s.gateway) await api.setSwitches("gateway", s.gateway);
      const booking = await s.run(ctx);
      setResult({ scenario: s, booking });
    } catch (e) {
      setError(errorText(e));
      if (current) setResult({ scenario: s, booking: current });
    } finally {
      await Promise.all([
        api.resetSwitches("booking"),
        api.resetSwitches("booking-2").catch(() => undefined),
        api.resetSwitches("gateway"),
      ]).catch(() => undefined);
      setRunning(null);
    }
  };

  const passed = result && result.booking.status === result.scenario.expect;
  return (
    <section className="rounded-lg bg-white p-4 shadow" aria-label={`Scenario ${title}`}>
      <h3 className="font-semibold">{title}</h3>
      <label className="mt-1 flex items-center gap-2 text-sm">
        Show
        <select
          aria-label={`${title} show`}
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
      <ul className="mt-3 grid gap-2 md:grid-cols-2">
        {scenarios.map((s) => (
          <li key={s.id} className="rounded border p-2 text-sm">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-medium">{s.title}</p>
                <p className="text-xs text-gray-600">{s.explain}</p>
                <p className="text-xs text-gray-500">expected: {s.expect}</p>
              </div>
              <button
                className="shrink-0 rounded bg-rose-700 px-2 py-1 text-white disabled:opacity-40"
                disabled={running !== null}
                aria-label={`Run ${s.id}`}
                onClick={() => void run(s)}
              >
                {running === s.id ? "Running…" : "Run"}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {steps.length > 0 && (
        <ol className="mt-3 list-decimal pl-5 text-sm" aria-label="Scenario steps">
          {steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      )}
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      {result && (
        <div className="mt-3">
          <p
            className={`font-medium ${passed ? "text-green-800" : "text-red-700"}`}
            aria-label="Scenario verdict"
            data-pass={passed ? "yes" : "no"}
          >
            {passed ? "✔" : "✘"} {result.scenario.title}: booking is {result.booking.status}
            {passed ? ", as expected" : `, expected ${result.scenario.expect}`}
          </p>
          <div className="mt-2">
            <BookingDetail id={result.booking.id} />
          </div>
        </div>
      )}
    </section>
  );
}
