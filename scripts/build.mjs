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
import * as acorn from 'acorn';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GAME_DIR = path.join(ROOT, 'src', 'game');

// ---- P1d: build-generated namespace (globalThis.Eldermyr) --------------------------------
// The EXPLICIT capture contract, generated from the two lists that already define it so the
// three can never drift silently:
//   • CAPTURE — server-spike/load-game.js  (symbols the headless server grabs)
//   • NAMES   — client/mp.html             (symbols the MP client grabs into window.__G)
// plus { state, maps, g }. Every entry must exist in the concatenated program as a top-level
// binding or as a slot of the __g globals holder — an unknown name FAILS THE BUILD. That is
// the whole point: a missing capture becomes a loud build error instead of a silent runtime
// no-op (the codebase's documented lexical-capture failure class).
function readCaptureList() {
  const src = fs.readFileSync(path.join(ROOT, 'server-spike', 'load-game.js'), 'utf8');
  const ast = acorn.parse(src, { ecmaVersion: 2023, sourceType: 'script' });
  for (const s of ast.body) {
    if (s.type !== 'VariableDeclaration') continue;
    for (const d of s.declarations) {
      if (d.id.type === 'Identifier' && d.id.name === 'CAPTURE' && d.init && d.init.type === 'ArrayExpression') {
        return d.init.elements.map((e) => {
          if (!e || e.type !== 'Literal' || typeof e.value !== 'string') throw new Error('build: CAPTURE has a non-string element');
          return e.value;
        });
      }
    }
  }
  throw new Error('build: CAPTURE array not found in server-spike/load-game.js');
}
function readNamesList() {
  const src = fs.readFileSync(path.join(ROOT, 'client', 'mp.html'), 'utf8');
  const marker = 'const NAMES = ';
  const i0 = src.indexOf(marker);
  if (i0 < 0) throw new Error('build: `const NAMES = ` not found in client/mp.html');
  if (src.indexOf(marker, i0 + 1) !== -1) throw new Error('build: multiple NAMES declarations in client/mp.html');
  const arr = acorn.parseExpressionAt(src, i0 + marker.length, { ecmaVersion: 2023 });
  if (arr.type !== 'ArrayExpression') throw new Error('build: NAMES is not an array literal');
  return arr.elements.map((e) => {
    if (!e || e.type !== 'Literal' || typeof e.value !== 'string') throw new Error('build: NAMES has a non-string element');
    return e.value;
  });
}
function namespaceEpilogue(program) {
  const ast = acorn.parse(program, { ecmaVersion: 2023, sourceType: 'script' });
  const bindings = new Map(); // top-level name -> kind (function|class|const|let|var)
  let slots = null; //          __g holder slot names
  for (const s of ast.body) {
    if (s.type === 'FunctionDeclaration') bindings.set(s.id.name, 'function');
    else if (s.type === 'ClassDeclaration') bindings.set(s.id.name, 'class');
    else if (s.type === 'VariableDeclaration') {
      for (const d of s.declarations) {
        if (d.id.type !== 'Identifier') continue;
        bindings.set(d.id.name, s.kind);
        if (d.id.name === '__g' && d.init && d.init.type === 'ObjectExpression') {
          slots = new Set(d.init.properties.map((p) => p.key.name));
        }
      }
    }
  }
  if (!slots) throw new Error('build: __g holder literal not found in the parts');
  const union = [...new Set([...readCaptureList(), ...readNamesList(), 'state', 'maps'])].sort();
  const unresolved = union.filter((n) => !bindings.has(n) && !slots.has(n));
  if (unresolved.length) {
    throw new Error(
      'build: CAPTURE/NAMES symbol(s) with NO top-level binding and NO __g slot in the game program: ' +
      unresolved.join(', ') + ' — fix the list or the game; the namespace refuses to paper over a dead capture.'
    );
  }
  const props = union.map((n) => {
    if (slots.has(n) && !bindings.has(n)) {
      return `  get ${n}() { return __g.${n}; },\n  set ${n}(v) { __g.${n} = v; },`;
    }
    const kind = bindings.get(n);
    const settable = kind === 'let' || kind === 'var' || kind === 'function';
    return `  get ${n}() { return ${n}; },` + (settable ? `\n  set ${n}(v) { ${n} = v; },` : '');
  });
  return (
    '\n;/* ===== BUILD-GENERATED NAMESPACE — emitted by scripts/build.mjs, NOT a source part =====\n' +
    'The explicit MP capture contract: every symbol the server CAPTUREs (server-spike/load-game.js)\n' +
    'and the client NAMES (client/mp.html), plus { state, maps, g }. Getters read the LIVE lexical\n' +
    'binding (post-load rewraps like log/gameOver stay visible); __g-slot names read through the\n' +
    'globals holder. Loaders PREFER this namespace when present and fall back to lexical/window\n' +
    'capture on the frozen monolith (which has no namespace). */\n' +
    'globalThis.Eldermyr = {\n' +
    '  g: __g,\n' +
    props.join('\n') + '\n' +
    '};\n'
  );
}

// ---- P3/S1: content chunk ----------------------------------------------------------------
// src/content/ registries are REAL strict ES modules (typechecked by the existing
// `npm run typecheck`). They enter the classic-script game program as ONE compiled,
// non-minified IIFE prelude prepended to the parts concat, so every part sees
// globalThis.CONTENT at load time. esbuild is pinned EXACTLY in package.json — the chunk
// text is part of the artifact, so version drift = dist churn, reviewed like any diff.
// The chunk step deletes itself at the module era (imports go direct; registries stay).
async function buildContentChunk(contentDir) {
  const r = await build({
    entryPoints: [path.join(contentDir, 'index.ts')],
    absWorkingDir: ROOT, // esbuild's `// src/content/…` file markers are cwd-relative — pin them so the chunk text (part of the artifact) is deterministic from any invocation dir
    bundle: true,
    write: false,
    format: 'iife',
    minify: false,
    sourcemap: false,
    target: 'es2022',
    platform: 'neutral',
  });
  let chunk = r.outputFiles[0].text;
  // esbuild (iife output, ESM input) emits `"use strict";` at the top of the FILE. For a
  // standalone file that's fine — the file IS the IIFE — but concat-embedded it would flip
  // the whole sloppy-mode game script. Relocate it INTO the IIFE body: identical strict
  // semantics for the chunk, zero effect on the program. Exactly anchored on the emitted
  // shape — if esbuild's output ever drifts, the directive stays top-level and guard 2
  // below fails the build loudly instead of guessing.
  const PROLOGUE = '"use strict";\n(() => {\n';
  if (chunk.startsWith(PROLOGUE)) chunk = '(() => {\n  "use strict";\n' + chunk.slice(PROLOGUE.length);
  // Guard 1 (throws): the chunk must acorn-parse STANDALONE as a classic script — if
  // esbuild ever emitted module syntax here, the concat program would die at load.
  let ast;
  try {
    ast = acorn.parse(chunk, { ecmaVersion: 2023, sourceType: 'script' });
  } catch (e) {
    throw new Error('build: content chunk does not parse standalone as a classic script: ' + e.message);
  }
  // Guard 2 (throws): no TOP-LEVEL "use strict" directive. The concatenated game program
  // is sloppy-mode; a strict prelude at top level would flip the WHOLE script strict.
  // ("use strict" INSIDE the IIFE body is fine and expected — modules are strict.)
  for (const s of ast.body) {
    if (!(s.type === 'ExpressionStatement' && typeof s.directive === 'string')) break; // directive prologue ends
    if (s.directive === 'use strict')
      throw new Error('build: content chunk opens with a TOP-LEVEL "use strict" — it would flip the whole concatenated game script to strict mode');
  }
  // Guard 3 (throws): the explicit seam must exist — a chunk that never assigns
  // globalThis.CONTENT leaves every part reading undefined, silently.
  if (!chunk.includes('globalThis.CONTENT'))
    throw new Error('build: content chunk lacks the `globalThis.CONTENT = …` assignment (src/content/index.ts must end with it)');
  return chunk;
}

const manifestPath = path.join(GAME_DIR, 'manifest.json');
if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const contentChunk = await buildContentChunk(path.join(ROOT, 'src', 'content'));
  // Chunk at the HEAD of the program (before p00): every part sees CONTENT at load time.
  // The IIFE adds no top-level bindings, so namespaceEpilogue's binding scan is unchanged —
  // and a CONTENT/registry name added to CAPTURE/NAMES still FAILS the build (no binding,
  // no __g slot): server and client reach content only through game fns, build-enforced.
  const program = contentChunk + manifest.map((f) => fs.readFileSync(path.join(GAME_DIR, 'parts', f), 'utf8')).join('');
  const epilogue = namespaceEpilogue(program);
  acorn.parse(program + epilogue, { ecmaVersion: 2023, sourceType: 'script' }); // assembled script must parse
  const out =
    fs.readFileSync(path.join(GAME_DIR, 'shell-head.html'), 'utf8') +
    program +
    epilogue +
    fs.readFileSync(path.join(GAME_DIR, 'shell-tail.html'), 'utf8');
  fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'dist', 'eldermyr.html'), out);
  console.log(`build: wrote dist/eldermyr.html (content chunk + ${manifest.length} parts + namespace epilogue, ${out.length} bytes)`);
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
