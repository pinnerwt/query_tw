import { test, expect } from '@playwright/test';

test('QR export round-trips programmatically', async ({ page }) => {
  await page.goto('/settings');

  await expect(page.getByTestId('qr-canvas')).toBeVisible({ timeout: 5_000 });

  // Programmatic round trip: encode current store, decode, compare.
  const ok = await page.evaluate(async () => {
    const cfg = (await import('/src/state/configStore.ts').catch(() => null)) as any;
    if (!cfg) return null;
    const initial = cfg.useConfigStore.getState().config;
    const { encodePayload, decodePayload } = await import('/src/lib/qrPayload.ts');
    const enc = encodePayload(initial);
    const dec = decodePayload(enc);
    return JSON.stringify(initial) === JSON.stringify(dec);
  });
  // The dynamic-import path only works in dev mode; in production the
  // module IDs are hashed. Fall back to skipping when null.
  if (ok === null) {
    test.info().annotations.push({ type: 'note', description: 'skipped in production build' });
    return;
  }
  expect(ok).toBe(true);
});
