/**
 * One-shot: upload the 19 Rose product photos (repo-root Images/) to the Bunny CDN under wreaths/2026/.
 *
 *   npx tsx --env-file=.env.local scripts/upload-wreath-images.ts
 *
 * Writes to the SHARED CDN zone, so it only ever PUTs under the wreaths/2026/ prefix and never deletes.
 * Re-running overwrites the same paths with the same bytes (idempotent). Prints catalog number -> CDN URL;
 * those URLs are the ones seeded into wreath_items.image_url by the wreath_sale migration.
 * The photo-to-catalog-number map is the prototype's (prototypes/wreath-sale/assets/data.js PHOTOS).
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { bunnyConfig, BUNNY_NOT_CONFIGURED } from '../src/lib/bunny-storage';

export const WREATH_PHOTOS: Record<number, string> = {
  1: 'wreath-20.jpg',
  2: 'wreath-26.jpg',
  3: 'wreath-36.jpg',
  4: 'Wreath-48.jpg',
  5: 'wreath-60.jpg',
  6: 'wreath-72.jpg',
  7: 'wreath-double-face-36.jpg',
  8: 'wreath-double-face-48.jpg',
  9: 'cane-36.jpg',
  10: 'door-swag-30.jpg',
  11: 'garland-25.jpg',
  12: 'christmas-tree-18.jpg',
  13: 'christmas-tree-27.jpg',
  14: 'centerpiece.jpg',
  15: 'easel-30.jpg',
  16: 'door-hanger-15.jpg',
  20: 'cross-36.jpg',
  21: 'wreath-special-24.jpg',
  22: 'wreath-platinum-24.jpg'
};

async function main() {
  const cfg = bunnyConfig();
  if (!cfg) throw new Error(BUNNY_NOT_CONFIGURED);
  const imagesDir = path.resolve(__dirname, '../../Images');
  for (const [n, file] of Object.entries(WREATH_PHOTOS)) {
    const bytes = await readFile(path.join(imagesDir, file));
    const remote = `wreaths/2026/${file.toLowerCase()}`;
    const res = await fetch(`https://${cfg.storageHost}/${cfg.zone}/${remote}`, {
      method: 'PUT',
      headers: { AccessKey: cfg.apiKey, 'Content-Type': 'application/octet-stream' },
      body: new Uint8Array(bytes)
    });
    if (!res.ok) throw new Error(`Upload of ${file} failed (${res.status})`);
    console.log(`${n}\thttps://${cfg.pullZoneHost}/${remote}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
