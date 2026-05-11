import { test, expect } from '@playwright/test';

test.describe('Announcements', () => {
  test('critical announcement appears above job cards', async ({ page }) => {
    await page.route('**/api/announcements', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [
            {
              id: 999,
              severity: 'critical',
              body: '**詐騙警告**：請小心',
              created_at: new Date().toISOString(),
            },
          ],
        }),
      }),
    );
    await page.goto('/');
    const announcement = page.getByTestId('announcement-card');
    await expect(announcement).toBeVisible();
    await expect(announcement).toContainText('詐騙警告');
  });

  test('dismissed announcement does not reappear after reload', async ({ page }) => {
    await page.route('**/api/announcements', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [
            {
              id: 998,
              severity: 'info',
              body: 'hello',
              created_at: new Date().toISOString(),
            },
          ],
        }),
      }),
    );
    await page.goto('/');
    await page.getByTestId('dismiss-announcement').click();
    await expect(page.getByTestId('announcement-card')).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('announcement-card')).toHaveCount(0);
  });
});
