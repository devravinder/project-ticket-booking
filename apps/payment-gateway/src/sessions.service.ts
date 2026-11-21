import { createHash, randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type {
  GatewaySession,
  GatewaySessionDetail,
  SessionStatus,
  WebhookDelivery,
  WebhookType,
} from "@tix/contracts";
import { Database, fail, SERVICE_CONFIG, sleep, Switches, type Tx } from "@tix/kit";
import type { GatewayConfig } from "./config.js";

export type NewSession = {
  merchantRef: string;
  amountCents: number;
  returnUrl: string;
  webhookUrl: string;
  expiresAt: string;
};

type Row = {
  id: string;
  merchantRef: string;
  amountCents: number;
  status: SessionStatus;
  returnUrl: string;
  webhookUrl: string;
  expiresAt: Date;
  paidAt: Date | null;
  createdAt: Date;
};

const newId = (prefix: string) => `${prefix}_${randomBytes(12).toString("base64url")}`;

// An OPEN session past its expiry reads as EXPIRED, swept or not.
const SESSION_SQL = `
  SELECT id, merchant_ref AS "merchantRef", amount_cents AS "amountCents",
         CASE WHEN status = 'OPEN' AND expires_at <= now() THEN 'EXPIRED' ELSE status END AS status,
         return_url AS "returnUrl", webhook_url AS "webhookUrl", expires_at AS "expiresAt",
         paid_at AS "paidAt", created_at AS "createdAt"
  FROM sessions`;

@Injectable()
export class SessionsService {
  constructor(
    @Inject(SERVICE_CONFIG) private readonly config: GatewayConfig,
    @Inject(Database) private readonly db: Database,
    @Inject(Switches) private readonly switches: Switches,
  ) {}

  // Same key and body: the first session again. Same key, other body: a client bug (422).
  async create(
    key: string,
    input: NewSession,
  ): Promise<{ session: GatewaySession; replayed: boolean }> {
    const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const inserted = await this.db.query<{ id: string }>(
      `INSERT INTO sessions (id, idempotency_key, request_hash, merchant_ref, amount_cents,
                             return_url, webhook_url, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
      [
        newId("ps"),
        key,
        hash,
        input.merchantRef,
        input.amountCents,
        input.returnUrl,
        input.webhookUrl,
        input.expiresAt,
      ],
    );
    if (inserted.rows[0]) return { session: await this.get(inserted.rows[0].id), replayed: false };
    const existing = await this.db.query<{ id: string; request_hash: string }>(
      "SELECT id, request_hash FROM sessions WHERE idempotency_key = $1",
      [key],
    );
    if (existing.rows[0]!.request_hash !== hash) {
      fail(422, "IDEMPOTENCY_KEY_REUSED", "this Idempotency-Key was used for a different request");
    }
    return { session: await this.get(existing.rows[0]!.id), replayed: true };
  }

  async get(id: string): Promise<GatewaySession> {
    const { rows } = await this.db.query<Row>(`${SESSION_SQL} WHERE id = $1`, [id]);
    if (!rows[0]) fail(404, "SESSION_NOT_FOUND", `payment session ${id} does not exist`);
    return this.view(rows[0]);
  }

  async detail(id: string): Promise<GatewaySessionDetail> {
    const session = await this.get(id);
    const { rows } = await this.db.query<WebhookDelivery>(
      `SELECT id, type, status, attempts, last_error AS "lastError", delivered_at AS "deliveredAt",
              created_at AS "createdAt"
       FROM webhook_events WHERE session_id = $1 ORDER BY created_at`,
      [id],
    );
    return { ...session, webhooks: rows };
  }

  async list(merchantRef?: string): Promise<GatewaySession[]> {
    const { rows } = await this.db.query<Row>(
      `${SESSION_SQL} WHERE ($1::text IS NULL OR merchant_ref = $1) ORDER BY created_at DESC LIMIT 50`,
      [merchantRef ?? null],
    );
    return rows.map((r) => this.view(r));
  }

  // The customer pressed Pay or Decline. Started in time means it may finish after expiry.
  async pay(id: string, outcome: "approve" | "decline"): Promise<GatewaySession> {
    const started = await this.db.query(
      `UPDATE sessions SET status = 'PROCESSING', updated_at = now()
       WHERE id = $1 AND status = 'OPEN' AND expires_at > now()`,
      [id],
    );
    if (!started.rowCount) {
      const session = await this.get(id);
      fail(409, "SESSION_NOT_OPEN", `payment session is ${session.status.toLowerCase()}`, {
        status: session.status,
      });
    }
    // Banks can be slow; the Lab uses this to make a payment finish after the hold expired.
    await sleep(this.switches.get<number>("slowPayMs"));
    const status = outcome === "approve" ? "PAID" : "DECLINED";
    await this.db.tx(async (c) => {
      await c.query(
        `UPDATE sessions SET status = $2, paid_at = CASE WHEN $2 = 'PAID' THEN now() END,
                updated_at = now() WHERE id = $1`,
        [id, status],
      );
      await this.emit(c, id, status === "PAID" ? "payment.succeeded" : "payment.failed");
    });
    return this.get(id);
  }

  async refund(id: string, key: string): Promise<GatewaySession> {
    return this.db.tx(async (c) => {
      const { rows } = await c.query<{ status: SessionStatus; amount_cents: number }>(
        "SELECT status, amount_cents FROM sessions WHERE id = $1 FOR UPDATE",
        [id],
      );
      const row = rows[0];
      if (!row) fail(404, "SESSION_NOT_FOUND", `payment session ${id} does not exist`);
      const done = await c.query<{ idempotency_key: string }>(
        "SELECT idempotency_key FROM refunds WHERE session_id = $1",
        [id],
      );
      if (done.rows[0]) {
        if (done.rows[0].idempotency_key !== key) {
          fail(409, "ALREADY_REFUNDED", "this payment was already refunded");
        }
      } else {
        if (row.status !== "PAID") {
          fail(409, "NOT_REFUNDABLE", `a ${row.status.toLowerCase()} payment cannot be refunded`);
        }
        await c.query(
          "INSERT INTO refunds (id, session_id, idempotency_key, amount_cents) VALUES ($1, $2, $3, $4)",
          [newId("rf"), id, key, row.amount_cents],
        );
        await c.query("UPDATE sessions SET status = 'REFUNDED', updated_at = now() WHERE id = $1", [
          id,
        ]);
        await this.emit(c, id, "refund.succeeded");
      }
      const { rows: view } = await c.query<Row>(`${SESSION_SQL} WHERE id = $1`, [id]);
      return this.view(view[0]!);
    });
  }

  // Outbox: the event exists exactly when the status change committed (ADR-009).
  private async emit(c: Tx, sessionId: string, type: WebhookType): Promise<void> {
    const { rows } = await c.query<Row>(`${SESSION_SQL} WHERE id = $1`, [sessionId]);
    const s = rows[0]!;
    const id = newId("evt");
    const payload = {
      id,
      type,
      createdAt: new Date().toISOString(),
      data: { sessionId, merchantRef: s.merchantRef, amountCents: s.amountCents, status: s.status },
    };
    const status = this.switches.get<boolean>("dropWebhooks") ? "DROPPED" : "PENDING";
    const delayMs = this.switches.get<number>("webhookDelayMs");
    await c.query(
      `INSERT INTO webhook_events (id, session_id, type, payload, url, status, next_attempt_at)
       VALUES ($1, $2, $3, $4, $5, $6, now() + $7 * interval '1 millisecond')`,
      [id, sessionId, type, JSON.stringify(payload), s.webhookUrl, status, delayMs],
    );
  }

  private view(r: Row): GatewaySession {
    return {
      id: r.id,
      merchantRef: r.merchantRef,
      amountCents: r.amountCents,
      status: r.status,
      payUrl: `${this.config.PUBLIC_URL}/pay/${r.id}`,
      returnUrl: r.returnUrl,
      expiresAt: new Date(r.expiresAt).toISOString(),
      paidAt: r.paidAt && new Date(r.paidAt).toISOString(),
      createdAt: new Date(r.createdAt).toISOString(),
    };
  }
}
