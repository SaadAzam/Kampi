import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Colyseus 0.16 expects a default export string; greeting-banner 4.x only exports greet(). */
const PATCH = `const banner = String.raw\`
   ___      _
  / __\\___ | |_   _ ___  ___ _   _ ___
 / /  / _ \\| | | | / __|/ _ \\ | | / __|
/ /__| (_) | | |_| \\__ \\  __/ |_| \\__ \\
\\____/\\___/|_|\\__, |___/\\___|\\__,_|___/
              |___/

Multiplayer Framework for Node.js · Open-source
\`;

export default banner;
export function greet() {
  console.log(banner);
}
`;

function collectGreetingFiles(dir) {
  const results = [];
  const add = (root) => {
    const file = join(root, '@colyseus', 'greeting-banner', 'build', 'index.mjs');
    if (existsSync(file)) results.push(file);
  };
  add(dir); // hoisted linker
  const store = join(dir, '.pnpm');
  if (existsSync(store)) {
    for (const entry of readdirSync(store)) {
      if (entry.startsWith('@colyseus+greeting-banner@')) add(join(store, entry, 'node_modules'));
    }
  }
  return results;
}

const files = collectGreetingFiles(join(process.cwd(), 'node_modules'));
let patched = 0;

for (const file of files) {
  const current = readFileSync(file, 'utf8');
  if (current.includes('export default banner')) continue;
  writeFileSync(file, PATCH);
  patched += 1;
}

if (patched > 0) {
  console.info(`[postinstall] patched @colyseus/greeting-banner in ${patched} location(s)`);
}
