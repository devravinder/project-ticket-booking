---
name: project-conventions
description: How this repo is organised, what every task must update, and cross-platform rules. Use at the start of any task in this project.
---

# Project conventions

## Layout

- `apps/booking-service` - NestJS (`@tix/booking-service`): shows, seats, holds, bookings.
- `apps/payment-gateway` - NestJS (`@tix/payment-gateway`): the fake payment provider.
- Each service has `src/`, `migrations/NNN_*.sql` and `.env.sample`.
- `apps/web` - React + Vite + Tailwind (`@tix/web`).
- `libs/kit` - shared by both services: config, `Database`, `Redis`, `Switches`, `/health`, `bootstrap`.
- `libs/contracts` - types shared by the services and the web app; no runtime dependencies.
- `infra/` - Compose file, Postgres init script, retag scripts.
- `docs/` - TASKS, HOW-TO-RUN, DECISIONS (ADRs), architecture. `http/` - REST Client requests.

## Every task updates

1. `docs/TASKS.md` - mark `[x]`, or `[~]` with what is missing; note what was verified.
2. `docs/HOW-TO-RUN.md` - when commands, ports or env vars change.
3. `docs/DECISIONS.md` - an ADR for each choice with a rejected alternative, and for anything learned
   the hard way.
4. `http/*.http` - when an endpoint is added or changed.
5. `.kiro/skills` - when a new pattern or gotcha appears.

## Rules

- Pin exact dependency versions; pick the latest that your registry resolves.
- Comments: one line, at most 15 words, the why (see `code-comments`).
- Windows (PowerShell) and Ubuntu (bash) both work: scripts are pnpm or Node; shell scripts get a
  `.ps1` and a `.sh` twin, and `.sh`/husky hooks are committed as mode 100755.
- No organisation names, registry hosts or internal paths in tracked files. Before committing:
  `git grep --cached -i -n -w -E "<org terms>"` must find nothing.
- Commits: Conventional, lowercase subject, under 10 words, one commit at the end of each task.

## Scripts

`pnpm start:services` runs every app in one terminal: `pnpm -r --parallel run "/^dev(:2)?$/"`.
A regex script name matches `dev` and `dev:2`, so the second booking instance starts too.
A new app joins by having a `dev` script and a `--filter` in that command.

## Ports

booking 7001 (second instance 7011), gateway 7002, web 5210, Postgres 5435, Redis 6381.
