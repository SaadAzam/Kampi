/**
 * Convert the supplied Kampi PNG slices into browser-ready assets.
 *
 * Run from the repository root after installing dependencies:
 *   node scripts/optimize-lobby-art.mjs "/path/to/kampi game slicing"
 *
 * The original artwork remains outside the repository. Outputs retain alpha,
 * never upscale, and strip source metadata. Labels and counters belong in HTML.
 * Sharp is supplied by the web app's image pipeline; this is an optional art
 * preparation command, not a build-time dependency on the source directory.
 */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const sourceDirectory = process.argv[2];
if (!sourceDirectory) {
  console.error('Usage: node scripts/optimize-lobby-art.mjs <source-slices-directory>');
  process.exit(1);
}

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(repository, 'apps/web/public/art/lobby');

// Decorative slices retain their original canvas so their transparent glows and
// bevels are not clipped. The penalty image is the text-free illustration only;
// its separate frame and empty footer are recreated by responsive HTML/CSS.
const assets = [
  {
    name: 'penalty-action',
    source: 'game box/penalty duel.png',
    widths: [240, 384],
    crop: { left: 20, top: 13, width: 384, height: 229 },
    quality: 82,
    description: 'Goalkeeper and ball illustration; no text or card footer.',
  },
  {
    name: 'logo',
    source: 'topp bar/logo.png',
    widths: [247],
    quality: 92,
    description: 'KAMPI.fun wordmark. Text is intrinsic to the logo.',
  },
  {
    name: 'reward-badge',
    source: 'banner/badge.png',
    widths: [112, 223],
    quality: 84,
    description: 'Gold K reward crest with transparent edges.',
  },
  {
    name: 'coin',
    source: 'topp bar/coin.png',
    widths: [40, 78],
    quality: 86,
    description: 'Blue and gold K coin; no amount baked in.',
  },
  {
    name: 'nav-battle',
    source: 'bottom/without text/battle.png',
    widths: [80, 156],
    quality: 84,
    description: 'Crossed swords medallion with alpha; no label.',
  },
  {
    name: 'nav-edit',
    source: 'bottom/without text/edit.png',
    widths: [58],
    quality: 90,
    description: 'Cyan edit icon with alpha; no label.',
  },
  {
    name: 'nav-leaderboard',
    source: 'bottom/without text/leaderboard.png',
    widths: [58],
    quality: 90,
    description: 'Cyan trophy icon with alpha; no label.',
  },
  {
    name: 'nav-shop',
    source: 'bottom/without text/shop.png',
    widths: [58],
    quality: 90,
    description: 'Coral cart icon with alpha; no label.',
  },
  {
    name: 'nav-profile',
    source: 'bottom/without text/profile.png',
    widths: [58],
    quality: 90,
    description: 'Coral profile icon with alpha; no label.',
  },
  {
    name: 'player-frame-blue',
    source: 'top players name/blue wihtout circle.png',
    widths: [257],
    quality: 82,
    description: 'Empty blue player frame; no avatar or text.',
  },
  {
    name: 'player-frame-red',
    source: 'top players name/red without circle.png',
    widths: [257],
    quality: 82,
    description: 'Empty red player frame; no avatar or text.',
  },
  {
    name: 'player-frame-purple',
    source: 'top players name/purple without circle.png',
    widths: [257],
    quality: 82,
    description: 'Empty purple player frame; no avatar or text.',
  },
  {
    name: 'background',
    source: 'background.png',
    widths: [450, 900],
    quality: 65,
    description: 'Dark arena background; no text or UI.',
  },
];

await mkdir(outputDirectory, { recursive: true });
const manifest = [];
for (const asset of assets) {
  const input = await readFile(path.resolve(sourceDirectory, asset.source));
  const source = await sharp(input).metadata();
  for (const width of asset.widths) {
    const pipeline = () => {
      let operation = sharp(input);
      if (asset.crop) operation = operation.extract(asset.crop);
      return operation.resize({ width, withoutEnlargement: true });
    };
    const variants = {};
    let dimensions;
    for (const format of ['webp', 'avif']) {
      const filename = `${asset.name}-${width}.${format}`;
      const output = path.join(outputDirectory, filename);
      const encoded =
        format === 'webp'
          ? pipeline().webp({
              quality: asset.quality,
              alphaQuality: 100,
              effort: 6,
              smartSubsample: true,
            })
          : pipeline().avif({
              quality: Math.max(45, asset.quality - 20),
              effort: 6,
              chromaSubsampling: '4:4:4',
            });
      dimensions = await encoded.toFile(output);
      variants[format] = { file: `/art/lobby/${filename}`, bytes: (await stat(output)).size };
    }
    manifest.push({
      name: asset.name,
      width: dimensions.width,
      height: dimensions.height,
      alpha: source.hasAlpha,
      description: asset.description,
      variants,
    });
  }
}

await writeFile(
  path.join(outputDirectory, 'manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.table(
  manifest.map(({ name, width, height, variants }) => ({
    name,
    dimensions: `${width}×${height}`,
    webp: variants.webp.bytes,
    avif: variants.avif.bytes,
  })),
);
