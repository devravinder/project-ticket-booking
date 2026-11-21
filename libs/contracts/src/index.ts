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
};

export type ShowDetail = ShowSummary & { rows: string[]; cols: number; seats: Seat[] };
