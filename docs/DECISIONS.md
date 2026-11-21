# Decisions (ADRs)

Each record says what was chosen, why, and what was rejected.

## ADR-001 - Stack

Date: 2026-11-06 - Status: Accepted

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

Date: 2026-11-06 - Status: Accepted

In real life the gateway belongs to another company. We only reach it over HTTP, and it only reaches
us through webhooks. Making it a separate process with its own database (`gateway`, role
`gateway_svc`, `CONNECT` revoked from `PUBLIC`) keeps that honest: the booking service cannot peek
at a payment row to find out what happened, which is exactly the situation the webhook and
reconciliation tasks are about.

Rejected: a gateway module inside the booking service - one transaction could then book the seat and
record the payment together, and none of the failure cases would exist.

## ADR-003 - One Postgres and one Redis container

Date: 2026-11-06 - Status: Accepted

One Postgres container with two databases and two roles (created by
`infra/postgres/init/01-databases.sql`, which runs only on an empty volume). Redis runs without
persistence: the waiting room can be rebuilt by people joining again, and the seat state never lives
in Redis. The passwords in `.env.sample` are local-container values, not secrets.

Rejected: one Postgres per service - closer to production, twice the memory for the same lesson.

## ADR-004 - Health checks name the failing dependency

Date: 2026-11-06 - Status: Accepted

`GET /health` returns 200 with one entry per dependency, or 503 with the same body, so the Status
page can say which one is down. Each probe has a 3-second timeout. Redis is checked only when
`REDIS_URL` is set (the gateway has none). The Redis client connects on first use and does not
queue commands while disconnected (`disableOfflineQueue`), so a stopped Redis gives an error at once
instead of a timeout.

Rejected: Terminus (`@nestjs/terminus`) - one more dependency for two probes.
