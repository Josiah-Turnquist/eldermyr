/* diag: does an enemy actually damage a player in the authoritative server sim?
 * Spawns one enemy on top of a stationary player and ticks; checks HP drop.
 * Also calls updateEnemies directly to surface any error the tick() try/catch swallows. */
'use strict';
const { World } = require('../server/world');
const G = require('./load-game');
const TILE = G.TILE || 32;

const w = new World();
const A = w.addPlayer('A', 'Ava');
A.level = 5; A.hp = A.maxHp = 60;

// clean slate: one enemy right next to A
G.state.enemies.length = 0;
const e = G.makeWildEnemy(Math.floor(A.x / TILE), Math.floor(A.y / TILE));
e.x = A.x + 12; e.y = A.y; e.hp = e.maxHp = 9999;   // beefy so A can't kill it
G.state.enemies.push(e);

// 1) does updateEnemies throw in the partition context? (tick() swallows it)
let threw = null;
try { G.state.player = A; G.state.inventory = A.inventory; G.updateEnemies(); }
catch (err) { threw = String((err && err.stack || err)).split('\n').slice(0, 4).join(' | '); }

// 2) tick and watch A's HP (A sends no input, just stands there)
const hp0 = A.hp;
let minHp = A.hp, invulnSeen = false;
for (let i = 0; i < 600; i++) {
  w.tick();
  if (A.invuln > 0) invulnSeen = true;
  if (A.hp < minHp) minHp = A.hp;
}
console.log(JSON.stringify({
  directUpdateEnemiesThrew: threw,
  hp0, minHp, hpAfter: A.hp,
  tookDamage: minHp < hp0,
  invulnEverSet: invulnSeen,
  enemyStillThere: G.state.enemies.includes(e),
  distEnemyToPlayer: Math.round(Math.hypot(e.x - A.x, e.y - A.y)),
  enemyType: e.type, hasEquippedWeaponFn: typeof G.equippedWeapon,
}, null, 2));
