# How to run

Everything runs on your machine: Postgres and Redis in Docker, the services and the web app on the
host. Works on Windows (PowerShell) and Ubuntu (bash).

## Prerequisites

- Docker (Desktop on Windows, Engine on Linux) with Compose v2
- Node.js 22 or later and pnpm 12 (`corepack enable`)

## Images

Compose uses `postgres:latest` and `redis:6.2.24`. If Docker Hub is not reachable and the images come
from a private registry, pull them from there and retag them with the plain names:

```bash
# Windows
$env:IMAGE_REGISTRY = "<registry-host>"; pwsh -File infra/retag-images.ps1
# Linux
IMAGE_REGISTRY="<registry-host>" ./infra/retag-images.sh
```

Paths that differ in your registry go in `infra/retag-images.local.json` (git-ignored).

## Start

```bash
pnpm install
pnpm start:pods        # Postgres :5435, Redis :6381; waits until both are healthy
pnpm start:services    # booking-service :7001 and payment-gateway :7002
pnpm start:web         # http://localhost:5210
```

Each service can also run on its own: `pnpm start:booking`, `pnpm start:gateway`. A second booking
instance on :7011 (same database) is `pnpm start:booking:2`. To see the live map cross instances,
open a show in two tabs and pick "via instance :7011" in one of them.

## Ports

| What            | Port | Notes                                              |
| --------------- | ---- | -------------------------------------------------- |
| booking-service | 7001 | second instance 7011                               |
| payment-gateway | 7002 | fake payment provider                              |
| web             | 5210 | `/api/<service>/...` is proxied                    |
| Postgres        | 5435 | user `tix` / `tix`; databases `booking`, `gateway` |
| Redis           | 6381 | no persistence                                     |

## Check

- `http://localhost:5210` - the Status tab shows every service and dependency.
- `http/*.http` - REST Client requests (VS Code or JetBrains).

## Environment

Each service reads `apps/<service>/.env.sample` (local values only, no real secrets):

| Variable         | Service         | Meaning                                             |
| ---------------- | --------------- | --------------------------------------------------- |
| `PUBLIC_URL`     | payment-gateway | where the browser reaches the pay page              |
| `WEBHOOK_SECRET` | both            | signs and checks webhooks; must be the same in both |

## Lab

The Lab tab has a card per scenario and the switches of every service. Switches live in memory, so
restarting a service resets them; each panel also has a Reset button.

- **Same seat, same moment:** N people hold one seat at once, in `atomic`, `pessimistic` or `naive`
  mode, optionally split over both booking instances.
- **Live seat map across instances:** LISTEN stats per instance and a button that drops the
  connection.
- **Payment gateway log:** sessions, every webhook attempt, Redeliver.

## Stop and reset

```bash
pnpm stop:pods     # keeps the data
pnpm reset:pods    # deletes the data; migrations and seeds run again on next start
```
