---
name: payment-gateway
description: How the fake payment gateway works and how the booking service must talk to it (sessions, pay page, webhooks, refunds). Use when changing apps/payment-gateway or any booking code that calls it or receives its webhooks.
---

# Payment gateway

## Contract

| Call                                 | Notes                                                      |
| ------------------------------------ | ---------------------------------------------------------- |
| `POST /sessions` + `Idempotency-Key` | replay 200 `Idempotent-Replayed`; other body 422           |
| `GET /sessions/:id`                  | status API; `OPEN` past `expiresAt` reads `EXPIRED`        |
| `GET /pay/:id`, `POST /pay/:id`      | hosted page; redirect 303 to `returnUrl?session&status`    |
| `POST /sessions/:id/pay`             | same as a button: `{ "outcome": "approve" \| "decline" }`  |
| `POST /sessions/:id/refund` + key    | once per session; 409 `NOT_REFUNDABLE`, `ALREADY_REFUNDED` |

Webhooks: `payment.succeeded`, `payment.failed`, `refund.succeeded`, body
`{ id, type, createdAt, data: { sessionId, merchantRef, amountCents, status } }`, headers
`Gateway-Signature` and `Gateway-Event-Id`. At least once: the same event id can arrive twice.

## Rules

- Status changes and their webhook row are written in one transaction (`emit(c, ...)`).
- Never make the HTTP call inside a transaction: claim with a lease, commit, send, record.
- Sign with `signWebhook` and check with `verifyWebhook` from `@tix/kit`; the raw request body is
  what is signed, so parse JSON only after verifying.
- Express pages use `@Res()`: Nest still defaults a `POST` to 201, so set `res.status(200)`.
- Session ids look like `ps_` + 16 base64url characters; event ids `evt_...`, refunds `rf_...`.
