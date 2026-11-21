---
name: seat-rules
description: Rules for any code that changes a seat, hold or booking in the booking service. Use when touching show_seats, holds, bookings or the expiry and reconciliation jobs.
---

# Seat rules

## Who gets a seat

- Only a conditional `UPDATE ... WHERE <seat is free>` decides (ADR-006). Never read a seat, decide
  in code and then write it, except in the deliberately broken `naive` mode.
- "Free" is `SEAT_IS_FREE` from `src/shows/seat-sql.ts`: `AVAILABLE`, or `HELD` with an expired hold.
  Use the constant; do not re-type the condition.
- All or nothing: if fewer rows changed than seats were asked for, throw so the whole transaction
  rolls back.

## Locks

- Lock seats in seat-number order (sort the request; `ORDER BY seat_no FOR UPDATE`).
- Lock order across tables: hold, then booking, then seats. `settle` locks the hold through
  `bookings.hold_id` before the booking; the sweeper and release already start at the hold.
- Background jobs that two instances run claim rows with `FOR UPDATE SKIP LOCKED`.

## Payment results

- Every result (webhook, return, reconciliation) goes through `BookingsService.settle(c, ...)`.
  Never change a booking's status anywhere else.
- Write a `booking_log` entry with every change; the timeline is how a person debugs it.
- No HTTP call inside a transaction. Commit, call the gateway, then record in a new transaction.

## Freeing seats

- Free only seats that still point at your hold (`WHERE hold_id = $1 AND status = 'HELD'`). After
  an expiry someone else may hold the seat already.
- `show_seats` has a check: `HELD` exactly when `hold_id` and `hold_expires_at` are set.

## Testing

- Race tests fire requests with `Promise.all` and count 201 against 409 `SEATS_UNAVAILABLE`; any
  other answer is a failure.
- `X-User` must be 3-30 characters: a test user called `p0` gets a 400, not a race.
