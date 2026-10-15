// Informational live check of the DeArrow hash-prefix branding API.
//
// It drives the same module the userscript ships (features/dearrowBranding.js)
// against the real service, and checks three things:
// 1. the bucket prefix equals the first four hex characters of SHA-256(videoID),
//    computed here with Node's crypto as an independent reference;
// 2. no request URL contains a full video ID (the privacy property);
// 3. every response status is recorded, so a 200, 404 or failure is visible.
//
// It is a probe, not a gate. It exits non-zero on a violated property and on
// network failure, and CI reports that result as a warning. It never asserts
// particular titles, because those change as DeArrow submissions change.
import { createHash } from 'node:crypto';
import { createBrandingService, brandingPrefix } from '../TizenTube/mods/features/dearrowBranding.js';

const ids = process.argv.length > 2
  ? process.argv.slice(2)
  : ['dQw4w9WgXcQ', 'jNQXAC9IVRw', 'M7lc1UVf-VE'];

for (const id of ids) {
  const expected = createHash('sha256').update(id).digest('hex').slice(0, 4);
  if (brandingPrefix(id) !== expected) {
    console.error(`prefix mismatch for ${id}: module=${brandingPrefix(id)} reference=${expected}`);
    process.exit(2);
  }
}

const urls = [];
const statuses = [];
const service = createBrandingService({
  fetchImpl: async (url, init) => {
    urls.push(String(url));
    const response = await fetch(url, init);
    statuses.push(response.status);
    return response;
  },
  timeoutMs: 10000,
});

const results = await service.lookup(ids);

const leaked = urls.filter(url => ids.some(id => url.includes(id)));
if (leaked.length) {
  console.error(`full video ID present in request URL(s): ${leaked.join(' ')}`);
  process.exit(3);
}

console.log(`requests=${urls.length} statuses=${statuses.join(',') || 'none'}`);
console.log(`urls=${urls.join(' ')}`);
for (const id of ids) {
  const entry = results.get(id);
  const summary = entry
    ? `titles=${entry.titles.length} thumbnails=${entry.thumbnails.length}`
    : 'no branding entry';
  console.log(`${id} prefix=${brandingPrefix(id)} ${summary}`);
}
if (statuses.length === 0 || statuses.some(status => status !== 200 && status !== 404)) {
  console.error('the branding service did not answer every bucket with 200 or 404');
  process.exit(4);
}
