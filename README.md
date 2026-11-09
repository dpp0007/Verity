# Verity — Trust, verified at the source

Verity verifies professional licences and business registrations directly against official public registries and monitors verified records for meaningful changes. It is built on [TinyFish](https://docs.tinyfish.ai) (Search, Fetch, Agent, Monitor).

> Records reflect the source and the time checked. Verity does not guarantee identity, suitability for employment, or legal compliance.

## Status — read this first

| Area | State |
|---|---|
| App, API, DB, UI, monitoring lifecycle | Implemented; 96 unit/integration tests against a simulated TinyFish provider |
| Real TinyFish calls (Search, Fetch, Agent, Monitor) | **Working live** (2026-11-09) |
| Live registry verification | Companies House and the Medical Board of California (by licence number) pass the live suite. CSLB, GMC, NMC and discovered company registers run end to end with lower confidence. See [docs/REGISTRIES.md](docs/REGISTRIES.md) |
| Monitoring | Create, pause, resume, check-now and delete work against the real Monitor API. Automatic webhooks need a public https `APP_URL`, so they have **not** been demonstrated from a local run |
| TinyFish-only | Yes by default. The India Sandbox vendor is opt-in (`VERITY_ENABLE_THIRD_PARTY_VENDORS=1`) |

Run `npm run live-suite` to re-check everything against the real registers (spends credits).

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind 3 · Prisma 6 · SQLite by default (PostgreSQL: change the datasource `provider`; JSON is stored as text so the schema is portable) · Zod · Vitest · Playwright.

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
| `npm run worker` | Re-drives queued jobs and fails dead ones (see Background jobs) |

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

**Background jobs:** jobs run in the web process. If it restarts, `queued` jobs are picked up by `npm run worker` and `running` jobs older than 15 minutes are marked `failed (interrupted, retryable)` when read. On serverless hosts run the worker as a separate long-lived process.

**Access control:** the web UI uses an anonymous httpOnly owner cookie; every record is scoped to its owner. API clients may use bearer keys (`VERITY_API_KEYS`). There is no account system. Rate limits are in-memory (per process).

## API

Versioned REST under `/api/v1` — see `/developers` in the app and the OpenAPI document at `/api/v1/openapi`.

`POST/GET /verifications`, `GET /verifications/:id`, `POST /verifications/:id/select`, `POST /verifications/:id/retry`, `GET /registries`, `POST/GET /monitors`, `GET/PATCH/DELETE /monitors/:id`, `POST /monitors/:id/check`, `GET /activity`, `POST /webhooks/tinyfish`.

## Deployment

1. Provision persistent storage (a volume for SQLite, or PostgreSQL after changing the Prisma provider and regenerating the migration).
2. Set the environment variables; `APP_URL` must be the public https origin.
3. `npx prisma migrate deploy && npm run build && npm start`; run `npm run worker` alongside if your host can restart the web process.
4. Verify `GET /api/health` returns `ok`, then run `npm run smoke` for each registry.
5. Webhooks are registered automatically per monitor as `${APP_URL}/api/v1/webhooks/tinyfish?token=${WEBHOOK_SECRET}`. Without a public https `APP_URL` monitors are still created but only change on manual "Check now", and the UI says so.

Not deployed anywhere yet.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Verification fails with `provider_auth` | TinyFish key invalid/expired — create a new one |
| `provider_billing` | TinyFish wallet empty (Agent and Monitor draw from the wallet) |
| Watchlist says "Manual checks only" | `APP_URL` not public https, `WEBHOOK_SECRET` unset, or TinyFish did not echo a `webhook_url` |
| Verification stuck → "interrupted" | Process restarted mid-job; use Retry |
| Registry returns `temporarily_unavailable` | Site blocked/timeout; retry later. Not evidence about the licence |
| `npm run build` fails on TypeScript 7 | Keep `typescript@5.x` (Next 15 requires the JS compiler API) |
