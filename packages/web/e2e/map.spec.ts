import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const shot = fileURLToPath(new URL('../../../docs/media/map.png', import.meta.url));
const mqtt = process.env.E2E_MQTT_URL ?? 'ws://localhost:5371';

test('live map shows vehicles and a confirmed alert', async ({ page }) => {
  await page.goto(`/?mqtt=${encodeURIComponent(mqtt)}`);
  await expect(page.getByTestId('conn-status')).toHaveText('live', { timeout: 15_000 });
  await expect(async () => {
    const n = Number(await page.getByTestId('vehicle-count').innerText());
    expect(n).toBeGreaterThan(0);
  }).toPass({ timeout: 15_000 });
  await expect(page.getByTestId('alert-row').first()).toBeVisible({ timeout: 180_000 });
  await page.screenshot({ path: shot });
});
