/* diag: bosses ignore town players + wander home when everyone's in town */
'use strict';
const { World } = require('../server/world');
const G = require('./load-game');
const TILE = G.TILE || 32;
const w = new World();
const A = w.addPlayer('A', 'Ava');            // sits in town (at spawn)
const B = w.addPlayer('B', 'Bo');
A.hp = A.maxHp = 100; B.hp = B.maxHp = 100;

function mkBoss(x, y) {
  const e = G.makeWildEnemy(Math.floor(x / TILE), Math.floor(y / TILE));
  e.isBoss = true; e.name = 'Test Boss'; e.hp = e.maxHp = 99999; e.atk = 25;   // generic boss (nemesis gets Vale-culled)
  e.x = x; e.y = y; e.tele = null; e.dash = null;
  return e;
}

// --- Test 1: boss sits RIGHT NEXT TO the town player A, but B is outside town →
//     boss must ignore adjacent A (in town) and never hurt her ---
B.x = A.x + 30 * TILE; B.y = A.y;
G.state.enemies.length = 0;
const b1 = mkBoss(A.x + 14, A.y);            // adjacent to A
G.state.enemies.push(b1);
const aHp0 = A.hp;
for (let i = 0; i < 200; i++) w.tick();
const test1 = { A_unhurt_despite_adjacent_boss: A.hp === aHp0, boss_left_town: Math.hypot(b1.x - A.x, b1.y - A.y) > 3 * TILE };

// --- Test 2: EVERYONE in town → boss should wander toward the map edge (away from town) ---
B.x = A.x + 2 * TILE; B.y = A.y;              // B now in town too
G.state.enemies.length = 0;
const b2 = mkBoss(A.x + 5 * TILE, A.y);
G.state.enemies.push(b2);
const d0 = Math.hypot(b2.x - A.x, b2.y - A.y);
for (let i = 0; i < 150; i++) w.tick();
const d1 = Math.hypot(b2.x - A.x, b2.y - A.y);
const test2 = { bossWanderedAwayFromTown: d1 > d0 + 40, distBefore: Math.round(d0), distAfter: Math.round(d1), A_unhurt: A.hp === 100 && B.hp === 100 };

console.log(JSON.stringify({ withOutsidePlayer: test1, everyoneInTown: test2 }, null, 2));
