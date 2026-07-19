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
 *       S3 (creature art): the enemies registry holds all ELEVEN drawEnemy kinds (5e),
 *       every entry carries a MANDATORY draw hook, dragon/kraken/boss are draw-hook-only
 *       entries with NO stats until the S5 apex slice (5h), and the facing data is
 *       registry-derived: FACING = exactly the entries flagged `faces` (charger/serpent/
 *       dragon), faceDz = 6 (5i);
 *   §6  mutation canary (plan risk #3): after a 3,000-tick 2-hero headless run, the live
 *       CONTENT still equals a fresh re-eval of the chunk in an isolated vm context —
 *       registries are deliberately NOT frozen (sloppy-mode writes to frozen objects fail
 *       SILENTLY), so this is the tripwire for sim writes reaching registry objects.
 *       S2 (hook-bearing registries): the projection is FUNCTION-AWARE — hooks serialize
 *       as their source text, so a replaced/wrapped init hook fails the canary too (the
 *       plain-JSON projection was blind to functions); S3: the DRAW hooks ride the same
 *       projection (6b now also demands a draw-op token in the serialized sources);
 *   §7  the S2 enemy/dungeon registries, probed in a CHILD process (argv 's2-child') that
 *       loads the same artifact with makeEnemy/makeDungeonEnemy/drawEnemy added to
 *       CAPTURE (the facing-noregress patch pattern): raw entry pins reach the factory,
 *       init hooks run with the SAME forced Math.random() draws in the SAME order (wobble
 *       first), the wild-spawn walk + the dungeon pool-growth knob read THROUGH the
 *       registry (runtime perturb → factory output moves → restore), and the strict
 *       `r < t` row semantics hold at the 0.55 boundary. S3 (§7u-7x): drawEnemy
 *       DISPATCHES through the registry — a swapped slime.draw hook receives the
 *       in-part DrawView (g2d surface + numeric sx/sy + boolean flash + working
 *       shade/rgbOf) and the live instance, restores clean; and updateEnemies reads the
 *       facing table THROUGH CONTENT.facing (poke slime in → a slime grows _faceL;
 *       restore → the next slime stays clean). Child-side mutations never touch this
 *       process's CONTENT, so §6 stays honest.
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
  const LG = path.join(__RR, 'server', 'load-game.js');
  const lgSrc = fs
    .readFileSync(LG, 'utf8')
    .replace('const CAPTURE = [', "const CAPTURE = [ 'makeEnemy', 'makeDungeonEnemy', 'drawEnemy',");
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
  // ---- S3 (§7u-7x): drawEnemy dispatch + DrawView seam + facing through-ness ------------
  const probeFoe = G.makeEnemy(2, 2, 'slime');
  probeFoe.x = S.camera.x + 200;
  probeFoe.y = S.camera.y + 200;
  probeFoe.hitFlash = 0;
  probeFoe.tele = null;
  let realThrew = null;
  try {
    G.drawEnemy(probeFoe);
  } catch (err) {
    realThrew = String(err);
  }
  out.realDrawClean = realThrew; // the registry hook runs headless without throwing
  const oldDraw = C.enemies.slime.draw;
  let seen = null;
  C.enemies.slime.draw = (v, e2) => {
    seen = {
      g2dOk: !!v.g2d && typeof v.g2d.fillRect === 'function',
      sx: v.sx,
      sy: v.sy,
      flash: v.flash,
      shadeOk: typeof v.shade === 'function' && v.shade('#000000', 10) === '#0a0a0a',
      rgbOk: typeof v.rgbOf === 'function' && v.rgbOf('#ff7838') === '255,120,56',
      eIsInstance: e2 === probeFoe,
    };
  };
  G.drawEnemy(probeFoe);
  out.drawPoked = seen;
  // flash rides VERBATIM from the prelude: `false || (e.tele && …)` → null for a
  // tele-less foe (hooks read truthiness only — the type says boolean|null on purpose)
  out.drawPokedSx = seen && seen.sx === probeFoe.x - S.camera.x && seen.sy === probeFoe.y - S.camera.y && (seen.flash === false || seen.flash === null);
  C.enemies.slime.draw = oldDraw;
  seen = null;
  G.drawEnemy(probeFoe);
  out.drawRestored = seen === null;
  // facing: updateEnemies must read the table THROUGH the registry object (p20 alias)
  S.map = 'overworld';
  const fFoe = G.makeEnemy(2, 2, 'slime');
  fFoe.x = S.player.x - 200;
  fFoe.y = S.player.y;
  S.enemies = [fFoe];
  G.updateEnemies();
  out.faceClean = fFoe._faceL === undefined; // slime has no front — never tracked
  C.facing.slime = 1;
  G.updateEnemies();
  const facedRight = fFoe._faceL; // hero is RIGHT of it → faces right (0), but SET now
  fFoe.x = S.player.x + 200;
  G.updateEnemies();
  out.facePoked = facedRight === 0 && fFoe._faceL === 1;
  delete C.facing.slime;
  const fFoe2 = G.makeEnemy(2, 2, 'slime');
  fFoe2.x = S.player.x - 200;
  fFoe2.y = S.player.y;
  S.enemies = [fFoe2];
  G.updateEnemies();
  out.faceRestored = fFoe2._faceL === undefined;
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
require(path.join(__RR, 'server', 'load-game.js'));
const C = globalThis.CONTENT;
const NS = globalThis.Eldermyr;
ok('5a. globalThis.CONTENT is live after the artifact eval', !!(C && C.elements));
ok('5b. elements registry holds exactly the four shipped rows', !!C && JSON.stringify(Object.keys(C.elements || {})) === JSON.stringify(['fire', 'frost', 'poison', 'shock']));
ok('5c. fire.color is the shipped value (#ff7838) — content edits REACH the game', !!C && C.elements.fire.color === '#ff7838', C && C.elements.fire.color);
ok('5d. the game\'s own elemRgb() reads THROUGH the registry (p17 alias → CONTENT)',
  !!(NS && C) && NS.elemRgb('fire') === C.elements.fire.rgb && NS.elemRgb('frost') === C.elements.frost.rgb && NS.elemRgb('bogus') === '192,192,208');
// S2: the enemy-kind + dungeon registries (shape/value pins; behavior probes live in §7).
// S3: the registry holds ALL ELEVEN drawEnemy kinds — the 8 spawnable ones first (order
// preserved), then the three factory-stat kinds as draw-hook-only entries.
ok('5e. enemies registry holds exactly the eleven drawEnemy kinds, in order', !!C && JSON.stringify(Object.keys(C.enemies || {})) === JSON.stringify(['slime', 'bat', 'skeleton', 'mage', 'charger', 'archer', 'healer', 'serpent', 'dragon', 'kraken', 'boss']));
ok('5f. slime.hp is the shipped value (11) — enemy edits REACH the game', !!C && C.enemies.slime.hp === 11, C && C.enemies.slime && C.enemies.slime.hp);
ok('5g. dungeon pool growth is the shipped pair (archer@3, healer@4)', !!C && JSON.stringify(C.dungeons && C.dungeons.poolGrowth) === JSON.stringify([{ minLevel: 3, add: 'archer' }, { minLevel: 4, add: 'healer' }]));
ok('5h. dragon/kraken/boss are draw-hook-ONLY entries (no stats until the S5 apex slice)',
  !!C && ['dragon', 'kraken', 'boss'].every((k) => C.enemies[k] && typeof C.enemies[k].draw === 'function' && !('hp' in C.enemies[k]) && !('atk' in C.enemies[k])));
ok('5i. every entry carries a draw hook; FACING derives to exactly {charger,dragon,serpent}; faceDz=6',
  !!C && Object.keys(C.enemies).every((k) => typeof C.enemies[k].draw === 'function')
  && JSON.stringify(Object.keys(C.facing || {}).sort()) === JSON.stringify(['charger', 'dragon', 'serpent'])
  && Object.keys(C.enemies).filter((k) => C.enemies[k].faces).sort().join(',') === Object.keys(C.facing).sort().join(',')
  && C.faceDz === 6);
// S5: the apex-boss DATA registry + the CAPTURE'd aliases (GREAT_HUNTS/PINNACLE_BOSSES) reading
// through it. The behavioural through-ness is proven LIVE by the golden `prove` hunt control
// (perturbing GREAT_HUNTS → makeGreatBeast → divergence exactly @700); these pin the shape/values.
ok('5j. CONTENT.apex holds the 4 Great Hunts + 2 pinnacles + dragon/pin tuning',
  !!C && C.apex && C.apex.hunts.length === 4 && C.apex.pinnacles.length === 2 && C.apex.dragonLevel === 30 && C.apex.dragonColor === '#e85020' && C.apex.pinLevel === 75 && C.apex.pinArenaStart === 360 && C.apex.pinArenaMin === 100 && C.apex.pinArenaShrink === 0.05 && C.apex.pinLeash === 980);
ok('5k. Great Hunt rows carry the shipped values (frosttitan 900hp, leviathan is an isle, Titan’s Maul reward)',
  !!C && C.apex.hunts[0].key === 'frosttitan' && C.apex.hunts[0].hp === 900 && C.apex.hunts[0].reward.weapon.name === 'Titan’s Maul' && C.apex.hunts[3].key === 'leviathan' && C.apex.hunts[3].island === true, C && C.apex.hunts[0].hp);
ok('5l. pinnacle rows carry the shipped values (drownedking 2600hp + its style-unique drop)',
  !!C && C.apex.pinnacles[0].key === 'drownedking' && C.apex.pinnacles[0].hp === 2600 && C.apex.pinnacles[0].drops.styleUniq === 'leviathanspine' && C.apex.pinnacles[1].key === 'paleshepherd' && C.apex.pinnacles[1].night === true);
ok('5m. the game reads apex THROUGH the registry (CAPTURE\'d GREAT_HUNTS/PINNACLE_BOSSES aliases === CONTENT.apex)',
  !!(NS && C) && NS.GREAT_HUNTS === C.apex.hunts && NS.PINNACLE_BOSSES === C.apex.pinnacles);
// S6: the gear DATA registry (rarity/shop/uniques/mastery/pattern + gen pools + affixPool). The
// through-ness is proven LIVE by golden (loot generation stays byte-identical — genWeapon/rollAffixes
// read these), so these pin the shape/values; the symbols are not CAPTURE'd (no namespace alias).
ok('5n. CONTENT.gear holds the loot tables (5 rarities · 13 shop weapons · 3 shop armor · 9 uniques [4 pinnacle + 5 Citadel relics] · 3 pattern weapons)',
  !!C && C.gear && C.gear.rarities.length === 5 && C.gear.shopWeapons.length === 13 && C.gear.shopArmor.length === 3 && Object.keys(C.gear.uniques).length === 9 && C.gear.patternWeapons.length === 3 && C.gear.styleNames.melee.length === 4);
ok('5o. gear rows carry the shipped values (legendary mult 2.05, Steel Sword 80g, mastery [10,18,24], leviathanspine ×1.2)',
  !!C && C.gear.rarities[4].id === 'legendary' && C.gear.rarities[4].mult === 2.05 && C.gear.shopWeapons[1].name === 'Steel Sword' && C.gear.shopWeapons[1].cost === 80 && JSON.stringify(C.gear.masteryLvls) === JSON.stringify([10, 18, 24]) && C.gear.uniques.leviathanspine.atkMul === 1.2, C && C.gear.shopWeapons[1] && C.gear.shopWeapons[1].cost);
ok('5p. affixPool is a pure rIdx-scaled helper (weapon r4 → crit +15% / lifesteal +3% / berserk; armor → evasion/lifesteal/crit)',
  !!C && typeof C.gear.affixPool === 'function' && (() => {
    const w = C.gear.affixPool(4, true), a = C.gear.affixPool(4, false);
    return w.length === 3 && w[0].t === 'crit' && w[0].label === '+15% Crit' && w[1].t === 'lifesteal' && w[1].label === '+3% Lifesteal' && w[2].t === 'berserk' && a[0].t === 'evasion' && a.length === 3;
  })());
// S7: the elite-affix DATA + per-key apply hooks. Behaviour is proven by affix-verify (a shielded
// elite seeds its shield pool through the hook, live); these pin the shape + the apply seeding
// (elite affixes only fire at partyLvl>=15, so the golden windows never exercise them — §5t is the
// guard for the extracted apply logic the oracles cannot see).
ok('5r. CONTENT.affixes holds the 4 elite affixes + the ordered key pool',
  !!C && C.affixes && JSON.stringify(C.affixes.keys) === JSON.stringify(['shielded', 'vampiric', 'splitting', 'warded']) && ['shielded', 'vampiric', 'splitting', 'warded'].every((k) => C.affixes.defs[k] && typeof C.affixes.defs[k].flag === 'string'));
ok('5s. affix defs carry the shipped flags/labels/prefixes (afxShield/SHIELDED/"Shielded ", afxVamp, afxWard)',
  !!C && C.affixes.defs.shielded.flag === 'afxShield' && C.affixes.defs.shielded.label === 'SHIELDED' && C.affixes.defs.shielded.pre === 'Shielded ' && C.affixes.defs.vampiric.flag === 'afxVamp' && C.affixes.defs.splitting.flag === 'afxSplit' && C.affixes.defs.warded.flag === 'afxWard');
ok('5t. shielded.apply seeds a 25%-maxHp shield pool; warded.apply arms the ward window; vampiric/splitting have none',
  !!C && typeof C.affixes.defs.shielded.apply === 'function' && (() => {
    const e = { maxHp: 400 }; C.affixes.defs.shielded.apply(e);
    const w = {}; C.affixes.defs.warded.apply(w);
    return e.shieldMax === 100 && e.shieldHp === 100 && e.shieldRegenT === 0 && w.wardT === 0 && w.wardCd === 180 && !C.affixes.defs.vampiric.apply && !C.affixes.defs.splitting.apply;
  })());
// S8: the dungeon registry gains DUNGEON_THEMES + the depth index, FLOOR_MODS + the weight ladder,
// and the Key-Vault knobs. The p03/p06/p18/p22 aliases read these; the RNG draws stay in-part, so
// pickFloorMod/theme are RNG-free and pinnable here (the golden windows exercise them only when a
// scenario descends — these are the shape/value + helper-math guards).
ok('5u. CONTENT.dungeons holds 4 themes + 4 floor mods + the vault knobs',
  !!C && C.dungeons && C.dungeons.themes.length === 4 && JSON.stringify(Object.keys(C.dungeons.floorMods)) === JSON.stringify(['gilded', 'swarming', 'cursed', 'vault']) && C.dungeons.vault.minLevel === 2 && C.dungeons.vault.odds === 0.4);
ok('5v. theme rows carry the shipped values (catacombs first, inferno lava pool, abyss void pit) and theme(level) indexes by depth VERBATIM',
  !!C && C.dungeons.themes[0].key === 'catacombs' && C.dungeons.themes[2].key === 'inferno' && C.dungeons.themes[2].pitKind === 'lava' && C.dungeons.themes[3].pitKind === 'void' && JSON.stringify(C.dungeons.themes[0].pool) === JSON.stringify(['skeleton', 'skeleton', 'bat', 'slime', 'archer'])
  && C.dungeons.theme(1).key === 'catacombs' && C.dungeons.theme(3).key === 'catacombs' && C.dungeons.theme(4).key === 'caverns' && C.dungeons.theme(10).key === 'abyss' && C.dungeons.theme(13).key === 'catacombs', C && C.dungeons.themes[0].key);
ok('5w. floor mods carry the shipped icons/names; pickFloorMod maps the weight ladder with strict `<` (0.54→null, 0.55→gilded, 0.685→swarming, 0.82→cursed, 0.955→vault)',
  !!C && C.dungeons.floorMods.gilded.icon === '👑' && C.dungeons.floorMods.vault.name === 'Treasure Vault'
  && C.dungeons.pickFloorMod(0.0) === null && C.dungeons.pickFloorMod(0.54) === null && C.dungeons.pickFloorMod(0.55) === 'gilded' && C.dungeons.pickFloorMod(0.684) === 'gilded' && C.dungeons.pickFloorMod(0.685) === 'swarming' && C.dungeons.pickFloorMod(0.82) === 'cursed' && C.dungeons.pickFloorMod(0.955) === 'vault' && C.dungeons.pickFloorMod(0.999) === 'vault',
  C && String(C.dungeons.pickFloorMod(0.55)));
// S9: the warband registry (COMP_CLASSES/COMP_NAMES/COMP_CAP/compStatsFor). Golden windows contain NO
// companions, so statsFor is oracle-invisible — these §5 pins are the formula's guard. statsFor is
// tiers-ready (tier default 0 = today, statMul 1); the byte-identity is `x*1===x`.
ok('5x. CONTENT.companions holds 3 classes + 16 names + cap 3; class rows carry shipped values (knight 120hp/200g, mage 13atk/240g); tiers[0].statMul === 1',
  !!C && C.companions && JSON.stringify(Object.keys(C.companions.classes)) === JSON.stringify(['knight', 'ranger', 'mage']) && C.companions.names.length === 16 && C.companions.cap === 3
  && C.companions.classes.knight.baseHp === 120 && C.companions.classes.knight.hire === 200 && C.companions.classes.mage.baseAtk === 13 && C.companions.classes.mage.hire === 240 && C.companions.classes.knight.tiers[0].statMul === 1, C && C.companions.classes.knight.hire);
ok('5y. statsFor(cls, level) is the VERBATIM level-scaling formula at tier 0 (knight L1→120/11/6, L5→187/17/8, L10→271/25/10; mage L1→64/13/1)',
  !!C && (() => {
    const k1 = C.companions.statsFor('knight', 1), k5 = C.companions.statsFor('knight', 5), k10 = C.companions.statsFor('knight', 10), m1 = C.companions.statsFor('mage', 1);
    return k1.maxHp === 120 && k1.atk === 11 && k1.def === 6 && k5.maxHp === 187 && k5.atk === 17 && k5.def === 8 && k10.maxHp === 271 && k10.atk === 25 && k10.def === 10 && m1.maxHp === 64 && m1.atk === 13 && m1.def === 1;
  })(), C && JSON.stringify(C.companions.statsFor('knight', 10)));
// S10: the small-tables sweep (seasons/foods/bless/trade/status/regions/poi/holds/warlord/nemesis/
// abilities). The oracle-REACHING tables (WL names → e.name, TRADE.base/FORAGE → gold, HOLDS coords,
// ABILITY_RMAX → ranks, HEAT_AURA → aura state) are proven byte-identical by golden/mp; these §5 pins
// are the guard for the DISPLAY-ONLY tables golden can't see, incl. the unicode (−, —, curly quotes).
ok('5z1. CONTENT.tables holds all 11 clusters with the shipped shapes/counts',
  !!C && C.tables && Object.keys(C.tables.foods.recipes).length === 4 && Object.keys(C.tables.bless).length === 4 && Object.keys(C.tables.trade).length === 4 && C.tables.regions.names.length === 9 && C.tables.regions.subs.length === 9 && C.tables.regions.lore.length === 9 && C.tables.holds.length === 3 && C.tables.warlord.first.length === 18 && C.tables.warlord.epithet.length === 15 && C.tables.nemesis.names.length === 6 && C.tables.seasons.names.length === 4 && Object.keys(C.tables.poi).length === 3);
ok('5z2. oracle-reaching values are the shipped ones (TRADE furs base 40, FORAGE herb 8, HOLD Ironford 269/112, ABILITY summon 4, heatAura 40/16, WL_FIRST[0] Grukk, POI camp #ff5040)',
  !!C && C.tables.trade.furs.base === 40 && C.tables.foods.forageValue.herb === 8 && C.tables.holds[1].tx === 269 && C.tables.holds[1].ty === 112 && C.tables.holds[1].name === 'Ironford' && C.tables.abilities.rankMax.summon === 4 && C.tables.abilities.heatAuraMin === 40 && C.tables.abilities.heatAuraTicks === 16 && C.tables.warlord.first[0] === 'Grukk' && C.tables.poi.camp.mark === '#ff5040');
ok('5z3. display-only unicode survives byte-for-byte (STATUS −22% is U+2212, BLESS.ward −40%, lore[8] Emberwyrm curly apostrophe, SEASON_TINT[3] winter rgba)',
  !!C && C.tables.status.Exhausted.includes('−22%') && C.tables.bless.ward.desc === '−40% damage taken' && C.tables.regions.lore[8] === 'The Emberwyrm is not the fire’s master. It is the fire’s prisoner.' && C.tables.seasons.tint[3] === 'rgba(180,212,255,0.14)' && C.tables.foods.recipes.roast.name === "Forager's Roast",
  C && C.tables.bless.ward.desc);
// The scaling curves. Golden/mp PROVE these live (every spawn+levelup evaluates them through the p03
// aliases → the oracles move consciously with a real change); these §5 pins evaluate the fns at sample
// points so a curve edit that slips past golden's windows still fails here. v3.1.0: the rank-and-file
// model is LEVEL-DRIVEN — owLevel/dungeonLevel are the level sources and hp/atk/def/xp/goldForLevel
// return the FINAL (rounded) stat from a kind's base + the level (Math.round now lives in the fns).
ok('5z4. xpForLevel is VERBATIM (L1→32, L2→55, L7→481, L10→1924) and the grind/ascension knobs are shipped (xpMul 1.4, goldMul 1.25, ascMul(0)=1, ascMul(5)=2)',
  !!C && C.curves && C.curves.xpForLevel(1) === 32 && C.curves.xpForLevel(2) === 55 && C.curves.xpForLevel(7) === 481 && C.curves.xpForLevel(10) === 1924 && C.curves.dungeonXpMul === 1.4 && C.curves.dungeonGoldMul === 1.25 && C.curves.ascMul(0) === 1 && C.curves.ascMul(5) === 2,
  C && C.curves && C.curves.xpForLevel(10));
ok('5z5. v3.1.0 LEVEL-DRIVEN curves are the shipped formulas — owLevel/dungeonLevel level sources + the unified hp/atk/def/xp/gold-forLevel ramps (home/L1 === base; gold slope 0.10 < xp slope 0.26)',
  !!C && (() => {
    const cu = C.curves;
    // level SOURCES — the anchors the model is tuned to
    const sources = cu.owLevel(0.10) === 3 && cu.owLevel(0.30) === 13 && cu.owLevel(0.58) === 34 && cu.owLevel(0.90) === 64 && cu.owLevel(1.0) === 75
      && cu.dungeonLevel(1) === 5 && cu.dungeonLevel(10) === 32 && cu.dungeonLevel(20) === 62;
    // the unified stat curve: L1 (home) === the kind's base for hp/atk/def, and each ramps up at L50.
    // v3.2.2 DOUBLED the rank-and-file hp/atk slopes (hp 0.35→0.70 → L50 363→706; atk 0.18→0.36 →
    // L50 196→373); def (0.22) is unchanged (L50 still 13). L1 stays === base (slope is the only knob).
    const stats = cu.hpForLevel(20, 1) === 20 && cu.hpForLevel(20, 50) === 706
      && cu.atkForLevel(20, 1) === 20 && cu.atkForLevel(20, 50) === 373
      && cu.defForLevel(2, 1) === 2 && cu.defForLevel(2, 50) === 13;
    // rewards ride the enemy level: XP the full 0.26 slope, gold the gentler 0.10 (base at L1, gold < xp for L>1)
    const rewards = cu.xpForEnemyLevel(10, 1) === 10 && cu.xpForEnemyLevel(10, 50) === 137
      && cu.goldForEnemyLevel(6, 1) === 6 && cu.goldForEnemyLevel(6, 50) === 35
      && cu.goldForEnemyLevel(10, 50) < cu.xpForEnemyLevel(10, 50);
    return sources && stats && rewards;
  })(), C && C.curves && String(C.curves.owLevel(1.0)));

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
ok('6b. the canary projection SEES the hooks (init AND draw sources serialized, not dropped)',
  live.includes('"fn:') && live.includes('aquatic') && live.includes('quadraticCurveTo'));

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
// ---- S3: the draw dispatch + the DrawView seam + registry-derived facing -----------------
ok('7u. the registry draw hook renders headless without throwing (real slime.draw)', P.realDrawClean === null, P.realDrawClean);
ok('7v. a swapped slime.draw REACHES drawEnemy with the full DrawView (g2d surface, prelude sx/sy/flash, working shade/rgbOf, the live instance)',
  !!P.drawPoked && P.drawPoked.g2dOk === true && P.drawPoked.shadeOk === true && P.drawPoked.rgbOk === true && P.drawPoked.eIsInstance === true && P.drawPokedSx === true,
  JSON.stringify(P.drawPoked));
ok('7w. slime.draw restores clean (the probe never fires again)', P.drawRestored === true);
ok('7x. updateEnemies reads facing THROUGH CONTENT.facing (slime untracked → poked in: _faceL 0 then 1 → restored: untracked)',
  P.faceClean === true && P.facePoked === true && P.faceRestored === true,
  'clean=' + P.faceClean + ' poked=' + P.facePoked + ' restored=' + P.faceRestored);

console.log(`\ncontent-purity: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
