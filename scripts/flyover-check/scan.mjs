// Usage: node scan.mjs <hike_id>   (BASE env, default http://localhost:5173)
// Plays the lightbox flyover and saves the map area every 250ms for 6s, then
// every 1s until it ends, to out/scan-<hike>-<ms>.png. Then run
// `python3 hikerscan.py <hike_id>`; you only need to LOOK at frames if it flags
// something (reading images is the expensive part).
import { chromium } from 'playwright-core';
import { useDiskCache } from './httpcache.mjs';
import path from 'node:path'; import { fileURLToPath } from 'node:url';
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');
const hike = process.argv[2]; const BASE = process.env.BASE ?? 'http://localhost:5173';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const cache = await useDiskCache(page.context());
await page.goto(`${BASE}/hikes/${hike}`, { waitUntil: 'networkidle' });
await page.locator('.map-card').first().click();
await page.locator('[aria-label="Flyover progress"]').waitFor({ timeout: 30000 });
if (await page.locator('[aria-label="Pause flyover"]').count()) await page.locator('[aria-label="Pause flyover"]').click();
await page.waitForTimeout(5000);
await page.locator('[aria-label="Play flyover"]').click();
const t0 = Date.now(); const times = [];
for (let t = 0; t <= 6000; t += 250) times.push(t);
for (let t = 7000; t <= 80000; t += 1000) times.push(t);
for (const t of times) {
  await page.waitForTimeout(Math.max(0, t - (Date.now() - t0)));
  if (t > 6000 && (await page.locator('[aria-label="Pause flyover"]').count()) === 0) break;
  await page.screenshot({ path: `${OUT}/scan-${hike}-${String(t).padStart(5, '0')}.png`, clip: { x: 370, y: 125, width: 700, height: 600 } });
}
console.log(cache.report());
await browser.close();
