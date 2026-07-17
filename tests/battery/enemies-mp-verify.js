const __RR = require('path').resolve(__dirname, '..', '..');
/* enemies-mp-verify — rebuild P2/S15: the enemy nearest-hero partition INTERNALIZED.
 * (plan §7 S13 sub-slice "enemies": updateEnemies is an A-shape — it partitions foes by
 * nearest hero ITSELF, pins each hero for their bucket in JOIN ORDER, keeps state.enemies
 * the FULL world roster throughout, regroups survivors in bucket order, sends target-less
 * boss-tier foes home, and killEnemy's inline liberation checks are correct again with no
 * __libGate.)
 *
 * Every section drives G.updateEnemies() DIRECTLY (no world.js loop) — on the pre-S15
 * engine that call processes every foe against the ONE pinned state.player (the partition
 * lived in world.js), so each section discriminates:
 *   1. per-foe nearest-hero targeting + bucket-order regroup + the no-restore pin
 *   2. killEnemy credit rides each bucket's OWN hero (XP/gold/slay)
 *   3. boss-tier: town-blind pool (wander home when nobody is targetable; chase the
 *      out-of-town hero even when an in-town one is nearer)
 *   4. downed heroes are invisible to foes
 *   5. full-roster liberation at the kill: last-guardian check sees the OTHER hero's
 *      bucket; the freeing kill pays the KILLER (the __libGate replacement)
 *   6. the internalized fns ship in the built artifact
 *   7. the real w.tick() path still engages both heroes' foes (regression floor)
 */
'use strict';
const { World } = require('' + __RR + '/server/world.js');
const G = require('' + __RR + '/server/load-game.js');
const S = G.state;
const TILE = G.TILE || 32;
let failed = false;
const A1 = (name, cond, extra) => { const ok = !!cond; if (!ok) failed = true; console.log((ok ? '  PASS ' : '  FAIL ') + name + (extra !== undefined ? '  [' + extra + ']' : '')); };
const mk = (px, py) => { let e = null; for (let d = 0; d < 10 && !e; d++) e = G.makeWildEnemy(Math.floor(px / TILE) + d, Math.floor(py / TILE)); return e; };
const plainMelee = (e) => { e.archer = e.flee = e.caster = e.healer = e.charger = false; e.isBoss = e.isNemesis = e.isGreatBeast = e.isWildDragon = false; e.night = false; e.windup = 0; e.stunT = 0; e.burnT = 0; e.poisonT = 0; e.chillT = 0; e.aquatic = false; e.homeDf = undefined; return e; };   // aquatic=false + homeDf=undefined: the probes TELEPORT mk()'s foe (created 0-9 tiles away, where the unseeded type/footprint roll decides WHICH tile succeeded), so near B's steep eastern ring the LEASH branch (homeDf stamped at creation) could trip and its amble-home step into coastal water be blocked — a foe frozen at 0px movement, ~1/4 flake observed on the pre-S16 tree too. Probe foes are leash-exempt (homeDf undefined, the boss rule) and never aquatic (canSailTo refuses every land step).
const burnKill = (e) => { e.hp = 1; e.burnT = 18; e.burnDmg = 99999; };
const d2 = (e, p) => (e.x + e.w / 2 - (p.x + p.w / 2)) ** 2 + (e.y + e.h / 2 - (p.y + p.h / 2)) ** 2;
const drop = (e) => { const i = S.enemies.indexOf(e); if (i >= 0) S.enemies.splice(i, 1); };

const w = new World();
const A = w.addPlayer('A', 'Ava');
const B = w.addPlayer('B', 'Bo');
for (const p of [A, B]) { p.def = 99999; p.maxHp = 999999; p.hp = 999999; }
const SPAWN = { x: A.x, y: A.y };   // A joins at the boot spawn (main-town center-ish)
// Worldgen is UNSEEDED here, so a blind teleport target (SPAWN + N tiles) lands in water/rock on
// some boots — probe foes then can't STEP toward their hero (canMoveTo refuses) and the movement
// asserts flaked ~1/4 (observed identically on the pre-S16 tree). Find the nearest OPEN 3x3 pocket
// (all non-SOLID; WATER is in SOLID) around the intended spot instead; search radius stays small so
// the placement's INTENT (far apart / outside the 20t town bubble) is preserved.
const openNear = (tx, ty, maxR, half) => {
  half = half || 1;
  const clear = (cx, cy) => { for (let dy = -half; dy <= half; dy++) for (let dx = -half; dx <= half; dx++) { let t; try { t = G.getTile('overworld', cx + dx, cy + dy); } catch (_e) { return false; } if (t === undefined || t === null || G.SOLID.has(t)) return false; } return true; };
  for (let r = 0; r <= maxR; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; if (clear(tx + dx, ty + dy)) return { x: (tx + dx) * TILE + 4, y: (ty + dy) * TILE + 4 }; }
  return { x: tx * TILE + 4, y: ty * TILE + 4 };   // absurd fallback: the raw target (old behavior)
};
const STX = Math.floor(SPAWN.x / TILE), STY = Math.floor(SPAWN.y / TILE);
const FAR = openNear(STX + 150, STY, 30, 3);       // B's far-east arena: a 7x7 open pocket (>=120t out on any boot) — probe foes 3t from B step freely

// ---------- 1. per-foe nearest-hero targeting + regroup order + the pin ----------
B.x = FAR.x; B.y = FAR.y;                                        // far apart -> unambiguous nearest
const FB = plainMelee(mk(B.x + 3 * TILE, B.y));                  // pushed FIRST (pre-S15 array order: FB before FA)
const FA = plainMelee(mk(SPAWN.x + 3 * TILE, SPAWN.y));
A1('two probe foes crafted', !!FA && !!FB);
FB.x = B.x + 96; FB.y = B.y; FA.x = A.x + 96; FA.y = A.y;        // 3 tiles: inside melee aggro (190), outside strike range
S.enemies.push(FB, FA);
S.player = A; S.inventory = A.inventory;                          // the pre-S15 trap: ONE pinned hero
const dFB0 = d2(FB, B), dFA0 = d2(FA, A);
G.updateEnemies();                                                // ONE direct call — no world.js partition around it
A1('B\'s foe stepped toward B (not the pinned A)', d2(FB, B) < dFB0, `d2 ${Math.round(dFB0)} -> ${Math.round(d2(FB, B))}`);
A1('A\'s foe stepped toward A', d2(FA, A) < dFA0);
A1('survivors regrouped in bucket order (A\'s foes before B\'s)', S.enemies.indexOf(FA) >= 0 && S.enemies.indexOf(FB) > S.enemies.indexOf(FA), `idx FA=${S.enemies.indexOf(FA)} FB=${S.enemies.indexOf(FB)}`);
A1('ambient pin = last roster hero after the call (the no-restore contract)', S.player === B);

// ---------- 2. killEnemy credit rides each bucket's OWN hero ----------
const GA = plainMelee(mk(SPAWN.x + 4 * TILE, SPAWN.y)), GB = plainMelee(mk(B.x + 4 * TILE, B.y));
A1('two credit foes crafted', !!GA && !!GB);
GA.x = A.x + 80; GA.y = A.y; GB.x = B.x + 80; GB.y = B.y;
GA.xp = 50; GA.gold = 10; GB.xp = 50; GB.gold = 10;
S.enemies.push(GA, GB);
burnKill(GA); burnKill(GB);
const a0 = { xp: A.xp, gold: A.gold | 0, slay: A.quests.slay.count | 0 };
const b0 = { xp: B.xp, gold: B.gold | 0, slay: B.quests.slay.count | 0 };
S.player = A; S.inventory = A.inventory;                          // wrong-pin trap again
G.updateEnemies();                                                // both die this call, one per bucket
A1('both credit foes died in one call', !S.enemies.includes(GA) && !S.enemies.includes(GB));
A1('A credited for HIS bucket\'s kill (xp/gold/slay)', A.xp > a0.xp && (A.gold | 0) === a0.gold + 10 && (A.quests.slay.count | 0) === a0.slay + 1, `xp +${A.xp - a0.xp} gold +${(A.gold | 0) - a0.gold} slay +${(A.quests.slay.count | 0) - a0.slay}`);
A1('B credited for HIS bucket\'s kill (xp/gold/slay)', B.xp > b0.xp && (B.gold | 0) === b0.gold + 10 && (B.quests.slay.count | 0) === b0.slay + 1, `xp +${B.xp - b0.xp} gold +${(B.gold | 0) - b0.gold} slay +${(B.quests.slay.count | 0) - b0.slay}`);

// ---------- 3. boss-tier: town-blind pool -> wander home; chase the OUT-of-town hero ----------
B.x = SPAWN.x + TILE; B.y = SPAWN.y;                              // both heroes IN the main-town bubble
const BOSSY = plainMelee(mk(SPAWN.x + 8 * TILE, SPAWN.y + 2 * TILE));
A1('boss probe crafted', !!BOSSY);
BOSSY.isBoss = true; BOSSY.specialCd = 9999; BOSSY.speed = 2;
BOSSY.x = SPAWN.x + 8 * TILE; BOSSY.y = SPAWN.y;
BOSSY.tele = { t: 99, max: 99, name: 'slam' }; BOSSY.chargeState = 3;   // wanderEnemyHome must clear these; updateBoss would tick tele and keep chargeState
S.enemies.push(BOSSY);
S.player = A; S.inventory = A.inventory;
G.updateEnemies();
A1('target-less boss dropped its wind-up (tele/chargeState cleared -> wandering home)', BOSSY.tele === null && BOSSY.chargeState === 0, `tele=${JSON.stringify(BOSSY.tele)} charge=${BOSSY.chargeState}`);
{ const OUT = openNear(STX + 40, STY, 8, 1); B.x = OUT.x; B.y = OUT.y; }   // B leaves town (bubble is 20t; pocket search keeps >=32t); boss sits ~15t from B
{ const BP = openNear(Math.floor(B.x / TILE) - 15, Math.floor(B.y / TILE), 8, 1); BOSSY.x = BP.x; BOSSY.y = BP.y; }   // the boss too starts in an open pocket, or a rocky boot pins it and the chase assert flakes
const dBoss0 = d2(BOSSY, B);
S.player = A; S.inventory = A.inventory;                          // A (in town, nearer the old spot) stays pinned — the trap
G.updateEnemies();
A1('boss chases the OUT-of-town hero (in-town A is invisible to it)', d2(BOSSY, B) < dBoss0, `d2 ${Math.round(dBoss0)} -> ${Math.round(d2(BOSSY, B))}`);
drop(BOSSY);

// ---------- 4. downed heroes are invisible to foes ----------
B.x = FAR.x; B.y = FAR.y;
B.downed = true;
const FD = plainMelee(mk(B.x + 4 * TILE, B.y));
A1('downed-probe foe crafted', !!FD);
FD.x = B.x + 100; FD.y = B.y;
S.enemies.push(FD);
const fd0 = { x: FD.x, y: FD.y };
S.player = B; S.inventory = B.inventory;                          // pre-S15: the pinned DOWNED hero still got chased
G.updateEnemies();
A1('foe ignores the downed hero beside it (buckets to far-away A, out of aggro -> stands)', FD.x === fd0.x && FD.y === fd0.y, `moved ${Math.round(Math.hypot(FD.x - fd0.x, FD.y - fd0.y))}px`);
B.downed = false;
drop(FD); drop(FA); drop(FB);

// ---------- 5. full-roster liberation AT the kill; the freeing kill pays the KILLER ----------
const hi = S.holdings.findIndex((h) => h && !h.liberated && !h.built);
A1('found an unliberated holding', hi >= 0, 'holdIdx=' + hi);
const hd = S.holdings[hi];
for (let i = S.enemies.length - 1; i >= 0; i--) if (S.enemies[i].holdKey === hi) S.enemies.splice(i, 1);
hd._seen = false;
const g1 = plainMelee(mk(SPAWN.x + 5 * TILE, SPAWN.y)), g2 = plainMelee(mk(B.x + 5 * TILE, B.y));
A1('two guardians crafted', !!g1 && !!g2);
g1.holdKey = hi; g2.holdKey = hi;
g1.x = A.x + 90; g1.y = A.y; g2.x = B.x + 90; g2.y = B.y;
g1.gold = 10; g2.gold = 10;
S.enemies.push(g1, g2);
burnKill(g1); burnKill(g2);
const aG0 = A.gold | 0, bG0 = B.gold | 0;
S.player = A; S.inventory = A.inventory;
G.updateEnemies();                                                // g1 dies in A's pass (g2 still guards -> no liberation), g2 in B's (last -> inline liberation under B)
A1('both guardians died in one call', !S.enemies.includes(g1) && !S.enemies.includes(g2));
A1('holding liberated INLINE at the last kill', hd.liberated === true);
A1('liberation reward paid the KILLER (B: kill gold + >=80 site gold)', (B.gold | 0) >= bG0 + 80 + 10, `B gold ${bG0} -> ${B.gold | 0}`);
A1('A drew only his own kill gold (no site reward for g1)', (A.gold | 0) === aG0 + 10, `A gold ${aG0} -> ${A.gold | 0}`);

// ---------- 6. the internalized partition ships in the built artifact ----------
const fs = require('fs');
const gamePath = process.env.GAME_HTML || process.env.ELDERMYR_GAME_FILE || (__RR + '/dist/eldermyr.html');
const html = fs.readFileSync(require('path').resolve(gamePath), 'utf8');
A1('artifact carries updateEnemiesFor (the SP body)', /function updateEnemiesFor\s*\(/.test(html));
A1('artifact carries the in-sim partition helpers', /function nearestHeroTo\s*\(/.test(html) && /function wanderEnemyHome\s*\(/.test(html) && /function heroInSpawnTown\s*\(/.test(html));

// ---------- 7. regression floor: the real w.tick() path engages BOTH heroes' foes ----------
const TA = plainMelee(mk(SPAWN.x + 4 * TILE, SPAWN.y + 3 * TILE)), TB = plainMelee(mk(B.x + 4 * TILE, B.y + 3 * TILE));
A1('two tick-probe foes crafted', !!TA && !!TB);
TA.x = A.x + 96; TA.y = A.y; TB.x = B.x + 96; TB.y = B.y;   // 3t: inside each hero's open pocket (FAR is 7x7-clear), outside strike range — the foe must WALK
S.enemies.push(TA, TB);
const tA0 = d2(TA, A), tB0 = d2(TB, B);
A.held = {}; B.held = {};
for (let i = 0; i < 12; i++) w.tick();
A1('through w.tick(): A\'s foe closed on A', !S.enemies.includes(TA) || d2(TA, A) < tA0);
A1('through w.tick(): B\'s foe closed on B', !S.enemies.includes(TB) || d2(TB, B) < tB0);

console.log(failed ? '\nENEMIES-MP RESULT: FAIL' : '\nENEMIES-MP RESULT: PASS');
process.exit(failed ? 1 : 0);
