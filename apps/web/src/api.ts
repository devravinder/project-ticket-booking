import {
  type Booking,
  type ConsistencyReport,
  type GatewaySession,
  type GatewaySessionDetail,
  type Health,
  type Hold,
  type LiveStats,
  type ShowDetail,
  type ShowSummary,
  USER_HEADER,
} from "@tix/contracts";

export type ServiceName = "booking" | "booking-2" | "gateway";
export type Switches = Record<string, string | number | boolean>;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly body: Record<string, unknown> | null,
  ) {
    super(message);
  }
}

async function request<T>(service: ServiceName, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/${service}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(
      response.status,
      body?.code ?? "HTTP_ERROR",
      body?.message ?? `${service}: HTTP ${response.status}`,
      body,
    );
  }
  return body as T;
}

export const as = (user: string) => ({ [USER_HEADER]: user });
const json = (value: unknown) => JSON.stringify(value);

export const api = {
  // A 503 still carries the checks, so the status page can say what is down.
  health: async (service: ServiceName): Promise<Health> => {
    try {
      return await request<Health>(service, "/health");
    } catch (error) {
      if (error instanceof ApiError && error.body?.service) return error.body as Health;
      throw error;
    }
  },
  shows: () => request<ShowSummary[]>("booking", "/shows"),
  show: (id: string) => request<ShowDetail>("booking", `/shows/${id}`),
  hold: (user: string, showId: string, seats: string[]) =>
    api.holdVia("booking", user, showId, seats),
  // The Lab sends some racers to the second instance.
  holdVia: (service: ServiceName, user: string, showId: string, seats: string[]) =>
    request<Hold>(service, `/shows/${showId}/holds`, {
      method: "POST",
      headers: as(user),
      body: json({ seats }),
    }),
  myHolds: (user: string, showId: string) =>
    request<Hold[]>("booking", `/holds?showId=${encodeURIComponent(showId)}`, {
      headers: as(user),
    }),
  getHold: (id: string) => request<Hold>("booking", `/holds/${id}`),
  consistency: () => request<ConsistencyReport>("booking", "/admin/consistency"),
  liveStats: (service: ServiceName) => request<LiveStats>(service, "/admin/live"),
  gatewaySessions: () => request<GatewaySession[]>("gateway", "/admin/sessions"),
  gatewaySession: (id: string) => request<GatewaySessionDetail>("gateway", `/admin/sessions/${id}`),
  redeliver: (eventId: string) =>
    request<unknown>("gateway", `/admin/webhooks/${eventId}/redeliver`, { method: "POST" }),
  dropLive: (service: ServiceName) =>
    request<{ dropped: boolean }>(service, "/admin/live/drop-connection", { method: "POST" }),
  release: (user: string, holdId: string) =>
    request<Hold>("booking", `/holds/${holdId}`, { method: "DELETE", headers: as(user) }),
  checkout: (user: string, holdId: string) =>
    request<Booking>("booking", `/holds/${holdId}/checkout`, { method: "POST", headers: as(user) }),
  bookings: (user: string) => request<Booking[]>("booking", "/bookings", { headers: as(user) }),
  booking: (id: string) => request<Booking>("booking", `/bookings/${id}`),
  verify: (id: string) => api.verifyVia("booking", id),
  verifyVia: (service: ServiceName, id: string) =>
    request<Booking>(service, `/bookings/${id}/verify`, { method: "POST" }),
  // Lab: press Pay or Decline on the gateway without opening its page.
  gatewayPay: (sessionId: string, outcome: "approve" | "decline") =>
    request<GatewaySession>("gateway", `/sessions/${sessionId}/pay`, {
      method: "POST",
      body: json({ outcome }),
    }),
  switches: (service: ServiceName) => request<Switches>(service, "/admin/switches"),
  setSwitches: (service: ServiceName, patch: Switches) =>
    request<Switches>(service, "/admin/switches", { method: "PUT", body: json(patch) }),
  resetSwitches: (service: ServiceName) =>
    request<Switches>(service, "/admin/switches/reset", { method: "PUT" }),
};
