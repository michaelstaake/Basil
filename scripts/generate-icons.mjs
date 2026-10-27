import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const svgPath = path.join(root, 'build', 'icon.svg');
const pngPath = path.join(root, 'build', 'icon.png');
const icoPath = path.join(root, 'build', 'icon.ico');

const svg = await fs.readFile(svgPath);

await sharp(svg).resize(512, 512).png().toFile(pngPath);

const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const buffers = await Promise.all(
  icoSizes.map((size) => sharp(svg).resize(size, size).png().toBuffer()),
);

const ico = await pngToIco(buffers);
await fs.writeFile(icoPath, ico);

// hicolor sizes for the Linux .deb. electron-builder installs each
// NxN.png under /usr/share/icons/hicolor. The Windows .ico above is unchanged.
const iconDir = path.join(root, 'build', 'icons');
await fs.mkdir(iconDir, { recursive: true });
const linuxSizes = [16, 22, 24, 32, 48, 64, 128, 256, 512];
await Promise.all(
  linuxSizes.map(async (size) => {
    const dest = path.join(iconDir, `${size}x${size}.png`);
    if (size === 512) {
      await fs.copyFile(pngPath, dest);
      return;
    }
    await sharp(svg).resize(size, size).png().toFile(dest);
  }),
);

console.log('Wrote build/icon.png, build/icon.ico, and build/icons/*.png');
