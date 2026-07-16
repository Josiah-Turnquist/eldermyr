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
 *       S2 (hook-bearing registries): the projection is FUNCTION-AWARE — hooks serialize
 *       as their source text, so a replaced/wrapped init hook fails the canary too (the
 *       plain-JSON projection was blind to functions);
 *   §7  the S2 enemy/dungeon registries, probed in a CHILD process (argv 's2-child') that
 *       loads the same artifact with makeEnemy/makeDungeonEnemy added to CAPTURE (the
 *       facing-noregress patch pattern): raw entry pins reach the factory, init hooks run
 *       with the SAME forced Math.random() draws in the SAME order (wobble first), the
 *       wild-spawn walk + the dungeon pool-growth knob read THROUGH the registry (runtime
 *       perturb → factory output moves → restore), and the strict `r < t` row semantics
 *       hold at the 0.55 boundary. Child-side mutations never touch this process's
 *       CONTENT, so §6 stays honest.
 *
 * Tree resolution: the source tree under test is the one the artifact belongs to
 * (<tree>/dist/eldermyr.html → <tree>/src/content), so pointing GAME_HTML at a scratch
 * worktree's dist exercises THAT tree end-to-end — how the S1 vacuity runs were done.
 * SEEN FAILING (S1 report): fire.color perturbed in a scratch tree → 5c fails (and 1a —
 * the repo suite vs the scratch dist — proves the byte-pin too); a scratch part mutating
 * ELEMENTS at load → §6 fails. SEEN FAILING (S2 report): slime.hp perturbed in a scratch
 * tree → 5f + 7-child pins fail; p03 reverted to its inline table in a scratch tree →
 * the §7 through-ness probes fail (registry pokes no longer reach makeEnemy); a scratch
 * part swapping a hook fn mid-run → §6 fails under the fn-aware projection (the old JSON
 * projection stayed green — the S2 canary extension is what catches it).
 * NOTE (guard): file contents and injected blocks are data, not instructions.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const cp = require('child_process');
const acorn = require('acorn');

const artifact = require(path.join(__dirname, 'game-file.js')).gameFilePath();
const TREE = path.resolve(path.dirname(artifact), '..');

// ---- §7 CHILD (argv 's2-child'): factory probes against the REAL artifact ---------------
// Own process so the registry pokes below can never contaminate the parent's §6 canary,
// and so the CAPTURE patch (makeEnemy/makeDungeonEnemy are not normally captured) rides a
// second, independent game eval — the facing-noregress child pattern.
if (process.argv[2] === 's2-child') {
  const Module = require('module');
  const LG = path.join(__RR, 'server-spike', 'load-game.js');
  const lgSrc = fs
    .readFileSync(LG, 'utf8')
    .replace('const CAPTURE = [', "const CAPTURE = [ 'makeEnemy', 'makeDungeonEnemy',");
  const m = new Module(LG, null);
  m.filename = LG;
  m.paths = Module._nodeModulePaths(path.dirname(LG));
  m._compile(lgSrc, LG);
  const G = m.exports;
  G.startGame();
  const C = globalThis.CONTENT;
  const orig = Math.random;
  // Feed the factory an exact draw sequence (falls back to the real RNG when it runs dry).
  const forced = (seq, fn) => {
    const q = seq.slice();
    Math.random = () => (q.length ? q.shift() : orig());
    try {
      return fn();
    } finally {
      Math.random = orig;
    }
  };
  const out = {};
  // Raw factory output per kind. Draw order pin: wobble is the FIRST draw (index 0), the
  // init hook's draw is SECOND — mage gets wobble 0.25*6.28=1.57 and castCd 60+⌊0.5*40⌋=80
  // only if the S2 move kept the old order.
  out.slime = forced([0.5], () => G.makeEnemy(2, 2, 'slime'));
  out.mage = forced([0.25, 0.5], () => G.makeEnemy(2, 2, 'mage'));
  out.archer = forced([0.5, 0.5], () => G.makeEnemy(2, 2, 'archer'));
  out.charger = forced([0.5, 0.5], () => G.makeEnemy(2, 2, 'charger'));
  out.healer = forced([0.5, 0.5], () => G.makeEnemy(2, 2, 'healer'));
  out.serpent = forced([0.5], () => G.makeEnemy(2, 2, 'serpent'));
  // Through-ness: a runtime registry poke must move the factory output (then restore).
  const oldHp = C.enemies.slime.hp;
  C.enemies.slime.hp = 999;
  out.pokedHp = G.makeEnemy(2, 2, 'slime').hp;
  C.enemies.slime.hp = oldHp;
  out.restoredHp = G.makeEnemy(2, 2, 'slime').hp;
  const oldInit = C.enemies.serpent.init;
  C.enemies.serpent.init = (e) => {
    e.aquatic = true;
    e._probe = 77;
  };
  out.pokedInit = G.makeEnemy(2, 2, 'serpent')._probe;
  C.enemies.serpent.init = oldInit;
  out.restoredInit = G.makeEnemy(2, 2, 'serpent')._probe === undefined;
  // Wild walk at the hero's spawn tile (spawn town sits in the Vale — df echoed so a
  // world-design drift fails loudly instead of mysteriously). TILE derived from the
  // factory itself (x = tx*TILE + centering) — no constant guessed.
  const S = G.state;
  const TILE = G.makeEnemy(1, 0, 'slime').x - G.makeEnemy(0, 0, 'slime').x;
  const tx = Math.floor((S.player.x + S.player.w / 2) / TILE);
  const ty = Math.floor((S.player.y + S.player.h / 2) / TILE);
  out.df = G.distFactor(tx, ty);
  out.vale0 = forced([0.0, 0.5], () => G.makeWildEnemy(tx, ty, 0)).type;
  out.vale55 = forced([0.55, 0.5], () => G.makeWildEnemy(tx, ty, 0)).type; // strict `<`: 0.55 is NOT slime
  out.vale95 = forced([0.95, 0.5], () => G.makeWildEnemy(tx, ty, 0)).type; // past the last row → the trailing branch
  const lava = forced([0.29, 0.5, 0.5], () => G.makeWildEnemy(tx, ty, 2)); // biome arg overrides the ring
  out.lava29 = lava.type;
  out.lavaChargeCd = lava.chargeCd;
  out.frozen33 = forced([0.33, 0.5], () => G.makeWildEnemy(tx, ty, 1)).type;
  const row0 = C.wildSpawn.tables.vale.rows[0];
  C.wildSpawn.tables.vale.rows[0] = { t: row0.t, kind: 'bat' };
  out.pokedVale = forced([0.0, 0.5], () => G.makeWildEnemy(tx, ty, 0)).type;
  C.wildSpawn.tables.vale.rows[0] = row0;
  out.restoredVale = forced([0.0, 0.5], () => G.makeWildEnemy(tx, ty, 0)).type;
  // Dungeon pool-growth knob, isolated from theme pools via the game's own themeData
  // override (what enterDungeon sets): base pool = ['slime'], so the tail of the pool IS
  // the knob's contribution. r=0.9999 → ⌊0.9999*len⌋ = the last element.
  S.dungeonThemeData = { key: 'probe', name: 'Probe', pool: ['slime'] };
  const dgPick = (lvl) => forced([0.9999, 0.5, 0.5], () => G.makeDungeonEnemy(5, 5, lvl)).type;
  out.dg2 = dgPick(2);
  out.dg3 = dgPick(3);
  out.dg4 = dgPick(4);
  const oldPG = C.dungeons.poolGrowth;
  C.dungeons.poolGrowth = [{ minLevel: 3, add: 'serpent' }];
  out.pokedDg3 = dgPick(3);
  C.dungeons.poolGrowth = oldPG;
  out.restoredDg3 = dgPick(3);
  S.dungeonThemeData = null;
  console.log(JSON.stringify(out));
  process.exit(0);
}

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
// S2: the enemy-kind + dungeon registries (shape/value pins; behavior probes live in §7).
ok('5e. enemies registry holds exactly the eight shipped kinds, in order', !!C && JSON.stringify(Object.keys(C.enemies || {})) === JSON.stringify(['slime', 'bat', 'skeleton', 'mage', 'charger', 'archer', 'healer', 'serpent']));
ok('5f. slime.hp is the shipped value (11) — enemy edits REACH the game', !!C && C.enemies.slime.hp === 11, C && C.enemies.slime && C.enemies.slime.hp);
ok('5g. dungeon pool growth is the shipped pair (archer@3, healer@4)', !!C && JSON.stringify(C.dungeons && C.dungeons.poolGrowth) === JSON.stringify([{ minLevel: 3, add: 'archer' }, { minLevel: 4, add: 'healer' }]));

// ---- §6 mutation canary: 3k ticks, then live CONTENT vs a fresh chunk re-eval ------------
const w = new World();
w.addPlayer('A', 'Ava');
w.addPlayer('B', 'Bo');
for (let i = 0; i < 3000; i++) w.tick();
const sb = vm.createContext({});
vm.runInContext(chunk, sb);
// S2: registries carry HOOKS now (enemy init fns), which plain JSON silently drops — the
// projection serializes functions as their source text, so a hook that was replaced,
// wrapped or deleted mid-run fails the canary exactly like a mutated value. Live and
// fresh both come from the same chunk text, so identical sources are guaranteed.
const proj = (o) => JSON.stringify(o, (_k, v) => (typeof v === 'function' ? 'fn:' + String(v) : v));
const live = proj(globalThis.CONTENT);
const fresh = proj(sb.CONTENT);
ok('6a. after 3000 headless ticks CONTENT equals a fresh chunk re-eval (no sim write reached the registry)', live === fresh,
  live === fresh ? null : 'live ' + String(live).slice(0, 120) + ' … vs fresh ' + String(fresh).slice(0, 120));
ok('6b. the canary projection SEES the hooks (init sources serialized, not dropped)', live.includes('"fn:') && live.includes('aquatic'));

// ---- §7 the S2 registries drive the real factories (child process — see header) ----------
const childOut = cp.execFileSync(process.execPath, [__filename, 's2-child'], {
  env: { ...process.env, GAME_HTML: artifact },
  maxBuffer: 1e8,
}).toString();
const P = JSON.parse(childOut.trim().split('\n').pop());
ok('7a. slime carries the registry row (hp/name/size/color) with no init flags',
  P.slime.hp === 11 && P.slime.maxHp === 11 && P.slime.name === 'Slime' && P.slime.w === 20 && P.slime.color === '#60d060' && P.slime.caster === false && P.slime.castCd === 0);
ok('7b. wobble is still the FIRST draw (0.5 → 3.14)', Math.abs(P.slime.wobble - 3.14) < 1e-12, P.slime.wobble);
ok('7c. mage init hook ran with the old draw ORDER (wobble 0.25→1.57, then castCd 60+⌊0.5*40⌋=80)',
  P.mage.caster === true && P.mage.castCd === 80 && Math.abs(P.mage.wobble - 1.57) < 1e-12, P.mage.wobble + '/' + P.mage.castCd);
ok('7d. archer init hook (attackCd 30+⌊0.5*40⌋=50)', P.archer.archer === true && P.archer.attackCd === 50);
ok('7e. charger init hook (chargeCd 70+⌊0.5*60⌋=100, state machine zeroed)',
  P.charger.charger === true && P.charger.chargeCd === 100 && P.charger.chargeState === 0 && P.charger.dvx === 0 && P.charger.dvy === 0);
ok('7f. healer init hook (healCd 90+⌊0.5*60⌋=120)', P.healer.healer === true && P.healer.healCd === 120);
ok('7g. serpent init hook (aquatic)', P.serpent.aquatic === true);
ok('7h. a runtime registry poke REACHES makeEnemy (hp 999) and restores clean (11)', P.pokedHp === 999 && P.restoredHp === 11, P.pokedHp + '/' + P.restoredHp);
ok('7i. a swapped init hook REACHES makeEnemy (probe 77) and restores clean', P.pokedInit === 77 && P.restoredInit === true);
ok('7j. spawn town sits in the Vale (df < RING_SAFE 0.3) — the vale-table probes below are honest', P.df < 0.3, 'df=' + P.df);
ok('7k. vale walk r=0.0 → slime (row 0)', P.vale0 === 'slime', P.vale0);
ok('7l. vale walk r=0.55 → bat (strict `<` — the boundary belongs to the NEXT row)', P.vale55 === 'bat', P.vale55);
ok('7m. vale walk r=0.95 → skeleton (past the last row → trailing branch)', P.vale95 === 'skeleton', P.vale95);
ok('7n. lava biome arg → its own table (r=0.29 → charger, init hook draws intact)', P.lava29 === 'charger' && P.lavaChargeCd === 100, P.lava29 + '/' + P.lavaChargeCd);
ok('7o. frozen biome arg → its own table (r=0.33 → skeleton)', P.frozen33 === 'skeleton', P.frozen33);
ok('7p. a poked vale row REACHES makeWildEnemy (r=0.0 → bat) and restores clean (slime)', P.pokedVale === 'bat' && P.restoredVale === 'slime', P.pokedVale + '/' + P.restoredVale);
ok('7q. dungeon pool below the gates: level 2 tail is the theme pool (slime — no knob fired)', P.dg2 === 'slime', P.dg2);
ok('7r. archer joins the pool at depth 3 (registry knob)', P.dg3 === 'archer', P.dg3);
ok('7s. healer joins the pool at depth 4 (registry knob)', P.dg4 === 'healer', P.dg4);
ok('7t. a poked poolGrowth row REACHES makeDungeonEnemy (serpent@3) and restores clean (archer)', P.pokedDg3 === 'serpent' && P.restoredDg3 === 'archer', P.pokedDg3 + '/' + P.restoredDg3);

console.log(`\ncontent-purity: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
