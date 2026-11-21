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
- [x] Verified: 41 API checks. One winner in 8 two-person races and 3 races of 25 people over two
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

- [ ] Hold, then pay, then confirm exactly once (webhook and redirect may race)
- [ ] Decline releases the seats; the payment session ends before the hold does

## 6. Failure lab

- [ ] Crash before confirm; reconciliation asks the gateway about stuck bookings
- [ ] Late payment after the seat was resold: automatic refund
- [ ] Consistency report: booked seats against confirmed bookings

## 7. Waiting room

- [ ] Redis queue per show; admit N users per second; holds need an admission token
- [ ] UI: your place in line; Lab: flash crowd

## 8. Wrap-up

- [ ] Full regression on Windows, Linux check, interview questions
