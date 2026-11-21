import { useState } from "react";
import { Health } from "./components/health.js";
import { Lab } from "./components/lab/lab.js";
import { ShowPage } from "./components/show-page.js";
import { Shows } from "./components/shows.js";

// Per tab, so two tabs can be two people racing for one seat.
const SESSION_KEY = "tix.user";

type Tab = "shows" | "lab" | "status";
const TABS: { id: Tab; label: string }[] = [
  { id: "shows", label: "Shows" },
  { id: "lab", label: "Lab" },
  { id: "status", label: "Status" },
];

export function App() {
  const [user, setUser] = useState(() => sessionStorage.getItem(SESSION_KEY));
  const [tab, setTab] = useState<Tab>("shows");
  const [showId, setShowId] = useState<string | null>(null);

  if (!user) {
    return (
      <Login
        onDone={(name) => {
          sessionStorage.setItem(SESSION_KEY, name);
          setUser(name);
        }}
      />
    );
  }

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
        <span className="text-sm">
          <span aria-label="Current user">{user}</span>{" "}
          <button
            className="ml-2 underline"
            onClick={() => {
              sessionStorage.removeItem(SESSION_KEY);
              setUser(null);
            }}
          >
            Switch user
          </button>
        </span>
      </header>
      <main className="mx-auto max-w-6xl p-6">
        {tab === "shows" &&
          (showId ? (
            <ShowPage user={user} showId={showId} onBack={() => setShowId(null)} />
          ) : (
            <Shows onOpen={setShowId} />
          ))}
        {tab === "lab" && <Lab />}
        {tab === "status" && <Health />}
      </main>
    </div>
  );
}

function Login({ onDone }: { onDone: (user: string) => void }) {
  const [name, setName] = useState("");
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-100">
      <form
        className="w-80 rounded-lg bg-white p-6 shadow"
        onSubmit={(event) => {
          event.preventDefault();
          onDone(name.trim().toLowerCase());
        }}
      >
        <h1 className="text-xl font-semibold text-rose-800">Tix</h1>
        <p className="mt-1 text-sm text-gray-600">
          Pick a user name. No password: this runs only on your machine.
        </p>
        <label className="mt-4 block text-sm font-medium" htmlFor="user">
          User name
        </label>
        <input
          id="user"
          autoFocus
          className="mt-1 w-full rounded border px-3 py-2"
          value={name}
          onChange={(e) => setName(e.target.value)}
          pattern="[a-zA-Z0-9_\-]{3,30}"
          required
        />
        <button className="mt-4 w-full rounded bg-rose-700 py-2 font-medium text-white">
          Continue
        </button>
      </form>
    </main>
  );
}
