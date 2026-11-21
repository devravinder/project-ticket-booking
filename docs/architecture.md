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

This document grows with each task.
