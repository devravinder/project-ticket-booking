# Interview questions

Questions this project answers, each with a short answer and where to look. Try to answer first.

## Two people, one seat

**Two users click the same seat in the same millisecond. Who gets it, and how?**
One conditional `UPDATE ... WHERE seat is free RETURNING seat_no`. The second transaction waits for
the row lock, re-checks the `WHERE` on the new row and matches nothing, so it gets 409. Postgres
decides; the application never "checks, then writes". See ADR-006 and the Lab race in `naive` mode,
where everyone is told the seat is theirs.

**Why not `SELECT` the seat, check it is free, then `UPDATE`?**
Between the read and the write another request reads "free" too. Both write; the last one wins
silently. `SELECT ... FOR UPDATE` fixes it (pessimistic mode) at the cost of one more round trip.

**A user picks 4 seats and one is taken. What happens to the other 3?**
Nothing: the hold is all or nothing. Fewer rows changed than requested, so the transaction rolls
back and the answer lists the seat that was taken.

**Can two multi-seat holds deadlock?**
Only if they lock seats in different orders. Seats are always locked in seat-number order; 40
overlapping 3-seat holds gave no deadlock. Across tables the order is hold, booking, seats.

**Would you use Redis `SET NX` for seat locks?**
For very hot shows it is faster, but then Redis and Postgres must agree, and an expired Redis key
tells nobody. Here Postgres is the source of truth; Redis only runs the waiting room (ADR-012).

## Holds and expiry

**How does a hold expire if the job that expires holds is down?**
It does not depend on the job. Every query treats `HELD` with `hold_expires_at <= now()` as free, so
the seat is on sale again at the expiry instant. The sweeper only tidies up and announces the
change to the live map (ADR-007).

**The payment session and the hold both expire. Which first, and why?**
The payment session ends `paymentMarginMs` (10 s) before the hold, so a customer who pays at the last
moment still owns the seats while the bank answers (ADR-010).

## Payment

**Can you trust `?status=PAID` on the return URL?**
No, anyone can type it. The return makes the server ask the gateway's status API (ADR-010).

**The webhook arrives twice, or together with the return. How is the seat booked once?**
Every result goes through `settle`, which locks the hold and the booking and does nothing if the
result was already applied. Webhooks also go through an inbox table keyed by event id.

**Payment fails. What happens to the seats?**
They are released at once (compensation), not after the hold expires.

**The customer paid, but our server crashed before recording it. What now?**
The gateway retries the webhook until we answer 2xx. If that also fails, reconciliation asks the
gateway about every booking still waiting after 15 s (ADR-011).

**The customer paid after the hold expired and someone else took the seat.**
The booking becomes `REFUND_PENDING` and a job refunds it with an idempotency key, so a retry
refunds once. If the seat was still free, the late payment books it.

**We crashed after the gateway created a payment session but before we saved its id.**
Pressing Pay again sends the same idempotency key and gets the same session. Reconciliation can also
find it by our booking id (`merchantRef`).

**How do you know a webhook really came from the gateway?**
HMAC-SHA256 over the timestamp and the raw body with a shared secret, compared in constant time;
signatures older than 5 minutes are refused, so captured requests cannot be replayed (ADR-009).

**Why is the gateway call outside the database transaction?**
A slow gateway would hold row locks for seconds, and a timeout would leave us unsure whether a
session exists. Commit, call with an idempotency key, then record the result.

## Live seat map

**How does a viewer on instance B see a hold made on instance A?**
The hold's transaction calls `pg_notify`; Postgres delivers it to every listening instance only
when the transaction commits, so a rolled-back hold is never announced. Each instance streams the
changed seats to its viewers over SSE (ADR-008).

**Why SSE and not WebSocket?**
Updates only flow from server to browser. SSE is plain HTTP, reconnects by itself and passes
through proxies unchanged.

**What if an instance misses notifications?**
`NOTIFY` is not stored. After its LISTEN connection comes back, the instance sends every open map a
full snapshot.

## Flash crowds

**10 000 people open a concert at the same second. What do you do?**
A waiting room: a Redis sorted set per show (FIFO by join time); a Lua script lets N people in per
second with a token that expires; holds need the token. Two instances still admit N per second
because only one wins `SET tick:<second> NX` (ADR-012).

**Redis goes down during the sale.**
The waiting room fails closed (503). Letting everyone in would bring back the stampede.

## Checking yourself

**How would you prove nothing was double-sold?**
Invariant queries (`GET /admin/consistency`): no seat `BOOKED` without a confirmed booking, no
confirmed booking missing a seat, no seat in two confirmed bookings. The schema also allows one
booking per seat row.
