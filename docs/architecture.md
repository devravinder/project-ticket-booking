# Architecture

## Components

```mermaid
flowchart LR
  W[Browser<br/>React :5210] -->|/api/booking| B1[booking-service :7001]
  W -->|/api/booking-2| B2[booking-service :7011]
  W -->|pay page| G[payment-gateway :7002]
  B1 --- DB[(Postgres booking)]
  B2 --- DB
  B1 --- R[(Redis)]
  B2 --- R
  G --- DG[(Postgres gateway)]
```

- **booking-service** owns movies, shows, seats, holds and bookings. Two instances can run against
  the same database to show that the design does not depend on one process.
- **payment-gateway** is a fake payment provider with its own database (ADR-002).
- **web** talks to the services through the Vite dev proxy: `/api/<service>/...`.

## Data

```mermaid
erDiagram
  movies ||--o{ shows : "is shown in"
  screens ||--o{ screen_seats : "has layout"
  screens ||--o{ shows : "hosts"
  shows ||--o{ show_seats : "copies the layout"
  show_seats {
    text show_id PK
    text seat_no PK
    text tier
    int price_cents
    text status "AVAILABLE, HELD, BOOKED"
  }
```

A show copies its screen's seats into `show_seats` (ADR-005): one row per seat per show is what
concurrent buyers compete for.

This document grows with each task.

## Holds

A hold keeps seats for one person while they pay. Two people asking for the same seat at once are
decided by one conditional `UPDATE` (ADR-006); an expired hold frees its seats at once (ADR-007).

```mermaid
stateDiagram-v2
  [*] --> HELD: POST /shows/:id/holds (every seat was free)
  HELD --> RELEASED: DELETE /holds/:id
  HELD --> EXPIRED: expiresAt passed (sweeper)
  HELD --> BOOKED: payment confirmed (Task 5)
  RELEASED --> [*]
  EXPIRED --> [*]
  BOOKED --> [*]
```

```mermaid
sequenceDiagram
  participant A as alice
  participant B as bob
  participant S as booking-service
  participant P as Postgres
  A->>S: hold B1
  B->>S: hold B1
  S->>P: UPDATE B1 WHERE free (alice)
  S->>P: UPDATE B1 WHERE free (bob) waits for the row lock
  P-->>S: alice: 1 row, commit
  P-->>S: bob: 0 rows (re-checked after the lock), rollback
  S-->>A: 201 HELD
  S-->>B: 409 SEATS_UNAVAILABLE [B1]
```

## Live seat map

Every seat change is announced with `pg_notify` inside its own transaction; each booking instance
listens and streams the changed seats to its viewers over SSE (ADR-008).

```mermaid
sequenceDiagram
  participant A as alice (via :7001)
  participant S1 as booking :7001
  participant P as Postgres
  participant S2 as booking :7011
  participant B as bob (via :7011)
  B->>S2: GET /shows/SHOW-3/events
  S2-->>B: snapshot
  A->>S1: hold C4
  S1->>P: UPDATE seat + pg_notify, COMMIT
  P-->>S1: NOTIFY seat_changes C4
  P-->>S2: NOTIFY seat_changes C4
  S2->>P: read seat C4
  S2-->>B: seats C4 HELD
```

## Payment gateway

The gateway is a separate service with its own database (ADR-002). It records each status change
together with a webhook row, and a deliverer sends the webhooks until they are acknowledged (ADR-009).

```mermaid
sequenceDiagram
  participant M as merchant (booking-service)
  participant G as payment-gateway
  participant C as customer browser
  M->>G: POST /sessions (Idempotency-Key)
  G-->>M: session + payUrl
  C->>G: GET /pay/ps_..
  C->>G: Pay
  G->>G: PAID + webhook row, one transaction
  G-->>C: 303 to returnUrl?session=..&status=PAID
  G->>M: POST webhook payment.succeeded (signed)
  M-->>G: 200 (else retried with backoff)
```

## Checkout

Every way a payment result arrives (webhook, the customer's return, reconciliation) ends in one
`settle` call, which locks the hold and the booking and applies the result once (ADR-010).

```mermaid
sequenceDiagram
  participant C as customer
  participant B as booking-service
  participant G as payment-gateway
  C->>B: POST /holds/:id/checkout
  B->>B: booking PENDING_PAYMENT (commit)
  B->>G: POST /sessions (key booking-id, ends 10 s before the hold)
  B-->>C: payUrl
  C->>G: pay
  par webhook
    G->>B: payment.succeeded (signed)
    B->>B: inbox + settle: seats BOOKED
  and return
    G-->>C: 303 to /?booking=id
    C->>B: POST /bookings/:id/verify
    B->>G: GET /sessions/:id
    B->>B: settle: already handled
  end
```

## Recovery

Background jobs on every instance close the gaps that webhooks and returns leave (ADR-011).

```mermaid
flowchart LR
  P[PENDING_PAYMENT or EXPIRED<br/>older than 15 s] -->|reconciliation asks GET /sessions/:id| S{session}
  S -->|PAID| C[settle: book or REFUND_PENDING]
  S -->|DECLINED or EXPIRED| F[settle: seats released]
  S -->|OPEN| W[ask again later, backoff]
  R[REFUND_PENDING] -->|refund job, key refund-id| G[gateway refund]
  G --> RF[REFUNDED]
```

## Waiting room

With the waiting room on, people queue in Redis and are let in a few per second; only an admission
token lets them hold seats (ADR-012).

```mermaid
sequenceDiagram
  participant U as customer
  participant B as booking-service (any instance)
  participant R as Redis
  U->>B: POST /shows/SHOW-1/queue
  B->>R: ZADD NX queue (join time)
  B-->>U: WAITING, position 37
  loop every 250 ms on every instance
    B->>R: Lua: SET tick NX, ZPOPMIN 2, SET token PX
  end
  U->>B: GET /shows/SHOW-1/queue/me
  B-->>U: ADMITTED + token
  U->>B: POST holds with X-Queue-Token
  B->>R: GET admitted token
  B-->>U: 201 HELD
```
