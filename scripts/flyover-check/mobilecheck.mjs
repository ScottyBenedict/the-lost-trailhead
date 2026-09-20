// Usage: node mobilecheck.mjs [baseUrl]   -> out/mobile-<page>.png + a layout report
// Checks the phone layout: horizontal overflow, the range map and gallery
// sizing, whether images actually decoded, and console errors.
// Caveat: Chrome with a phone viewport, not real iOS Safari — this catches
// layout and loading problems, not WebKit-specific rendering.
import { chromium } from 'playwright-core';
import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { useDiskCache } from './httpcache.mjs';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');
const BASE = process.argv[2] ?? 'https://the-lost-trailhead.vercel.app';
const PAGES = [['about', '/about'], ['hike', '/hikes/blanca-lake'], ['home', '/']];

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--use-angle=metal'] });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },      // iPhone 14/15
  deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
});
await useDiskCache(ctx);

for (const [name, route] of PAGES) {
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 120)); });
  page.on('pageerror', e => errs.push(String(e).slice(0, 120)));
  await page.goto(BASE + route, { waitUntil: 'networkidle' });
  await page.waitForTimeout(name === 'about' ? 18000 : 8000);

  const r = await page.evaluate(() => {
    const de = document.documentElement;
    const overflow = de.scrollWidth - de.clientWidth;
    const wide = [...document.querySelectorAll('*')]
      .filter(el => el.getBoundingClientRect().right > de.clientWidth + 1)
      .slice(0, 5)
      .map(el => `${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]} (${Math.round(el.getBoundingClientRect().right)}px)`);
    const imgs = [...document.images];
    return {
      viewport: de.clientWidth,
      overflow,
      wide,
      images: imgs.length,
      broken: imgs.filter(i => i.complete && i.naturalWidth === 0).map(i => i.currentSrc.slice(-45)),
      map: (() => { const m = document.querySelector('.range-map'); if (!m) return null;
        const b = m.getBoundingClientRect(); const c = m.querySelector('canvas');
        return { w: Math.round(b.width), h: Math.round(b.height), canvas: c ? `${c.width}x${c.height}` : 'none' }; })(),
      gallery: (() => { const g = document.querySelector('.hike-gallery'); if (!g) return null;
        return { cols: getComputedStyle(g).gridTemplateColumns.split(' ').length,
                 items: g.querySelectorAll('.gallery-item').length }; })(),
      card: (() => { const c = document.querySelector('.map-card'); if (!c) return null;
        const b = c.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height) }; })(),
    };
  });

  console.log(`\n${name}  ${route}`);
  console.log(`  viewport ${r.viewport}px, horizontal overflow: ${r.overflow}px ${r.overflow > 1 ? '<-- OVERFLOWS' : 'ok'}`);
  if (r.wide.length) console.log(`  too wide: ${r.wide.join(', ')}`);
  console.log(`  images ${r.images}, broken ${r.broken.length}${r.broken.length ? ': ' + r.broken.join(', ') : ''}`);
  if (r.map) console.log(`  range map ${r.map.w}x${r.map.h}, canvas ${r.map.canvas}`);
  if (r.gallery) console.log(`  gallery ${r.gallery.cols} column(s), ${r.gallery.items} items`);
  if (r.card) console.log(`  map card ${r.card.w}x${r.card.h}`);
  console.log(`  console errors: ${errs.length ? errs.slice(0, 3).join(' | ') : 'none'}`);

  await page.screenshot({ path: `${OUT}/mobile-${name}.png`, fullPage: false });
  await page.close();
}
await browser.close();
