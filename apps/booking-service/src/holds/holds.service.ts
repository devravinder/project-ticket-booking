import { Inject, Injectable } from "@nestjs/common";
import type { Hold, HoldMode } from "@tix/contracts";
import { Database, fail, sleep, Switches, type Tx } from "@tix/kit";
import { SeatEvents } from "../live/seat-events.js";
import { SEAT_IS_FREE } from "../shows/seat-sql.js";

class SeatsTaken extends Error {
  constructor(readonly unavailable: string[]) {
    super(`seats ${unavailable.join(", ")} are not available`);
  }
}

export const HOLD_SQL = `
  SELECT h.id, h.show_id AS "showId", h.user_name AS "user", h.seat_nos AS seats,
         h.amount_cents AS "amountCents",
         CASE WHEN h.status = 'HELD' AND h.expires_at <= now() THEN 'EXPIRED' ELSE h.status END AS status,
         h.expires_at AS "expiresAt", h.created_at AS "createdAt",
         (SELECT count(*)::int FROM show_seats x
          WHERE x.hold_id = h.id AND x.status = 'HELD' AND x.hold_expires_at > now()) AS "seatsStillHeld"
  FROM holds h`;

// Postgres deadlock detected: two transactions waited on each other's rows.
const DEADLOCK = "40P01";

@Injectable()
export class HoldsService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(Switches) private readonly switches: Switches,
    @Inject(SeatEvents) private readonly events: SeatEvents,
  ) {}

  // All or nothing: either every requested seat is now this user's, or none is (ADR-006).
  async hold(showId: string, user: string, requested: string[]): Promise<Hold> {
    const seatNos = [...new Set(requested)].sort();
    try {
      return await this.db.tx(async (c) => {
        const show = await c.query("SELECT 1 FROM shows WHERE id = $1", [showId]);
        if (!show.rowCount) fail(404, "SHOW_NOT_FOUND", `show ${showId} does not exist`);
        const known = await c.query<{ seat_no: string; price_cents: number }>(
          "SELECT seat_no, price_cents FROM show_seats WHERE show_id = $1 AND seat_no = ANY($2)",
          [showId, seatNos],
        );
        if (known.rowCount !== seatNos.length) {
          const found = new Set(known.rows.map((r) => r.seat_no));
          fail(400, "SEAT_NOT_FOUND", "no such seat in this show", {
            unknown: seatNos.filter((s) => !found.has(s)),
          });
        }
        const amount = known.rows.reduce((sum, r) => sum + r.price_cents, 0);
        const { rows } = await c.query<{ id: string; expires_at: Date }>(
          `INSERT INTO holds (show_id, user_name, seat_nos, amount_cents, expires_at)
           VALUES ($1, $2, $3, $4, now() + $5 * interval '1 millisecond') RETURNING id, expires_at`,
          [showId, user, seatNos, amount, this.switches.get<number>("holdTtlMs")],
        );
        const hold = rows[0]!;
        const got = await this.take(c, showId, seatNos, hold.id, hold.expires_at);
        if (got.length < seatNos.length) {
          throw new SeatsTaken(seatNos.filter((s) => !got.includes(s)));
        }
        await this.events.publish(
          c,
          got.map((seatNo) => ({ showId, seatNo })),
        );
        return this.view(c, hold.id);
      });
    } catch (error) {
      if (error instanceof SeatsTaken) {
        fail(409, "SEATS_UNAVAILABLE", error.message, { unavailable: error.unavailable });
      }
      if ((error as { code?: string }).code === DEADLOCK) {
        fail(409, "DEADLOCK", "another hold locked the same seats; try again", { retryable: true });
      }
      throw error;
    }
  }

  async release(holdId: string, user: string): Promise<Hold> {
    return this.db.tx(async (c) => {
      const { rows } = await c.query<{ user_name: string; status: string }>(
        "SELECT user_name, status FROM holds WHERE id = $1 FOR UPDATE",
        [holdId],
      );
      const hold = rows[0];
      if (!hold) fail(404, "HOLD_NOT_FOUND", `hold ${holdId} does not exist`);
      if (hold.user_name !== user) fail(403, "NOT_YOUR_HOLD", "this hold belongs to someone else");
      if (hold.status === "BOOKED") fail(409, "HOLD_BOOKED", "these seats are already booked");
      if (hold.status === "HELD") {
        await this.freeHold(c, holdId, "RELEASED");
        await this.endCheckouts(c, [holdId], "released by you");
      }
      return this.view(c, holdId);
    });
  }

  // Holds past their expiry: mark them and free the seats they still point at.
  async expireDue(c: Tx, limit = 100): Promise<{ id: string; showId: string }[]> {
    const { rows } = await c.query<{ id: string; showId: string }>(
      `UPDATE holds SET status = 'EXPIRED', updated_at = now()
       WHERE id IN (SELECT id FROM holds WHERE status = 'HELD' AND expires_at <= now()
                    ORDER BY expires_at LIMIT $1 FOR UPDATE SKIP LOCKED)
       RETURNING id, show_id AS "showId"`,
      [limit],
    );
    if (rows.length) {
      const ids = rows.map((r) => r.id);
      await this.freeSeats(c, ids);
      await this.endCheckouts(c, ids, "hold expired before payment");
    }
    return rows;
  }

  async get(holdId: string): Promise<Hold> {
    const { rows } = await this.db.query<Hold>(`${HOLD_SQL} WHERE h.id = $1`, [holdId]);
    if (!rows[0]) fail(404, "HOLD_NOT_FOUND", `hold ${holdId} does not exist`);
    return rows[0];
  }

  async live(user: string, showId?: string): Promise<Hold[]> {
    const { rows } = await this.db.query<Hold>(
      `${HOLD_SQL} WHERE h.user_name = $1 AND ($2::text IS NULL OR h.show_id = $2)
         AND h.status = 'HELD' AND h.expires_at > now() ORDER BY h.created_at`,
      [user, showId ?? null],
    );
    return rows;
  }

  // Frees what this hold still has and closes it; a hold already closed is left alone.
  async freeHold(c: Tx, holdId: string, status: "RELEASED" | "EXPIRED"): Promise<void> {
    await this.freeSeats(c, [holdId]);
    await c.query(
      "UPDATE holds SET status = $2, updated_at = now() WHERE id = $1 AND status = 'HELD'",
      [holdId, status],
    );
  }

  // A checkout still waiting for money ends with its hold; a late payment is handled on arrival.
  private async endCheckouts(c: Tx, holdIds: string[], reason: string): Promise<void> {
    const { rows } = await c.query<{ id: string }>(
      `UPDATE bookings SET status = 'EXPIRED', failure_reason = $2, updated_at = now()
       WHERE hold_id = ANY($1) AND status = 'PENDING_PAYMENT' RETURNING id`,
      [holdIds, reason],
    );
    for (const { id } of rows) {
      await c.query("INSERT INTO booking_log (booking_id, what) VALUES ($1, $2)", [id, reason]);
    }
  }

  private async view(c: Tx, holdId: string): Promise<Hold> {
    return (await c.query<Hold>(`${HOLD_SQL} WHERE h.id = $1`, [holdId])).rows[0]!;
  }

  // A seat already taken by a newer hold keeps that hold: only our own pointer is cleared.
  private async freeSeats(c: Tx, holdIds: string[]): Promise<void> {
    const { rows } = await c.query<{ showId: string; seatNo: string }>(
      `UPDATE show_seats SET status = 'AVAILABLE', hold_id = NULL, hold_expires_at = NULL, updated_at = now()
       WHERE hold_id = ANY($1) AND status = 'HELD' RETURNING show_id AS "showId", seat_no AS "seatNo"`,
      [holdIds],
    );
    await this.events.publish(c, rows);
  }

  // The statement that decides who gets a seat; returns the seats this hold now has.
  private async take(
    c: Tx,
    showId: string,
    seatNos: string[],
    holdId: string,
    expiresAt: Date,
  ): Promise<string[]> {
    const mode = this.switches.get<HoldMode>("holdMode");
    if (mode === "atomic") {
      const { rows } = await c.query<{ seat_no: string }>(
        `UPDATE show_seats SET status = 'HELD', hold_id = $3, hold_expires_at = $4, updated_at = now()
         WHERE show_id = $1 AND seat_no = ANY($2) AND ${SEAT_IS_FREE} RETURNING seat_no`,
        [showId, seatNos, holdId, expiresAt],
      );
      return rows.map((r) => r.seat_no);
    }
    // Pessimistic locks in seat order; naive reads without a lock and decides in code.
    const lock = mode === "pessimistic" ? "ORDER BY seat_no FOR UPDATE" : "";
    const { rows } = await c.query<{ seat_no: string; free: boolean }>(
      `SELECT seat_no, ${SEAT_IS_FREE} AS free FROM show_seats
       WHERE show_id = $1 AND seat_no = ANY($2) ${lock}`,
      [showId, seatNos],
    );
    const free = rows.filter((r) => r.free).map((r) => r.seat_no);
    if (free.length < seatNos.length) return free;
    // WRONG ON PURPOSE in naive mode: the pause lets a second buyer read "free" too.
    if (mode === "naive") await sleep(this.switches.get<number>("naiveDelayMs"));
    await c.query(
      `UPDATE show_seats SET status = 'HELD', hold_id = $3, hold_expires_at = $4, updated_at = now()
       WHERE show_id = $1 AND seat_no = ANY($2)`,
      [showId, seatNos, holdId, expiresAt],
    );
    return seatNos;
  }
}
