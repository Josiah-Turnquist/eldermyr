const __RR = require('path').resolve(__dirname, '..', '..');
/* t2 — FIX 2: no premature liberation from partitioned combat.
 * Two guardians of ONE holding, placed so they land in DIFFERENT players' buckets.
 * Kill #1 via burn DOT (tickEnemyStatus -> statusDamage -> killEnemy fires INSIDE the
 * partitioned updateEnemies, exactly the bug path). Holding must NOT liberate — since
 * P2/S15 that's STRUCTURAL: updateEnemies partitions internally and state.enemies stays
 * the FULL world roster, so killEnemy's inline `.some(holdKey)` sees the other bucket's
 * guardian (the __libGate that used to blind-then-defer this is retired). Kill #2 the
 * same way -> the INLINE path liberates at the kill, same tick, credited to the KILLER's
 * pin (conscious P2/S15 delta: the hero who freed the site draws the reward, not
 * players[0]). Then the identical scenario for a town SIEGE (raidTown ->
 * checkRaidLiberation -> liberateTown), and the _seen sweep's REMAINING job: a guardian
 * removed with NO kill event (the leash-despawn shape) still liberates via the sweep. */
'use strict';
const { World } = require('' + __RR + '/server/world.js');
const G = require('' + __RR + '/server/load-game.js');
const S = G.state;
const TILE = G.TILE || 32;
let failed = false;
const A1 = (name, cond, extra) => { const ok = !!cond; if (!ok) failed = true; console.log((ok ? '  PASS ' : '  FAIL ') + name + (extra !== undefined ? '  [' + extra + ']' : '')); };
const mk = (px, py) => { let e = null; for (let d = 0; d < 10 && !e; d++) e = G.makeWildEnemy(Math.floor(px / TILE) + d, Math.floor(py / TILE)); return e; };
const burnKill = (e) => { e.hp = 1; e.burnT = 18; e.burnDmg = 99999; };   // dies on the NEXT updateEnemies pass (inside the bucket)

const w = new World();
const A = w.addPlayer('A', 'Ava');
const B = w.addPlayer('B', 'Bo');
// far apart -> guaranteed separate combat buckets; both tanky so nobody goes down mid-test
B.x = A.x + 150 * TILE; B.y = A.y;
for (const p of [A, B]) { p.def = 99999; p.maxHp = 999999; p.hp = 999999; }

// --- sanity: the lexical wrappers exist and the gate blocks/passes as designed ---
A1('liberateTown captured', typeof G.liberateTown === 'function');
const TZ = G.getTownZones ? G.getTownZones() : null;
A1('getTownZones live getter works (world-gen towns visible)', Array.isArray(TZ) && TZ.length === 6, 'towns=' + (TZ && TZ.length));

// --- pick a holding, take over its guardian roster with exactly two, one per player ---
const hi = S.holdings.findIndex((h) => h && !h.liberated && !h.built);
A1('found an unliberated holding to test', hi >= 0, 'holdIdx=' + hi);
const hd = S.holdings[hi];
for (let i = S.enemies.length - 1; i >= 0; i--) if (S.enemies[i].holdKey === hi) S.enemies.splice(i, 1);   // clear its real spawn-time guardians
hd._seen = false;
const g1 = mk(A.x + 3 * TILE, A.y), g2 = mk(B.x + 3 * TILE, B.y);
A1('two guardians crafted', !!g1 && !!g2);
g1.holdKey = hi; g2.holdKey = hi;
g1.x = A.x + 90; g1.y = A.y; g2.x = B.x + 90; g2.y = B.y;
S.enemies.push(g1, g2);
for (let i = 0; i < 3; i++) w.tick();
A1('sweep saw the guardians (_seen set), no liberation yet', hd._seen === true && !hd.liberated);

// --- kill guardian #1 inside A's bucket ---
burnKill(g1);
w.tick();
A1('guardian #1 died during partitioned combat', !S.enemies.includes(g1));
A1('holding NOT liberated (other bucket still guards it)  <-- the bug fix', !hd.liberated, 'liberated=' + !!hd.liberated);
A1('guardian #2 still alive in the full roster', S.enemies.includes(g2));
w.tick(); w.tick();
A1('still not liberated two ticks later', !hd.liberated);

// --- kill guardian #2 inside B's bucket -> the INLINE path liberates AT the kill (P2/S15) ---
const bGold0 = B.gold | 0, aGold0 = A.gold | 0;   // the KILLER (B — g2 died in HIS bucket, under his pin) draws the reward
burnKill(g2);
w.tick();
const libNow = !!hd.liberated; if (!libNow) w.tick();
A1('holding LIBERATED once every spawned guardian is dead', !!hd.liberated, libNow ? 'same tick' : 'next tick');
A1('liberation reward went to the KILLER (B), not players[0]', (B.gold | 0) > bGold0, `B gold ${bGold0} -> ${B.gold | 0}`);
A1('players[0] (A) drew no liberation gold for B\'s kill', (A.gold | 0) === aGold0, `A gold ${aGold0} -> ${A.gold | 0}`);

// --- same shape for a town SIEGE (raidTown / checkRaidLiberation -> liberateTown) ---
const ti = 1; const tz = TZ[ti];
tz.besieged = true; tz._seen = false;
const r1 = mk(A.x + 4 * TILE, A.y), r2 = mk(B.x + 4 * TILE, B.y);
A1('two raiders crafted', !!r1 && !!r2);
r1.raidTown = ti; r2.raidTown = ti; r1.dread = true; r2.dread = true;
r1.x = A.x + 70; r1.y = A.y + 30; r2.x = B.x + 70; r2.y = B.y + 30;
S.enemies.push(r1, r2);
for (let i = 0; i < 3; i++) w.tick();
A1('town sweep saw the raiders (_seen), siege holds', tz._seen === true && tz.besieged === true);
burnKill(r1);
w.tick();
A1('raider #1 died in a bucket; town NOT liberated (raider #2 alive elsewhere)', !S.enemies.includes(r1) && tz.besieged === true);
burnKill(r2);
w.tick();
const tLibNow = tz.besieged === false; if (!tLibNow) w.tick();
A1('town liberated once ALL raiders are dead (sweep)', tz.besieged === false, tLibNow ? 'same tick' : 'next tick');

// --- the _seen sweep's REMAINING job (P2/S15): a guardian removed with NO kill event ---
// (the leash-despawn shape: updateEnemies splices a foe that strayed too far off its home
// ring — no killEnemy, no inline check) must still liberate, via the sweep, under players[0].
const hj = S.holdings.findIndex((h, j) => j !== hi && h && !h.liberated && !h.built);
A1('found a second holding for the sweep probe', hj >= 0, 'holdIdx=' + hj);
if (hj >= 0) {
  const hd2 = S.holdings[hj];
  for (let i = S.enemies.length - 1; i >= 0; i--) if (S.enemies[i].holdKey === hj) S.enemies.splice(i, 1);
  hd2._seen = false;
  const g3 = mk(A.x + 5 * TILE, A.y + 2 * TILE);
  A1('sweep-probe guardian crafted', !!g3);
  g3.holdKey = hj; g3.x = A.x + 110; g3.y = A.y + 40;
  S.enemies.push(g3);
  for (let i = 0; i < 3; i++) w.tick();
  A1('sweep saw the lone guardian (_seen), no liberation', hd2._seen === true && !hd2.liberated);
  const i3 = S.enemies.indexOf(g3);
  if (i3 >= 0) S.enemies.splice(i3, 1);              // vanish WITHOUT killEnemy — the leash-despawn shape
  const aGoldPre = A.gold | 0;
  w.tick();
  const swLibNow = !!hd2.liberated; if (!swLibNow) w.tick();
  A1('sweep liberated the kill-less removal', !!hd2.liberated, swLibNow ? 'same tick' : 'next tick');
  A1('sweep credit rides players[0] (A)', (A.gold | 0) > aGoldPre, `A gold ${aGoldPre} -> ${A.gold | 0}`);
}

// --- gate machinery is GONE (P2/S15): no __libGate sets in world.js, no lexical wrappers ---
const fs = require('fs');
const worldSrc = fs.readFileSync(__RR + '/server/world.js', 'utf8');
const loaderSrc = fs.readFileSync(__RR + '/server/load-game.js', 'utf8');
A1('world.js never assigns __libGate', !/__libGate\s*=/.test(worldSrc));
A1('load-game.js carries no liberation wrappers', !/__rawLibHold|__rawClearPOI|__rawLibTown/.test(loaderSrc));

console.log(failed ? '\nT2 RESULT: FAIL' : '\nT2 RESULT: PASS');
process.exit(failed ? 1 : 0);
