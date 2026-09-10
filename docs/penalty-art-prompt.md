# Penalty desktop illustration

Prepared on 2026-09-10 using Codex's built-in `image_gen` edit tool. The edit target was the user's supplied goalkeeper art, cropped into `apps/web/public/art/lobby/penalty-action-384.webp`. The generated version provides additional visual detail for larger desktop cards. It is an AI-assisted recreation/restoration, not a lossless upscale; small face, texture and lighting details differ from the supplied source.

Final prompt:

> Use case: precise-object-edit. Asset type: higher-resolution responsive desktop version of the attached penalty-football game lobby illustration. Edit target: the supplied low-resolution illustration. Make a faithful high-resolution restoration/detail enhancement of this exact image, landscape aspect ratio approximately 1.68:1, at least 1152 pixels wide. Preserve the exact composition, camera, crop, perspective, central fictional male goalkeeper's appearance and face, his short dark hair, yellow goalkeeper kit, exact diving body pose from lower-left toward upper-right, outstretched white glove in upper-right, smaller glove at left, and legs and boots cropped at lower-left. Preserve the large brown-and-white football at lower-right with warm orange fiery motion streaks trailing diagonally left. Preserve the diagonal white goal frame, blue hexagonal net, dark blue stadium, stadium floodlights at both top corners, cyan highlights and orange accents. Only restore clean fine details in skin, yellow fabric, white gloves, ball panels and the net at higher resolution; maintain the premium realistic painterly sports-game illustration style of the source. Do not redesign any object or move, add or remove subjects. No new logos, no text, no card frame, no interface, no footer, no border, no padding or blank area. Full-bleed image filling the complete canvas.

The generated 1624 × 968 source was inspected and downscaled with Sharp; the large PNG is excluded from the repository. Responsive assets live in `apps/web/public/art/lobby/`.

| Width × height | AVIF bytes | WebP bytes |
| --- | ---: | ---: |
| 768 × 457 | 34,492 | 68,504 |
| 1152 × 686 | 58,789 | 120,318 |

File names: `penalty-desktop-{width}.{avif,webp}`. AVIF quality 48 / effort 6; WebP quality 76 / effort 5. These are optional desktop sources; the supplied mobile art remains available unchanged.
