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

- [ ] SSE stream per show; `LISTEN/NOTIFY` so both booking instances push every change
- [ ] Expired holds reappear as free on every open map

## 4. Fake payment gateway

- [ ] Payment sessions, hosted pay page, signed webhooks with retries, status API, refunds
- [ ] Switches: slow payment, dropped and duplicate webhooks, no redirect back

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
