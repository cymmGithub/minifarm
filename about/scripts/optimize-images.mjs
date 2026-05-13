import { readdir, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_DIR = path.resolve(__dirname, '../../dashboard/public/about');
const OUTPUT_DIR = path.resolve(__dirname, '../public/about');
const WIDTHS = [640, 1280, 1920];
const QUALITY = { webp: 60, jpg: 65 };

async function isNewer(srcPath, outPath) {
  if (!existsSync(outPath)) return true;
  const [src, out] = await Promise.all([stat(srcPath), stat(outPath)]);
  return src.mtimeMs > out.mtimeMs;
}

async function processImage(srcPath) {
  const base = path.basename(srcPath, path.extname(srcPath));
  const srcSize = (await stat(srcPath)).size;
  let totalOut = 0;

  for (const width of WIDTHS) {
    const webpOut = path.join(OUTPUT_DIR, `${base}-${width}.webp`);
    const jpgOut = path.join(OUTPUT_DIR, `${base}-${width}.jpg`);

    if (await isNewer(srcPath, webpOut)) {
      await sharp(srcPath).resize({ width, withoutEnlargement: true })
        .webp({ quality: QUALITY.webp }).toFile(webpOut);
    }
    if (await isNewer(srcPath, jpgOut)) {
      await sharp(srcPath).resize({ width, withoutEnlargement: true })
        .jpeg({ quality: QUALITY.jpg, mozjpeg: true }).toFile(jpgOut);
    }

    totalOut += (await stat(webpOut)).size + (await stat(jpgOut)).size;
  }

  const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
  console.log(`  ${base}: ${kb(srcSize)} -> ${kb(totalOut)} (${WIDTHS.length * 2} variants)`);
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const sources = (await readdir(SOURCE_DIR))
    .filter((f) => /\.(jpe?g|png)$/i.test(f));

  if (sources.length === 0) {
    console.error(`No source images found in ${SOURCE_DIR}`);
    process.exit(1);
  }

  console.log(`Optimizing ${sources.length} images from ${SOURCE_DIR}`);
  console.log(`Output: ${OUTPUT_DIR}`);
  console.log('');

  for (const src of sources) {
    await processImage(path.join(SOURCE_DIR, src));
  }

  console.log('');
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
