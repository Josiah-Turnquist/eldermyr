'use strict';
const __RR = require('path').resolve(__dirname, '..', '..');
// leveling-verify.js — v3.1.0 LEVEL-DRIVEN rank-and-file model. Proves the owner-decided change:
// player level no longer touches enemy stats, type selection, or rewards. The TILE (owLevel) and the
// DEPTH (dungeonLevel) set each enemy's real integer level, and ONE curve derives hp/atk/def/xp/gold
// from it. Drives the REAL factories headlessly (server/load-game). Seen-to-fail: on the pre-change
// dist, (a) FAILS (L1 != L50) and the new curves are absent — proven against dist-pre in the report.
const REPO = '' + __RR + '';
process.chdir(REPO);
const G = require(REPO + '/server/load-game.js');
const S = G.state;
const C = globalThis.CONTENT;
const TILE = G.TILE;
let pass = 0, fail = 0; const out = [];
const ok = (n, c, x) => { (c ? pass++ : fail++); out.push((c ? 'PASS ' : 'FAIL ') + n + (x != null ? '  [' + x + ']' : '')); };
G.startGame();

// Spawn a wild enemy on a FIXED tile at a given PLAYER level, under an identical (constant) RNG stream —
// so the ONLY thing that could differ between two calls is the level-scaling, never the type roll/wobble.
const _rnd = Math.random;
function spawnFixed(tx, ty, playerLevel) {
  S.player.level = playerLevel; S._partyLevel = 0; S._partyN = 1;
  Math.random = () => 0.5;
  const e = G.makeWildEnemy(tx, ty, 0);
  Math.random = _rnd;
  return { type: e.type, level: e.level, hp: e.maxHp, atk: e.atk, def: e.def, xp: e.xp, gold: e.gold };
}

// ── (a) THE HEADLINE — player level no longer touches enemy stats ──────────────────────────────────
out.push('=== (a) same tile, player L1 === L50 (fails on the pre-change engine) ===');
const a1 = spawnFixed(20, 20, 1), a50 = spawnFixed(20, 20, 50);
ok('L1 and L50 spawns are byte-identical on tile [20,20]', JSON.stringify(a1) === JSON.stringify(a50), 'L1=' + JSON.stringify(a1) + ' L50=' + JSON.stringify(a50));
ok('the enemy carries a real integer level', Number.isInteger(a1.level) && a1.level >= 1, 'level=' + a1.level);

// Guard: the pre-change engine has no owLevel/dungeonLevel — record a clean FAIL and stop (proves the
// rest of the suite exercises the NEW model, not an accidental green against stale bytes).
if (!C || !C.curves || typeof C.curves.owLevel !== 'function' || typeof C.curves.dungeonLevel !== 'function') {
  ok('NEW level curves present (owLevel/dungeonLevel)', false, 'pre-change engine — the level-driven curves are absent');
  console.log(out.join('\n'));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(1);
}

// ── (b) owLevel rises with distance from home (the MAP sets the danger) ─────────────────────────────
out.push('\n=== (b) owLevel rises with distance from home ===');
ok('owLevel anchors (.10→3, .30→13, .58→34, .90→64, 1.0→75)',
  C.curves.owLevel(0.10) === 3 && C.curves.owLevel(0.30) === 13 && C.curves.owLevel(0.58) === 34 && C.curves.owLevel(0.90) === 64 && C.curves.owLevel(1.0) === 75,
  [0.10, 0.30, 0.58, 0.90, 1.0].map((d) => C.curves.owLevel(d)).join(','));
ok('owLevel strictly rises 0→1', C.curves.owLevel(0.05) < C.curves.owLevel(0.5) && C.curves.owLevel(0.5) < C.curves.owLevel(0.95));
const cx = Math.round(G.OW_W / 2), cy = Math.round(G.OW_H / 2);
const near = spawnFixed(cx, cy, 1), far = spawnFixed(2, 2, 1);
ok('a near-home foe is lower level than a far-frontier foe', near.level < far.level, 'home L' + near.level + ' vs frontier L' + far.level);

// ── (c) dungeonLevel rises with depth ───────────────────────────────────────────────────────────────
out.push('\n=== (c) dungeonLevel rises with depth ===');
ok('dungeonLevel anchors (floor1→5, 10→32, 20→62)', C.curves.dungeonLevel(1) === 5 && C.curves.dungeonLevel(10) === 32 && C.curves.dungeonLevel(20) === 62, [1, 10, 20].map((d) => C.curves.dungeonLevel(d)).join(','));
G.setupDungeonFloor(1);
const d1min = S.enemies.find((e) => !e.isBoss), d1boss = S.enemies.find((e) => e.isBoss);
G.setupDungeonFloor(10);
const d10min = S.enemies.find((e) => !e.isBoss);
ok('floor-1 minion level === dungeonLevel(1)', d1min && d1min.level === C.curves.dungeonLevel(1), 'lvl=' + (d1min && d1min.level));
ok('floor-10 minion out-levels floor-1', d10min && d1min && d10min.level > d1min.level, 'f1 L' + (d1min && d1min.level) + ' → f10 L' + (d10min && d10min.level));
ok('floor boss level === dungeonLevel(depth) + 2 (capstone bump)', d1boss && d1boss.level === C.curves.dungeonLevel(1) + 2, 'boss L' + (d1boss && d1boss.level));

// ── (d) every Citadel guard matches its master ──────────────────────────────────────────────────────
out.push('\n=== (d) Citadel minions + court === the boss level ===');
const ARCH = C.apex.archivist.level;
S.citadel = 1; S.citadelCycle = 0;
G.setupCitadelFloor(1);
const cmin = S.enemies.filter((e) => e.isCitadelMinion);
const cboss = G.makeCitadelBoss(5, 5), court = G.makeCitadelAdd(null, 5, 5, 0);
ok('the Drowned Archivist is L' + ARCH, cboss.level === ARCH, 'boss L' + cboss.level);
ok('every floor minion is the boss level (' + ARCH + ')', cmin.length > 0 && cmin.every((e) => e.level === ARCH), cmin.length + ' minions, levels ' + [...new Set(cmin.map((e) => e.level))].join(','));
ok('the drowned court is the boss level (' + ARCH + ')', court.level === ARCH, 'court L' + court.level);

// ── (e) hp/atk/def track the ENEMY level, and NONE of them move with the player level ───────────────
out.push('\n=== (e) hp/atk/def move with enemy level, never with player level ===');
ok('hpForLevel rises with level', C.curves.hpForLevel(20, 5) < C.curves.hpForLevel(20, 40));
ok('atkForLevel rises with level', C.curves.atkForLevel(20, 5) < C.curves.atkForLevel(20, 40));
ok('defForLevel rises with level', C.curves.defForLevel(2, 5) < C.curves.defForLevel(2, 40));
ok('same tile, L1 vs L50: hp AND atk AND def all identical', a1.hp === a50.hp && a1.atk === a50.atk && a1.def === a50.def, `hp ${a1.hp}/${a50.hp} atk ${a1.atk}/${a50.atk} def ${a1.def}/${a50.def}`);

// ── (f) DEF FLOOR — a high-def foe stays killable; the sim floors damage at ≥1 ──────────────────────
out.push('\n=== (f) def floor: the toughest rank-and-file def never makes a foe unkillable ===');
const maxDef = C.curves.defForLevel(2, ARCH); // serpent/skeleton base def 2 @ L200 — the toughest rank-and-file def
ok('max rank-and-file def is bounded (L200 base-2 → ~46)', maxDef >= 40 && maxDef < 60, 'def=' + maxDef);
// Drive ONE real, connecting downward melee swing against a fat foe of def `defVal`; return {drop, atk}.
function meleeDropVsDef(defVal, playerLevel, weaponAtk) {
  const p = S.player;
  p.level = playerLevel;
  S.inventory.weapons.forEach((w) => (w.equipped = false));
  S.inventory.weapons.push({ name: 'probe', atk: weaponAtk, style: 'melee', rarity: 1, reqLevel: 1, reqProf: 1, dur: 1e6, durMax: 1e6, equipped: true });
  G.recalcStats();
  p.crit = 0; p.momentum = 0; p._momoDecay = 0; p.evasion = 0; p.invuln = 0; p.blessT = 0; p.foodT = 0;
  p.dir = 'down'; p.hp = p.maxHp = 500; p.x = 100 * TILE; p.y = 100 * TILE; p.attackCooldown = 0;
  const e = G.makeWildEnemy(100, 101, 0);
  e.x = p.x; e.y = p.y + 18; e.w = e.w || 24; e.h = e.h || 24; e.def = defVal; e.level = ARCH; e.hp = e.maxHp = 1e7; e.isBoss = false; e.stunT = 0; e.hitFlash = 0;
  S.enemies = [e];
  Math.random = () => 0; // zero jitter, no crit roll
  G.tryAttack();
  Math.random = _rnd;
  return { drop: e.maxHp - e.hp, atk: p.atk };
}
const geared = meleeDropVsDef(maxDef, 40, 30);
ok('an on-level geared player out-atk\'s def ' + maxDef + ' (raw atk-def > 0)', geared.atk > maxDef, 'p.atk=' + geared.atk);
ok('...and a swing lands MEANINGFUL damage, not chip', geared.drop > 10, 'dmg=' + geared.drop);
const weak = meleeDropVsDef(maxDef, 1, 1); // atk (~5) << def (46): the raw subtraction is negative
ok('the Math.max(1,…) floor holds when atk << def — foe still takes ≥1 (never unkillable)', weak.drop >= 1, 'weak atk=' + weak.atk + ' vs def ' + maxDef + ' → dmg=' + weak.drop);

console.log(out.join('\n'));
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
