import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
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

function collectGreetingFiles(dir, results = []) {
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    if (entry === '@colyseus' && existsSync(join(full, 'greeting-banner', 'build', 'index.mjs'))) {
      results.push(join(full, 'greeting-banner', 'build', 'index.mjs'));
    }

    if (entry === 'node_modules' || entry === '.pnpm' || entry.startsWith('@colyseus+')) {
      collectGreetingFiles(full, results);
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
