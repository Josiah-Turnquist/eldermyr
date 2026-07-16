// scripts/build.mjs
//
// Bundles the browser client entry with esbuild.
// P0 scaffold: src/boot/client.ts is a placeholder; real modules arrive in P1.
// tsc (npm run typecheck) is the type gate — esbuild here only bundles/emits.
import { build } from 'esbuild';

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
