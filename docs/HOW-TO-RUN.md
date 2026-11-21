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
- `http/health.http` - REST Client requests (VS Code or JetBrains).

## Stop and reset

```bash
pnpm stop:pods     # keeps the data
pnpm reset:pods    # deletes the data; migrations and seeds run again on next start
```
