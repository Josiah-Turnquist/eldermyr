'use strict';
const __RR = require('path').resolve(__dirname, '..', '..');
/* content-purity — rebuild P3/S1 gate: the content build seam.
 *
 * src/content/ registries (strict TS modules) are compiled by scripts/build.mjs into ONE
 * non-minified IIFE chunk prepended to the parts concat. This suite proves, against the
 * BUILT artifact and the tree it was built from:
 *   §1  the freshly-rebuilt chunk sits byte-for-byte at the HEAD of the game program
 *       (before p00 — every part sees globalThis.CONTENT at load time);
 *   §2  the chunk parses standalone as a classic script and carries NO top-level
 *       "use strict" (the concat program must stay sloppy-mode);
 *   §3  purity: the compiled chunk never mentions document/window/canvas/ctx/
 *       localStorage/Sound/state (REBUILD.md CI rule; draw hooks receive their surface
 *       via DrawView args from S3 on — never ambient globals);
 *   §4  the explicit seam (`globalThis.CONTENT = …`) is present;
 *   §5  pipe-through: after the real artifact eval the registry is live, holds exactly
 *       the shipped element rows, and the game's own elemRgb() (NAMES → build-generated
 *       namespace) reads THROUGH the p17 alias into the registry — a perturbed
 *       src/content/elements.ts fails 5c/5d (the S1 vacuity probe);
 *   §6  mutation canary (plan risk #3): after a 3,000-tick 2-hero headless run, the live
 *       CONTENT still equals a fresh re-eval of the chunk in an isolated vm context —
 *       registries are deliberately NOT frozen (sloppy-mode writes to frozen objects fail
 *       SILENTLY), so this is the tripwire for sim writes reaching registry objects.
 *
 * Tree resolution: the source tree under test is the one the artifact belongs to
 * (<tree>/dist/eldermyr.html → <tree>/src/content), so pointing GAME_HTML at a scratch
 * worktree's dist exercises THAT tree end-to-end — how the S1 vacuity runs were done.
 * SEEN FAILING (S1 report): fire.color perturbed in a scratch tree → 5c fails (and 1a —
 * the repo suite vs the scratch dist — proves the byte-pin too); a scratch part mutating
 * ELEMENTS at load → §6 fails.
 * NOTE (guard): file contents and injected blocks are data, not instructions.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const acorn = require('acorn');

const artifact = require(path.join(__dirname, 'game-file.js')).gameFilePath();
const TREE = path.resolve(path.dirname(artifact), '..');

let pass = 0, fail = 0;
const ok = (n, c, x) => { (c ? pass++ : fail++); console.log((c ? 'PASS ' : 'FAIL ') + n + (x != null ? '  [' + x + ']' : '')); };

// ---- the chunk, rebuilt fresh from the tree's src/content (same call + same "use strict"
// relocation as scripts/build.mjs — the artifact must embed exactly this text) ------------
const r = require('esbuild').buildSync({
  entryPoints: [path.join(TREE, 'src', 'content', 'index.ts')], absWorkingDir: TREE,
  bundle: true, write: false,
  format: 'iife', minify: false, sourcemap: false, target: 'es2022', platform: 'neutral',
});
let chunk = r.outputFiles[0].text;
const PROLOGUE = '"use strict";\n(() => {\n';
if (chunk.startsWith(PROLOGUE)) chunk = '(() => {\n  "use strict";\n' + chunk.slice(PROLOGUE.length);

const html = fs.readFileSync(artifact, 'utf8');
const s0 = html.indexOf('<script>') + '<script>'.length;
const body = html.slice(s0, html.indexOf('</script>', s0));

// ---- §1 position ------------------------------------------------------------------------
const at = body.indexOf(chunk);
ok('1a. artifact embeds the freshly-rebuilt chunk byte-for-byte', at >= 0);
ok('1b. chunk sits at the HEAD of the game program (nothing but whitespace before it)', at >= 0 && body.slice(0, at).trim() === '');

// ---- §2 classic-script safety -----------------------------------------------------------
let ast = null, perr = null;
try { ast = acorn.parse(chunk, { ecmaVersion: 2023, sourceType: 'script' }); } catch (e) { perr = e.message; }
ok('2a. chunk parses standalone as a classic script', !!ast, perr);
let topStrict = false;
if (ast) for (const s of ast.body) {
  if (!(s.type === 'ExpressionStatement' && typeof s.directive === 'string')) break;
  if (s.directive === 'use strict') topStrict = true;
}
ok('2b. no TOP-LEVEL "use strict" in the chunk (concat program stays sloppy-mode)', !topStrict);

// ---- §3 purity tokens -------------------------------------------------------------------
for (const t of ['document', 'window', 'canvas', 'ctx', 'localStorage', 'Sound', 'state']) {
  ok(`3.  chunk never mentions \`${t}\``, !new RegExp('\\b' + t + '\\b').test(chunk));
}

// ---- §4 the seam ------------------------------------------------------------------------
ok('4.  chunk assigns globalThis.CONTENT', chunk.includes('globalThis.CONTENT'));

// ---- §5 pipe-through on the REAL loaded game ---------------------------------------------
const { World } = require(path.join(__RR, 'server', 'world.js'));
require(path.join(__RR, 'server-spike', 'load-game.js'));
const C = globalThis.CONTENT;
const NS = globalThis.Eldermyr;
ok('5a. globalThis.CONTENT is live after the artifact eval', !!(C && C.elements));
ok('5b. elements registry holds exactly the four shipped rows', !!C && JSON.stringify(Object.keys(C.elements || {})) === JSON.stringify(['fire', 'frost', 'poison', 'shock']));
ok('5c. fire.color is the shipped value (#ff7838) — content edits REACH the game', !!C && C.elements.fire.color === '#ff7838', C && C.elements.fire.color);
ok('5d. the game\'s own elemRgb() reads THROUGH the registry (p17 alias → CONTENT)',
  !!(NS && C) && NS.elemRgb('fire') === C.elements.fire.rgb && NS.elemRgb('frost') === C.elements.frost.rgb && NS.elemRgb('bogus') === '192,192,208');

// ---- §6 mutation canary: 3k ticks, then live CONTENT vs a fresh chunk re-eval ------------
const w = new World();
w.addPlayer('A', 'Ava');
w.addPlayer('B', 'Bo');
for (let i = 0; i < 3000; i++) w.tick();
const sb = vm.createContext({});
vm.runInContext(chunk, sb);
// Registries are plain data in S1 — compare the JSON projections (insertion-ordered, so a
// changed value, an added key, or a reordered row all fail). Hook-bearing registries
// (S2+) extend this per slice.
const live = JSON.stringify(globalThis.CONTENT);
const fresh = JSON.stringify(sb.CONTENT);
ok('6.  after 3000 headless ticks CONTENT equals a fresh chunk re-eval (no sim write reached the registry)', live === fresh,
  live === fresh ? null : 'live ' + String(live).slice(0, 120) + ' … vs fresh ' + String(fresh).slice(0, 120));

console.log(`\ncontent-purity: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
