// Usage: node range.mjs [name]  -> out/range-<name>.png (the About page range map, Retina)
// Also reports whether the page still scrolls with the wheel over the map.
import { chromium } from 'playwright-core';
import path from 'node:path'; import { fileURLToPath } from 'node:url';
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out'); const BASE = process.env.BASE ?? 'http://localhost:5173';
const name = process.argv[2] ?? 'range';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--use-angle=metal'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errs = []; page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); page.on('pageerror', e => errs.push(String(e)));
const bad = []; page.on('response', r => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url().slice(0, 110)}`); });
await page.goto(`${BASE}/about`, { waitUntil: 'networkidle' });
await page.addStyleTag({ content: 'nav, header, .nav { visibility: hidden !important; }' });
const card = page.locator('.range-map'); await card.scrollIntoViewIfNeeded(); await page.waitForTimeout(15000);
await card.screenshot({ path: `${OUT}/range-${name}.png` });
const box = await card.boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
const before = await page.evaluate(() => window.scrollY); await page.mouse.wheel(0, 400); await page.waitForTimeout(800);
console.log('scrollY before/after wheel over map:', before, await page.evaluate(() => window.scrollY));
console.log('errors:', JSON.stringify(errs.slice(0, 5)));
console.log('failed requests:', bad.length ? JSON.stringify([...new Set(bad)].slice(0, 6), null, 1) : 'none');
await browser.close();
