import { CRASH_POINTS, HOLD_MODES } from "@tix/contracts";
import { useState } from "react";
import { api, type ServiceName, type Switches } from "../../api.js";
import { errorText, usePoll } from "../../hooks.js";

// Mirrors the services' allowed values; the service rejects anything else anyway.
const CHOICES: Record<string, readonly string[]> = {
  holdMode: HOLD_MODES,
  crashPoint: CRASH_POINTS,
};

export function SwitchesPanel({ service, title }: { service: ServiceName; title: string }) {
  const { data, error, refresh } = usePoll<Switches>(() => api.switches(service), 1000, [service]);
  const [problem, setProblem] = useState<string | null>(null);
  const set = async (patch: Switches) => {
    try {
      setProblem(null);
      await api.setSwitches(service, patch);
    } catch (e) {
      setProblem(errorText(e));
    } finally {
      refresh();
    }
  };
  const reset = async () => {
    try {
      await api.resetSwitches(service);
    } catch (e) {
      setProblem(errorText(e));
    } finally {
      refresh();
    }
  };
  return (
    <section className="rounded-lg bg-white p-4 shadow" aria-label={`Switches ${service}`}>
      <h3 className="flex justify-between font-semibold">
        {title}
        <button className="text-xs underline" onClick={() => void reset()}>
          Reset
        </button>
      </h3>
      {error && <p className="text-sm text-red-700">Not reachable: {error}</p>}
      <dl className="mt-2 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-sm">
        {data &&
          Object.entries(data).map(([name, value]) => (
            <SwitchRow
              key={name}
              name={name}
              value={value}
              onSet={(v) => void set({ [name]: v })}
            />
          ))}
      </dl>
      {problem && <p className="mt-2 text-sm text-red-700">{problem}</p>}
    </section>
  );
}

type Value = string | number | boolean;

function SwitchRow({
  name,
  value,
  onSet,
}: {
  name: string;
  value: Value;
  onSet: (v: Value) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const label = <dt className="font-mono text-xs">{name}</dt>;
  if (typeof value === "boolean") {
    return (
      <>
        {label}
        <dd>
          <input
            type="checkbox"
            aria-label={name}
            checked={value}
            onChange={(e) => onSet(e.target.checked)}
          />
        </dd>
      </>
    );
  }
  if (CHOICES[name]) {
    return (
      <>
        {label}
        <dd>
          <select
            aria-label={name}
            className="rounded border px-1"
            value={String(value)}
            onChange={(e) => onSet(e.target.value)}
          >
            {CHOICES[name].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </dd>
      </>
    );
  }
  return (
    <>
      {label}
      <dd>
        <form
          className="flex gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            onSet(typeof value === "number" ? Number(draft) : draft);
          }}
        >
          <input
            aria-label={name}
            className="w-28 rounded border px-1"
            value={draft}
            onFocus={() => setDraft(String(value))}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button className="rounded border px-2 text-xs">Set</button>
          <span className="self-center text-xs text-gray-500">now {String(value)}</span>
        </form>
      </dd>
    </>
  );
}
