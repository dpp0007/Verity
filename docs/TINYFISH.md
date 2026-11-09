# TinyFish integration

Contracts below were read from docs.tinyfish.ai on 2026-11-03. Everything lives in `src/tinyfish/`; the API key is attached in exactly one place (`client.ts`, header `X-API-Key`) and never reaches the browser.

| Capability | Endpoint | Used for |
|---|---|---|
| Search | `GET https://api.search.tinyfish.ai` (`query`, `include_domains`, `location`, `language`) | Source discovery, restricted to the registry's approved domains; hits off those domains are dropped; a snippet is never evidence |
| Fetch | `POST https://api.fetch.tinyfish.ai` (`urls`, `format: markdown`, `ttl: 0`, `per_url_timeout_ms`) | Live re-retrieval of the record page to validate agent excerpts; per-URL `errors[]` are surfaced as limitations |
| Agent | `POST https://agent.tinyfish.ai/v1/automation/run-async` + `GET /v1/runs/{id}` (poll) + `POST /v1/runs/{id}/cancel` | Interactive registry search and record extraction with `output_schema` (only keywords the docs allow) |
| Monitor | `POST/GET/PATCH/DELETE /v1/monitors`, `POST /v1/monitors/{id}/runs` | Page monitor (`type: fetch`) on the official record URL |

## Behaviour

- Timeouts: 30 s default; Fetch 150 s (docs recommend ≥150); monitor create/run 120 s; agent runs capped by `max_duration_seconds` (240) plus a polling deadline, then cancelled.
- Retries: up to 2 with backoff for 429/5xx/network/timeouts, honouring `Retry-After`. **Monitor creation is never retried** to avoid duplicate monitors; a local unique key `(owner, verification)` additionally blocks duplicates.
- Errors: `TinyFishError` kinds `auth | billing | rate_limit | invalid | not_found | conflict | unavailable | timeout | malformed | blocked | agent_failure`. Run-level agent failures (`SITE_BLOCKED`, `TIMEOUT`, `SERVICE_BUSY`, …) are mapped case-insensitively. Source-side problems become `temporarily_unavailable`; malformed output becomes `failed`. Nothing is substituted with mock data.
- Validation: every provider response is parsed with Zod before use; agent output is re-validated and placeholders (`""`, `N/A`) become `null`.
- Provider ids are persisted: `Verification.providerRunIds`, `Monitor.providerId`, `MonitorRun.providerRunId`.

## Gaps in the provider contract (handled, not hidden)

- **Webhook signatures are not documented** for Monitor webhooks. Verity embeds `?token=WEBHOOK_SECRET` in the registered URL and compares it in constant time; this is a shared-secret URL, weaker than HMAC. Re-check the docs for signing support before production.
- Monitor webhooks are sent for **scheduled** runs only; "run now" returns the run in the response and Verity processes it directly. Run-now responses carry no change judgement, so manual checks detect change via a content hash and then re-verify.
- The docs do not show the PATCH/GET monitor response body explicitly; the parser accepts either a bare monitor or `{ monitor }`. **Unconfirmed against the live API.**
- Monitor responses do not echo `purpose`; Verity stores it locally.
- Agent webhooks are not used (runs are polled), so no agent-webhook authenticity question arises.
- The 402 (insufficient credits) case is surfaced as `provider_billing`.

## Change-detection design

TinyFish page monitors fire on any content difference. Verity treats that as a *trigger*, never a conclusion: if TinyFish's relevance judgement says the change is unrelated, nothing happens; otherwise the record is re-verified (Agent + Fetch) and `detectChanges` compares normalized fields with the stored baseline. Layout/banner changes that leave the verified fields identical produce no alert; an inconclusive re-verification produces a monitoring error, not an alert.
