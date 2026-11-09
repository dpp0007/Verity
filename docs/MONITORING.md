# Seeing TinyFish Monitor work

Official registries rarely change on demand, so a short run can honestly show "unchanged" every time. To see change detection itself,
point a monitor at a page that updates continuously. `npm run monitor-demo` creates a real TinyFish page monitor, triggers runs, prints
whether TinyFish saw a change, and deletes the monitor afterwards.

| Page | Why | Result seen |
|---|---|---|
| USGS live earthquake feed `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.atom` | A US government feed that updates every minute | 2026-11-09: 3 of 3 runs `CHANGED` |
| The Gazette, latest notices `https://www.thegazette.co.uk/all-notices/notice?service=all-notices&sort-by=latest-date` | The UK's official public record. Companies, insolvency and strike-off notices land here in batches during every business day, ahead of status changes at Companies House | 2026-11-09: 4 runs, all `unchanged` in a 6-minute window (batches are not continuous) |

```bash
npm run monitor-demo -- 3 60 https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.atom
npm run monitor-demo                 # Gazette, 3 runs two minutes apart
```

## Real status changes to watch

The statuses that move soonest are companies in the Gazette's insolvency and strike-off notices. Verify one at Companies House,
add it to the watchlist, and the scheduled re-check (default every 24 h) or "Check now" records the change with its evidence when the
official status moves (for example Active → Liquidation → Dissolved).

## Why a scheduled re-check exists

A page monitor sees page text. California licence profiles load their status by script, so the text never changes when the status
does. The maintenance cron (`/api/cron/maintenance`) re-verifies every active monitor each `VERITY_RECHECK_HOURS` (default 24) through the same path, so alerts still come only
from field-level differences in a verified result.
