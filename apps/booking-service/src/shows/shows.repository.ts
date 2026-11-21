import { Inject, Injectable } from "@nestjs/common";
import type { Seat, ShowDetail, ShowSummary } from "@tix/contracts";
import { Database, fail } from "@tix/kit";
import { SEAT_COLUMNS, SEAT_IS_FREE } from "./seat-sql.js";

const SUMMARY_SQL = `
  SELECT s.id, s.starts_at AS "startsAt",
         json_build_object('id', m.id, 'title', m.title, 'minutes', m.minutes, 'rating', m.rating) AS movie,
         json_build_object('id', sc.id, 'name', sc.name) AS screen,
         LEAST(s.regular_cents, s.premium_cents) AS "priceFromCents",
         (SELECT count(*)::int FROM show_seats x WHERE x.show_id = s.id) AS "seatsTotal",
         (SELECT count(*)::int FROM show_seats x WHERE x.show_id = s.id AND ${SEAT_IS_FREE})
           AS "seatsAvailable"
  FROM shows s JOIN movies m ON m.id = s.movie_id JOIN screens sc ON sc.id = s.screen_id`;

@Injectable()
export class ShowsRepository {
  constructor(@Inject(Database) private readonly db: Database) {}

  async list(): Promise<ShowSummary[]> {
    return (await this.db.query<ShowSummary>(`${SUMMARY_SQL} ORDER BY s.starts_at, s.id`)).rows;
  }

  async detail(id: string): Promise<ShowDetail> {
    const { rows } = await this.db.query<ShowSummary>(`${SUMMARY_SQL} WHERE s.id = $1`, [id]);
    if (!rows[0]) fail(404, "SHOW_NOT_FOUND", `show ${id} does not exist`);
    const seats = await this.seats(id);
    return {
      ...rows[0],
      rows: [...new Set(seats.map((s) => s.row))],
      cols: Math.max(...seats.map((s) => s.col)),
      seats,
    };
  }

  async seats(showId: string, seatNos?: string[]): Promise<Seat[]> {
    const { rows } = await this.db.query<Seat>(
      `SELECT ${SEAT_COLUMNS}
       FROM show_seats WHERE show_id = $1 AND ($2::text[] IS NULL OR seat_no = ANY($2))
       ORDER BY row_label, col`,
      [showId, seatNos ?? null],
    );
    return rows;
  }

  async remove(id: string): Promise<boolean> {
    return ((await this.db.query("DELETE FROM shows WHERE id = $1", [id])).rowCount ?? 0) > 0;
  }

  // Test and demo helper: a fresh show with every seat free.
  async create(input: {
    id: string;
    movieId: string;
    screenId: string;
    startsAt: string;
    regularCents: number;
    premiumCents: number;
  }): Promise<ShowDetail> {
    await this.db.tx(async (c) => {
      const inserted = await c.query(
        `INSERT INTO shows (id, movie_id, screen_id, starts_at, regular_cents, premium_cents)
         SELECT $1, m.id, sc.id, $4, $5, $6 FROM movies m, screens sc WHERE m.id = $2 AND sc.id = $3
         ON CONFLICT (id) DO NOTHING`,
        [
          input.id,
          input.movieId,
          input.screenId,
          input.startsAt,
          input.regularCents,
          input.premiumCents,
        ],
      );
      if (inserted.rowCount === 0) {
        const exists = await c.query("SELECT 1 FROM shows WHERE id = $1", [input.id]);
        if (exists.rowCount) fail(409, "SHOW_EXISTS", `show ${input.id} already exists`);
        fail(400, "INVALID_REQUEST", "unknown movieId or screenId");
      }
      await c.query(
        `INSERT INTO show_seats (show_id, seat_no, row_label, col, tier, price_cents)
         SELECT s.id, ss.seat_no, ss.row_label, ss.col, ss.tier,
                CASE ss.tier WHEN 'PREMIUM' THEN s.premium_cents ELSE s.regular_cents END
         FROM shows s JOIN screen_seats ss USING (screen_id) WHERE s.id = $1`,
        [input.id],
      );
    });
    return this.detail(input.id);
  }
}
