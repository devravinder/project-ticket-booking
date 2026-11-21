import { useState } from "react";
import { Health } from "./components/health.js";

type Tab = "status";
const TABS: { id: Tab; label: string }[] = [{ id: "status", label: "Status" }];

export function App() {
  const [tab, setTab] = useState<Tab>("status");
  return (
    <div className="min-h-screen bg-gray-100 text-gray-900">
      <header className="flex items-center justify-between bg-rose-800 px-6 py-3 text-white">
        <h1 className="text-xl font-semibold">Tix</h1>
        <nav className="flex gap-1" aria-label="Main">
          {TABS.map((t) => (
            <button
              key={t.id}
              aria-current={tab === t.id ? "page" : undefined}
              className={`rounded px-3 py-1 ${tab === t.id ? "bg-white text-rose-800" : "hover:bg-rose-700"}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl p-6">{tab === "status" && <Health />}</main>
    </div>
  );
}
