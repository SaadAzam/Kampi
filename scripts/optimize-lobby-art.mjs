/**
 * Convert the supplied Kampi PNG slices into browser-ready assets.
 *
 * Run from the repository root after installing dependencies:
 *   node scripts/optimize-lobby-art.mjs "/path/to/kampi game slicing"
 *
 * The original artwork remains outside the repository. Outputs retain alpha,
 * never upscale, and strip source metadata. Live counters remain in HTML;
 * reference-button labels are preserved in the faithful source UI variants.
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
// bevels are not clipped. Both the original full penalty card and independent
// illustration/footer variants are available for responsive source-faithful UI.
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
  {
    name: 'slice-play-button-v1',
    source: 'game box/play.png',
    widths: [157],
    quality: 100,
    lossless: true,
    formats: ['webp'],
    description:
      'Original Play button, including its label; painted bounds x6,y6,w145,h59 inside a 157x71 canvas.',
  },
  {
    name: 'slice-play-button-v2',
    source: 'game box/play.png',
    widths: [157],
    quality: 94,
    formats: ['webp'],
    description:
      'Original Play button with label at high-quality lossy compression; original 157x71 canvas and alpha preserved.',
  },
  {
    name: 'slice-reward-button-v2',
    source: 'banner/view reward button.png',
    widths: [247],
    quality: 94,
    formats: ['webp'],
    description:
      'Original VIEW REWARDS button at high-quality lossy compression; original 247x57 canvas and alpha preserved.',
  },
  {
    name: 'slice-battle-base-v1',
    source: 'bottom/battle base.png',
    widths: [231],
    quality: 92,
    formats: ['webp'],
    description: 'Original text-free hexagonal battle plinth; alpha/glow uses full 231x144 canvas.',
  },
  {
    name: 'slice-bottom-bar-v1',
    source: 'bottom/bottom bar.png',
    widths: [900],
    quality: 92,
    formats: ['webp'],
    description:
      'Original continuous cyan/red metal navigation rail; full 900x149 canvas, no icons or text.',
  },
  {
    name: 'slice-dock-left-v1',
    source: 'bottom/bottom bar.png',
    widths: [240],
    crop: { left: 0, top: 0, width: 240, height: 149 },
    quality: 92,
    formats: ['webp'],
    description:
      'Original dock left metal rail, source x0..239; tile/stretch independently from the fixed center notch.',
  },
  {
    name: 'slice-dock-center-v1',
    source: 'bottom/bottom bar.png',
    widths: [420],
    crop: { left: 240, top: 0, width: 420, height: 149 },
    quality: 92,
    formats: ['webp'],
    description:
      'Original dock center cyan/red notch, source x240..659; preserve centered width independently of outer rails.',
  },
  {
    name: 'slice-dock-right-v1',
    source: 'bottom/bottom bar.png',
    widths: [240],
    crop: { left: 660, top: 0, width: 240, height: 149 },
    quality: 92,
    formats: ['webp'],
    description:
      'Original dock right metal rail, source x660..899; tile/stretch independently from the fixed center notch.',
  },
  {
    name: 'slice-reward-panel-v1',
    source: 'banner/base.png',
    widths: [758],
    quality: 92,
    formats: ['webp'],
    description:
      'Original blue banner panel without words or crest; painted bounds x17,y9,w724,h175, shadow fills original 758x205 canvas.',
  },
  {
    name: 'slice-reward-button-v1',
    source: 'banner/view reward button.png',
    widths: [247],
    quality: 100,
    lossless: true,
    formats: ['webp'],
    description:
      'Original VIEW REWARDS button including label; painted bounds cover 247x57 canvas.',
  },
  {
    name: 'slice-balance-counter-v1',
    source: 'topp bar/balance counter.png',
    widths: [126],
    quality: 100,
    lossless: true,
    formats: ['webp'],
    description:
      'Original empty metallic balance counter; painted bounds x1,y0,w125,h57, no amount or coin.',
  },
  {
    name: 'slice-coin-balance-v1',
    source: 'topp bar/coin balance.png',
    widths: [180],
    quality: 100,
    lossless: true,
    formats: ['webp'],
    description:
      'Original combined blue K coin and empty counter; painted bounds x6,y6,w174,h65 inside 180x77 canvas.',
  },
  {
    name: 'slice-penalty-card-v1',
    source: 'game box/penalty duel.png',
    widths: [424],
    quality: 88,
    formats: ['webp'],
    description:
      'Original complete card with illustration, frame, empty footer and all shadow; painted bounds x17,y9,w391,h342 inside 424x372 canvas.',
  },
  {
    name: 'slice-penalty-card-tight-v1',
    source: 'game box/penalty duel.png',
    widths: [391],
    crop: { left: 17, top: 9, width: 391, height: 338 },
    quality: 88,
    formats: ['webp'],
    description:
      'Original full card cropped to its frame at source x17,y9,w391,h338; diffuse outer shadow intentionally excluded. No baked labels.',
  },
  {
    name: 'slice-card-shell-v1',
    source: 'game box/penalty duel.png',
    widths: [391],
    crop: { left: 17, top: 9, width: 391, height: 338 },
    quality: 85,
    formats: ['webp'],
    clearIllustration: true,
    description:
      'Original trimmed card border and blank footer, with a transparent top-rounded illustration aperture x3,y3,w385,h229. Original divider and lower frame retained; no text.',
  },
  {
    name: 'slice-card-footer-v1',
    source: 'game box/penalty duel.png',
    widths: [391],
    crop: { left: 17, top: 241, width: 391, height: 106 },
    quality: 92,
    formats: ['webp'],
    description:
      'Original reusable green-glow empty card footer and rounded lower frame at source x17,y241,w391,h106; no text.',
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
      if (asset.clearIllustration) {
        // A transparent aperture allows any game illustration below the original
        // border/footer. Only the card interior is cleared; art is never invented.
        operation = operation.composite([
          {
            input: Buffer.from(
              '<svg width="391" height="338" xmlns="http://www.w3.org/2000/svg"><path d="M26 3 H365 Q388 3 388 26 V232 H3 V26 Q3 3 26 3 Z" fill="white"/></svg>',
            ),
            blend: 'dest-out',
          },
        ]);
      }
      return operation.resize({ width, withoutEnlargement: true });
    };
    const variants = {};
    let dimensions;
    for (const format of asset.formats ?? ['webp', 'avif']) {
      const filename = `${asset.name}-${width}.${format}`;
      const output = path.join(outputDirectory, filename);
      const encoded =
        format === 'webp'
          ? pipeline().webp({
              quality: asset.quality,
              lossless: asset.lossless ?? false,
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
    avif: variants.avif?.bytes,
  })),
);
