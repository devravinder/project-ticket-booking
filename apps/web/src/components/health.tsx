import type { Health as HealthBody } from "@tix/contracts";
import { api, type ServiceName } from "../api.js";
import { usePoll } from "../hooks.js";

const SERVICES: { name: ServiceName; label: string; optional?: boolean }[] = [
  { name: "booking", label: "booking-service :7001" },
  { name: "booking-2", label: "booking-service :7011 (second instance)", optional: true },
  { name: "gateway", label: "payment-gateway :7002" },
];

export function Health() {
  return (
    <section className="grid gap-4 md:grid-cols-3">
      {SERVICES.map((s) => (
        <ServiceCard key={s.name} {...s} />
      ))}
    </section>
  );
}

function ServiceCard({ name, label, optional }: (typeof SERVICES)[number]) {
  const { data, error } = usePoll<HealthBody>(() => api.health(name), 2000);
  const checks = data
    ? Object.entries(data).filter(
        (e): e is [string, { ok: boolean; detail: string }] =>
          typeof e[1] === "object" && e[1] !== null,
      )
    : [];
  const up = Boolean(data) && checks.every(([, c]) => c.ok);
  return (
    <article
      className="rounded-lg bg-white p-4 shadow"
      aria-label={`Health ${name}`}
      data-up={up ? "yes" : "no"}
    >
      <h2 className="flex items-center justify-between font-semibold">
        {label}
        <span
          className={`rounded px-2 py-0.5 text-xs ${up ? "bg-green-100 text-green-900" : "bg-red-100 text-red-900"}`}
        >
          {up ? "UP" : "DOWN"}
        </span>
      </h2>
      {error && (
        <p className="mt-2 text-sm text-red-700">
          {optional ? "Not running (optional): " : "Unreachable: "}
          {error}
        </p>
      )}
      <ul className="mt-2 space-y-1 text-sm">
        {checks.map(([key, c]) => (
          <li key={key} className={c.ok ? "text-gray-700" : "text-red-700"}>
            {c.ok ? "✔" : "✘"} {key}: {c.detail}
          </li>
        ))}
      </ul>
    </article>
  );
}
