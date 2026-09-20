// Disk cache for the browser checks, so running them doesn't cost bandwidth.
//
// Localhost pulls photos and GPX from the Supabase CDN exactly like
// production does, and every scan/card/range run loads a real hike page:
// roughly 25 MB of photos plus a 3 MB GPX, each time. A day of flyover work
// is a few hundred of those, which is what used up the 5 GB monthly
// allowance and got the project restricted on 2026-09-19. The same files
// come back byte for byte every run, so they only need fetching once.
//
// Only successful responses are stored — caching a 402 or a 500 would keep
// serving it back long after the real problem was fixed. Delete .cache/http
// to force a refetch.
//
// The key includes the page's origin, not just the URL. Supabase echoes the
// requesting origin back in access-control-allow-origin, so a response
// cached while pointed at localhost, replayed against the production site,
// fails CORS — which reads as the live site being broken when it is not.

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '.cache', 'http');

// Supabase is the metered one. The terrain and imagery tiles are free but
// slow, and caching them takes a cold run from minutes to seconds.
const DEFAULT_HOSTS = [
  'supabase.co',
  's3.amazonaws.com/elevation-tiles-prod',
  'server.arcgisonline.com',
  'basemap.nationalmap.gov',
];

export async function useDiskCache(context, { hosts = DEFAULT_HOSTS, verbose = false } = {}) {
  await fs.mkdir(DIR, { recursive: true });
  let hits = 0;
  let misses = 0;

  await context.route('**/*', async (route) => {
    const url = route.request().url();
    if (route.request().method() !== 'GET' || !hosts.some((h) => url.includes(h))) {
      return route.continue();
    }
    // Keyed by origin + url: see the note at the top about CORS headers.
    const origin = new URL(route.request().frame().url()).origin;
    const key = createHash('sha256').update(`${origin}\n${url}`).digest('hex').slice(0, 32);
    const metaFile = path.join(DIR, `${key}.json`);
    const bodyFile = path.join(DIR, `${key}.bin`);

    try {
      const meta = JSON.parse(await fs.readFile(metaFile, 'utf8'));
      const body = await fs.readFile(bodyFile);
      hits++;
      return route.fulfill({ status: meta.status, headers: meta.headers, body });
    } catch {
      // Not cached yet.
    }

    let response;
    try {
      response = await route.fetch();
    } catch (e) {
      return route.abort();
    }
    const body = Buffer.from(await response.body());
    misses++;
    if (response.status() === 200) {
      await fs.writeFile(bodyFile, body);
      await fs.writeFile(metaFile, JSON.stringify({ status: response.status(), headers: response.headers() }));
    } else if (verbose) {
      console.log(`  not cached (${response.status()}): ${url.slice(0, 100)}`);
    }
    return route.fulfill({ status: response.status(), headers: response.headers(), body });
  });

  return {
    report: () => `cache: ${hits} hits, ${misses} fetched`,
  };
}
