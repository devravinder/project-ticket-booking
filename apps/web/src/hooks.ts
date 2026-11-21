import { useCallback, useEffect, useRef, useState } from "react";

// Refetches every intervalMs while mounted. Lists and status only; the seat map is live (SSE).
export function usePoll<T>(load: () => Promise<T>, intervalMs: number, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const value = await loadRef.current();
        if (!stopped) {
          setData(value);
          setError(null);
        }
      } catch (e) {
        if (!stopped) setError((e as Error).message);
      }
      if (!stopped) timer = setTimeout(tick, intervalMs);
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [intervalMs, nonce, ...deps]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, refresh };
}

export const money = (cents: number | null | undefined) =>
  cents == null ? "-" : `₹${(cents / 100).toFixed(2)}`;

export const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

// Milliseconds left until iso, re-rendering every 250 ms.
export function useCountdown(iso: string | null | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!iso) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [iso]);
  return iso ? Math.max(0, new Date(iso).getTime() - now) : 0;
}

export const clock = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export const errorText = (error: unknown) => (error as Error).message;
