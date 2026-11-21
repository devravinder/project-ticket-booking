# Decisions (ADRs)

Each record says what was chosen, why, and what was rejected.

## ADR-001 - Stack

Date: 2026-11-21 - Status: Accepted

- **Services:** two NestJS 12 apps on Node 22+, run with `tsx` (no build step): `booking-service`
  and `payment-gateway`. Shared code is in `libs/kit` (`@tix/kit`); shared types in `libs/contracts`.
- **Data:** Postgres 18 with plain SQL through `pg` 8.23. Who gets a seat is decided by one SQL
  statement, so the statements and locks stay visible instead of behind an ORM.
- **Redis 6.2** with `redis` 6.3, only for the waiting room (Task 7).
- **Web:** React 19 + Vite 8 + Tailwind 4.
- **Users:** no login. The caller names itself in an `X-User` header; the UI asks for a name once
  per browser tab, so two tabs can be two people racing for a seat.
- **Out of scope:** login, observability, cloud or Kubernetes deployment.

Rejected:

- Prisma or TypeORM: they hide the exact `UPDATE ... WHERE` that decides the race.
- WebSocket for the live map: updates flow one way, from server to browser; SSE is plain HTTP,
  reconnects by itself and goes through the Vite proxy unchanged (ADR in Task 3).

## ADR-002 - The payment gateway is a separate service with its own database

Date: 2026-11-21 - Status: Accepted

In real life the gateway belongs to another company. We only reach it over HTTP, and it only reaches
us through webhooks. Making it a separate process with its own database (`gateway`, role
`gateway_svc`, `CONNECT` revoked from `PUBLIC`) keeps that honest: the booking service cannot peek
at a payment row to find out what happened, which is exactly the situation the webhook and
reconciliation tasks are about.

Rejected: a gateway module inside the booking service - one transaction could then book the seat and
record the payment together, and none of the failure cases would exist.

## ADR-003 - One Postgres and one Redis container

Date: 2026-11-21 - Status: Accepted

One Postgres container with two databases and two roles (created by
`infra/postgres/init/01-databases.sql`, which runs only on an empty volume). Redis runs without
persistence: the waiting room can be rebuilt by people joining again, and the seat state never lives
in Redis. The passwords in `.env.sample` are local-container values, not secrets.

Rejected: one Postgres per service - closer to production, twice the memory for the same lesson.

## ADR-004 - Health checks name the failing dependency

Date: 2026-11-21 - Status: Accepted

`GET /health` returns 200 with one entry per dependency, or 503 with the same body, so the Status
page can say which one is down. Each probe has a 3-second timeout. Redis is checked only when
`REDIS_URL` is set (the gateway has none). The Redis client connects on first use and does not
queue commands while disconnected (`disableOfflineQueue`), so a stopped Redis gives an error at once
instead of a timeout.

Rejected: Terminus (`@nestjs/terminus`) - one more dependency for two probes.

## ADR-005 - One row per seat per show

Date: 2026-11-21 - Status: Accepted

`show_seats (show_id, seat_no)` holds the status of every seat of every show, copied from the
screen's layout (`screen_seats`) when the show is created. This is the row two buyers fight over:
"who gets A7 at 18:00" becomes "whose `UPDATE` changes this one row", which Postgres decides with a
row lock. The price is copied too, so a later price change does not alter a seat someone is paying
for.

Rejected:

- A counter per show (`seats_left`), as in the e-commerce stock: people pick a specific seat, not
  "any seat".
- Seats only in `bookings`, free meaning "no booking row": a hold would then be an insert that has to
  be checked against expired rows, and the seat map needs a join with a `NOT EXISTS` for every seat.

## ADR-006 - A hold is one conditional UPDATE, all or nothing

Date: 2026-11-21 - Status: Accepted

When two people press "Hold" on A7 in the same millisecond, the database decides:

```sql
UPDATE show_seats SET status = 'HELD', hold_id = $3, hold_expires_at = $4
WHERE show_id = $1 AND seat_no = ANY($2)
  AND (status = 'AVAILABLE' OR (status = 'HELD' AND hold_expires_at <= now()))
RETURNING seat_no;
```

The second `UPDATE` waits for the first one's row lock, then re-checks the `WHERE` on the new row
version and matches nothing. If fewer rows come back than seats were asked for, the transaction
(including the new `holds` row) is rolled back and the caller gets 409 `SEATS_UNAVAILABLE` with the
seats that were not free. The other seats are never held "half way".

The `holdMode` switch shows the alternatives side by side:

| Mode          | How                                                       | Result                                                  |
| ------------- | --------------------------------------------------------- | ------------------------------------------------------- |
| `atomic`      | the statement above                                       | one winner                                              |
| `pessimistic` | `SELECT ... ORDER BY seat_no FOR UPDATE`, check, `UPDATE` | one winner, one more round trip                         |
| `naive`       | `SELECT` without a lock, pause, unconditional `UPDATE`    | everyone is told "yours"; the last writer really has it |

Seats are always locked in seat-number order (sorted request, `ORDER BY seat_no`), so overlapping
multi-seat holds wait for each other instead of deadlocking: 40 overlapping 3-seat holds gave no
deadlock. A deadlock would still be answered with 409 `DEADLOCK` and `retryable: true`.

Rejected:

- `SERIALIZABLE`: also correct, but the loser gets a serialization failure to retry instead of a
  clear "seat taken".
- A lock in Redis (`SET NX`) in front of the database: faster for very hot shows, but then two
  systems must agree; Postgres is the source of truth here and is fast enough for one seat row.
- A version column (optimistic locking): the conditional `UPDATE` already is the optimistic check,
  without an extra column.

## ADR-007 - Expired means free at once; the sweeper only tidies

Date: 2026-11-21 - Status: Accepted

A hold lasts `holdTtlMs` (60 000 ms by default, so the expiry is easy to watch). Every read and
every hold treats `status = 'HELD' AND hold_expires_at <= now()` as free (`SEAT_IS_FREE` in
`seat-sql.ts`), so a seat is back on sale the moment its hold expires, without waiting for a job.

A sweeper on every instance runs each second: it marks due holds `EXPIRED`
(`FOR UPDATE SKIP LOCKED`, so two instances never take the same hold) and frees only seats that
still point at that hold. A seat someone else already took after the expiry keeps its new hold.

Rejected:

- Sweeper only: a seat would look taken for up to a second after its hold ended, and correctness
  would depend on a background job running.
- Redis keys with a TTL as the hold: an expired key vanishes without anyone telling the seat map,
  and the booking would need both stores to agree.
