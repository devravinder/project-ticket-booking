---
name: nestjs-service
description: Patterns for the NestJS services and libs/kit (NestJS 12 run by tsx). Use when adding a service, controller, provider or background job.
---

# NestJS service patterns

## Injection

`tsx` (esbuild) emits no decorator metadata. **Every constructor parameter needs `@Inject(Token)`**,
classes included:

```ts
constructor(
  @Inject(SERVICE_CONFIG) private readonly config: BookingConfig,
  @Inject(Database) private readonly db: Database,
) {}
```

Symptom when missing: `Cannot read properties of undefined` on first use.

## tsconfig include

tsx applies compiler options only to files in the tsconfig `include`. Each service includes
`../../libs/*/src`. Symptom when missing: "Parameter decorators only work when experimental
decorators are enabled".

## A service

- `src/main.ts` calls `bootstrap(AppModule, <migrations dir>)` from `@tix/kit`: migrations run
  before the port opens; `rawBody` is on for webhook signatures.
- `src/app.module.ts` imports `KitModule.forService(loadConfig(schema), { switches })`. Extend
  `baseEnvSchema` with `.extend({...})` for service-specific variables.
- `KitModule` is global: `SERVICE_CONFIG`, `Database`, `Redis` and `Switches` can be injected anywhere.

## Errors

Throw with `fail(status, code, message, extra)` from `@tix/kit`. Every error body has a stable
`code`; the UI and tests branch on it, never on the message. `parse(schema, value)` turns a zod
failure into 400 `INVALID_REQUEST`.

## Data access

- `db.query(sql, values)` for one statement; `db.tx(async (c) => ...)` when several statements
  must commit together. Inside `tx`, use `c`, never `db.query`, or the statement runs outside the
  transaction.
- Always parameterised (`$1`, `$2`); never build SQL from strings.
- Never call another service (HTTP) inside a transaction: commit, call, then record the result.

## Background jobs

`setInterval` started in `onApplicationBootstrap`, one run at a time (`this.running ??= ...`),
stopped and awaited in `onModuleDestroy`. Two instances may run the same job: claim rows with
`FOR UPDATE SKIP LOCKED`.

## Live updates (SSE)

- Announce a seat change with `SeatEvents.publish(c, changes)` inside the same transaction as the
  change; it calls `pg_notify`, which Postgres delivers only on commit.
- `@Sse()` handlers are `async` and validate before returning the `Observable`, so an unknown show
  is a normal 404 instead of an error event on an open stream.
- The `Observable` teardown removes the viewer: always clear its timers there.
- The LISTEN connection is a plain `pg.Client`, not from the pool. `error` and `end` can both fire
  for one failure: reconnect once (a `gone` flag), and resync viewers after reconnecting.
