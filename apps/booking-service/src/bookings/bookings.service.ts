import { Inject, Injectable, Logger } from "@nestjs/common";
import type {
  Booking,
  BookingStatus,
  GatewaySession,
  SessionStatus,
  WebhookEvent,
} from "@tix/contracts";
import { Database, fail, SERVICE_CONFIG, Switches, type Tx } from "@tix/kit";
import type { BookingConfig } from "../config.js";
import { HoldsService } from "../holds/holds.service.js";
import { SeatEvents } from "../live/seat-events.js";
import { GatewayClient, gatewayFailed } from "../payments/gateway.client.js";
import { SEAT_IS_FREE } from "../shows/seat-sql.js";

export type Source = "webhook" | "return" | "reconcile";

type Row = {
  id: string;
  hold_id: string;
  show_id: string;
  seat_nos: string[];
  status: BookingStatus;
  session_id: string | null;
};

const BOOKING_SQL = `
  SELECT b.id, b.hold_id AS "holdId", b.show_id AS "showId", b.user_name AS "user",
         b.seat_nos AS seats, b.amount_cents AS "amountCents", b.status,
         b.session_id AS "sessionId", b.pay_url AS "payUrl",
         b.payment_expires_at AS "paymentExpiresAt", h.expires_at AS "holdExpiresAt",
         b.failure_reason AS "failureReason", b.confirmed_at AS "confirmedAt",
         b.created_at AS "createdAt",
         COALESCE((SELECT json_agg(json_build_object('at', l.at, 'what', l.what, 'detail', l.detail)
                                   ORDER BY l.id)
                   FROM booking_log l WHERE l.booking_id = b.id), '[]') AS log
  FROM bookings b JOIN holds h ON h.id = b.hold_id`;

// Less than this left to pay is not worth sending the customer to the gateway.
const MIN_PAY_WINDOW_MS = 3000;

export async function log(c: Tx, bookingId: string, what: string, detail?: string): Promise<void> {
  await c.query("INSERT INTO booking_log (booking_id, what, detail) VALUES ($1, $2, $3)", [
    bookingId,
    what,
    detail ?? null,
  ]);
}

// Checkout and every way a payment result can arrive; each result is applied once (ADR-010).
@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    @Inject(SERVICE_CONFIG) private readonly config: BookingConfig,
    @Inject(Database) private readonly db: Database,
    @Inject(Switches) private readonly switches: Switches,
    @Inject(HoldsService) private readonly holds: HoldsService,
    @Inject(SeatEvents) private readonly events: SeatEvents,
    @Inject(GatewayClient) private readonly gateway: GatewayClient,
  ) {}

  // Safe to repeat: one booking per hold, one gateway session per booking (same key).
  async checkout(holdId: string, user: string): Promise<Booking> {
    const id = await this.db.tx(async (c) => {
      const existing = await c.query<{ id: string; user_name: string }>(
        "SELECT id, user_name FROM bookings WHERE hold_id = $1",
        [holdId],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].user_name !== user)
          fail(403, "NOT_YOUR_HOLD", "this hold belongs to someone else");
        return existing.rows[0].id;
      }
      const { rows } = await c.query<{
        user_name: string;
        status: string;
        expired: boolean;
        lost: boolean;
        show_id: string;
        seat_nos: string[];
        amount_cents: number;
        pay_until: Date;
        window_ms: number;
      }>(
        `SELECT user_name, status, expires_at <= now() AS expired, show_id, seat_nos, amount_cents,
                (SELECT count(*) FROM show_seats x WHERE x.hold_id = h.id AND x.status = 'HELD')
                  < cardinality(seat_nos) AS lost,
                expires_at - $2 * interval '1 millisecond' AS pay_until,
                extract(epoch FROM expires_at - $2 * interval '1 millisecond' - now()) * 1000 AS window_ms
         FROM holds h WHERE id = $1 FOR UPDATE`,
        [holdId, this.switches.get<number>("paymentMarginMs")],
      );
      const h = rows[0];
      if (!h) fail(404, "HOLD_NOT_FOUND", `hold ${holdId} does not exist`);
      if (h.user_name !== user) fail(403, "NOT_YOUR_HOLD", "this hold belongs to someone else");
      if (h.status !== "HELD" || h.expired) {
        fail(
          409,
          "HOLD_NOT_ACTIVE",
          `the hold is ${h.expired ? "expired" : h.status.toLowerCase()}; hold the seats again`,
        );
      }
      if (h.lost) fail(409, "HOLD_LOST", "some of these seats were taken by someone else");
      if (h.window_ms < MIN_PAY_WINDOW_MS) {
        fail(409, "HOLD_EXPIRING", "too little time left to pay; release and hold again");
      }
      const inserted = await c.query<{ id: string }>(
        `INSERT INTO bookings (hold_id, show_id, user_name, seat_nos, amount_cents, payment_expires_at)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [holdId, h.show_id, user, h.seat_nos, h.amount_cents, h.pay_until],
      );
      const bookingId = inserted.rows[0]!.id;
      await log(c, bookingId, "checkout started", `pay by ${h.pay_until.toISOString()}`);
      return bookingId;
    });
    await this.ensureSession(id);
    return this.get(id);
  }

  // The gateway call happens outside any transaction; a retry reuses the key and gets the same session.
  private async ensureSession(id: string): Promise<void> {
    const b = await this.get(id);
    if (b.sessionId || b.status !== "PENDING_PAYMENT") return;
    let session: GatewaySession;
    try {
      session = await this.gateway.createSession(`booking-${id}`, {
        merchantRef: id,
        amountCents: b.amountCents,
        expiresAt: new Date(b.paymentExpiresAt).toISOString(),
        returnUrl: `${this.config.WEB_URL}/?booking=${id}`,
      });
    } catch (error) {
      await this.db.tx((c) => log(c, id, "could not reach the gateway", (error as Error).message));
      gatewayFailed(error);
    }
    await this.db.tx(async (c) => {
      const r = await c.query(
        "UPDATE bookings SET session_id = $2, pay_url = $3, updated_at = now() WHERE id = $1 AND session_id IS NULL",
        [id, session.id, session.payUrl],
      );
      if (r.rowCount) await log(c, id, "payment session created", session.id);
    });
  }

  // Webhooks: verified by the controller; the inbox row commits with the effect.
  async onWebhook(event: WebhookEvent): Promise<{ result: string }> {
    const result = await this.db.tx(async (c) => {
      const fresh = await c.query(
        "INSERT INTO webhook_inbox (event_id, type, session_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
        [event.id, event.type, event.data.sessionId],
      );
      const bookingId = event.data.merchantRef;
      const known = await c.query("SELECT 1 FROM bookings WHERE id::text = $1", [bookingId]);
      if (!known.rowCount) return "unknown booking";
      if (!fresh.rowCount) {
        await log(c, bookingId, "webhook: duplicate ignored", `${event.type} ${event.id}`);
        return "duplicate";
      }
      await log(c, bookingId, `webhook: ${event.type}`, event.id);
      return this.settle(c, bookingId, event.data.sessionId, event.data.status, "webhook");
    });
    return { result };
  }

  // The customer came back from the pay page. The URL says nothing reliable: ask the gateway.
  async verify(id: string): Promise<Booking> {
    const b = await this.get(id);
    if (!b.sessionId || !["PENDING_PAYMENT", "EXPIRED"].includes(b.status)) return b;
    let session: GatewaySession;
    try {
      session = await this.gateway.getSession(b.sessionId);
    } catch (error) {
      gatewayFailed(error);
    }
    await this.db.tx(async (c) => {
      await log(c, id, "customer returned; asked the gateway", `session is ${session.status}`);
      await this.settle(c, id, session.id, session.status, "return");
    });
    return this.get(id);
  }

  // Applies one payment result. Locks the booking first, so racing sources apply it once.
  async settle(
    c: Tx,
    bookingId: string,
    sessionId: string,
    status: SessionStatus,
    source: Source,
  ): Promise<string> {
    // Lock order everywhere: hold, then booking, then seats (seat-rules skill).
    await c.query(
      "SELECT 1 FROM holds WHERE id = (SELECT hold_id FROM bookings WHERE id = $1) FOR UPDATE",
      [bookingId],
    );
    const { rows } = await c.query<Row>(
      "SELECT id, hold_id, show_id, seat_nos, status, session_id FROM bookings WHERE id = $1 FOR UPDATE",
      [bookingId],
    );
    const b = rows[0];
    if (!b) return "unknown booking";
    if (b.session_id && b.session_id !== sessionId) {
      await log(c, b.id, `${source}: ignored a result for another session`, sessionId);
      return "other session";
    }
    if (!b.session_id) {
      // The session was created but we crashed before storing its id.
      await c.query("UPDATE bookings SET session_id = $2 WHERE id = $1", [b.id, sessionId]);
    }
    if (status === "PAID") return this.confirm(c, b, source);
    if (status === "DECLINED") return this.declined(c, b, source);
    if (status === "EXPIRED") return this.unpaid(c, b, source);
    if (status === "REFUNDED") return this.refunded(c, b, source);
    return "still open";
  }

  private async confirm(c: Tx, b: Row, source: Source): Promise<string> {
    if (b.status === "CONFIRMED" || b.status === "REFUND_PENDING" || b.status === "REFUNDED") {
      await log(c, b.id, `${source}: already handled`, `booking is ${b.status}`);
      return "already handled";
    }
    await c.query("SAVEPOINT book");
    // Our hold, or free again after it expired: either way the seat can still be ours.
    const booked = await c.query<{ seat_no: string }>(
      `UPDATE show_seats SET status = 'BOOKED', booking_id = $3, hold_id = NULL,
              hold_expires_at = NULL, updated_at = now()
       WHERE show_id = $1 AND seat_no = ANY($2) AND (hold_id = $4 OR ${SEAT_IS_FREE})
       RETURNING seat_no`,
      [b.show_id, [...b.seat_nos].sort(), b.id, b.hold_id],
    );
    if (booked.rowCount === b.seat_nos.length) {
      await c.query(
        "UPDATE bookings SET status = 'CONFIRMED', confirmed_at = now(), failure_reason = NULL, updated_at = now() WHERE id = $1",
        [b.id],
      );
      await c.query("UPDATE holds SET status = 'BOOKED', updated_at = now() WHERE id = $1", [
        b.hold_id,
      ]);
      await this.events.publish(
        c,
        b.seat_nos.map((seatNo) => ({ showId: b.show_id, seatNo })),
      );
      await log(c, b.id, `${source}: paid, seats booked`, b.seat_nos.join(", "));
      this.logger.log(`booking ${b.id.slice(0, 8)} confirmed via ${source}`);
      return "confirmed";
    }
    // Paid, but someone else has a seat now: the money goes back (Task 6 sends the refund).
    await c.query("ROLLBACK TO SAVEPOINT book");
    const got = new Set(booked.rows.map((r) => r.seat_no));
    const taken = b.seat_nos.filter((s) => !got.has(s));
    await this.holds.freeHold(c, b.hold_id, "EXPIRED");
    await c.query(
      `UPDATE bookings SET status = 'REFUND_PENDING', updated_at = now(),
              failure_reason = $2 WHERE id = $1`,
      [b.id, `paid after the hold ended; ${taken.join(", ")} went to someone else`],
    );
    await log(
      c,
      b.id,
      `${source}: paid, but seats were taken`,
      `refund needed: ${taken.join(", ")}`,
    );
    return "refund needed";
  }

  private async declined(c: Tx, b: Row, source: Source): Promise<string> {
    if (b.status !== "PENDING_PAYMENT" && b.status !== "EXPIRED") {
      await log(c, b.id, `${source}: decline ignored`, `booking is ${b.status}`);
      return "ignored";
    }
    // Compensation: give the seats back at once instead of waiting for the hold to expire.
    await this.holds.freeHold(c, b.hold_id, "RELEASED");
    await c.query(
      "UPDATE bookings SET status = 'PAYMENT_FAILED', failure_reason = 'card declined', updated_at = now() WHERE id = $1",
      [b.id],
    );
    await log(c, b.id, `${source}: payment declined, seats released`);
    return "declined";
  }

  private async unpaid(c: Tx, b: Row, source: Source): Promise<string> {
    if (b.status !== "PENDING_PAYMENT") return "ignored";
    await this.holds.freeHold(c, b.hold_id, "EXPIRED");
    await c.query(
      "UPDATE bookings SET status = 'EXPIRED', failure_reason = 'not paid in time', updated_at = now() WHERE id = $1",
      [b.id],
    );
    await log(c, b.id, `${source}: payment session expired, seats released`);
    return "expired";
  }

  private async refunded(c: Tx, b: Row, source: Source): Promise<string> {
    if (b.status === "REFUNDED") return "already handled";
    await c.query("UPDATE bookings SET status = 'REFUNDED', updated_at = now() WHERE id = $1", [
      b.id,
    ]);
    await log(c, b.id, `${source}: refund confirmed by the gateway`);
    return "refunded";
  }

  async get(id: string): Promise<Booking> {
    const { rows } = await this.db.query<Booking>(`${BOOKING_SQL} WHERE b.id = $1`, [id]);
    if (!rows[0]) fail(404, "BOOKING_NOT_FOUND", `booking ${id} does not exist`);
    return rows[0];
  }

  async mine(user: string): Promise<Booking[]> {
    const { rows } = await this.db.query<Booking>(
      `${BOOKING_SQL} WHERE b.user_name = $1 ORDER BY b.created_at DESC LIMIT 30`,
      [user],
    );
    return rows;
  }
}
