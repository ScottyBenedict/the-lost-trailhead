// Usage: node card.mjs <hike_id> ...  -> out/card-<hike>.png (the hike page's map card, Retina)
import { chromium } from 'playwright-core';
import { useDiskCache } from './httpcache.mjs';
import path from 'node:path'; import { fileURLToPath } from 'node:url';
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out'); const BASE = process.env.BASE ?? 'http://localhost:5173';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--use-angle=metal'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
const cache = await useDiskCache(ctx);
for (const hike of process.argv.slice(2)) {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/hikes/${hike}`, { waitUntil: 'networkidle' });
  const card = page.locator('.map-card').first(); await card.scrollIntoViewIfNeeded(); await page.waitForTimeout(7000);
  await card.screenshot({ path: `${OUT}/card-${hike}.png` }); await page.close();
}
console.log(cache.report());
await browser.close();
