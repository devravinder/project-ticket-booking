import { Inject, Injectable } from "@nestjs/common";
import { type GatewaySession, IDEMPOTENCY_HEADER } from "@tix/contracts";
import { fail, SERVICE_CONFIG } from "@tix/kit";
import type { BookingConfig } from "../config.js";

const TIMEOUT_MS = 5000;

export class GatewayError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code: string | null,
  ) {
    super(message);
  }
}

// Every call is safe to repeat: creates and refunds carry an idempotency key (ADR-009).
@Injectable()
export class GatewayClient {
  constructor(@Inject(SERVICE_CONFIG) private readonly config: BookingConfig) {}

  createSession(
    key: string,
    body: { merchantRef: string; amountCents: number; expiresAt: string; returnUrl: string },
  ): Promise<GatewaySession> {
    return this.call("POST", "/sessions", key, { ...body, webhookUrl: this.config.WEBHOOK_URL });
  }

  getSession(id: string): Promise<GatewaySession> {
    return this.call("GET", `/sessions/${encodeURIComponent(id)}`);
  }

  refund(id: string, key: string): Promise<GatewaySession> {
    return this.call("POST", `/sessions/${encodeURIComponent(id)}/refund`, key);
  }

  private async call<T>(method: string, path: string, key?: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.config.GATEWAY_URL}${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          ...(key ? { [IDEMPOTENCY_HEADER]: key } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      const err = e as Error & { cause?: { code?: string } };
      throw new GatewayError(`gateway unreachable: ${err.cause?.code ?? err.message}`, null, null);
    }
    const json = (await res.json().catch(() => null)) as { code?: string; message?: string } | null;
    if (!res.ok) {
      throw new GatewayError(
        json?.message ?? `gateway HTTP ${res.status}`,
        res.status,
        json?.code ?? null,
      );
    }
    return json as T;
  }
}

// For request handlers: the customer sees a clear 502 instead of a stack trace.
export function gatewayFailed(error: unknown): never {
  if (error instanceof GatewayError) {
    fail(502, "GATEWAY_UNAVAILABLE", error.message, { gatewayCode: error.code });
  }
  throw error;
}
