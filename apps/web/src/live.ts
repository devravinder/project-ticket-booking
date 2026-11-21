import type { Seat, ShowDetail } from "@tix/contracts";
import { useEffect, useState } from "react";
import type { ServiceName } from "./api.js";

export type LiveState = "connecting" | "live" | "reconnecting";
export type LiveShow = ShowDetail & { via: string };

// Snapshot first, then changed seats only. EventSource reconnects by itself (ADR-008).
export function useLiveShow(showId: string, service: ServiceName = "booking") {
  const [show, setShow] = useState<LiveShow | null>(null);
  const [state, setState] = useState<LiveState>("connecting");
  const [updates, setUpdates] = useState(0);

  useEffect(() => {
    setShow(null);
    setState("connecting");
    const source = new EventSource(`/api/${service}/shows/${encodeURIComponent(showId)}/events`);
    source.addEventListener("snapshot", (e) => {
      setShow(JSON.parse((e as MessageEvent<string>).data) as LiveShow);
      setState("live");
    });
    source.addEventListener("seats", (e) => {
      const { seats } = JSON.parse((e as MessageEvent<string>).data) as { seats: Seat[] };
      const changed = new Map(seats.map((s) => [s.seatNo, s]));
      setShow(
        (current) =>
          current && {
            ...current,
            seats: current.seats.map((s) => changed.get(s.seatNo) ?? s),
            seatsAvailable:
              current.seatsAvailable +
              seats.reduce((d, s) => {
                const before = current.seats.find((x) => x.seatNo === s.seatNo);
                return (
                  d + (s.status === "AVAILABLE" ? 1 : 0) - (before?.status === "AVAILABLE" ? 1 : 0)
                );
              }, 0),
          },
      );
      setUpdates((n) => n + 1);
    });
    source.onerror = () => setState("reconnecting");
    return () => source.close();
  }, [showId, service]);

  return { show, state, updates };
}
