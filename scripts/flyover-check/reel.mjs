// Usage: node reel.mjs <hike_id> [seconds]
// Records the flyover as a 1080x1920 vertical clip straight from the page —
// no screen capture, so no cursor, no browser chrome, no desktop behind it,
// and a steady frame rate. Everything but the map is hidden and the map is
// stretched to fill the frame.
import { chromium } from 'playwright-core';
import path from 'node:path'; import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import { useDiskCache } from './httpcache.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const hike = process.argv[2];
const seconds = Number(process.argv[3] ?? 50);
// --bare strips everything but the map; by default the lightbox is recorded
// as it actually appears, title, controls, stats and all.
const bare = process.argv.includes('--bare');
const BASE = process.env.BASE ?? 'http://localhost:5173';
if (!hike) { console.error('usage: node reel.mjs <hike_id> [seconds]'); process.exit(1); }

const outDir = path.join(HERE, 'out', 'reel');
await fs.mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--use-angle=metal'] });
const t0 = Date.now();
const ctx = await browser.newContext({
  // The video is captured at the viewport's own size — asking for a larger
  // recordVideo size pads rather than scales, which left the page in the
  // top-left corner of a grey 1080x1920 frame. Render at the full output
  // size instead and let CSS zoom give the phone-width layout.
  viewport: { width: 1080, height: 1920 },
  deviceScaleFactor: 1,
  recordVideo: { dir: outDir, size: { width: 1080, height: 1920 } },
});
await useDiskCache(ctx);
const page = await ctx.newPage();
await page.goto(`${BASE}/hikes/${hike}`, { waitUntil: 'networkidle' });
await page.locator('.map-card').first().scrollIntoViewIfNeeded();
await page.waitForTimeout(9000);
await page.locator('.map-card').first().click();
await page.locator('[aria-label="Flyover progress"]').waitFor({ timeout: 60000 });

if (bare) await page.addStyleTag({ content: `
  nav, header, .nav, .gallery-lightbox-close { display: none !important; }
  .gallery-lightbox { background: #000 !important; }
  .gallery-lightbox-frame, .gallery-lightbox-frame-map {
    width: 100vw !important; max-width: 100vw !important;
    max-height: 100vh !important; border-radius: 0 !important;
    gap: 0 !important; box-shadow: none !important; overflow: hidden !important;
  }
  .hike-map-viewport { height: 100vh !important; }
` });
// The label, stats and elevation chart are inline-styled, so they go by
// walking the frame rather than by class.
if (bare) await page.evaluate(() => {
  const frame = document.querySelector('.gallery-lightbox-frame-map');
  if (!frame) return;
  for (const el of frame.children) {
    if (!el.className || !String(el.className).includes('hike-map-viewport')) el.style.display = 'none';
  }
  const vp = document.querySelector('.hike-map-viewport');
  if (vp) vp.style.display = '';
});
await page.waitForTimeout(1500);
await page.evaluate(() => window.dispatchEvent(new Event('resize')));
await page.waitForTimeout(1500);

// Clicked in JS: the control bar is hidden for the recording, and Playwright
// will not click something it cannot see.
const started = await page.evaluate(() => {
  const b = document.querySelector('[aria-label="Play flyover"], [aria-label="Restart flyover"]');
  if (!b) return false;
  b.click();
  return true;
});
if (!started) console.log('  warning: no play button found — recording whatever is on screen');
const card = await page.locator('.gallery-lightbox-frame-map').boundingBox();
console.log(`  CARD=${Math.round(card.x)},${Math.round(card.y)},${Math.round(card.width)},${Math.round(card.height)}`);
const playAt = (Date.now() - t0) / 1000;
console.log(`  playback starts ${playAt.toFixed(1)}s into the recording`);
console.log(`  recording ${seconds}s of ${hike}...`);
await page.waitForTimeout(seconds * 1000);

const video = page.video();
await ctx.close();
const raw = await video.path();
const webm = path.join(outDir, `${hike}.webm`);
await fs.rename(raw, webm);
await browser.close();
console.log(`  raw -> ${webm}`);
console.log(`  TRIM_FROM=${playAt.toFixed(2)}`);
