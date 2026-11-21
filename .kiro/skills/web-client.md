---
name: web-client
description: Structure and rules of apps/web (React + Vite + Tailwind). Use when changing anything in the web app.
---

# Web client

## Structure

| File                                    | Role                                                         |
| --------------------------------------- | ------------------------------------------------------------ |
| `src/api.ts`                            | Every REST call, through the Vite proxy `/api/<service>/...` |
| `src/hooks.ts`                          | `usePoll` (with `refresh()`), money and time formatting      |
| `src/live.ts`                           | `useLiveShow`: EventSource, snapshot then changed seats      |
| `src/components/health.tsx`             | Status tab: one card per service                             |
| `src/components/shows.tsx`              | Show cards                                                   |
| `src/components/show-page.tsx`          | One show: seat map and (later) hold and checkout             |
| `src/components/seat-map.tsx`           | Seat grid; colour from a `lookOf(seat)` callback             |
| `src/components/lab/lab.tsx`            | Lab tab: scenario cards and switches panels                  |
| `src/components/lab/race.tsx`           | Same seat, same moment: N racers via `Promise.all`           |
| `src/components/lab/scenarios.ts`       | Payment scenarios: switches, steps, expected status          |
| `src/components/lab/checkout-lab.tsx`   | Runs a scenario, shows verdict and booking timeline          |
| `src/components/lab/consistency.tsx`    | Consistency report card and crash instructions               |
| `src/components/bookings.tsx`           | My bookings, booking detail with timeline                    |
| `src/components/lab/switches-panel.tsx` | Edit any service's switches (choices for modes)              |

## Rules

- Types come from `@tix/contracts`; never copy them.
- The seat map is live (`useLiveShow`); do not add polling for it. Lists and the Lab poll.
- The proxy keys end in `/` (`/api/booking/`), otherwise `/api/booking` also matches `/api/booking-2`.
- The return from the gateway (`/?booking=<id>`) calls `verify` once (a module flag: StrictMode
  runs effects twice) and cleans the URL.
- Every promise started from a click handles its own error; the UI test fails on any `pageerror`.
- Keep accessible names stable (`aria-label`, button text, `data-status`): the browser test finds
  elements by them.

## Testing in a browser

`playwright-core` with the installed Chrome (`chromium.launch({ channel: "chrome" })`); two browser
contexts are two people.
