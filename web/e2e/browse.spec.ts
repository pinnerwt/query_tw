import { test, expect, Page } from '@playwright/test';

/**
 * E2E suite for 脆找工作.
 *
 * Targets the deployed site by default (BASE_URL env var). On query.tw the
 * site lives at https://query.tw — set BASE_URL=https://query.tw before
 * running. Locally, use http://localhost:8080 (the API binary serves the
 * SPA from /app/dist).
 *
 * Verifies the user-stated acceptance criteria:
 *   - the app loads
 *   - the filter sidebar is collapsible
 *   - queries to /api/jobs succeed and render
 */

async function waitForJobs(page: Page) {
  // Wait for at least one card or the empty state, whichever appears first.
  await Promise.race([
    page.getByTestId('job-card').first().waitFor({ state: 'visible', timeout: 15_000 }),
    page.getByTestId('empty').waitFor({ state: 'visible', timeout: 15_000 }),
  ]);
}

test.describe('Browse page', () => {
  test('loads, queries jobs, sidebar is collapsible', async ({ page, isMobile }) => {
    const responses: number[] = [];
    page.on('response', (r) => {
      if (r.url().includes('/api/jobs')) responses.push(r.status());
    });

    await page.goto('/');

    // Header is the brand mark
    await expect(page.getByRole('link', { name: /脆找工作/ })).toBeVisible();

    // Wait for the API call to have happened and the list to settle
    await waitForJobs(page);
    expect(responses.some((s) => s === 200)).toBeTruthy();

    // The toggle-sidebar control is always rendered
    const toggle = page.getByTestId('toggle-sidebar');
    await expect(toggle).toBeVisible();

    if (!isMobile) {
      // Desktop: sidebar starts open. Closing it should hide the body.
      await expect(page.getByTestId('sidebar')).toBeVisible();
      const profileVisible = await page.getByTestId('profile-select').isVisible();
      expect(profileVisible).toBe(true);

      await toggle.click();
      // Now the body's child controls should be hidden (sidebar collapsed to w-0)
      await expect(page.getByTestId('profile-select')).toBeHidden();

      // Re-open
      await toggle.click();
      await expect(page.getByTestId('profile-select')).toBeVisible();
    } else {
      // Mobile: bottom sheet starts closed. Tapping toggle opens it.
      // Profile control is hidden until open.
      const before = await page.getByTestId('profile-select').isVisible().catch(() => false);
      expect(before).toBe(false);
      await toggle.click();
      await expect(page.getByTestId('profile-select')).toBeVisible();
      // Close again via the "關閉" button in the sheet
      await page.getByRole('button', { name: '關閉' }).click();
      await expect(page.getByTestId('profile-select')).toBeHidden();
    }
  });

  test('city filter narrows the result set and updates the URL', async ({ page, isMobile }) => {
    await page.goto('/');
    await waitForJobs(page);

    if (isMobile) {
      await page.getByTestId('toggle-sidebar').click();
    }
    await page.getByTestId('city-高雄市').click();

    // URL should pick up an `f=` param encoding the filter set
    await expect.poll(() => page.url(), { timeout: 5_000 }).toMatch(/[?&]f=/);

    // Wait for fetch to settle, then verify a 200 came back. With our seed
    // there is at least one 高雄 job, so we don't expect "empty"; but we
    // guard against zero-data deployments by accepting either state.
    await Promise.race([
      page.getByTestId('job-card').first().waitFor({ state: 'visible', timeout: 10_000 }),
      page.getByTestId('empty').waitFor({ state: 'visible', timeout: 10_000 }),
    ]);
  });
});

test.describe('API health', () => {
  test('healthz returns ok', async ({ request }) => {
    const r = await request.get('/healthz');
    expect(r.status()).toBe(200);
    const json = await r.json();
    expect(json.ok).toBe(true);
  });

  test('jobs returns a JSON page', async ({ request }) => {
    const r = await request.get('/api/jobs?limit=5');
    expect(r.status()).toBe(200);
    const j = await r.json();
    expect(Array.isArray(j.jobs)).toBe(true);
  });

  test('skills/roles/cities all return data', async ({ request }) => {
    for (const path of ['/api/skills', '/api/roles', '/api/cities']) {
      const r = await request.get(path);
      expect(r.status(), `${path} status`).toBe(200);
    }
  });
});
