// scripts/build.mjs
//
// Bundles the browser client entry with esbuild, and (P1) assembles the legacy game
// artifact dist/eldermyr.html from src/game/ (shell + ordered parts). During P1 the
// assembled artifact is the unit under test: the golden master and battery run against
// it via ELDERMYR_GAME_FILE=dist/eldermyr.html.
// tsc (npm run typecheck) is the type gate — esbuild here only bundles/emits.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GAME_DIR = path.join(ROOT, 'src', 'game');
const manifestPath = path.join(GAME_DIR, 'manifest.json');
if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const out =
    fs.readFileSync(path.join(GAME_DIR, 'shell-head.html'), 'utf8') +
    manifest.map((f) => fs.readFileSync(path.join(GAME_DIR, 'parts', f), 'utf8')).join('') +
    fs.readFileSync(path.join(GAME_DIR, 'shell-tail.html'), 'utf8');
  fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'dist', 'eldermyr.html'), out);
  console.log(`build: wrote dist/eldermyr.html (${manifest.length} parts, ${out.length} bytes)`);
}

await build({
  entryPoints: ['src/boot/client.ts'],
  outfile: 'dist/client.js',
  bundle: true,
  minify: true,
  sourcemap: true,
  format: 'iife',
  target: 'es2022',
  platform: 'browser',
  logLevel: 'info',
});

console.log('build: wrote dist/client.js');
