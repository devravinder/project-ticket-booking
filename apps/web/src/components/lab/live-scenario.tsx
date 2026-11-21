import type { LiveStats } from "@tix/contracts";
import { useState } from "react";
import { api, type ServiceName } from "../../api.js";
import { errorText, usePoll } from "../../hooks.js";

const INSTANCES: { service: ServiceName; label: string }[] = [
  { service: "booking", label: "instance :7001" },
  { service: "booking-2", label: "instance :7011" },
];

// Open a show in two tabs, one per instance; changes still reach both (LISTEN/NOTIFY).
export function LiveScenario() {
  return (
    <section className="rounded-lg bg-white p-4 shadow" aria-label="Scenario live">
      <h3 className="font-semibold">Live seat map across instances</h3>
      <p className="text-sm text-gray-600">
        Open a show in two tabs and pick a different "via instance" in each. A hold on one instance
        reaches viewers of the other through Postgres NOTIFY. Drop an instance's LISTEN connection
        to see it reconnect and send every open map a fresh snapshot.
      </p>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {INSTANCES.map((i) => (
          <InstanceCard key={i.service} {...i} />
        ))}
      </div>
    </section>
  );
}

function InstanceCard({ service, label }: (typeof INSTANCES)[number]) {
  const { data, error, refresh } = usePoll<LiveStats>(() => api.liveStats(service), 1000, [
    service,
  ]);
  const [problem, setProblem] = useState<string | null>(null);
  const viewers = data ? Object.values(data.viewers).reduce((a, b) => a + b, 0) : 0;
  const drop = async () => {
    try {
      await api.dropLive(service);
    } catch (e) {
      setProblem(errorText(e));
    } finally {
      refresh();
    }
  };
  return (
    <article className="rounded border p-3 text-sm" aria-label={`Live ${service}`}>
      <h4 className="font-medium">{label}</h4>
      {error && <p className="text-red-700">Not running</p>}
      {data && (
        <ul className="mt-1 space-y-0.5">
          <li data-listening={String(data.listening)}>
            LISTEN: {data.listening ? "✔ connected" : "✘ reconnecting"}
          </li>
          <li>open seat maps: {viewers}</li>
          <li>notifications received: {data.received}</li>
          <li aria-label={`Reconnects ${service}`}>reconnects: {data.reconnects}</li>
        </ul>
      )}
      <button
        className="mt-2 rounded border px-2 py-1 disabled:opacity-40"
        disabled={!data}
        onClick={() => void drop()}
      >
        Drop LISTEN connection
      </button>
      {problem && <p className="text-red-700">{problem}</p>}
    </article>
  );
}
