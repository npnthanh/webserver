# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Project

EMS (energy management system) web app: an admin portal for managing projects, devices, meter points, accounts, emission factors and gateways, plus a per-project customer dashboard (energy and power-quality charts, cost, greenhouse-gas emissions, alerts, reports, system diagram). Field gateways POST meter telemetry to the server. The UI text, route segments and code comments are in Vietnamese (`du-an` = project, `thiet-bi` = devices, `tai-khoan` = accounts, `he-so-phat-thai` = emission factors, `khi-nha-kinh` = GHG, `canh-bao` = alerts, `bao-cao` = reports, `so-do` = diagram). Keep new user-facing strings in Vietnamese.

Stack: Next.js 16 App Router (see AGENTS.md: read `node_modules/next/dist/docs/` before using Next APIs), React 19, Tailwind v4, `mysql2` against MariaDB/MySQL, `@xyflow/react` for the system diagram. Package manager is pnpm. There is no test suite.

## Commands

- `pnpm dev`: dev server
- `pnpm lint`: ESLint (flat config, `eslint-config-next`)
- `pnpm exec tsc --noEmit`: type-check (no script for it)
- `pnpm build`: runs `scripts/hostinger-build.mjs`, not a plain `next build` (see Deployment)
- `pnpm db:init`: applies `database/schema.sql` to local XAMPP MariaDB (creates `ems_local`). Safe to re-run. Uses `MYSQL_BIN` or `C:\xampp\mysql\bin\mysql.exe`.
- `node scripts/gateway-tcp.mjs`: raw-TCP to HTTP bridge for firmware that speaks plain TCP. It forwards to `GATEWAY_INGEST_URL` (default `http://127.0.0.1:3005/api/gateway`).

DB connection env vars: `DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME`, with `MYSQL_*` equivalents as fallbacks. Defaults are `127.0.0.1:3306`, `root`, empty password, `ems_local`. `GATEWAY_UPSTREAM_URL` sets the upstream server that gateway data is synced from (`off`/`none` disables it).

## Architecture

**Data access goes through one generic route.** Client components never query the DB directly. They call `dbFetch(resource)` from `lib/db-client.ts`, which hits `app/api/ems/[resource]/route.ts`. That single large handler implements GET/POST/PUT/DELETE for every resource in its `RESOURCE_NAMES` set as `if (resource === "...")` branches, and checks permissions with `requirePermission`. To add a resource or field, edit this route plus the matching `lib/<resource>.ts` types/normalizers. After a mutation the client calls `emitDbChange(resource)`, which fires a `window` event `ems-<resource>-changed` that other components listen to so they refetch.

**Server vs. shared lib modules.** Files that import `server-only` (`server-db.ts`, `server-auth.ts`, `server-projects.ts`, `server-client-meters.ts`, `gateway-store.ts`) must not be imported from client components. The other `lib/*.ts` files hold shared types, normalizers and constants used on both sides.

**Schema is partly self-migrating.** Besides `database/schema.sql`, many modules create or alter tables lazily at runtime: `ensureGatewaySchema`, `ensureAccountProjectsSchema`, `ensureCustomerAccountsSchema`, and the `ensure*`/`*Ready` promises in the EMS route. They use `ALTER ... ADD COLUMN` with errors swallowed and record versions in `schema_migrations`. When you change the schema, update `database/schema.sql` (local) and `database/hostinger_schema.sql` (a full MariaDB dump including data, used for production), and add the idempotent runtime migration if existing deployments need it.

**Gateway pipeline.** Firmware POSTs JSON to `/api/gateway`. `middleware.ts` also rewrites `POST /` there, because some firmware only knows IP:port. `lib/gateway-protocol.ts` parses the packet, validates CRC/checksum and builds the ACK. `lib/gateway-hmac.ts` verifies optional per-gateway HMAC. `lib/gateway-store.ts` (the largest module) persists to `gateway_packets` / `gateway_samples` / `gateway_devices`, handles thresholds and alarms, syncs live and historical data from the upstream server, and serves all chart and series queries (`getProjectGatewaySeries`, daily energy, energy slots, list telemetry). These queries use an in-memory TTL cache. Meters link to gateway data by serial number (`meter_points.serial_number`, falling back to `devices.serial_number`). The `gateway_*` tables are large, so avoid unbounded `ORDER BY` on them (see commit aaf9686).

**Auth.** Login creates a row in `auth_sessions` and sets an HTTP-only cookie holding the token. The DB stores only its sha256. `getServerSession()` resolves it against `accounts` (admin portal, roles `Admin`/`Manage`, project scope via `account_projects`) or `customer_accounts` (customer portal, bound to one `projectId`). `lib/permissions.ts` maps roles to permissions and paths to required permissions. Client-side gating lives in `components/auth/AuthGuard.tsx` and `lib/auth.ts` (`getAuthRedirect`). `middleware.ts` also strips malformed `next-action` headers.

**Routing.** Admin pages are at top-level Vietnamese segments (`/du-an`, `/tao-du-an`, `/chinh-sua-du-an/[id]/...`, `/thiet-bi`, `/gateway`, ...). The customer dashboard is `/du-an/[id]/*`: its `layout.tsx` loads the project server-side and wraps pages in `components/client/ClientShell.tsx`, and the chart and dashboard components live in `components/client/`.

**Time.** All bucketing and display uses Vietnam time (UTC+7) via `lib/vietnam-time.ts`. Don't rely on the server's local timezone.

## Deployment (Hostinger)

Production runs on Hostinger shared hosting through Passenger using the custom `server.js` (`next()` + `http.createServer`, port taken from `PORT`). `scripts/hostinger-build.mjs` fixes file permissions and runs `next build --webpack` with limited parallelism (see also `experimental.cpus: 2` in `next.config.mjs`). If the native Tailwind/LightningCSS bindings can't load on the host (old GLIBC) or `FORCE_PRECOMPILED_CSS=1` is set, it temporarily swaps `app/globals.css` for `app/globals.compiled.css` and disables PostCSS. That means `globals.compiled.css` is a checked-in, pre-built CSS bundle, and it must be regenerated and committed whenever styles or Tailwind classes change, or production styling will drift.
