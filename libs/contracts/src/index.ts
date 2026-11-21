// Types shared by the services and the web app. No runtime dependencies.

// No login (ADR-001): the caller names itself in this header.
export const USER_HEADER = "x-user";

export type Check = { ok: boolean; detail: string };

export type Health = {
  service: string;
  port: number;
  postgres: Check;
  redis?: Check;
};

export type ApiErrorBody = { statusCode: number; code: string; message: string };

export type Tier = "REGULAR" | "PREMIUM";
export type SeatStatus = "AVAILABLE" | "HELD" | "BOOKED";

export type Movie = { id: string; title: string; minutes: number; rating: string };

export type ShowSummary = {
  id: string;
  movie: Movie;
  screen: { id: string; name: string };
  startsAt: string;
  priceFromCents: number;
  seatsTotal: number;
  seatsAvailable: number;
};

export type Seat = {
  seatNo: string;
  row: string;
  col: number;
  tier: Tier;
  priceCents: number;
  status: SeatStatus;
  // Lets the browser colour its own held seats; releasing still needs the right X-User.
  holdId: string | null;
};

export type ShowDetail = ShowSummary & { rows: string[]; cols: number; seats: Seat[] };

export const HOLD_MODES = ["atomic", "pessimistic", "naive"] as const;
export type HoldMode = (typeof HOLD_MODES)[number];
export type HoldStatus = "HELD" | "RELEASED" | "EXPIRED" | "BOOKED";

export const MAX_SEATS_PER_HOLD = 6;

export type Hold = {
  id: string;
  showId: string;
  user: string;
  seats: string[];
  amountCents: number;
  // EXPIRED once expiresAt passes, even before the sweeper has run.
  status: HoldStatus;
  expiresAt: string;
  createdAt: string;
  // Seats still pointing at this hold; less than seats.length only in naive mode.
  seatsStillHeld: number;
};

export type SeatsUnavailable = ApiErrorBody & { code: "SEATS_UNAVAILABLE"; unavailable: string[] };

export type LiveStats = {
  service: string;
  listening: boolean;
  received: number;
  reconnects: number;
  viewers: Record<string, number>;
};
