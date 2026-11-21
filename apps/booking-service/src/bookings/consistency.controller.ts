import { Controller, Get, Inject } from "@nestjs/common";
import type { ConsistencyReport } from "@tix/contracts";
import { Database } from "@tix/kit";

// Each query lists rows that break an invariant; all empty means the data agrees with itself.
const CHECKS: { kind: string; severity: "error" | "warning"; sql: string }[] = [
  {
    kind: "seat booked without a confirmed booking",
    severity: "error",
    sql: `SELECT s.show_id || ' ' || s.seat_no AS detail FROM show_seats s
          LEFT JOIN bookings b ON b.id = s.booking_id
          WHERE s.status = 'BOOKED' AND (b.id IS NULL OR b.status <> 'CONFIRMED')`,
  },
  {
    kind: "confirmed booking missing a seat",
    severity: "error",
    sql: `SELECT b.id || ' ' || seat AS detail FROM bookings b, unnest(b.seat_nos) AS seat
          WHERE b.status = 'CONFIRMED' AND NOT EXISTS (
            SELECT 1 FROM show_seats s WHERE s.show_id = b.show_id AND s.seat_no = seat
              AND s.status = 'BOOKED' AND s.booking_id = b.id)`,
  },
  {
    kind: "seat sold twice",
    severity: "error",
    sql: `SELECT b.show_id || ' ' || seat || ' x' || count(*) AS detail
          FROM bookings b, unnest(b.seat_nos) AS seat WHERE b.status = 'CONFIRMED'
          GROUP BY b.show_id, seat HAVING count(*) > 1`,
  },
  {
    kind: "live hold that lost seats (naive mode)",
    severity: "warning",
    sql: `SELECT h.id || ' ' || h.user_name AS detail FROM holds h
          WHERE h.status = 'HELD' AND h.expires_at > now() AND (SELECT count(*) FROM show_seats s
            WHERE s.hold_id = h.id AND s.status = 'HELD') < cardinality(h.seat_nos)`,
  },
  {
    kind: "refund owed, not sent yet",
    severity: "warning",
    sql: `SELECT id || ' ' || user_name AS detail FROM bookings WHERE status = 'REFUND_PENDING'`,
  },
  {
    kind: "waiting for payment news for over a minute",
    severity: "warning",
    sql: `SELECT id || ' ' || user_name AS detail FROM bookings
          WHERE status = 'PENDING_PAYMENT' AND created_at < now() - interval '1 minute'`,
  },
];

@Controller("admin")
export class ConsistencyController {
  constructor(@Inject(Database) private readonly db: Database) {}

  @Get("consistency")
  async report(): Promise<ConsistencyReport> {
    const problems = [];
    for (const check of CHECKS) {
      const { rows } = await this.db.query<{ detail: string }>(`${check.sql} LIMIT 20`);
      for (const r of rows)
        problems.push({ kind: check.kind, severity: check.severity, detail: r.detail });
    }
    const { rows } = await this.db.query<{ status: string; n: number }>(
      "SELECT status, count(*)::int AS n FROM bookings GROUP BY status ORDER BY status",
    );
    return {
      ok: !problems.some((p) => p.severity === "error"),
      checkedAt: new Date().toISOString(),
      bookings: Object.fromEntries(rows.map((r) => [r.status, r.n])),
      problems,
    };
  }
}
