# Registry coverage

Registries are configuration (`src/lib/registries.ts`): id, authority, country/regions, record types, approved domains, search entry, method, expected fields, limitations, navigation hints, and a `livePassed` flag. The generic engine builds Agent instructions from this config; adding a registry means adding an entry (and, if needed, hints) rather than new code paths.

**Live results (re-run 2026-11-09, real TinyFish API, `npm run live-suite`)**

| Registry | Result |
|---|---|
| Companies House (GB) | **Pass.** By number, name variants, several matches then pick, liquidated companies read as `inactive`, no match, a wrong number never verifies. `verified`/high, Fetch-confirmed. New in the latest run: Rolls-Royce Holdings plc by number, `verified`/high, through the production server |
| Medical Board of California (CA) | **Pass by licence number** (A 46271 → `verified`/high, active, issued 1989-07-11, expires 2028-12-31). Name-only search is refused: the DCA search form is behind a CAPTCHA, which Verity does not bypass. The public profile page `search.dca.ca.gov/profile/800/8002/<n>/A` has no CAPTCHA, so a licence number opens it directly. Fetch cannot see the script-rendered status, so it is confirmed by up to three separate Agent reads, two of which must agree (labelled as such) |
| GMC (GB) | **Pass.** Chris Whitty (nickname) → GMC 3545939, `verified`/high, registered 1992-08-01, annual retention due 2027-08-01. The page is server-rendered, so Fetch confirms it |
| CSLB (CA contractors) | Found Granite Construction Company (licence 89, active) on 2026-11-08 and 2026-11-09. On 2026-11-09 the CSLB site later showed "database is currently undergoing scheduled maintenance"; Verity now reports that as `temporarily_unavailable`, never as "no match" |
| NMC Indian Medical Register | Intermittent: Randeep Guleria was found on some runs (`partially_verified`, number and council, no status because the register shows none) and not on others. A run that finds nothing is reported as no match only when the site itself said so |
| Discovered company registers | Canada (federal) and Australia work. New Zealand returns the two same-name companies for selection |
| Ireland (CRO), Singapore (Bizfile) | **Refused up front.** Ireland is behind a Cloudflare challenge and Singapore shows an anti-bot check ("Suspicious attempt detected"); Verity does not bypass either |
| India company records (Sandbox) | Third-party API, **off by default** (opt-in `VERITY_ENABLE_THIRD_PARTY_VENDORS=1`): Verity is TinyFish-only unless enabled |

**Found while testing, now fixed:** an agent that hit a maintenance page or bot check could report "search ran, no results", which Verity turned into "not found". Searches now ask the agent to report any site message, and a result is never called empty when the agent's own text describes a maintenance page, outage or bot check.

`livePassed` is `true` only for Companies House and the Medical Board of California (by licence number).

| Id | Registry | Record type | Jurisdiction | Approved domains | Expected fields | Known limitations |
|---|---|---|---|---|---|---|
| `us-ca-medical-board` | Medical Board of California (via DCA License Search) | `medical_license` (person) | US-CA | mbc.ca.gov, search.dca.ca.gov, dca.ca.gov | name, number, status, issue/expiry date, disciplinary | DCA-wide tool, agent must restrict to the Medical Board; disciplinary detail may be linked documents |
| `gb-gmc-register` | GMC Medical Register | `medical_license` (person) | GB | gmc-uk.org | name, GMC number, registration status, licence to practise | Fitness-to-practise outcomes may be on separate pages; the search entry URL is unverified |
| `gb-companies-house` | Companies House | `company_registration` (business) | GB | company-information.service.gov.uk, companieshouse.gov.uk | name, number, status, incorporation date | No expiry/disciplinary concept (returned as `null`) |
| `in-nmc-medical-register` | NMC Indian Medical Register | `medical_license` (person) | IN | nmc.org.in | name, registration number, council, year of registration | No licence status/expiry shown; CAPTCHA risk |
| `us-ca-cslb` | CSLB License Check | `contractor_license` (business) | US-CA | cslb.ca.gov | name, number, status, issue/expiry, classifications | Session-based detail URLs may prevent monitoring |

Selection of the second US licensing authority (CSLB) was made on documentation grounds only; it should be replaced if the live test shows the detail pages are not usable.

## Unsupported requests

Unsupported jurisdictions or record types return `422 unsupported_jurisdiction` / `unsupported_record_type` (UI: only supported combinations are selectable). Verity never searches arbitrary websites and presents the result as official.

## Smoke testing a registry

```bash
npm run smoke -- --list
npm run smoke -- gb-companies-house                       # defaults to a public company
npm run smoke -- us-ca-cslb "<business>" "<licence no.>"  # use a subject you are entitled to look up
```

The script: (1) fetches the registry entry through TinyFish Fetch and records reachability; (2) runs the real workflow; (3) validates the result schema; (4) checks the source URL is on the approved domain; (5) lists missing fields. Exit 0 = ran end to end, 1 = failed validation, 2 = not tested (unreachable/invalid key/no credits).

## India company records (`in-company-vendor`)

The official MCA lookup is CAPTCHA-gated and the data.gov.in dataset is a snapshot up to 2023-11-03, so neither is used. Verity instead supports the licensed Sandbox MCA API (`SANDBOX_API_KEY`/`SANDBOX_API_SECRET`). Implemented from developer.sandbox.co.in and tested **only against a simulated Sandbox**; it has never run against a real account. Results are labelled as a licensed third party, evidence is not independently confirmed, confidence is capped at medium, and monitoring is unavailable (no direct record URL). Without the keys, India company requests return `422 registry_not_configured`.

**Live result (2026-11-03, production Sandbox API):** name search "Infosys Limited" returned 10 candidates (selection required); the selected record returned CIN L85110KA1981PLC013115, status Active, registered 1981-07-02, provider data refreshed 2026-10-13 → `partially_verified`/medium as designed. Live findings: multi-word searches take 10–26 s (client timeout 60 s, one retry on Sandbox's intermittent 5xx "Endpoint request timed out"); the search call must not force cache bypass; test keys only work on `https://test-api.sandbox.co.in`, live keys only on the default production URL (leave `SANDBOX_API_URL` unset).
