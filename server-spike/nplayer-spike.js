/*
 * nplayer-spike.js — SECOND FEASIBILITY GATE: N players in ONE shared world.
 * -----------------------------------------------------------------------------
 * The risk the first spike did NOT test: Eldermyr assumes a singular
 * `state.player`. This proves the "rotation model" makes N players coexist and
 * be driven independently in one shared sim, and that the only shared-world
 * touch-point (enemies targeting "the player") generalizes to nearest-of-N with
 * a tiny, localized change.
 *
 * Model under test:
 *   - state.players = [A, B, ...]; each has its own `input` (held keys).
 *   - Per tick: for each player P → set the acting player + its input, run the
 *     PER-PLAYER functions (updatePlayer/companions/fatigue). Then run the
 *     SHARED world functions ONCE (enemies/projectiles/spawn/weather/...).
 *   - Enemy targeting becomes nearestPlayer(enemy, players) — the 4-line change
 *     updateEnemies needs — verified here as a standalone unit.
 *
 * Run: node server-spike/nplayer-spike.js   (touches nothing in the shipping game)
 */
'use strict';
const G = require('./load-game');
const TILE = G.TILE || 32;
const report = { boot: {}, coexist: {}, targeting: {}, combatPerPlayer: {}, perf: {}, notes: [] };

// ---- boot the shared world ----
G.startGame();
report.boot = {
  scene: G.state.scene, map: `${G.maps.overworld[0].length}x${G.maps.overworld.length}`,
  enemies: G.state.enemies.length,
};

// ---- build N players from the game's own player object ----
// Deep-clone so each is fully independent (all combat fields, cooldowns, etc.).
function clonePlayer(src, dx, dy) {
  const c = structuredClone(src);
  c.x = src.x + dx; c.y = src.y + dy;
  c.input = {};                    // this player's held-keys
  return c;
}
const A = G.state.player;          // reuse the booted player as player A
A.input = {};
A.pid = 'A';
const B = clonePlayer(A, 6 * TILE, 0); B.pid = 'B';    // 6 tiles east of A
const players = [A, B];
G.state.players = players;

// Drive the global `keys` object from a given player's input each time we tick it.
function setKeys(input) { for (const k in G.keys) delete G.keys[k]; Object.assign(G.keys, input); }

// PER-PLAYER slice of the loop (functions that act on the acting player).
function tickPlayer(P) {
  G.state.player = P;
  setKeys(P.input);
  G.updatePlayer();
  if (G.updateCompanions) G.updateCompanions();
  if (G.updateFatigue) G.updateFatigue();
}
// SHARED world slice (run once per tick). For this coexistence run, enemies act
// vs. players[0]; targeting-of-nearest is proven separately below.
function tickShared() {
  G.state.player = players[0];
  G.updateTime(); G.updateEnemies(); G.updateProjectiles(); G.maybeSpawnWild();
  G.updateFires(); G.updateWeather(); G.updateEvents(); G.updateFactionWar();
  if (G.updateNemesisPresence) G.updateNemesisPresence();
}
function multiTick() { for (const P of players) tickPlayer(P); tickShared(); }

// ===========================================================================
// TEST 1 — coexistence + INDEPENDENT input (A walks east, B walks south)
// ===========================================================================
A.input = { d: true };             // east
B.input = { s: true };             // south
const a0 = [A.x, A.y], b0 = [B.x, B.y];
let err = null, ok = 0;
const N = 3000;
for (let i = 0; i < N; i++) {
  try { multiTick(); ok++; } catch (e) { err = { tick: i, msg: String(e && e.message || e), stack: (e && e.stack || '').split('\n').slice(1, 4).join(' | ') }; break; }
}
report.coexist = {
  ticksOk: ok, firstError: err,
  A_moved_east: (A.x - a0[0] > 50) && Math.abs(A.y - a0[1]) < Math.abs(A.x - a0[0]),
  B_moved_south: (B.y - b0[1] > 50) && Math.abs(B.x - b0[0]) < Math.abs(B.y - b0[1]),
  A_pos: [Math.round(A.x), Math.round(A.y)], B_pos: [Math.round(B.x), Math.round(B.y)],
  bothFinite: [A.x, A.y, B.x, B.y].every(Number.isFinite),
  stayedDistinct: Math.hypot(A.x - B.x, A.y - B.y) > TILE,
};

// ===========================================================================
// TEST 2 — nearest-player targeting (the exact updateEnemies change)
// This is the 4-line generalization: inside the per-enemy loop, replace
// `const p=state.player` with the nearest player to THAT enemy.
// ===========================================================================
function nearestPlayer(e, ps) {
  const ex = e.x + e.w / 2, ey = e.y + e.h / 2;
  let best = null, bd = Infinity;
  for (const P of ps) { const d = Math.hypot((P.x + P.w / 2) - ex, (P.y + P.h / 2) - ey); if (d < bd) { bd = d; best = P; } }
  return { player: best, dist: bd };
}
// place A and B far apart; an enemy near each should pick the correct one, and
// an enemy that moves across the midpoint should switch targets.
A.x = 1000; A.y = 1000; B.x = 3000; B.y = 1000;
const nearA = { x: 1100, y: 1000, w: A.w, h: A.h };
const nearB = { x: 2900, y: 1000, w: A.w, h: A.h };
const mover = { x: 1400, y: 1000, w: A.w, h: A.h };
report.targeting = {
  enemyNearA_picks: nearestPlayer(nearA, players).player.pid,          // expect A
  enemyNearB_picks: nearestPlayer(nearB, players).player.pid,          // expect B
  mover_at_1400_picks: nearestPlayer(mover, players).player.pid,       // expect A (closer to 1000)
  mover_at_2600_picks: nearestPlayer({ x: 2600, y: 1000, w: A.w, h: A.h }, players).player.pid, // expect B
  correct: nearestPlayer(nearA, players).player.pid === 'A' &&
           nearestPlayer(nearB, players).player.pid === 'B' &&
           nearestPlayer(mover, players).player.pid === 'A' &&
           nearestPlayer({ x: 2600, y: 1000, w: A.w, h: A.h }, players).player.pid === 'B',
};

// ===========================================================================
// TEST 3 — combat credits the ACTING player (rotation model → per-player gold/xp)
// ===========================================================================
function spawnNear(P, n) {
  let made = 0;
  for (let k = 0; k < n; k++) {
    const e = G.makeWildEnemy(Math.floor(P.x / TILE) + 1 + k, Math.floor(P.y / TILE));
    if (e) { e.x = P.x + (k + 1) * 10; e.y = P.y; G.state.enemies.push(e); made++; }
  }
  return made;
}
function killNearest(P, n) {
  G.state.player = P;                 // killEnemy credits state.player
  const foes = G.state.enemies.filter((e) => Math.hypot((e.x) - P.x, (e.y) - P.y) < 400).slice(0, n);
  let killed = 0;
  for (const e of foes) { try { e.hp = 0; G.killEnemy(e); killed++; } catch (_e) { break; } }
  return killed;
}
const aGold0 = A.gold, aXp0 = A.xp + A.level * 1e6;
const bGold0 = B.gold, bXp0 = B.xp + B.level * 1e6;
const spawnedA = spawnNear(A, 3), spawnedB = spawnNear(B, 3);
const killedA = killNearest(A, 3), killedB = killNearest(B, 3);
report.combatPerPlayer = {
  spawnedNearA: spawnedA, spawnedNearB: spawnedB, killedByA: killedA, killedByB: killedB,
  A_gained_gold: A.gold - aGold0 > 0, B_gained_gold: B.gold - bGold0 > 0,
  A_gained_xp: (A.xp + A.level * 1e6) - aXp0 > 0, B_gained_xp: (B.xp + B.level * 1e6) - bXp0 > 0,
  creditedIndependently: (A.gold - aGold0 > 0) && (B.gold - bGold0 > 0),
};

// ===========================================================================
// TEST 4 — perf with N players (does the rotation model scale?)
// ===========================================================================
A.input = { d: true }; B.input = { a: true };
for (const label of [2, 4, 8]) {
  while (players.length < label) { const p = clonePlayer(A, players.length * 40, 20); p.pid = 'P' + players.length; p.input = { w: true }; players.push(p); }
  const M = 2000, t0 = process.hrtime.bigint();
  for (let i = 0; i < M; i++) multiTick();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  report.perf['players_' + label] = { perTickMs: +(ms / M).toFixed(4), hz: Math.round(1000 / (ms / M)) };
}

// ---- verdict ----
const c = report.coexist, tg = report.targeting, cp = report.combatPerPlayer;
const green = c.ticksOk === N && c.A_moved_east && c.B_moved_south && c.bothFinite && c.stayedDistinct &&
  tg.correct && cp.creditedIndependently;
report.notes.push('Rotation model = set acting player + its input, run per-player fns; run shared world once.');
report.notes.push('updateEnemies change = replace `const p=state.player` with nearestPlayer(e,state.players) inside the per-enemy loop (~4 lines).');
report.notes.push('Per-player inventory not modeled here (shared state.inventory); the real refactor gives each player its own — additive, not blocking.');

console.log('\n' + '='.repeat(74));
console.log('  ELDERMYR — N-PLAYERS-IN-ONE-WORLD SPIKE');
console.log('='.repeat(74));
console.log(JSON.stringify(report, null, 2));
console.log('\n' + '-'.repeat(74));
console.log(green
  ? '  ✅ GREEN — two players coexist, move on independent input, fight & bank\n     their own gold/xp in one shared world; nearest-of-N targeting is a\n     4-line localized change. The singular-player assumption is tractable.'
  : '  ⚠  NOT GREEN — inspect the failing section above.');
console.log('-'.repeat(74) + '\n');
process.exit(green ? 0 : 3);
