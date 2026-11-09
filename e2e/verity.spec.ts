// End-to-end tests: real app + real DB + SIMULATED TinyFish provider (scripts/mock-tinyfish.ts).
import { expect, test, type Page } from '@playwright/test';

const SECRET = 'e2e-secret-123';
const control = (request: any, data: object) => request.post('http://127.0.0.1:4010/__control', { data });

async function submit(page: Page, name: string) {
  await page.goto('/');
  await page.getByRole('radio', { name: /Doctor/ }).check();
  await page.getByLabel('Full name').fill(name);
  await page.getByRole('button', { name: 'Verify record' }).click();
  await expect(page).toHaveURL(/\/results\/ver_/);
}

test.beforeEach(async ({ request }) => { await control(request, { suspended: false, pageVersion: 1 }); });

test('empty search is rejected with an inline error', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Verify record' }).click();
  await expect(page.getByText('Enter the full name')).toBeVisible();
  await expect(page).toHaveURL('/');
});

test('verify -> results -> JSON -> watchlist -> change alert -> failed monitor run', async ({ page, request }) => {
  await submit(page, 'Jane Roe');
  await expect(page.getByText('Verification in progress').or(page.getByText('Last verified'))).toBeVisible();
  await expect(page.getByText('Last verified')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('A12345').first()).toBeVisible();
  await expect(page.getByText('high confidence')).toBeVisible();
  await expect(page.locator('a[href="https://www.gmc-uk.org/doctors/A12345"]').first()).toHaveAttribute('target', '_blank');

  // copy structured JSON
  await page.getByText('Structured JSON').click();
  await page.getByRole('button', { name: 'Copy JSON' }).click();
  const clip = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
  expect(clip.record.status).toBe('active');
  expect(clip.verification.source_url).toBe('https://www.gmc-uk.org/doctors/A12345');

  // reload: data persists
  await page.reload();
  await expect(page.getByText('Last verified')).toBeVisible();

  // watchlist
  await page.getByRole('button', { name: 'Add to Watchlist' }).click();
  await expect(page.getByText('Monitoring:')).toBeVisible({ timeout: 15_000 });
  await page.goto('/watchlist');
  const row = page.getByRole('row', { name: /Jane Roe/ });
  await expect(row).toContainText('active');
  await expect(row).toContainText('Manual checks only'); // the simulated provider echoes no webhook_url, so the UI must not claim one is active
});

test('simulated monitoring change produces an alert; failed run produces an error, not an alert', async ({ page, request }) => {
  await submit(page, 'Jane Roe');
  await expect(page.getByText('Last verified')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Add to Watchlist' }).click();
  await expect(page.getByText('Monitoring:')).toBeVisible({ timeout: 15_000 });

  const monitorId = (await (await page.request.get('/api/v1/monitors')).json()).monitors[0].provider_monitor_id as string;

  // failed monitoring run
  const fail = await request.post(`/api/v1/webhooks/tinyfish?token=${SECRET}`, {
    data: { fetch_monitor_id: monitorId, id: 'wh_fail', is_baseline: false, outcome: null, results: [], errors: [{ url: 'x', error: 'target_unreachable' }] },
  });
  expect(fail.status()).toBe(200);
  await page.goto('/watchlist');
  await expect(page.getByRole('alert').filter({ hasText: 'target_unreachable' })).toBeVisible();
  await expect(page.getByText('No alerts')).toBeVisible();

  // real change: registry now shows Suspended
  await control(request, { suspended: true, pageVersion: 2 });
  const ok = await request.post(`/api/v1/webhooks/tinyfish?token=${SECRET}`, {
    data: { fetch_monitor_id: monitorId, id: 'wh_change', is_baseline: false, outcome: 'changed', diff: '-Active\n+Suspended', judgment: { is_relevant: true, summary: 's' }, results: [{ url: 'x', text: 'Status: Suspended' }], errors: [] },
  });
  expect((await ok.json()).outcome).toBe('recheck_started');
  // duplicate delivery is safe
  expect((await (await request.post(`/api/v1/webhooks/tinyfish?token=${SECRET}`, { data: { fetch_monitor_id: monitorId, id: 'wh_change', results: [], errors: [] } })).json()).duplicate).toBe(true);

  await expect(async () => {
    await page.goto('/watchlist');
    await expect(page.getByText('status changed')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });
  await expect(page.getByText('active → suspended').first()).toBeVisible();
  await page.goto('/developers');
  await expect(page.getByText('status_change.detected').first()).toBeVisible();
});

test('several matches require selection', async ({ page }) => {
  await submit(page, 'Sam Smith');
  await expect(page.getByText('2 possible matches')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Last verified')).toHaveCount(0);
  await page.getByRole('row', { name: /FRESNO/ }).getByRole('button', { name: 'Select' }).click();
  await expect(page.getByText('Last verified')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('B22222').first()).toBeVisible();
});

test('no match is explicit and does not claim unlicensed', async ({ page }) => {
  await submit(page, 'Nobody Here');
  await expect(page.getByText('No matching record found')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/does not prove/)).toBeVisible();
});

test('failed verification shows an honest error and can be retried', async ({ page }) => {
  await submit(page, 'Fail Case');
  await expect(page.getByText(/temporarily unavailable|Verification failed/).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/not evidence that the record is expired/)).toBeVisible();
  await page.getByRole('button', { name: 'Retry verification' }).click();
  await expect(page).toHaveURL(/\/results\/ver_/);
});

test('API & Activity lists persisted events', async ({ page }) => {
  await page.request.post('/api/v1/verifications', { data: { name: 'Nobody Here', subject_type: 'person', record_type: 'medical_license', country: 'US', region: 'CA' } });
  await page.goto('/developers');
  await expect(page.getByText('verification.requested').first()).toBeVisible();
  await expect(page.getByRole('link', { name: '/api/v1/openapi' })).toBeVisible();
});
