/* diag: can the SECOND player (not players[0]) be hurt by melee vs ranged enemies? */
'use strict';
const { World } = require('../server/world');
const G = require('./load-game');
const TILE = G.TILE || 32;
const w = new World();
const A = w.addPlayer('A', 'Ava');
const B = w.addPlayer('B', 'Bo');
B.x = A.x + 1600; B.y = A.y;                 // B far from A so B's enemies bucket to B
A.hp = A.maxHp = 100; B.hp = B.maxHp = 100;

// --- MELEE: a plain skeleton right next to B ---
G.state.enemies.length = 0; G.state.projectiles.length = 0;
const m = G.makeWildEnemy(Math.floor(B.x / TILE), Math.floor(B.y / TILE));
m.x = B.x + 14; m.y = B.y; m.hp = m.maxHp = 9999; m.atk = 20;
m.type = 'skeleton'; m.caster = false; m.charger = false; m.windup = 0;
G.state.enemies.push(m);
const bMelee0 = B.hp;
for (let i = 0; i < 300; i++) w.tick();
const melee = { B_tookMelee: B.hp < bMelee0, B_hp: Math.round(B.hp) };

// --- RANGED: a caster near B (its bolts should hit B) ---
B.hp = B.maxHp = 100; A.hp = A.maxHp = 100;
G.state.enemies.length = 0; G.state.projectiles.length = 0;
const c = G.makeWildEnemy(Math.floor(B.x / TILE), Math.floor(B.y / TILE));
c.x = B.x + 130; c.y = B.y; c.hp = c.maxHp = 9999; c.atk = 20; c.caster = true; c.castCd = 0;
G.state.enemies.push(c);
const bRanged0 = B.hp;
for (let i = 0; i < 500; i++) w.tick();
const ranged = { B_tookRanged: B.hp < bRanged0, B_hp: Math.round(B.hp), projInWorld: G.state.projectiles.length };

console.log(JSON.stringify({ melee, ranged, A_unhurt: A.hp === 100 }, null, 2));
