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
