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

- [ ] Movies, screens with a seat layout, shows; seats per show with a price tier
- [ ] `GET /shows`, `GET /shows/:id` with the seat map
- [ ] UI: pick a user name, list shows, read-only seat map

## 2. Seat holds

- [ ] Hold several seats, all or nothing; 1-minute expiry; release
- [ ] `holdMode` switch: `atomic`, `pessimistic`, `naive`
- [ ] UI: select seats, hold, countdown; Lab: two users race for one seat

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
