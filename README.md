# Verity — Trust, verified at the source

Verity verifies professional licences and business registrations directly against official public registries and monitors verified records for meaningful changes. It is built on [TinyFish](https://docs.tinyfish.ai) (Search, Fetch, Agent, Monitor).

> Records reflect the source and the time checked. Verity does not guarantee identity, suitability for employment, or legal compliance.

## Status — read this first

| Area | State |
|---|---|
| App, API, DB, UI, monitoring lifecycle | Implemented; 96 unit/integration tests against a simulated TinyFish provider |
| Real TinyFish calls (Search, Fetch, Agent, Monitor) | **Working live** (2026-11-09) |
| Live registry verification | Companies House, the Medical Board of California (by licence number) and the GMC reach `verified`/high in live runs. CSLB, NMC and discovered company registers run end to end with lower confidence or intermittently. Ireland and Singapore are refused up front (bot protection). See [docs/REGISTRIES.md](docs/REGISTRIES.md) |
| Monitoring | Create, pause, resume, check-now and delete work against the real Monitor API. `npm run monitor-demo` proves live change detection (3 of 3 runs reported `changed` on a page that updates every minute). Scheduled re-checks cover pages whose status loads by script. Automatic webhooks need a public https `APP_URL` and have **not** been demonstrated from a local run |
| TinyFish-only | Yes by default. The India Sandbox vendor is opt-in (`VERITY_ENABLE_THIRD_PARTY_VENDORS=1`) |

Run `npm run live-suite` to re-check everything against the real registers (spends credits).

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind 3 · Prisma 6 · SQLite locally and hosted libSQL (Turso) on Vercel; JSON is stored as text, so the schema is portable · Zod · Vitest · Playwright.

## Setup

```bash
npm install
cp .env.example .env        # fill TINYFISH_API_KEY, WEBHOOK_SECRET (>= 8 chars), APP_URL
npx prisma migrate deploy   # creates prisma/dev.db
npm run dev                 # http://localhost:3000
```

| Variable | Purpose |
|---|---|
| `TINYFISH_API_KEY` | Server-side only (in dev, `.env` overrides a stale OS-level variable). Create at https://agent.tinyfish.ai/api-keys |
| `DATABASE_URL` | `file:./dev.db` (SQLite) or a PostgreSQL URL |
| `APP_URL` | Public base URL; monitor webhooks are registered only if this is public `https` |
| `WEBHOOK_SECRET` | Shared secret appended to the webhook URL (TinyFish documents no signature) |
| `VERITY_API_KEYS` | Optional comma-separated bearer keys for programmatic API access |
| `VERITY_ENABLE_THIRD_PARTY_VENDORS`, `SANDBOX_API_KEY`, `SANDBOX_API_SECRET` | Optional, off by default. All three are needed. Enables India company lookups through the licensed Sandbox MCA API (third party, not the official registry; confidence capped at medium; no monitoring). Live-tested once (Infosys Limited) |
| `TINYFISH_*_URL` | Test-only provider overrides. `/api/health` reports `provider: "simulated"` when set |

`GET /api/health` reports database and configuration problems (503 when degraded).

## Commands

| Command | What it does |
|---|---|
| `npm test` | Unit + integration tests (SQLite test DB built from real migrations, **simulated provider**) |
| `npm run test:e2e` | Playwright against the real app + **simulated provider** (uses installed Chrome; set `PW_CHANNEL=chromium` after `npx playwright install chromium` otherwise) |
| `npm run smoke -- <registry-id> "<name>" [number]` | **Live** workflow against real TinyFish + registry. Exit 2 = *not tested*, never a pass |
| `npm run build && npm start` | Production build/run |
| `npm run db:migrate:turso` | Applies the SQL migrations to the hosted libSQL database (see Deployment) |
| `npm run live-suite` | Gold-set run against the real registers (spends credits) |
| `npm run monitor-demo` | Live proof that TinyFish Monitor sees change: creates a monitor, runs it repeatedly, deletes it |

## Architecture

```
src/tinyfish/   client (auth, timeouts, bounded retries) · search · fetch · agent · monitor · normalization · errors
src/server/     verify (engine) · verifications · monitoring · webhook · serialize · api (auth, rate limit, errors)
src/lib/        registries (config) · status/date normalization · matching · confidence · changes · monitorState · url (allow-list)
src/app/        UI (Verify, Results, Watchlist, API & Activity) and /api/v1 routes
```

**Verification flow** (background job, never inside the browser request): `finding_source` (Search restricted to the registry's approved domains) → `searching_registry` (Agent with strict output schema) → `comparing_records` (never auto-picks among several) → `verifying_evidence` (Agent opens the single record, then Fetch re-retrieves the page; excerpts count as *validated* only if found on that independently fetched page). Stages are written to the database only when that step runs.

**Trust rules enforced in code:** unknown source statuses stay `unknown`; missing fields are `null` with an explanation; a failed or incomplete search is `temporarily_unavailable`/`failed`, never `not_found`; ambiguous results require selection; confidence is derived from evidence (see `src/lib/confidence.ts`); URLs must be https on a registry's approved domain.

**Monitoring:** a TinyFish *Page Monitor* (`type: "fetch"`) on the direct official record URL, daily `0 6 * * *` UTC. A page change never creates an alert by itself: it triggers a fresh verification, and alerts are created only for field-level differences (status, expiry, new disciplinary actions) in the verified result. Failed checks create a monitoring error, not an alert. Pause/resume/run-now/delete call the real Monitor API. Webhooks are deduplicated on `fetch_monitor_id:id`.

**Scheduled re-check:** a page monitor only sees what a plain page fetch sees. Some official pages (California licence profiles) load their status by script, so the page text never changes when the status does. The maintenance cron therefore re-verifies every active monitor each `VERITY_RECHECK_HOURS` (default 24) through the same path as a page change, so alerts still come only from field-level differences. Cooldown: one re-check per record per 10 minutes.

**Agent reads:** where Fetch cannot see a page's status, the record is read by the browser agent up to three times and two reads must agree on status, number and expiry before the evidence is marked confirmed. A consensus overrules an outlier first read, and the result says so.

**Background jobs:** a verification runs after the HTTP response (Next `after()`). A `running` job older than 8 minutes is marked `failed (interrupted, retryable)` when read, and the daily maintenance cron re-drives `queued` jobs. See Deployment.

**Access control:** the web UI uses an anonymous httpOnly owner cookie; every record is scoped to its owner. API clients may use bearer keys (`VERITY_API_KEYS`). There is no account system. Rate limits are in-memory (per process).

## API

Versioned REST under `/api/v1` — see `/developers` in the app and the OpenAPI document at `/api/v1/openapi`.

`POST/GET /verifications`, `GET /verifications/:id`, `POST /verifications/:id/select`, `POST /verifications/:id/retry`, `GET /registries`, `POST/GET /monitors`, `GET/PATCH/DELETE /monitors/:id`, `POST /monitors/:id/check`, `GET /activity`, `POST /webhooks/tinyfish`.

## Deployment (Vercel)

Vercel functions are serverless: there is no persistent disk and no always-on worker, so production differs from local development. Each difference is handled in code:

| Concern | How it works on Vercel |
|---|---|
| Database | Hosted libSQL ([Turso](https://turso.tech), SQLite-compatible, available from the Vercel Marketplace). With `TURSO_DATABASE_URL` set, [src/lib/db.ts](src/lib/db.ts) uses it through a Prisma driver adapter; locally the SQLite file is used |
| Background jobs | A verification runs after the HTTP response through Next's `after()`, and the routes that start one set `maxDuration = 300` (the limit with Vercel Fluid compute on Hobby; a job that outlives its function is reported as *interrupted* and can be retried) |
| Scheduled work | [vercel.json](vercel.json) runs `/api/cron/maintenance` daily at 05:00 UTC: it fails dead jobs, re-drives queued ones and starts scheduled re-checks (3 records per run). Hobby allows daily crons only; on Pro change the schedule (for example `*/10 * * * *`) |
| Rate limits | Counted from database rows, so they hold across instances |

1. Create a libSQL database and apply the schema once, from your machine:
   ```bash
   TURSO_DATABASE_URL=libsql://<db>.turso.io TURSO_AUTH_TOKEN=<token> npm run db:migrate:turso
   ```
2. Import the repository in Vercel and set these environment variables:

   | Variable | Value |
   |---|---|
   | `TINYFISH_API_KEY` | your TinyFish key |
   | `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | from step 1 |
   | `APP_URL` | the public https origin, for example `https://verity.vercel.app` (TinyFish calls the monitor webhook there) |
   | `WEBHOOK_SECRET` | 8+ characters |
   | `CRON_SECRET` | 8+ characters; Vercel sends it to the cron route automatically |
   | `VERITY_API_KEYS` | optional bearer keys for programmatic access |

3. Deploy (the build runs `prisma generate && next build`). Check `GET /api/health` returns `ok`.
4. Create a monitor in the app. Because `APP_URL` is public https, the TinyFish monitor registers its webhook and changes arrive without anyone pressing "Check now".

Not deployed yet: this path was verified locally (the libSQL adapter ran a real verification against a local libSQL file) but not on Vercel itself.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Verification fails with `provider_auth` | TinyFish key invalid/expired — create a new one |
| `provider_billing` | TinyFish wallet empty (Agent and Monitor draw from the wallet) |
| Watchlist says "Manual checks only" | `APP_URL` not public https, `WEBHOOK_SECRET` unset, or TinyFish did not echo a `webhook_url` |
| Verification stuck → "interrupted" | Process restarted mid-job; use Retry |
| Registry returns `temporarily_unavailable` | Site blocked/timeout; retry later. Not evidence about the licence |
| `npm run build` fails on TypeScript 7 | Keep `typescript@5.x` (Next 15 requires the JS compiler API) |
