// A hold past its expiry frees the seat at once; the sweeper only tidies up (ADR-007).
export const SEAT_IS_FREE = `(status = 'AVAILABLE' OR (status = 'HELD' AND hold_expires_at <= now()))`;

export const SEAT_STATUS = `CASE WHEN ${SEAT_IS_FREE} THEN 'AVAILABLE' ELSE status END`;

export const SEAT_COLUMNS = `seat_no AS "seatNo", row_label AS row, col, tier,
  price_cents AS "priceCents", ${SEAT_STATUS} AS status,
  CASE WHEN ${SEAT_IS_FREE} THEN NULL ELSE hold_id END AS "holdId"`;
