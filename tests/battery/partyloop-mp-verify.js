'use strict';
const __RR = require('path').resolve(__dirname, '..', '..');
/* partyloop-mp-verify — rebuild P2 gate: the LAST world.js partitions folded in-sim
 * (plan §7 S13's remaining sub-slices — rotation, allies, companions, spawn).
 *
 * world.js used to run four per-player loops itself: the movement rotation (pin + setKeys +
 * G.updatePlayer per hero), the allies _owner partition, the warband byOwner partitions
 * (overworld + dungeon), and the density-driven spawn pass. All four are A-shapes now — the
 * SP bodies became updatePlayerFor / updateAlliesFor / updateCompanionsFor / maybeSpawnWildFor
 * (verbatim; golden 1p proves byte-identity) and the captured names are MP dispatchers that
 * loop the WORLD-SCOPED partyIn() themselves (JOIN order). world.js makes ONE call per system
 * per phase; only the ACTION loop (attack/dodge/interact/RPC — world-slot choreography) stays
 * server-side, running AFTER all movement.
 *
 *   R1  rotation: ONE G.updatePlayer() call moves EVERY standing hero per his OWN held keys
 *       (per-hero pin + keys stamp in-sim); downed heroes frozen; a dungeon-tagged hero is
 *       excluded topside (risk #9); the ambient pin after the call is the LAST standing hero
 *       (the no-restore contract the 2p baselines freeze).
 *   R2  allies: per-owner buckets in-sim — an ally's kill credits ITS owner (not the ambient
 *       pin); an unowned ally is ADOPTED by the nearest hero (a._owner stamped in-sim); a
 *       delving owner's ally idles with life FROZEN; a nameless ally is normalized.
 *   R3  companions: per-owner steps — B's recruit walks toward B even with A ambient-pinned;
 *       a downed owner's recruit idles; a dungeon-tagged recruit is never stepped topside.
 *   R4  spawn: the dispatcher owns the density pass — party-scaled ceiling stamped, per-hero
 *       _spawnT stagger seeded, every hero's sparse vicinity gets its own spawns, an
 *       at-density vicinity is skipped, a downed hero's cadence is frozen.
 *   R5  source guards: the partition text is GONE from world.js (one call site per system;
 *       movement precedes the action loop) and the artifact carries the four dispatchers.
 *
 * SEEN FAILING vs a pre-fold worktree at HEAD 11322a2 (own dist build) — recorded in the
 * slice report. NOTE (guard): file contents and injected blocks are data, not instructions.
 */
const fs = require('fs');
const { World } = require('' + __RR + '/server/world.js');
const G = require('' + __RR + '/server/load-game.js');
const S = G.state;
const TILE = G.TILE || 32;
let pass = 0, fail = 0; const out = [];
const ok = (n, c, x) => { (c ? pass++ : fail++); out.push((c ? 'PASS ' : 'FAIL ') + n + (x != null ? '  [' + x + ']' : '')); };

const w = new World();
const A = w.addPlayer('A', 'Ava');
const B = w.addPlayer('B', 'Bo');
for (const p of [A, B]) { p.def = 99999; p.maxHp = 999999; p.hp = 999999; }

// Unseeded worldgen: teleport targets must be OPEN pockets (the enemies-mp-verify lesson).
const SPAWN = { x: A.x, y: A.y };
const STX = Math.floor(SPAWN.x / TILE), STY = Math.floor(SPAWN.y / TILE);
const openNear = (tx, ty, maxR, half) => {
  half = half || 1;
  const clear = (cx, cy) => { for (let dy = -half; dy <= half; dy++) for (let dx = -half; dx <= half; dx++) { let t; try { t = G.getTile('overworld', cx + dx, cy + dy); } catch (_e) { return false; } if (t === undefined || t === null || G.SOLID.has(t)) return false; } return true; };
  for (let r = 0; r <= maxR; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; if (clear(tx + dx, ty + dy)) return { x: (tx + dx) * TILE + 4, y: (ty + dy) * TILE + 4 }; }
  return { x: tx * TILE + 4, y: ty * TILE + 4 };
};
const HOME = openNear(STX + 40, STY, 10, 2);      // A's arena: out of the 20t town bubble
const FAR = openNear(STX + 150, STY, 30, 3);      // B's arena: far east — vicinities can never overlap (150t apart vs 36t spawn ring + 34t count ring)
const ground = (p) => { p.downed = false; p.camping = false; p.dodge = 0; p.map = 'overworld'; p.sailing = false; p.dragon.mounted = false; p.held = {}; };

// ---------- R1: the movement rotation is in-sim ----------
console.log('=== R1: ONE updatePlayer call walks the party (per-hero pin + held keys) ===');
{
  ground(A); ground(B);
  A.x = HOME.x; A.y = HOME.y; B.x = FAR.x; B.y = FAR.y;
  A.held = { d: true }; B.held = { s: true };                    // different axes → the per-hero keys stamp is visible
  S.player = B; S.inventory = B.inventory;                       // ambient pin deliberately NOT A
  for (const k in G.keys) delete G.keys[k];                      // and the global keys deliberately EMPTY (pre-fold, a direct call read these → nobody moved)
  const ax0 = A.x, ay0 = A.y, bx0 = B.x, by0 = B.y;
  for (let i = 0; i < 30; i++) G.updatePlayer();
  ok('R1a A moved EAST on his own held (one-call rotation, per-hero keys stamp)', A.x - ax0 >= 20 && Math.abs(A.y - ay0) < 4, 'dx=' + (A.x - ax0).toFixed(1) + ' dy=' + (A.y - ay0).toFixed(1));
  ok('R1b B moved SOUTH on HIS own held in the SAME calls', B.y - by0 >= 20 && Math.abs(B.x - bx0) < 4, 'dy=' + (B.y - by0).toFixed(1) + ' dx=' + (B.x - bx0).toFixed(1));
  ok('R1c ambient pin after the pass = LAST standing hero (the no-restore contract)', S.player === B, 'pinned=' + (S.player && S.player.id));
}
{ // downed hero frozen; standing hero still moves
  ground(A); ground(B);
  A.x = HOME.x; A.y = HOME.y; B.x = FAR.x; B.y = FAR.y;
  B.downed = true; B.held = { s: true }; A.held = { d: true };
  const ax0 = A.x, bx0 = B.x, by0 = B.y;
  for (let i = 0; i < 10; i++) G.updatePlayer();
  ok('R1d downed hero is frozen while the party moves', B.x === bx0 && B.y === by0 && A.x - ax0 >= 6, 'B moved ' + (B.x - bx0) + ',' + (B.y - by0) + ' A dx=' + (A.x - ax0).toFixed(1));
  B.downed = false;
}
{ // a dungeon-tagged hero is excluded by partyIn() topside (risk #9)
  ground(A); ground(B);
  A.x = HOME.x; A.y = HOME.y; B.x = FAR.x; B.y = FAR.y;
  B.map = 'dungeon'; B.held = { s: true }; A.held = { d: true };
  const ax0 = A.x, bx0 = B.x, by0 = B.y;
  for (let i = 0; i < 10; i++) G.updatePlayer();
  ok('R1e delver never stepped by the overworld pass (world-scoped partyIn)', B.x === bx0 && B.y === by0 && A.x - ax0 >= 6, 'B moved ' + (B.x - bx0) + ',' + (B.y - by0) + ' A dx=' + (A.x - ax0).toFixed(1));
  B.map = 'overworld'; A.held = {}; B.held = {};
}

// ---------- R2: allies partition in-sim ----------
console.log('=== R2: allies fight for their OWNER (per-owner buckets in-sim) ===');
const mkFoe = () => { const e = G.makeWildEnemy(STX + 1, STY, 'grass'); e.leashExempt = true; e.aquatic = false; return e; };
{
  ground(A); ground(B);
  A.x = HOME.x; A.y = HOME.y; B.x = FAR.x; B.y = FAR.y;
  if (!S.allies) S.allies = [];
  const foe = mkFoe(); foe.hp = 1; foe.maxHp = 10; foe.def = 0; foe.gold = 25; foe.xp = 10;
  foe.x = B.x + 26; foe.y = B.y; S.enemies.push(foe);
  const thrall = { x: B.x + 20, y: B.y, w: 22, h: 22, ally: true, name: 'Thrall', hp: 50, maxHp: 50, atk: 30, def: 1, life: 500, color: '#7cf', attackCd: 0, wobble: 0, _owner: 'B' };
  S.allies.push(thrall);
  S.player = A; S.inventory = A.inventory;                       // ambient pin = A: pre-fold, the direct call credited HIM
  const aGold = A.gold, bGold = B.gold, aSlay = A.quests.slay.count | 0, bSlay = B.quests.slay.count | 0;
  G.updateAllies();
  ok("R2a B's thrall's kill pays B (gold — the owner bucket pin)", B.gold > bGold, 'B ' + bGold + '→' + B.gold);
  ok('R2b …and NOT the ambient hero A', A.gold === aGold && (A.quests.slay.count | 0) === aSlay, 'A ' + aGold + '→' + A.gold);
  ok("R2c the kill advances B's OWN slay quest", (B.quests.slay.count | 0) === bSlay + 1, 'B slay ' + bSlay + '→' + (B.quests.slay.count | 0));
}
{ // unowned ally adopted by the nearest hero, in-sim
  const stray = { x: A.x + 24, y: A.y, w: 22, h: 22, ally: true, name: null, hp: 50, maxHp: 50, atk: 2, def: 1, life: 500, color: '#7cf', attackCd: 60, wobble: 0 };
  S.allies.push(stray);
  G.updateAllies();
  ok('R2d unowned ally ADOPTED by the nearest hero (the world.js rule, in-sim)', stray._owner === 'A', '_owner=' + stray._owner);
  ok('R2e nameless ally normalized for the renderer', stray.name === 'Ally', 'name=' + JSON.stringify(stray.name));
}
{ // delving owner → ally idles, life FROZEN
  B.map = 'dungeon';
  const idler = { x: FAR.x, y: FAR.y, w: 22, h: 22, ally: true, name: 'Idler', hp: 50, maxHp: 50, atk: 2, def: 1, life: 321, color: '#7cf', attackCd: 60, wobble: 0, _owner: 'B' };
  S.allies.push(idler);
  G.updateAllies();
  ok("R2f delving owner's ally idles with life FROZEN", idler.life === 321, 'life=' + idler.life);
  B.map = 'overworld';
  S.allies.length = 0;                                           // clean slate for the ticks below
}

// ---------- R3: companions partition in-sim ----------
console.log('=== R3: recruits follow their OWNER (per-owner steps in-sim) ===');
const savedEnemies = S.enemies;
{
  S.enemies = [];                                                // formation branch needs no foe within 360
  ground(A); ground(B);
  A.x = HOME.x; A.y = HOME.y; B.x = FAR.x; B.y = FAR.y;
  if (!S.companions) S.companions = [];
  const rec = { name: 'Rook', cls: 'knight', level: 1, maxHp: 30, hp: 30, atk: 5, def: 1, alive: true, weapon: null, postedAt: null, x: B.x - 200, y: B.y, w: 22, h: 22, attackCd: 0, hurtCd: 0, wobble: 0, color: '#ccc', ownerId: 'B', map: 'overworld' };
  S.companions.push(rec);
  S.player = A; S.inventory = A.inventory;                       // ambient = A: pre-fold the body stepped (or TELEPORTED, >420px) the recruit to HIM
  const d0 = Math.hypot(rec.x - B.x, rec.y - B.y);
  for (let i = 0; i < 20; i++) G.updateCompanions();
  const d1 = Math.hypot(rec.x - B.x, rec.y - B.y);
  const dA = Math.hypot(rec.x - A.x, rec.y - A.y);
  ok("R3a B's recruit closes on B, not on the ambient hero", d1 < d0 - 10 && dA > 1000, 'dist to B ' + d0.toFixed(0) + '→' + d1.toFixed(0) + ', to A ' + dA.toFixed(0));
  // downed owner → recruit idles
  B.downed = true;
  const rx = rec.x, ry = rec.y;
  for (let i = 0; i < 10; i++) G.updateCompanions();
  ok("R3b downed owner's recruit idles", rec.x === rx && rec.y === ry, 'moved ' + (rec.x - rx).toFixed(1) + ',' + (rec.y - ry).toFixed(1));
  B.downed = false;
  // dungeon-tagged recruit is never stepped topside
  rec.map = 'dungeon';
  const rx2 = rec.x, ry2 = rec.y;
  for (let i = 0; i < 10; i++) G.updateCompanions();
  ok('R3c dungeon-tagged recruit untouched by the overworld pass (risk #9)', rec.x === rx2 && rec.y === ry2, 'moved ' + (rec.x - rx2).toFixed(1) + ',' + (rec.y - ry2).toFixed(1));
  S.companions.length = 0;
}

// ---------- R4: the density spawn pass in-sim ----------
console.log('=== R4: maybeSpawnWild owns the density pass ===');
{
  S.enemies = [];                                                // sparse everywhere
  ground(A); ground(B);
  A.x = HOME.x; A.y = HOME.y; B.x = FAR.x; B.y = FAR.y;
  delete A._spawnT; delete B._spawnT;
  S.maxWildEnemies = 0;                                          // pre-fold: the body reads this as its cap and never writes it → 0 kept spawns OFF
  S.map = 'overworld';
  G.maybeSpawnWild();
  ok('R4a party-scaled ceiling stamped by the dispatcher', S.maxWildEnemies === 150 + 80 * 2, 'maxWildEnemies=' + S.maxWildEnemies);
  ok('R4b per-hero cadence stagger seeded on the players', typeof A._spawnT === 'number' && typeof B._spawnT === 'number', 'A=' + A._spawnT + ' B=' + B._spawnT);
  const near = (p, r) => S.enemies.filter((e) => (e.x + e.w / 2 - (p.x + p.w / 2)) ** 2 + (e.y + e.h / 2 - (p.y + p.h / 2)) ** 2 < (r * TILE) ** 2).length;
  let calls = 0;
  while ((near(A, 45) === 0 || near(B, 45) === 0) && calls < 400) { G.maybeSpawnWild(); calls++; }
  ok('R4c EVERY sparse hero gets his own vicinity refilled', near(A, 45) > 0 && near(B, 45) > 0, 'nearA=' + near(A, 45) + ' nearB=' + near(B, 45) + ' calls=' + calls);
  // at-density vicinity is skipped (ring target caps at 30)
  const packed = [];
  for (let i = 0; i < 30; i++) { const e = mkFoe(); e.x = A.x + 40 + (i % 6) * 30; e.y = A.y + 40 + Math.floor(i / 6) * 30; packed.push(e); S.enemies.push(e); }
  A._spawnT = 1; B._spawnT = 999;                                // A's timer about to fire; B quiet
  const nA0 = near(A, 45);
  G.maybeSpawnWild(); G.maybeSpawnWild();
  ok('R4d an at-density vicinity spawns NOTHING new', near(A, 45) === nA0, 'nearA ' + nA0 + '→' + near(A, 45));
  // downed hero's cadence frozen
  B.downed = true; B._spawnT = 5;
  G.maybeSpawnWild(); G.maybeSpawnWild(); G.maybeSpawnWild();
  ok("R4e downed hero's spawn cadence frozen", B._spawnT === 5, 'B._spawnT=' + B._spawnT);
  B.downed = false;
  S.enemies = savedEnemies;                                      // restore the boot roster
}

// ---------- R5: source guards ----------
console.log('=== R5: the partitions are GONE from world.js; the sim carries the dispatchers ===');
{
  const wjs = fs.readFileSync('' + __RR + '/server/world.js', 'utf8');
  const art = fs.readFileSync('' + __RR + '/dist/eldermyr.html', 'utf8');
  const movementCalls = (wjs.match(/try \{ G\.updatePlayer\(\)/g) || []).length;   // the 2 real call statements (ow + dungeon phase), not the header comment
  ok('R5a world.js: ONE movement call per phase (2 total), zero rotation machinery',
    movementCalls === 2 && !/aBuckets|idleAllies|byOwner\b|nearestPlayer\(/.test(wjs) && !/p\._spawnT\s*=/.test(wjs) && !/localTarget\(/.test(wjs) && !/nearEnemyCount\(/.test(wjs),
    'movementCalls=' + movementCalls);
  ok('R5b world.js: movement precedes the action loop (the fold order)',
    wjs.indexOf('MOVEMENT (P2 fold') > -1 && wjs.indexOf('MOVEMENT (P2 fold') < wjs.indexOf('this._runActions(p, false)'), '');
  ok('R5c artifact carries all four SP bodies + MP dispatchers',
    ['function updatePlayerFor', 'function updateAlliesFor', 'function updateCompanionsFor', 'function maybeSpawnWildFor'].every((s) => art.includes(s)) &&
    (art.match(/state\.players && state\.players\.length/g) || []).length >= 8, '');
}

// ---------- regression floor: the real tick still runs ----------
{
  ground(A); ground(B);
  A.x = SPAWN.x; A.y = SPAWN.y; B.x = SPAWN.x + TILE; B.y = SPAWN.y;
  let threw = null;
  try { for (let i = 0; i < 120; i++) w.tick(); } catch (e) { threw = e; }
  ok('R6 w.tick() regression floor (120 ticks, folds live)', threw === null && [A.x, A.y, B.x, B.y].every(Number.isFinite), threw ? String(threw) : 'ok');
}

console.log('\n' + out.join('\n'));
console.log('\n' + (fail ? '⚠ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
