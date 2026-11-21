---
name: web-client
description: Structure and rules of apps/web (React + Vite + Tailwind). Use when changing anything in the web app.
---

# Web client

## Structure

| File                        | Role                                                         |
| --------------------------- | ------------------------------------------------------------ |
| `src/api.ts`                | Every REST call, through the Vite proxy `/api/<service>/...` |
| `src/hooks.ts`              | `usePoll` (with `refresh()`), money and time formatting      |
| `src/components/health.tsx` | Status tab: one card per service                             |

## Rules

- Types come from `@tix/contracts`; never copy them.
- The proxy keys end in `/` (`/api/booking/`), otherwise `/api/booking` also matches `/api/booking-2`.
- Every promise started from a click handles its own error; the UI test fails on any `pageerror`.
- Keep accessible names stable (`aria-label`, button text, `data-status`): the browser test finds
  elements by them.

## Testing in a browser

`playwright-core` with the installed Chrome (`chromium.launch({ channel: "chrome" })`); two browser
contexts are two people.
