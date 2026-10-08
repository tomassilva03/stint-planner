// Renders the installer's sidebar and header bitmaps from installer/images.html.
// Run from desktop/ after changing the HTML: node scripts/installer-images.mjs
// Needs Chromium (CHROMIUM_PATH) and the repo's playwright-core; writes 24-bit BMPs,
// the only kind the Windows installer accepts.
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('../../node_modules/playwright-core');
const dir = fileURLToPath(new URL('../installer/', import.meta.url));

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const page = await browser.newPage({ deviceScaleFactor: 1 });
await page.goto(`file://${dir}images.html`);
for (const name of ['sidebar', 'header']) {
  const box = await page.locator(`#${name}`).boundingBox();
  const png = await page.screenshot({ clip: box, type: 'png' });
  const rgb = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return { w: img.width, h: img.height, data: [...ctx.getImageData(0, 0, img.width, img.height).data] };
  }, png.toString('base64'));
  writeFileSync(`${dir}${name}.bmp`, bmp(rgb.w, rgb.h, rgb.data));
  console.log(`installer/${name}.bmp ${rgb.w}x${rgb.h}`);
}
await browser.close();

/** A bottom-up 24-bit BMP from RGBA pixels */
function bmp(w, h, rgba) {
  const row = Math.ceil((w * 3) / 4) * 4;
  const buf = Buffer.alloc(54 + row * h);
  buf.write('BM', 0);
  buf.writeUInt32LE(buf.length, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(w, 18);
  buf.writeInt32LE(h, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(row * h, 34);
  buf.writeInt32LE(2835, 38);
  buf.writeInt32LE(2835, 42);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const o = 54 + (h - 1 - y) * row + x * 3;
      buf[o] = rgba[i + 2];
      buf[o + 1] = rgba[i + 1];
      buf[o + 2] = rgba[i];
    }
  }
  return buf;
}
