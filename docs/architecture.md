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
