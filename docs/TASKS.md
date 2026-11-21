# Tasks

`[x]` done, `[~]` partly done, `[ ]` to do. One commit per task, once its checks pass.

## 0. Scaffold

- [x] pnpm monorepo, Prettier, oxlint, markdownlint, husky + commitlint
- [x] Docker Compose: Postgres 18 (databases `booking` and `gateway`, one login role each), Redis 6.2
- [x] `libs/kit`: config, Postgres pool + migration runner, lazy Redis client, switches, `GET /health`
- [x] `libs/contracts`: types shared by the services and the web app
- [x] booking-service (7001, second instance 7011) and payment-gateway (7002), NestJS
- [x] `apps/web` (React + Vite + Tailwind) on 5210 showing every service's health
- [x] Image retag scripts for a private registry (Windows and Linux)
- [x] Docs, ADR-001 to ADR-004, `http/health.http`, skills
- [x] Verified: 17 checks. `/health` 200 for all three, directly and through the Vite proxy;
      `booking_svc` cannot connect to `gateway` ("permission denied"); booking 503 naming Redis
      while Redis is stopped, gateway unaffected; 503 naming Postgres while it is stopped; both 200
      after restarts; an unknown switch is a 400 with code `UNKNOWN_SWITCH`

## 1. Catalog and seat map

- [x] Movies, screens with a seat layout, shows; one `show_seats` row per seat per show with its
      tier and price (migration `001_catalog.sql`, seeds SHOW-1 to SHOW-4)
- [x] `GET /shows` (free and total seats), `GET /shows/:id` with the seat map,
      `POST /admin/shows` and `DELETE /admin/shows/:id` for tests and demos
- [x] UI: pick a user name (per browser tab), list shows, read-only seat map with an aisle and legend
- [x] Verified: 17 API checks (seeded layouts of 96 and 32 seats, premium rows G-H at 350.00, row
      and column order, 404 `SHOW_NOT_FOUND`, 400 on a bad id, create, 409 `SHOW_EXISTS`, delete);
      7 browser checks (login, show cards, 96 seats, status page, no page errors)

## 2. Seat holds

- [x] Hold up to 6 seats, all or nothing (`POST /shows/:id/holds`, `X-User`); release
      (`DELETE /holds/:id`); `GET /holds/:id`, `GET /holds?showId=` (my live holds)
- [x] 1-minute expiry (`holdTtlMs`): an expired seat reads as free at once; a sweeper on each
      instance marks holds `EXPIRED` (`FOR UPDATE SKIP LOCKED`)
- [x] `holdMode` switch: `atomic` (conditional `UPDATE`), `pessimistic` (`FOR UPDATE`), `naive`
      (read, pause, write); allowed values are checked
- [x] UI: select seats, hold, countdown, release; Lab: "same seat, same moment" race with N
      people, optionally split over both instances, and a switches panel per instance
- [x] Verified: 39 API checks. One winner in 8 two-person races and 3 races of 25 people over two
      instances (atomic and pessimistic); 40 overlapping 3-seat holds give no seat twice and no
      deadlock; naive mode tells both people "201" and one hold silently loses its seat; expired
      seats free at once, sweeping an old hold leaves the new holder's seat alone; 403 for another
      user's hold; release is idempotent. 14 browser checks: two people press Hold on B1 together
      and exactly one gets it, the other sees "Just taken"; colours for mine, held and free; Lab
      verdicts for atomic (1 winner) and naive (5 told, 1 really)

## 3. Live seat map

- [x] `GET /shows/:id/events` (SSE): a `snapshot` first, then `seats` events with only the changed
      seats, `ping` every 15 s; 404 before the stream opens for an unknown show
- [x] `pg_notify` inside every transaction that changes a seat (hold, release, expiry sweep); each
      instance `LISTEN`s on one dedicated connection, reconnects with backoff and resyncs its viewers
- [x] One seat query per change per instance, however many viewers; `GET /admin/live` (stats),
      `POST /admin/live/drop-connection` (Lab)
- [x] Expired holds reappear as free on every open map (the sweeper's write is announced)
- [x] UI: the seat map is live (no polling), with a state badge, an update counter and a "via
      instance" picker; Lab card with each instance's LISTEN stats and a "Drop LISTEN" button
- [x] Verified: 21 API checks. A hold on :7001 reaches viewers on :7001, :7011 and the Vite proxy
      in about 20 ms; a rolled-back (409) hold sends nothing; a 1.5 s hold shows up free about 0.8 s
      after it expired; after `pg_terminate_backend` of both LISTEN connections each instance
      reconnects once, resyncs, and later changes arrive; closed streams are removed. 12 browser
      checks: bob watching via :7011 sees alice's hold in 22 ms, expiry frees the seat on both maps,
      no seat-map requests in 4 s, the Lab drop button reconnects

## 4. Fake payment gateway

- [x] `POST /sessions` (`Idempotency-Key` required; replay 200, other body 422), `GET /sessions/:id`
      (the status API), hosted pay page `GET /pay/:id` with Pay and Decline and a countdown,
      `POST /sessions/:id/pay` (the same as a button, for tests), `POST /sessions/:id/refund`
- [x] Webhook outbox (`webhook_events`) written with the status change; a deliverer claims due
      events with a lease, signs them (`Gateway-Signature: t=..,v1=HMAC-SHA256`), retries with
      backoff (0.5 s doubling to 10 s, 25 attempts)
- [x] Switches: `slowPayMs`, `webhookDelayMs`, `dropWebhooks`, `duplicateWebhooks`, `redirectBack`;
      `POST /admin/webhooks/:id/redeliver`
- [x] Lab: gateway switches panel and a sessions log with each webhook's attempts, errors and a
      Redeliver button
- [x] Verified: 33 API checks against a local webhook receiver (signatures valid and fresh; 3 x 500
      then delivered on attempt 4 with gaps of 0.8, 1.0 and 2.1 s; `ECONNREFUSED` while the receiver
      is down, delivered after; dropped then redelivered; duplicates carry the same event id; an
      expired session refuses payment; a payment started in time still finishes after expiry;
      refunds are idempotent per key, 409 for another key or a declined payment). 8 browser checks
      (pay page, redirect back with session and status, Lab log)

## 5. Checkout

- [x] `POST /holds/:id/checkout`: one booking per hold, a gateway session per booking (key
      `booking-<id>`), created outside any transaction; a retry after a gateway outage reuses it
- [x] The payment session ends `paymentMarginMs` (10 s) before the hold; less than 3 s left is
      409 `HOLD_EXPIRING`
- [x] `POST /webhooks/gateway`: signature over the raw body, 5-minute window, `webhook_inbox` for
      duplicates, the effect in the same transaction
- [x] `POST /bookings/:id/verify`: the return from the gateway asks the gateway; the redirect's
      `status` is never trusted
- [x] Confirm locks hold, then booking, then seats; books the seats if they are still this hold's
      or free again, otherwise `REFUND_PENDING`. Decline releases the seats at once; an unpaid hold
      expires the booking; releasing a hold ends its checkout
- [x] `booking_log` timeline; `GET /bookings` (mine), `GET /bookings/:id`
- [x] UI: Pay on the hold card goes to the gateway page and back to My bookings, which shows the
      status and timeline; Lab "Checkout and payment" card with 6 scenarios and their verdicts
- [x] Verified: 37 API checks. Webhook confirms; checkout is idempotent; a webhook and two returns
      on two instances book once ("already handled" for the rest); a dropped webhook is recovered
      by the return; duplicates are ignored by the inbox; decline frees the seats; unsigned, wrongly
      signed and 10-minute-old webhooks get 401 and change nothing; a result for another session is
      ignored; abandoned checkouts expire with the hold; gateway down gives 502, then the retry gets
      a session and confirms. 16 browser checks: real pay page round trip, decline on the page, live
      grey seat for the other viewer, all 6 Lab scenarios pass

## 6. Failure lab

- [x] Reconciliation job (each instance, every second): bookings still waiting for news after
      `reconcileAfterMs` (15 s) are claimed with `FOR UPDATE SKIP LOCKED` and a backoff (2 to 30 s),
      the gateway is asked, the answer goes through `settle`; a final answer sets `settled_at`
- [x] A session created at the gateway but never stored is found by `merchantRef` (the booking id)
- [x] Refund job: `REFUND_PENDING` bookings are refunded with the key `refund-<id>` until the gateway
      says `REFUNDED`
- [x] Switches: `crashPoint` (`afterSession`, `beforeConfirm`: a real `process.exit`),
      `webhooksDown` (503), `reconcileAfterMs`
- [x] `GET /admin/consistency`: seat booked without a confirmed booking, confirmed booking missing
      a seat, seat sold twice (errors); naive double holds, refunds owed, stuck checkouts (warnings)
- [x] Lab: "When things go wrong" card (paid late with the seat free or resold, lost webhook and no
      return, webhook endpoint down), consistency card, crash instructions, `crashPoint` select
- [x] Verified: 27 API checks. Lost webhook and no return: reconciliation confirms, once across two
      instances; 503 for a while: the gateway retries and the next attempt confirms; crash before
      confirm: nothing committed, after a restart it is confirmed; crash after the session was
      created: retrying checkout reuses that one session, and with no retry reconciliation finds it
      by `merchantRef`; paid late with the seat free: `CONFIRMED`; paid late after a rival took the
      seat: `REFUNDED`, the rival keeps it; a corrupted seat is reported and the report clears after
      the repair; a naive double hold is a warning. 11 browser checks: the four Lab scenarios pass
      with the expected timeline entries, consistency stays OK

## 7. Waiting room

- [x] Redis line per show (`ZADD NX` sorted set by join time); `POST /shows/:id/queue` (join, keeps
      your place), `GET /shows/:id/queue/me`, `GET /shows/:id/queue` (stats),
      `DELETE /admin/shows/:id/queue`
- [x] Admission by one Lua script per show per second: `SET tick NX` so only one instance admits,
      `ZPOPMIN` N people, a token per person with a TTL (`admissionTtlMs`, 2 minutes)
- [x] With `waitingRoom` on, `POST /shows/:id/holds` needs `X-Queue-Token` (403 `QUEUE_REQUIRED`);
      Redis down while it is on: 503, never "let everyone in"
- [x] UI: the show page shows your place in line, then a banner with the time left; Lab "Flash
      crowd" card: N bots join at once, each holds a seat when let in, with live stats
- [x] Verified: 20 API checks. 20 fans over two instances get positions in join order; joining again
      keeps the place; no token or a wrong token is 403; 2 per second in total with two instances
      (measured 2.0/s over 8 s); first in, first out; a token works only for its owner and expires;
      Redis stopped: join and hold 503 with the room on, holds work with it off. 9 browser checks:
      12 bots in line, bob arrives seventh, waits, is let in and holds a seat; all bots hold a seat;
      clean-up releases them and turns the room off

## 8. Wrap-up

- [x] Full regression on Windows: 211 API checks (task0 17, task1 17, task2 39, task3 21, task4 33,
      task5 37, task6 27, task7 20) and 77 browser checks, from freshly started services
- [x] Linux check in an Alpine container on the compose network: frozen-lockfile install, oxlint,
      markdownlint, Prettier, typecheck, web build, retag script, both services started against the
      containers, 8 end-to-end checks (race, live map, checkout, decline, waiting room, consistency)
- [x] `docs/INTERVIEW-QUESTIONS.md`, ADR-013
