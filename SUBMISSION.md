# Verity — submission

Live: https://verity-theta-topaz.vercel.app · Code: https://github.com/dpp0007/Verity

## What I built

Verity verifies professional licences and business registrations directly against official public registries, then monitors each verified record and raises an alert only when a field actually changes (status, expiry, new disciplinary action). Every result shows its source URL, the time it was checked, and a confidence level derived from evidence. Anything it cannot confirm stays `unknown`, `null` or `temporarily_unavailable`; it never turns a failed search into "not found".

It is a Next.js 15 app with a web UI (Verify, Results, Watchlist, API & Activity) and a versioned REST API under `/api/v1` (OpenAPI at `/api/v1/openapi`).

## Where TinyFish is used

All four TinyFish products are used, in `src/tinyfish/`. The API key is attached in one place (`client.ts`) and never reaches the browser.

| Product | Used for |
|---|---|
| Search | Finds the official source, restricted to the registry's approved domains. A snippet is never evidence. |
| Agent | Searches the registry and extracts the record against a strict output schema. Where a page loads its status by script, up to 3 reads are made and 2 must agree. |
| Fetch | Re-retrieves the record page independently; an agent excerpt counts as validated only if it appears on that page. |
| Monitor | A page monitor on the official record URL. A page change triggers a fresh verification, and alerts come only from field-level differences. Scheduled results arrive at `/api/v1/webhooks/tinyfish`. |

Details and contract notes: [docs/TINYFISH.md](docs/TINYFISH.md).

## How to test it

### A. In the browser (about 2 minutes, uses a few TinyFish credits)

1. Open https://verity-theta-topaz.vercel.app and choose **Verify**.
2. Registry **Companies House**, enter `Tesco PLC` or number `00445790`. Expect a result with status, incorporation date and a source URL on `company-information.service.gov.uk`.
3. Registry **Medical Board of California**, enter licence number `A 46271`. Expect `verified`, active, expires 2028-12-31, with evidence labelled as confirmed by agreeing reads.
4. On a result, add it to the **Watchlist**, then press **Check now**. Expect `unchanged` and no alert.
5. `GET /api/health` should return `{"status":"ok","database":"ok","provider":"tinyfish"}`.

The site is public, so please keep it to a few checks; each one spends credits.

### B. Locally, no API key needed (simulated TinyFish provider)

```bash
npm install
cp .env.example .env
npx prisma migrate deploy
npm test            # 114 unit/integration tests
npm run test:e2e    # Playwright against the real app + simulated provider
```

### C. Locally, against the real TinyFish API (needs `TINYFISH_API_KEY`, spends credits)

```bash
npm run smoke -- gb-companies-house       # live end-to-end verification
npm run monitor-demo                      # live proof that TinyFish Monitor detects change
npm run live-suite                        # gold-set run across the registers
```

## Honest limits

- Companies House, the Medical Board of California (by licence number) and the GMC reach `verified`/high in live runs. CSLB and NMC are intermittent. Ireland and Singapore are refused because of bot protection; Verity does not bypass it.
- A real scheduled webhook has been received and recorded (outcome `unchanged`). A real status *change* arriving by webhook has not been observed yet.
- Records reflect the source at the time checked. Verity does not guarantee identity, suitability or compliance.
- Details: [README.md](README.md), [docs/REGISTRIES.md](docs/REGISTRIES.md), [docs/MONITORING.md](docs/MONITORING.md).
