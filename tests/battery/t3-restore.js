const __RR = require('path').resolve(__dirname, '..', '..');
/* t3 — FIX 3: the dungeon phase must restore the overworld even when a sim call throws.
 * A enters the real dungeon (key + entrance tile + interact). Then G.isExhausted is
 * monkeypatched to throw ONLY while the dungeon world is swapped into S (world.js calls it
 * unwrapped inside the phase) -> the tick throws mid-phase -> the finally must still put
 * the overworld back. Overworld ARRAY IDENTITY is the proof (same objects, not lookalikes). */
'use strict';
const { World } = require('' + __RR + '/server/world.js');
const G = require('' + __RR + '/server-spike/load-game.js');
const S = G.state;
const TILE = G.TILE || 32;
let failed = false;
const A1 = (name, cond, extra) => { const ok = !!cond; if (!ok) failed = true; console.log((ok ? '  PASS ' : '  FAIL ') + name + (extra !== undefined ? '  [' + extra + ']' : '')); };

const w = new World();
const A = w.addPlayer('A', 'Ava');
const B = w.addPlayer('B', 'Bo');
B.x = A.x + 200; B.y = A.y + 200;
for (const p of [A, B]) { p.def = 99999; p.maxHp = 999999; p.hp = 999999; }
for (let i = 0; i < 10; i++) w.tick();

// --- normal ENTER: stand under the real entrance tile, spend a key, [E] ---
const de = S.dungeonEntrance;
A.inventory.keys = 3;
A.x = de.tx * TILE + 4; A.y = (de.ty + 1) * TILE + 4;
A.actions.push('interact');
w.tick();
A1('A entered the dungeon', A.map === 'dungeon' && !!w.sharedDg);
A1('overworld restored after the entering tick', S.map === 'overworld');
A1('dungeon and overworld enemy lists are distinct', w.sharedDg.enemies !== S.enemies);
const snapA = w.snapshotFor('A'), snapB = w.snapshotFor('B');
A1('snapshots: A sees dungeon, B sees overworld', snapA.map === 'dungeon' && snapB.map === 'overworld' && !!snapA.dgTiles);
for (let i = 0; i < 30; i++) w.tick();
A1('30 mixed ticks fine', S.map === 'overworld' && A.map === 'dungeon');
// NOTE: S.enemies identity is NOT stable by design (partition recombine builds a fresh
// `survivors` array each combat tick) — anchor identity on npcs/pickups/map grid instead.
const owNpcs = S.npcs, owPickups = S.pickups, owMd = G.maps.dungeon;

// --- INJECTED THROW mid-dungeon-phase (after putWorld(sharedDg), before the tail restore) ---
const realExh = G.isExhausted;
G.isExhausted = () => { if (S.map === 'dungeon') throw new Error('injected-boom'); return realExh(); };
let threw = null;
try { w.tick(); } catch (e) { threw = String(e && e.message); }
G.isExhausted = realExh;
A1('tick THREW from inside the dungeon phase', threw === 'injected-boom', 'err=' + threw);
A1('overworld STILL restored (finally ran): map', S.map === 'overworld');
A1('overworld restored by IDENTITY: npcs/pickups arrays', S.npcs === owNpcs && S.pickups === owPickups);
A1('enemies slot holds the overworld roster, not the dungeon one', S.enemies !== w.sharedDg.enemies && S.enemies.some((e) => e.holdKey !== undefined || e.raidTown !== undefined || !e.dungeon));
A1('dungeon grid slot restored (maps.dungeon)', G.maps.dungeon === owMd);
A1('party dungeon instance survives for the delver', !!w.sharedDg && A.map === 'dungeon');
A1('liberation gate not leaked by the aborted phase', !global.__libGate);

// --- room keeps living: more ticks, both worlds sane, snapshots serialize ---
let err2 = null;
try { for (let i = 0; i < 60; i++) { w.tick(); if (S.map !== 'overworld') throw new Error('left swapped at tick ' + i); } } catch (e) { err2 = String(e && e.message); }
A1('60 follow-up ticks clean, overworld in S after every tick', err2 === null, err2 || '');
const snapA2 = w.snapshotFor('A'), snapB2 = w.snapshotFor('B');
A1('post-crash snapshots still healthy (A below, B topside)', snapA2 && snapA2.map === 'dungeon' && snapB2 && snapB2.map === 'overworld');
A1('scene is play, nobody corrupted', S.scene === 'play' && [A.x, A.y, B.x, B.y].every(Number.isFinite));

console.log(failed ? '\nT3 RESULT: FAIL' : '\nT3 RESULT: PASS');
process.exit(failed ? 1 : 0);
