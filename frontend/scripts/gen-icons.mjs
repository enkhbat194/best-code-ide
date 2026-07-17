import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const svg = readFileSync(path.join(dir, 'icon.svg'));
const publicDir = path.join(dir, '..', 'public');

const targets = [
  { file: 'pwa-192.png', size: 192 },
  { file: 'pwa-512.png', size: 512 },
  { file: 'apple-touch-icon.png', size: 180 },
];

for (const { file, size } of targets) {
  await sharp(svg).resize(size, size).png().toFile(path.join(publicDir, file));
  console.log('wrote', file);
}

// Maskable icon: same art but shrunk into the center 80% safe zone on a solid background.
const maskableSize = 512;
const safeContent = Math.round(maskableSize * 0.7);
const inner = await sharp(svg).resize(safeContent, safeContent).png().toBuffer();
await sharp({
  create: {
    width: maskableSize,
    height: maskableSize,
    channels: 4,
    background: { r: 67, g: 56, b: 202, alpha: 1 },
  },
})
  .composite([{ input: inner, gravity: 'center' }])
  .png()
  .toFile(path.join(publicDir, 'pwa-maskable-512.png'));
console.log('wrote pwa-maskable-512.png');
