const __RR = require('path').resolve(__dirname, '..', '..');
/* t1 — FIX 1: co-op knockdown must NOT run the SP gameOver path.
 * 2 players; lethal hit on A through the REAL playerTakeDamage (whose internal, LEXICAL
 * call to gameOver() is the thing being hooked). Assert scene stays 'play', A goes downed,
 * warlord levels/ranks/grudges untouched, and after bleed-out A respawns at town. */
'use strict';
const { World } = require('' + __RR + '/server/world.js');
const G = require('' + __RR + '/server/load-game.js');
const S = G.state;
const TILE = G.TILE || 32;
let failed = false;
const A1 = (name, cond, extra) => { const ok = !!cond; if (!ok) failed = true; console.log((ok ? '  PASS ' : '  FAIL ') + name + (extra !== undefined ? '  [' + extra + ']' : '')); };

const w = new World();
const A = w.addPlayer('A', 'Ava');
const a0 = { x: A.x, y: A.y };           // A's join point IS the town SPAWN (seq 0, no fan-out offset)
const B = w.addPlayer('B', 'Bo');
// B: far enough to never revive A (REVIVE_R ~83px), tanky enough to never go down himself
B.x = A.x + 340; B.y = A.y + 340;
B.def = 99999; B.maxHp = 999999; B.hp = 999999;
for (let i = 0; i < 20; i++) w.tick();   // warm up (first _rescaleThreats catch-up happens here)

const wlSnap = () => JSON.stringify({
  w: (S.legion && S.legion.warlords || []).map((x) => ({ id: x.id, level: x.level, rank: x.rank, grudge: x.grudge })),
  o: S.legion && S.legion.overlord ? { level: S.legion.overlord.level, rank: S.legion.overlord.rank } : null,
});
const before = wlSnap();

// hook sanity: world.js installed the MP no-op
A1('__onGameOver installed', typeof global.__onGameOver === 'function');

// lethal hit through the REAL game path (its internal gameOver() call is lexical)
S.player = A; S.inventory = A.inventory;
A.invuln = 0; A.evasion = 0; A.hp = 1;
G.playerTakeDamage(99999);
A1('hp pinned to 0 by playerTakeDamage', A.hp === 0, 'hp=' + A.hp);
A1('scene still play right after lethal hit (gameOver rerouted)', S.scene === 'play', 'scene=' + S.scene);

w.tick();
A1('A is DOWNED after the tick (goDown fired off hp<=0)', A.downed === true);
A1('scene stays play after the tick', S.scene === 'play', 'scene=' + S.scene);
A1('warlords unchanged right after knockdown (no nemesisGrows)', wlSnap() === before);

// bleed-out: keep one foe pinned on A (danger radius) so the timer actually drains;
// B stays far, so no revive — A must eventually truly die and respawn at town.
let foe = null;
for (let d = 1; d < 8 && !foe; d++) foe = G.makeWildEnemy(Math.floor(A.x / TILE) + d, Math.floor(A.y / TILE));
A1('pinned foe spawned', !!foe);
foe.atk = 0; S.enemies.push(foe);
let sceneOk = true, respTick = -1;
for (let i = 0; i < 1200; i++) {
  foe.x = A.x + 10; foe.y = A.y; foe.hp = foe.maxHp;   // re-pin (it chases B otherwise) + keep it alive
  w.tick();
  if (S.scene !== 'play') sceneOk = false;
  if (A._respawned && respTick < 0) { respTick = i; break; }
}
A1('scene stayed play through the whole bleed-out', sceneOk);
A1('A respawned after bleed-out (~960 ticks @80Hz)', A._respawned === 1, 'at tick ' + respTick);
A1('A restored: standing, full hp', A.downed === false && A.hp === A.maxHp, 'hp=' + A.hp + '/' + A.maxHp);
A1('A respawned at town spawn (exact SPAWN coords, overworld, invulnerable)', A.x === a0.x && A.y === a0.y && A.map === 'overworld' && A.invuln > 0, `pos=${A.x},${A.y} vs spawn=${a0.x},${a0.y}`);
for (let i = 0; i < 10; i++) w.tick();
A1('warlords STILL unchanged after the whole ordeal', wlSnap() === before);
A1('B untouched (never downed)', !B.downed);

console.log(failed ? '\nT1 RESULT: FAIL' : '\nT1 RESULT: PASS');
process.exit(failed ? 1 : 0);
