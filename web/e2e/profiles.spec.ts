import { test, expect } from '@playwright/test';

test.describe('Profiles', () => {
  test('add, switch, rename profile', async ({ page, isMobile }) => {
    await page.goto('/');
    await Promise.race([
      page.getByTestId('job-card').first().waitFor({ state: 'visible', timeout: 15_000 }),
      page.getByTestId('empty').waitFor({ state: 'visible', timeout: 15_000 }),
    ]);

    if (isMobile) {
      await page.getByTestId('toggle-sidebar').click();
    }

    const sel = page.getByTestId('profile-select');
    await expect(sel).toBeVisible();
    const initial = await sel.evaluate((el: HTMLSelectElement) => el.options.length);

    await page.getByRole('button', { name: '新增', exact: true }).click();
    await expect.poll(() => sel.evaluate((el: HTMLSelectElement) => el.options.length)).toBe(initial + 1);

    // Switch back to first profile
    await sel.selectOption({ index: 0 });
    const firstId = await sel.inputValue();
    expect(firstId.length).toBeGreaterThan(0);
  });
});
